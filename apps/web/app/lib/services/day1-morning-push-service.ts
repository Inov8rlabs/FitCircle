/**
 * Guaranteed Day-1 morning push (retention fix 1, 2026-11-09). Policy + copy are
 * pure (lib/journey/day1-morning.ts); this does the reads and the send.
 *
 * Runs inside the 15-minute meal-reminders cron. Per run:
 *   1. candidates: profiles created 6–60 h ago (the Day-1 morning of every
 *      timezone falls in that range), not test / internal accounts, with an
 *      active push device;
 *   2. due: the user's local morning hour on the day after their sign-up day
 *      (remote config day1_morning_push / day1_morning_push_hour, per user);
 *   3. skip when already attempted (any notification_log row with the dedupe
 *      key, including a quiet-hours hold) or when the user already opened the
 *      app that morning (AppOpenService.openedSince);
 *   4. build the message from Day-0 facts and send through
 *      NotificationOrchestrator: Journey toggle + push master switch, the daily
 *      cap (counts toward it), quiet hours (held, then released — fix 2),
 *      dedupe key `day1_morning:<userId>` (one per user, ever).
 *
 * Volume: one push per new user at most (≈ the daily sign-ups with a device).
 */
import { classifyTestUser } from '../ads/test-users';
import { PUBLIC_CIRCLE_IDS } from '../ads/virality';
import {
  DAY1_PUSH_TYPE,
  DEFAULT_DAY1_HOUR,
  MORNING_STARTS_HOUR,
  chooseDay1Message,
  day1DedupeKey,
  day1Window,
  type Day1Circle,
  type Day1Facts,
} from '../journey/day1-morning';
import { resolveNotificationTimezone } from '../notifications/user-timezone';
import { flaggedTestDevice, onlyEmulatorDevices } from '../onboarding-nudges/policy';
import { addDays } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';

import { AppOpenService } from './app-open-service';
import { NotificationOrchestrator, startOfLocalDay } from './notification-orchestrator';

const MIN_AGE_HOURS = 6;
const MAX_AGE_HOURS = 60;
const CANDIDATE_LIMIT = 500;
const RECENT_SETUP_PUSH_HOURS = 6;

export interface Day1RunSummary {
  enabled: boolean;
  candidates: number;
  due: number;
  sent: number;
  skipped: Record<string, number>;
  variants: Record<string, number>;
}

interface ProfileRow {
  id: string;
  email: string | null;
  created_at: string;
  timezone: string | null;
  onboarding_completed: boolean | null;
  is_admin: boolean | null;
  is_active: boolean | null;
  metadata: Record<string, any> | null;
}

const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

async function remoteSwitches(userId: string): Promise<{ on: boolean; hour: number }> {
  try {
    const { RemoteConfigService } = await import('../remote-config/service');
    const [on, hour] = await Promise.all([
      RemoteConfigService.enumValue('day1_morning_push', { userId }),
      RemoteConfigService.value('day1_morning_push_hour', { userId }),
    ]);
    return { on: on !== 'off', hour };
  } catch {
    return { on: true, hour: DEFAULT_DAY1_HOUR };
  }
}

export class Day1MorningPushService {
  static async run(opts: { now?: Date; userId?: string; dryRun?: boolean } = {}): Promise<Day1RunSummary> {
    const now = opts.now ?? new Date();
    const summary: Day1RunSummary = { enabled: true, candidates: 0, due: 0, sent: 0, skipped: {}, variants: {} };
    const db = createAdminSupabase();

    let q = db
      .from('profiles')
      .select('id, email, created_at, timezone, onboarding_completed, is_admin, is_active, metadata')
      .gte('created_at', new Date(now.getTime() - MAX_AGE_HOURS * 3_600_000).toISOString())
      .lte('created_at', new Date(now.getTime() - MIN_AGE_HOURS * 3_600_000).toISOString());
    if (opts.userId) q = q.eq('id', opts.userId);
    const { data, error } = await q.limit(CANDIDATE_LIMIT);
    if (error) throw new Error(`day1 candidates read failed: ${error.message}`);
    const rows = ((data ?? []) as ProfileRow[]).filter((r) => r.is_active !== false);
    summary.candidates = rows.length;
    if (!rows.length) return summary;
    const ids = rows.map((r) => r.id);

    const [tokens, prefs, claims, attribution, attempts] = await Promise.all([
      db.from('push_tokens').select('user_id, device_name').in('user_id', ids).eq('is_active', true),
      db.from('notification_preferences').select('user_id, quiet_hours_timezone').in('user_id', ids),
      db.from('streak_claims').select('user_id, timezone, claim_date').in('user_id', ids).order('claim_date', { ascending: false }),
      db.from('user_attribution').select('user_id, is_test').in('user_id', ids),
      db.from('notification_log').select('user_id, notification_type, suppressed, sent_at').in('user_id', ids).in('notification_type', [DAY1_PUSH_TYPE, 'onboarding_finish_reminder']),
    ]);
    const devices = new Map<string, Array<string | null>>();
    for (const t of (tokens.data ?? []) as Array<{ user_id: string; device_name: string | null }>) devices.set(t.user_id, [...(devices.get(t.user_id) ?? []), t.device_name]);
    const prefTz = new Map<string, string>(((prefs.data ?? []) as any[]).filter((p) => p.quiet_hours_timezone).map((p) => [p.user_id, p.quiet_hours_timezone]));
    const claimTz = new Map<string, string>();
    for (const c of (claims.data ?? []) as any[]) if (c.timezone && !claimTz.has(c.user_id)) claimTz.set(c.user_id, c.timezone);
    const mock = new Set(((attribution.data ?? []) as any[]).filter((a) => a.is_test === true).map((a) => a.user_id));
    const logRows = (attempts.data ?? []) as Array<{ user_id: string; notification_type: string; suppressed: boolean | null; sent_at: string }>;
    const attempted = new Set(logRows.filter((a) => a.notification_type === DAY1_PUSH_TYPE).map((a) => a.user_id));
    // A "finish setup" push delivered this morning already is their morning push (one, not two).
    const recentSetupPush = new Set(
      logRows
        .filter((a) => a.notification_type === 'onboarding_finish_reminder' && a.suppressed !== true && now.getTime() - Date.parse(a.sent_at) < RECENT_SETUP_PUSH_HOURS * 3_600_000)
        .map((a) => a.user_id)
    );

    for (const row of rows) {
      try {
        const testReason =
          classifyTestUser({ email: row.email, isAdmin: row.is_admin, mockAttribution: mock.has(row.id) }) ??
          (flaggedTestDevice(row.metadata) ? 'test_device' : null) ??
          (onlyEmulatorDevices(devices.get(row.id) ?? []) ? 'emulator' : null);
        if (testReason) {
          bump(summary.skipped, 'test_user');
          continue;
        }
        if (!(devices.get(row.id) ?? []).length) {
          bump(summary.skipped, 'no_device');
          continue;
        }
        const tz = resolveNotificationTimezone({ quietHoursTimezone: prefTz.get(row.id), profileTimezone: row.timezone, claimTimezone: claimTz.get(row.id) });
        // Only the day after the sign-up day matters; remote config is resolved only then.
        const day = day1Window(now, row.created_at, tz, 0);
        if (day.localDate !== addDays(day.signupLocalDate, 1)) {
          if (day.localDate > addDays(day.signupLocalDate, 1)) bump(summary.skipped, 'window_passed');
          continue;
        }
        const sw = await remoteSwitches(row.id);
        if (!sw.on) {
          bump(summary.skipped, 'switched_off');
          continue;
        }
        const w = day1Window(now, row.created_at, tz, sw.hour);
        if (!w.due) {
          if (w.wait === 'too_late') bump(summary.skipped, 'window_passed');
          continue;
        }
        summary.due++;
        if (attempted.has(row.id)) {
          bump(summary.skipped, 'already_attempted');
          continue;
        }
        if (row.onboarding_completed !== true && recentSetupPush.has(row.id)) {
          bump(summary.skipped, 'setup_push_this_morning');
          continue;
        }
        const morning = new Date(startOfLocalDay(tz, now).getTime() + MORNING_STARTS_HOUR * 3_600_000);
        if (await AppOpenService.openedSince(row.id, morning, w.localDate)) {
          bump(summary.skipped, 'opened_this_morning');
          continue;
        }
        const facts = await this.loadFacts(row, w.signupLocalDate);
        const msg = chooseDay1Message(facts);
        bump(summary.variants, msg.variant);
        if (opts.dryRun) continue;
        const res = await NotificationOrchestrator.send(row.id, DAY1_PUSH_TYPE, {
          title: msg.title,
          body: msg.body,
          screen: msg.screen,
          variant: msg.variant,
          ...(msg.circleId ? { circleId: msg.circleId } : {}),
          localDate: w.localDate,
          dedupeKey: day1DedupeKey(row.id),
        });
        if (res.sent) summary.sent++;
        else bump(summary.skipped, res.reason ?? 'not_sent');
      } catch (err: any) {
        console.error('[Day1MorningPush] failed for', row.id, err?.message ?? err);
        bump(summary.skipped, 'error');
      }
    }
    if (summary.due) console.log('[Day1MorningPush] run', JSON.stringify(summary));
    return summary;
  }

  /** What the user did on Day 0 (their sign-up local day and since). */
  static async loadFacts(row: Pick<ProfileRow, 'id' | 'created_at' | 'onboarding_completed'>, signupLocalDate: string): Promise<Day1Facts> {
    const db = createAdminSupabase();
    const [memberships, meals, streak, mySteps] = await Promise.all([
      db.from('fitcircle_members').select('fitcircle_id, joined_at, status').eq('user_id', row.id).eq('status', 'active'),
      db.from('food_log_entries').select('id').eq('user_id', row.id).eq('entry_type', 'food').is('deleted_at', null).gte('created_at', row.created_at).limit(1),
      db.from('engagement_streaks').select('current_streak').eq('user_id', row.id).maybeSingle(),
      db.from('daily_tracking').select('steps').eq('user_id', row.id).eq('tracking_date', signupLocalDate).maybeSingle(),
    ]);
    const circleIds = [...new Set(((memberships.data ?? []) as any[]).map((m) => m.fitcircle_id as string))].filter((id) => !PUBLIC_CIRCLE_IDS.has(id));
    const circles: Day1Circle[] = [];
    if (circleIds.length) {
      const [circleRows, members, challenges] = await Promise.all([
        db.from('fitcircles').select('id, name, visibility, status').in('id', circleIds),
        db.from('fitcircle_members').select('fitcircle_id, user_id').in('fitcircle_id', circleIds).eq('status', 'active'),
        db.from('challenges').select('fitcircle_id, name, status').in('fitcircle_id', circleIds).eq('status', 'active'),
      ]);
      const live = ((circleRows.data ?? []) as any[]).filter((c) => c.visibility !== 'public' && c.status !== 'cancelled' && c.status !== 'draft');
      const memberIds = [...new Set(((members.data ?? []) as any[]).map((m) => m.user_id as string))];
      const steps = new Map<string, number>();
      if (memberIds.length) {
        const { data: st } = await db.from('daily_tracking').select('user_id, steps').in('user_id', memberIds).eq('tracking_date', signupLocalDate);
        for (const s of (st ?? []) as any[]) if (typeof s.steps === 'number') steps.set(s.user_id, s.steps);
      }
      const joinedAt = new Map(((memberships.data ?? []) as any[]).map((m) => [m.fitcircle_id, String(m.joined_at ?? '')]));
      for (const c of live) {
        const ids = ((members.data ?? []) as any[]).filter((m) => m.fitcircle_id === c.id).map((m) => m.user_id as string);
        circles.push({
          id: c.id,
          name: String(c.name ?? ''),
          challengeName: ((challenges.data ?? []) as any[]).find((ch) => ch.fitcircle_id === c.id)?.name ?? null,
          memberSteps: ids.filter((id) => steps.has(id)).map((id) => ({ userId: id, steps: steps.get(id)! })),
        });
      }
      circles.sort((a, b) => (joinedAt.get(b.id) ?? '').localeCompare(joinedAt.get(a.id) ?? ''));
    }
    const ownSteps = (mySteps.data as { steps?: number | null } | null)?.steps;
    return {
      userId: row.id,
      onboardingCompleted: row.onboarding_completed,
      circles,
      stepsDay0: typeof ownSteps === 'number' ? ownSteps : null,
      loggedMealDay0: ((meals.data ?? []) as any[]).length > 0,
      streakDays: Number((streak.data as { current_streak?: number } | null)?.current_streak) || 0,
    };
  }
}
