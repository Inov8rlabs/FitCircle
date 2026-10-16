/**
 * Campaign push + email delivery (docs/CAMPAIGNS_SPEC.md §5, §6), driven by the
 * hourly GET /api/cron/campaigns.
 *
 * Push: an item fires when the recipient's local hour equals `localHour` on a
 * matching local date (launch → starts_at, daily → every live day, last_day →
 * ends_at, custom → sendOn). Dedupe `push:{key}:{localDate}`. Sent through
 * NotificationOrchestrator as type `campaign` (category prefs, daily cap and
 * quiet hours apply). daily_calendar daily reminders skip users who already
 * opened today's door.
 *
 * Email: due from `localHour` onward on the matching local date, ≤ 50 per run
 * per campaign (the next hourly run continues). Dedupe `email:{key}`
 * (`email:{key}:{date}` for daily items). Skips marketingEmails === false.
 */
import { Resend } from 'resend';

import { CampaignError } from '../campaigns/http';
import { dateOfDay, totalDaysOf, type CampaignRow } from '../campaigns/model';
import { firstNameOf, renderPlaceholders, type PlaceholderVars } from '../campaigns/placeholders';
import type { CampaignEmail, CampaignNotification } from '../campaigns/types';
import { campaignPageUrl, campaignUnsubscribeUrl } from '../campaigns/unsubscribe';
import { campaignEmail } from '../email/campaign-emails';
import type { RenderedEmail } from '../email/referral-emails';
import { addDays, daysBetween, isValidTimezone } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';

import { CampaignActivityService } from './campaign-activity-service';
import { CampaignService } from './campaign-service';
import { NotificationOrchestrator } from './notification-orchestrator';
import { PushService } from './push-service';

export const DEFAULT_USER_TZ = 'America/Los_Angeles';
export const EMAILS_PER_RUN_PER_CAMPAIGN = 50;
const PAGE = 1000;
const CHUNK = 200;

interface Recipient {
  id: string;
  email: string | null;
  display_name: string | null;
  username: string | null;
  timezone: string | null;
  preferences: Record<string, any> | null;
}

export interface CronSummary {
  campaigns: number;
  push: { due: number; sent: number; skippedOpened: number; skippedDuplicate: number; failed: number };
  email: { due: number; sent: number; skippedConsent: number; failed: number };
  errors: string[];
}

/**
 * The zone deliveries are scheduled in. profiles.timezone defaults to 'UTC' at
 * the column level, which in practice means "never set" — treated as unset.
 */
export function recipientTimezone(tz: string | null | undefined): string {
  if (!tz || tz === 'UTC' || tz === 'Etc/UTC' || !isValidTimezone(tz)) return DEFAULT_USER_TZ;
  return tz;
}

export function localDateHour(timeZone: string, now: Date): { date: string; hour: number } {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const hour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hour12: false }).format(now), 10) % 24;
  return { date, hour };
}

/** Local dates an item fires on. */
export function targetDates(item: { kind: CampaignNotification['kind']; sendOn?: string | null }, row: CampaignRow): string[] {
  switch (item.kind) {
    case 'launch':
      return [row.starts_at];
    case 'last_day':
      return [row.ends_at];
    case 'custom':
      return item.sendOn ? [item.sendOn] : [];
    case 'daily': {
      const out: string[] = [];
      for (let d = 1; d <= totalDaysOf(row); d++) out.push(dateOfDay(row, d));
      return out;
    }
    default:
      return [];
  }
}

/** Placeholder values for `row` on local `date`. */
export function placeholderVars(row: CampaignRow, date: string, person: { display_name?: string | null; username?: string | null }): PlaceholderVars {
  const inWindow = row.starts_at <= date && date <= row.ends_at;
  const day = inWindow ? daysBetween(row.starts_at, date) + 1 : null;
  const door = day ? (row.calendar?.doors ?? []).find((d) => d.day === day) : undefined;
  return {
    day,
    door_title: door?.title ?? null,
    door_emoji: door?.emoji ?? null,
    days_left: inWindow ? daysBetween(date, row.ends_at) + 1 : null,
    title: row.title,
    first_name: firstNameOf(person.display_name, person.username),
  };
}

export function renderPush(item: CampaignNotification, row: CampaignRow, date: string, person: Recipient | Record<string, any>) {
  const vars = placeholderVars(row, date, person);
  return { title: renderPlaceholders(item.title, vars), body: renderPlaceholders(item.body, vars) };
}

export function renderEmail(item: CampaignEmail, row: CampaignRow, date: string, person: Recipient | Record<string, any>, userId: string): RenderedEmail {
  const vars = placeholderVars(row, date, person);
  return campaignEmail({
    subject: renderPlaceholders(item.subject, vars),
    preheader: renderPlaceholders(item.preheader ?? '', vars),
    heading: renderPlaceholders(item.heading, vars),
    body: renderPlaceholders(item.body, vars),
    ctaLabel: renderPlaceholders(item.ctaLabel, vars) || 'Take a look',
    ctaUrl: campaignPageUrl(row.slug),
    emoji: row.emoji,
    headerImageUrl: row.art?.emailHeader?.url ?? null,
    unsubscribeUrl: campaignUnsubscribeUrl(userId),
  });
}

const pushKey = (key: string, date: string) => `push:${key}:${date}`;
const emailKey = (item: CampaignEmail, date: string) => (item.kind === 'daily' ? `email:${item.key}:${date}` : `email:${item.key}`);

let resend: Resend | null = null;

/** Resend transport for campaign mail. False when unconfigured or rejected. */
export async function sendCampaignEmail(to: string, email: RenderedEmail, unsubscribeUrl: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[CampaignDelivery] RESEND_API_KEY not configured; email skipped');
    return false;
  }
  resend ??= new Resend(key);
  try {
    const { error } = await resend.emails.send({
      from: 'FitCircle <team@fitcircle.ai>',
      replyTo: 'team@fitcircle.ai',
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    if (error) {
      console.error('[CampaignDelivery] Resend rejected email:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error('[CampaignDelivery] email send failed:', err?.message);
    return false;
  }
}

const chunks = <T>(xs: T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export class CampaignDeliveryService {
  /** One hourly run. `now` is injectable for tests. */
  static async runCron(now: Date = new Date()): Promise<CronSummary> {
    const summary: CronSummary = {
      campaigns: 0,
      push: { due: 0, sent: 0, skippedOpened: 0, skippedDuplicate: 0, failed: 0 },
      email: { due: 0, sent: 0, skippedConsent: 0, failed: 0 },
      errors: [],
    };
    const utcToday = now.toISOString().slice(0, 10);
    const near = new Set([addDays(utcToday, -1), utcToday, addDays(utcToday, 1)]);
    const fires = (item: { kind: CampaignNotification['kind']; sendOn?: string | null; enabled: boolean }, row: CampaignRow) =>
      item.enabled && targetDates(item, row).some((d) => near.has(d));

    const rows = (await CampaignService.fetchActiveRows()).filter((r) => r.published && !r.archived_at);
    const ctx = new RunContext(now);
    for (const row of rows) {
      const pushItems = (row.notifications ?? []).filter((n) => fires(n, row));
      const emailItems = (row.emails ?? []).filter((e) => fires(e, row));
      if (pushItems.length === 0 && emailItems.length === 0) continue;
      summary.campaigns++;
      for (const item of pushItems) {
        try {
          await this.deliverPush(row, item, ctx, summary);
        } catch (err: any) {
          summary.errors.push(`${row.slug}/push:${item.key}: ${err?.message ?? err}`);
        }
      }
      if (emailItems.length > 0) {
        try {
          await this.deliverEmails(row, emailItems, ctx, summary);
        } catch (err: any) {
          summary.errors.push(`${row.slug}/email: ${err?.message ?? err}`);
        }
      }
    }
    return summary;
  }

  private static async deliverPush(row: CampaignRow, item: CampaignNotification, ctx: RunContext, summary: CronSummary) {
    const supabase = createAdminSupabase();
    const tokenUsers = await ctx.tokenUsers();
    let audience: string[];
    if (item.audience === 'all') audience = [...tokenUsers];
    else {
      const parts = await ctx.participants(row.id);
      audience = parts.filter((p) => item.audience === 'participants' || p.reminders).map((p) => p.user_id).filter((u) => tokenUsers.has(u));
    }
    if (audience.length === 0) return;

    const dates = new Set(targetDates(item, row));
    const people = await ctx.profiles(audience);
    const due: Array<{ person: Recipient; date: string }> = [];
    for (const id of audience) {
      const person = people.get(id);
      if (!person) continue;
      const { date, hour } = localDateHour(recipientTimezone(person.timezone), ctx.now);
      if (hour === item.localHour && dates.has(date)) due.push({ person, date });
    }
    if (due.length === 0) return;
    summary.push.due += due.length;

    // Dedupe against earlier runs.
    const keys = [...new Set(due.map((d) => pushKey(item.key, d.date)))];
    const already = new Set<string>();
    for (const part of chunks(due.map((d) => d.person.id))) {
      const { data, error } = await supabase
        .from('campaign_deliveries')
        .select('user_id, delivery_key')
        .eq('campaign_id', row.id)
        .in('delivery_key', keys)
        .in('user_id', part);
      if (error) throw error;
      for (const r of (data ?? []) as Array<{ user_id: string; delivery_key: string }>) already.add(`${r.user_id}|${r.delivery_key}`);
    }

    // Calendar reminders: skip whoever already opened today's door.
    const opened = new Set<string>();
    if (row.template === 'daily_calendar' && item.kind === 'daily') {
      const byDate = new Map<string, string[]>();
      for (const d of due) byDate.set(d.date, [...(byDate.get(d.date) ?? []), d.person.id]);
      for (const [date, ids] of byDate) {
        for (const u of await CampaignActivityService.showedUpOn(ids, date)) opened.add(`${u}|${date}`);
      }
    }

    for (const { person, date } of due) {
      const key = pushKey(item.key, date);
      if (already.has(`${person.id}|${key}`)) {
        summary.push.skippedDuplicate++;
        continue;
      }
      if (opened.has(`${person.id}|${date}`)) {
        summary.push.skippedOpened++;
        continue;
      }
      // Claim first: the UNIQUE index makes concurrent runs send once.
      const { error: claimError } = await supabase
        .from('campaign_deliveries')
        .insert({ campaign_id: row.id, user_id: person.id, delivery_key: key, channel: 'push' });
      if (claimError) {
        if ((claimError as any).code === '23505') summary.push.skippedDuplicate++;
        else summary.push.failed++;
        continue;
      }
      const { title, body } = renderPush(item, row, date, person);
      try {
        const res = await NotificationOrchestrator.send(person.id, 'campaign', {
          title,
          body,
          campaignSlug: row.slug,
          campaignId: row.id,
          campaignKey: item.key,
        });
        if (res.sent) summary.push.sent++;
      } catch (err: any) {
        summary.push.failed++;
        console.error('[CampaignDelivery] push failed:', row.slug, item.key, err?.message);
      }
    }
  }

  private static async deliverEmails(row: CampaignRow, items: CampaignEmail[], ctx: RunContext, summary: CronSummary) {
    if (!process.env.RESEND_API_KEY) return;
    const supabase = createAdminSupabase();
    let budget = EMAILS_PER_RUN_PER_CAMPAIGN;
    for (const item of items) {
      if (budget <= 0) break;
      const dates = new Set(targetDates(item, row));
      const keys = item.kind === 'daily' ? [...dates].map((d) => emailKey(item, d)) : [emailKey(item, '')];
      const { data: sentRows, error } = await supabase
        .from('campaign_deliveries')
        .select('user_id, delivery_key')
        .eq('campaign_id', row.id)
        .in('delivery_key', keys);
      if (error) throw error;
      const already = new Set(((sentRows ?? []) as Array<{ user_id: string; delivery_key: string }>).map((r) => `${r.user_id}|${r.delivery_key}`));

      const consider = async (person: Recipient): Promise<boolean> => {
        if (!person.email) return false;
        const { date, hour } = localDateHour(recipientTimezone(person.timezone), ctx.now);
        if (!dates.has(date) || hour < item.localHour) return false;
        const key = emailKey(item, date);
        if (already.has(`${person.id}|${key}`)) return false;
        if (person.preferences?.marketingEmails === false) {
          summary.email.skippedConsent++;
          return false;
        }
        summary.email.due++;
        const { error: claimError } = await supabase
          .from('campaign_deliveries')
          .insert({ campaign_id: row.id, user_id: person.id, delivery_key: key, channel: 'email' });
        if (claimError) return false;
        const unsubscribe = campaignUnsubscribeUrl(person.id);
        const ok = await sendCampaignEmail(person.email, renderEmail(item, row, date, person, person.id), unsubscribe);
        if (ok) {
          summary.email.sent++;
          return true;
        }
        summary.email.failed++;
        // Release the claim so the next run retries.
        await supabase.from('campaign_deliveries').delete().eq('campaign_id', row.id).eq('user_id', person.id).eq('delivery_key', key);
        return true; // counts against the budget either way
      };

      if (item.audience === 'participants') {
        const ids = (await ctx.participants(row.id)).map((p) => p.user_id);
        const people = await ctx.profiles(ids);
        for (const id of ids) {
          if (budget <= 0) break;
          const p = people.get(id);
          if (p && (await consider(p))) budget--;
        }
      } else {
        for (let from = 0; budget > 0; from += PAGE) {
          const { data, error: pageError } = await supabase
            .from('profiles')
            .select('id, email, display_name, username, timezone, preferences')
            .order('id', { ascending: true })
            .range(from, from + PAGE - 1);
          if (pageError) throw pageError;
          const page = (data ?? []) as Recipient[];
          for (const p of page) {
            if (budget <= 0) break;
            if (await consider(p)) budget--;
          }
          if (page.length < PAGE) break;
        }
      }
    }
  }

  /** Marketing opt-out from an email unsubscribe link (preferences.marketingEmails = false). */
  static async optOut(userId: string): Promise<boolean> {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from('profiles').select('preferences').eq('id', userId).maybeSingle();
    if (error) throw error;
    if (!data) return false;
    const prefs = { ...(((data as any).preferences as Record<string, any>) ?? {}), marketingEmails: false };
    const { error: upErr } = await supabase.from('profiles').update({ preferences: prefs }).eq('id', userId);
    if (upErr) throw upErr;
    return true;
  }

  // -------------------------------------------------------------------------
  // Admin test sends (ignore dedupe, audiences, caps; caller only)
  // -------------------------------------------------------------------------

  private static testDate(row: CampaignRow, profile: Record<string, any>): string {
    const today = CampaignService.adminToday(recipientTimezone(profile.timezone));
    const asOf = profile?.preferences?.campaignPreview?.asOf;
    const d = typeof asOf === 'string' ? asOf : today;
    return d >= row.starts_at && d <= row.ends_at ? d : row.starts_at;
  }

  static async sendTestPush(campaignId: string, profile: Record<string, any>, key: string): Promise<{ sent: boolean; devices: number; title: string; body: string }> {
    const row = await CampaignService.fetchById(campaignId);
    const item = (row.notifications ?? []).find((n) => n.key === key);
    if (!item) throw new CampaignError(404, 'NOT_FOUND', `No push message with key "${key}"`);
    const { title, body } = renderPush(item, row, this.testDate(row, profile), profile);
    const devices = await PushService.sendPush(profile.id, {
      title,
      body,
      data: { type: 'campaign', category: 'challenge', screen: 'campaign', campaignSlug: row.slug },
    });
    return { sent: devices > 0, devices, title, body };
  }

  static async sendTestEmail(campaignId: string, profile: Record<string, any>, key: string): Promise<{ sent: boolean; to: string | null; subject: string }> {
    const row = await CampaignService.fetchById(campaignId);
    const item = (row.emails ?? []).find((e) => e.key === key);
    if (!item) throw new CampaignError(404, 'NOT_FOUND', `No email with key "${key}"`);
    let email: string | null = profile.email ?? null;
    if (!email) {
      const { data } = await createAdminSupabase().from('profiles').select('email').eq('id', profile.id).maybeSingle();
      email = (data as { email?: string } | null)?.email ?? null;
    }
    if (!email) throw new CampaignError(400, 'NO_EMAIL', 'Your account has no email address');
    const rendered = renderEmail(item, row, this.testDate(row, profile), profile, profile.id);
    const sent = await sendCampaignEmail(email, { ...rendered, subject: `[Test] ${rendered.subject}` }, campaignUnsubscribeUrl(profile.id));
    return { sent, to: email, subject: rendered.subject };
  }
}

/** Per-run caches (token holders, participants, profiles). */
class RunContext {
  private tokens: Set<string> | null = null;
  private parts = new Map<string, Array<{ user_id: string; reminders: boolean }>>();
  private people = new Map<string, Recipient>();
  constructor(public readonly now: Date) {}

  async tokenUsers(): Promise<Set<string>> {
    if (this.tokens) return this.tokens;
    const supabase = createAdminSupabase();
    const ids = new Set<string>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from('push_tokens').select('user_id').eq('is_active', true).range(from, from + PAGE - 1);
      if (error) throw error;
      for (const r of (data ?? []) as Array<{ user_id: string }>) ids.add(r.user_id);
      if ((data ?? []).length < PAGE) break;
    }
    this.tokens = ids;
    return ids;
  }

  async participants(campaignId: string) {
    if (this.parts.has(campaignId)) return this.parts.get(campaignId)!;
    const supabase = createAdminSupabase();
    const out: Array<{ user_id: string; reminders: boolean }> = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('campaign_participants')
        .select('user_id, reminders')
        .eq('campaign_id', campaignId)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...((data ?? []) as typeof out));
      if ((data ?? []).length < PAGE) break;
    }
    this.parts.set(campaignId, out);
    return out;
  }

  async profiles(ids: string[]): Promise<Map<string, Recipient>> {
    const missing = [...new Set(ids)].filter((id) => !this.people.has(id));
    const supabase = createAdminSupabase();
    for (const part of chunks(missing)) {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, display_name, username, timezone, preferences')
        .in('id', part);
      if (error) throw error;
      for (const p of (data ?? []) as Recipient[]) this.people.set(p.id, p);
    }
    return this.people;
  }
}
