/**
 * Loads everything the twice-daily ads email needs (lib/ads/email-report.ts)
 * from the Ads Console tables and our own data, and sends it with Resend.
 * Read-only against the database; never calls the ad networks directly (the
 * hourly /api/cron/ads/sync keeps ad_metrics_daily fresh).
 */
import { sendEmail } from '@/lib/email/email-service';

import { reportTimeZone } from '../config';
import { addDays, todayInTz, ymdInTz } from '../dates';
import {
  type AdsEmailReport,
  buildAdsEmailReport,
  type FunnelUser,
  launchDateFrom,
  renderHtml,
  renderSubject,
  renderText,
  type SyncState,
} from '../email-report';
import { dedupeEvents, type RevenueEvent, userOutcome } from '../metrics';
import { classifyTestUser } from '../test-users';
import { AD_CHANNELS, type AdEntityRow, type AttributionRow } from '../types';

import { chunk, db, selectAll } from './db';
import { AdsReportService } from './report-service';
import { AdsSyncService } from './sync-service';

export const DEFAULT_RECIPIENTS = ['ani@inov8rlabs.com'];
/** Never look further back than this for "since launch" (keeps the queries bounded). */
const MAX_LOOKBACK_DAYS = 120;

export function reportRecipients(env: Record<string, string | undefined> = process.env): string[] {
  const list = (env.ADS_REPORT_RECIPIENTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  return list.length ? list : DEFAULT_RECIPIENTS;
}

/** Ads Console in Admin Tools (the old /admin/ads pages on this site redirect there). */
export const ADMIN_TOOLS_ADS_URL = 'https://admintools.inov8rlabs.com/apps/fitcircle/ads';

export function consoleUrl(env: Record<string, string | undefined> = process.env): string {
  const url = (env.ADS_CONSOLE_URL ?? '').trim().replace(/\/+$/, '');
  // Only an https override makes a usable link in an email.
  return /^https:\/\//.test(url) && !/localhost|127\.0\.0\.1/.test(url) ? url : ADMIN_TOOLS_ADS_URL;
}

const normPlatform = (v: unknown): string | null => {
  const s = String(v ?? '').toLowerCase();
  if (s.includes('ios') || s.includes('iphone') || s.includes('ipad')) return 'ios';
  if (s.includes('android')) return 'android';
  if (s.includes('web')) return 'web';
  return null;
};

export interface RenderedAdsReport {
  report: AdsEmailReport;
  subject: string;
  text: string;
  html: string;
}

export class AdsEmailReportService {
  /** Sign-ups launch … today with platform, onboarding, first meal, trial / paid and attribution. */
  static async loadFunnelUsers(start: string, timeZone: string): Promise<FunnelUser[]> {
    const from = new Date(Date.parse(`${start}T00:00:00Z`) - 14 * 3600_000).toISOString();
    const profiles = (
      await selectAll<{ id: string; created_at: string; email: string | null; is_admin: boolean | null; onboarding_completed: boolean | null }>(() =>
        db()
          .from('profiles')
          .select('id, created_at, email, is_admin, onboarding_completed')
          .gte('created_at', from)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
      )
    )
      .map((p) => ({ ...p, day: ymdInTz(p.created_at, timeZone) }))
      .filter((p) => p.day >= start);
    if (!profiles.length) return [];

    const attribution = new Map<string, AttributionRow>();
    const platform = new Map<string, string>();
    const meal = new Set<string>();
    const events = new Map<string, RevenueEvent[]>();

    for (const part of chunk(profiles, 150)) {
      const ids = part.map((p) => p.id);
      const [attr, tokens, food, subs] = await Promise.all([
        selectAll<AttributionRow>(() => db().from('user_attribution').select('*').in('user_id', ids).order('user_id', { ascending: true })),
        selectAll<{ id: string; user_id: string; platform: string | null; created_at: string }>(() =>
          db().from('push_tokens').select('id, user_id, platform, created_at').in('user_id', ids).order('created_at', { ascending: true }).order('id', { ascending: true })
        ),
        selectAll<{ id: string; user_id: string; input_method: string | null }>(() =>
          db().from('food_log_entries').select('id, user_id, input_method').in('user_id', ids).order('id', { ascending: true })
        ),
        selectAll<RevenueEvent>(() =>
          db()
            .from('subscription_events')
            .select('id, user_id, type, store, environment, event_timestamp, raw')
            .in('user_id', ids)
            .eq('environment', 'PRODUCTION')
            .order('id', { ascending: true })
        ),
      ]);
      for (const a of attr) attribution.set(a.user_id, a);
      for (const a of attr) {
        const p = normPlatform(a.platform);
        if (p && !platform.has(a.user_id)) platform.set(a.user_id, p);
      }
      for (const t of tokens) {
        const p = normPlatform(t.platform);
        if (p && !platform.has(t.user_id)) platform.set(t.user_id, p);
      }
      // Health app nutrition imports are not the user logging a meal.
      for (const f of food) if (f.input_method !== 'imported') meal.add(f.user_id);
      for (const e of subs) {
        if (!e.user_id) continue;
        const list = events.get(e.user_id) ?? [];
        list.push(e);
        events.set(e.user_id, list);
      }

      // Last resort for platform: the first home-feed request (every 1.0.8+ app makes one on launch).
      const missing = ids.filter((id) => !platform.has(id));
      if (missing.length) {
        const feed = await selectAll<{ id: string; user_id: string; platform: string | null; created_at: string }>(() =>
          db().from('home_feed_decisions').select('id, user_id, platform, created_at').in('user_id', missing).order('created_at', { ascending: true }).order('id', { ascending: true })
        );
        for (const f of feed) {
          const p = normPlatform(f.platform);
          if (p && !platform.has(f.user_id)) platform.set(f.user_id, p);
        }
      }
    }

    return profiles.map((p) => {
      const a = attribution.get(p.id) ?? null;
      const effective = a && !a.is_test ? a : null;
      const outcome = userOutcome({
        userId: p.id,
        signupAt: p.created_at,
        signupDate: p.day,
        attribution: a,
        firstActivityAt: null,
        events: dedupeEvents(events.get(p.id) ?? []).events,
      });
      const paid = effective && (AD_CHANNELS as string[]).includes(effective.channel) ? effective.channel : null;
      return {
        userId: p.id,
        signupDate: p.day,
        testReason: classifyTestUser({ email: p.email, isAdmin: p.is_admin, mockAttribution: a?.is_test === true }),
        platform: platform.get(p.id) ?? 'unknown',
        onboarded: p.onboarding_completed === true,
        firstMeal: meal.has(p.id),
        trial: outcome.trial,
        payer: outcome.payer,
        paidChannel: paid,
        campaignExternalId: paid ? effective!.campaign_external_id : null,
      };
    });
  }

  static async build(now: Date = new Date()): Promise<RenderedAdsReport> {
    const timeZone = reportTimeZone();
    const today = todayInTz(timeZone, now);
    const floor = addDays(today, -MAX_LOOKBACK_DAYS);

    const [entities, status, lastSuccess] = await Promise.all([AdsReportService.loadEntities(), AdsSyncService.status(), AdsSyncService.lastSuccess()]);
    const campaigns = entities.filter((e): e is AdEntityRow => e.level === 'campaign');
    const metricsAll = await AdsReportService.loadMetrics(floor, today);
    const metricRows = metricsAll.filter((r) => r.level === 'campaign');
    let launch = launchDateFrom(campaigns, metricRows, timeZone, today, now);
    if (launch < floor) launch = floor;

    const users = await this.loadFunnelUsers(launch, timeZone);
    const sync: SyncState[] = status.map((s) => ({
      channel: s.channel,
      configured: s.configured,
      lastSuccessAt: lastSuccess[s.channel] ?? null,
      lastFinishedAt: s.finishedAt,
      lastFinishedOk: s.finishedAt ? s.ok : null,
      lastError: s.error,
    }));

    const report = buildAdsEmailReport({ now, timeZone, consoleUrl: consoleUrl(), entities: campaigns, metricRows, sync, users, launchDate: launch });
    return { report, subject: renderSubject(report), text: renderText(report), html: renderHtml(report) };
  }

  static async send(rendered: RenderedAdsReport, recipients = reportRecipients()): Promise<{ success: boolean; id?: string; error?: string }> {
    return sendEmail({ to: recipients, subject: rendered.subject, html: rendered.html, text: rendered.text });
  }
}
