/**
 * D1 / D7 retention by platform and acquisition source, from server-side app
 * opens (retention fix 4). Cohort = the Ads Console sign-up cohort
 * (AdsReportService.reportCohort: same range, report time zone and test-user
 * exclusion); math is pure (lib/retention/app-open-retention.ts).
 */
import { chunk, db, selectAll } from '../ads/services/db';
import { AdsReportService, type RangeQuery } from '../ads/services/report-service';
import { DEFAULT_NOTIFICATION_TZ, isPlaceholderTimezone } from '../notifications/user-timezone';
import {
  buildRetention,
  userPlatform,
  userSource,
  type OpenRow,
  type RetentionReport,
  type RetentionUser,
} from '../retention/app-open-retention';

export interface RetentionApiResponse extends RetentionReport {
  range: { start: string; end: string; timeZone: string };
  excludedUsers: unknown;
  definitions: Record<string, string>;
}

export const RETENTION_DEFINITIONS: Record<string, string> = {
  appOpen:
    'An authenticated GET of /api/mobile/entitlements, /api/mobile/targets or /api/mobile/home-feed. iOS and Android make these on every app open / foreground and never from background syncs. One row per user per local day per platform (app_opens).',
  d1: 'Opened the app (any platform) on the local day after the sign-up day, in the user’s own timezone. Counted once that day has fully passed.',
  d7: 'Opened the app on the 7th local day after the sign-up day. Counted once that day has fully passed.',
  eligibility: 'Only users who signed up after app-open recording started (signalSince) are counted; earlier sign-ups show in signups only.',
  platform: 'Platform of the user’s first recorded open; else the attribution / push-device platform; else unknown.',
  source: 'invite when the user joined through a referral; else the attribution channel (apple_ads, google_ads, organic, …); else unknown.',
};

type OpenWithAt = OpenRow & { first_open_at: string; timezone: string | null };

export class RetentionReportService {
  /** First app_opens row ever (when the signal starts), or null (none / table missing). */
  static async signalSince(): Promise<string | null> {
    const { data, error } = await db().from('app_opens').select('first_open_at').order('first_open_at', { ascending: true }).limit(1);
    if (error) return null;
    return ((data ?? []) as Array<{ first_open_at: string }>)[0]?.first_open_at ?? null;
  }

  static async report(range: RangeQuery): Promise<RetentionApiResponse> {
    const now = range.now ?? new Date();
    const [{ cohort, excluded }, signalSince] = await Promise.all([AdsReportService.reportCohort(range), this.signalSince()]);
    const ids = cohort.map((u) => u.userId);
    const opens = new Map<string, OpenWithAt[]>();
    const tz = new Map<string, string | null>();
    const devicePlatform = new Map<string, string>();
    const invitees = new Set<string>();
    for (const part of chunk(ids, 150)) {
      const [openRows, profiles, tokens, refs] = await Promise.all([
        signalSince
          ? selectAll<OpenWithAt>(() =>
              db().from('app_opens').select('user_id, local_date, platform, first_open_at, timezone').in('user_id', part).order('user_id', { ascending: true }).order('local_date', { ascending: true }).order('platform', { ascending: true })
            )
          : Promise.resolve([] as OpenWithAt[]),
        selectAll<{ id: string; timezone: string | null }>(() => db().from('profiles').select('id, timezone').in('id', part).order('id', { ascending: true })),
        selectAll<{ id: string; user_id: string; platform: string | null }>(() => db().from('push_tokens').select('id, user_id, platform').in('user_id', part).order('id', { ascending: true })),
        selectAll<{ id: string; invitee_id: string }>(() => db().from('referrals').select('id, invitee_id').in('invitee_id', part).order('id', { ascending: true })),
      ]);
      for (const o of openRows) opens.set(o.user_id, [...(opens.get(o.user_id) ?? []), o]);
      for (const p of profiles) tz.set(p.id, p.timezone);
      for (const t of tokens) if (t.platform && !devicePlatform.has(t.user_id)) devicePlatform.set(t.user_id, t.platform);
      for (const r of refs) invitees.add(r.invitee_id);
    }
    const users: RetentionUser[] = cohort.map((u) => {
      const mine = opens.get(u.userId) ?? [];
      const profileTz = tz.get(u.userId);
      const openTz = mine[0]?.timezone;
      return {
        userId: u.userId,
        signupAt: u.signupAt,
        timezone: !isPlaceholderTimezone(profileTz) ? profileTz! : !isPlaceholderTimezone(openTz) ? openTz! : DEFAULT_NOTIFICATION_TZ,
        platform: userPlatform(mine, u.attribution?.platform ?? devicePlatform.get(u.userId)),
        source: userSource(invitees.has(u.userId), u.attribution?.channel),
      };
    });
    const report = buildRetention(users, opens, now, signalSince);
    return {
      range: { start: range.start, end: range.end, timeZone: range.timeZone },
      ...report,
      excludedUsers: excluded,
      definitions: RETENTION_DEFINITIONS,
    };
  }
}
