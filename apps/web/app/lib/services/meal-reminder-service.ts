/**
 * Meal-slot reminders (docs/ACTIVATION_JOURNEY_SPEC.md §4): breakfast 08:30,
 * lunch 12:30, snack 15:30 (opt-in), dinner 18:30 — user-local.
 *
 * Runs every 15 minutes (/api/cron/meal-reminders), so each slot fires within
 * 15 min of its local time in every timezone, including :30 / :45 offsets
 * (a slot is due for 60 min after its send time; the dedupe key
 * `meal:<slot>:<localDate>` makes it one attempt per slot per local day).
 * Policy is pure (lib/journey/meal-reminders.ts); sends go through
 * NotificationOrchestrator (momentum toggle, quiet hours, daily cap, dedupe,
 * logging, FCM/APNs).
 *
 * Kill switch: MEAL_REMINDERS_ENABLED=false (default ON — server-only, helps shipped apps).
 *
 * 1.1.5 (ENGAGEMENT_115_SPEC §14.7): the same run sends the once-per-user "Snap your first
 * meal" push (`first_meal_nudge`, lib/journey/first-meal-nudge.ts) to a user who finished
 * onboarding without a meal, at their first lunch / dinner slot ≥ 60 min and ≤ 24 h later —
 * INSTEAD of that slot's regular reminder. Kill switch FIRST_MEAL_NUDGE_ENABLED=false (default
 * ON); it also stops with MEAL_REMINDERS_ENABLED=false.
 */
import { DMT_PUSH_TYPES, DMT_TOUCH_HOURS } from '../journey/dont-miss-twice';
import {
  DORMANT_NO_MEAL_DAYS,
  MEAL_REMINDER_TYPE,
  decideMealReminder,
  dueSlotFor,
  isNewUser,
  mealDedupeKey,
  type MealReminderSkip,
} from '../journey/meal-reminders';
import {
  FIRST_MEAL_NUDGE_MAX_DELAY_MS,
  FIRST_MEAL_NUDGE_SLOTS,
  FIRST_MEAL_NUDGE_TYPE,
  decideFirstMealNudge,
  firstMealNudgeDedupeKey,
  firstMealNudgeEnabled,
  nextMealNudgeFrom,
} from '../journey/first-meal-nudge';
import { mealReminderPrefsFrom, type MealEntryLite, type MealSlot } from '../journey/meal-slots';
import { testAccountReason } from '../notifications/audience';
import { resolveNotificationTimezone } from '../notifications/user-timezone';
import { addDays } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';

import { NotificationOrchestrator } from './notification-orchestrator';
import { confirmedOnly } from '@/lib/meal-drafts/config';

const DEFAULT_TZ = 'America/New_York';
const CHUNK = 200;
/** How far back "already attempted today" looks (≥ one local day, < two slots apart). */
const ATTEMPT_WINDOW_HOURS = 20;
/** Cap on the reminders-since-last-meal lookback (dormancy). */
const DORMANCY_LOOKBACK_DAYS = 60;
const MEAL_TYPES = Object.values(MEAL_REMINDER_TYPE);

export function mealRemindersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.MEAL_REMINDERS_ENABLED ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

export interface MealReminderRunSummary {
  enabled: boolean;
  candidates: number;
  due: number;
  sent: number;
  skipped: Record<string, number>;
  bySlot: Record<string, number>;
  /** first_meal_nudge pushes delivered (also counted in `sent`). */
  firstMealNudges: number;
}

async function chunked<T>(ids: string[], fn: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fn(ids.slice(i, i + CHUNK))));
  return out;
}

const group = <T extends { user_id: string }>(rows: T[]) => {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r.user_id, [...(m.get(r.user_id) ?? []), r]);
  return m;
};

export class MealReminderService {
  static async run(opts: { now?: Date; userId?: string } = {}): Promise<MealReminderRunSummary> {
    const now = opts.now ?? new Date();
    const summary: MealReminderRunSummary = { enabled: mealRemindersEnabled(), candidates: 0, due: 0, sent: 0, skipped: {}, bySlot: {}, firstMealNudges: 0 };
    if (!summary.enabled) return summary;
    const bump = (k: string) => (summary.skipped[k] = (summary.skipped[k] ?? 0) + 1);

    const supabase = createAdminSupabase();
    let userIds: string[];
    if (opts.userId) userIds = [opts.userId];
    else {
      const { data } = await supabase.from('push_tokens').select('user_id').eq('is_active', true);
      userIds = [...new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
    }
    summary.candidates = userIds.length;
    if (!userIds.length) return summary;

    // Timezone (lib/notifications/user-timezone.ts, the zone quiet hours use too): a
    // quiet-hours zone the user changed → profiles.timezone (device) → latest streak
    // claim → the New York default. 'UTC' / the untouched New York preference default
    // are placeholders, not the user's zone.
    const [prefRows, claimRows, profileRows] = await Promise.all([
      chunked(userIds, async (p) => ((await supabase.from('notification_preferences').select('user_id, quiet_hours_timezone').in('user_id', p)).data ?? []) as any[]),
      chunked(userIds, async (p) =>
        ((await supabase.from('streak_claims').select('user_id, timezone, claim_date').in('user_id', p).order('claim_date', { ascending: false }).limit(p.length * 5)).data ?? []) as any[]
      ),
      chunked(userIds, async (p) =>
        ((await supabase.from('profiles').select('id, timezone, preferences, created_at, onboarding_completed_at, email, is_admin, metadata').in('id', p)).data ?? []) as any[]
      ),
    ]);
    const claimTz = new Map<string, string>();
    for (const c of claimRows) if (c.timezone && !claimTz.has(c.user_id)) claimTz.set(c.user_id, c.timezone);
    const prefTz = new Map<string, string>(prefRows.filter((p) => p.quiet_hours_timezone).map((p) => [p.user_id, p.quiet_hours_timezone]));
    const profiles = new Map<string, any>(profileRows.map((p) => [p.id, p]));

    // 1. Cheap filter: a slot is due in the user's timezone and their toggle is on.
    const due: Array<{ userId: string; tz: string; slot: MealSlot; localDate: string }> = [];
    for (const userId of userIds) {
      let tz = resolveNotificationTimezone({
        quietHoursTimezone: prefTz.get(userId),
        profileTimezone: profiles.get(userId)?.timezone,
        claimTimezone: claimTz.get(userId),
      });
      let d: ReturnType<typeof dueSlotFor>;
      try {
        d = dueSlotFor(now, tz);
      } catch {
        tz = DEFAULT_TZ;
        d = dueSlotFor(now, tz);
      }
      if (!d.slot) continue;
      if (!mealReminderPrefsFrom(profiles.get(userId)?.preferences)[d.slot]) {
        bump('slot_off');
        continue;
      }
      due.push({ userId, tz, slot: d.slot, localDate: d.localDate });
    }
    summary.due = due.length;
    if (!due.length) return summary;

    // 2. Batched reads for the due users.
    const ids = due.map((u) => u.userId);
    const today = now.toISOString().slice(0, 10);
    const since8 = addDays(today, -8);
    const attemptSince = new Date(now.getTime() - ATTEMPT_WINDOW_HOURS * 3_600_000).toISOString();
    const dmtSince = new Date(now.getTime() - DMT_TOUCH_HOURS * 3_600_000).toISOString();
    const [entries, attempts, dmtPushes] = await Promise.all([
      chunked(ids, async (p) =>
        ((await confirmedOnly(supabase.from('food_log_entries')
          .select('user_id, entry_type, entry_date, meal_type, logged_at, created_at'))
          .in('user_id', p)
          .eq('entry_type', 'food')
          .gte('entry_date', since8)
          .is('deleted_at', null)).data ?? []) as any[]
      ),
      chunked(ids, async (p) =>
        ((await supabase
          .from('notification_log')
          .select('user_id, data')
          .in('user_id', p)
          .in('notification_type', [...MEAL_TYPES, FIRST_MEAL_NUDGE_TYPE])
          .gte('sent_at', attemptSince)).data ?? []) as any[]
      ),
      // 1.1.5: delivered D+1 pushes (ENGAGEMENT_115_SPEC §5.2) — the slot they named is skipped that day.
      chunked(ids, async (p) =>
        ((await supabase
          .from('notification_log')
          .select('user_id, data')
          .in('user_id', p)
          .in('notification_type', [...DMT_PUSH_TYPES])
          .eq('suppressed', false)
          .gte('sent_at', dmtSince)).data ?? []) as any[]
      ),
    ]);
    const dmtSlotBy = new Map<string, Set<string>>();
    for (const d of dmtPushes) {
      const slot = d.data?.mealType;
      const day = d.data?.localDate;
      if (typeof slot === 'string' && typeof day === 'string') dmtSlotBy.set(d.user_id, new Set([...(dmtSlotBy.get(d.user_id) ?? []), `${day}:${slot}`]));
    }
    const entriesBy = group(entries);
    const attemptedBy = new Map<string, Set<string>>();
    for (const a of attempts) {
      // A first_meal_nudge carries its slot's key in data.slotKey: that slot's reminder is skipped.
      for (const key of [a.data?.dedupeKey, a.data?.slotKey]) {
        if (typeof key === 'string') attemptedBy.set(a.user_id, new Set([...(attemptedBy.get(a.user_id) ?? []), key]));
      }
    }
    const nudge = await this.firstMealNudgeFacts(due, profiles, now);

    for (const u of due) {
      try {
        if (dmtSlotBy.get(u.userId)?.has(`${u.localDate}:${u.slot}`)) {
          bump('dont_miss_twice_slot');
          continue;
        }
        // 1.1.5 first_meal_nudge replaces this slot's regular reminder for a brand-new user.
        if (nudge.candidates.has(u.userId)) {
          const profile = profiles.get(u.userId);
          const d = decideFirstMealNudge({
            now,
            timezone: u.tz,
            onboardingCompletedAt: profile?.onboarding_completed_at ?? null,
            hasAnyMeal: nudge.hasMeal.has(u.userId),
            attemptedBefore: nudge.attempted.has(u.userId),
            isTestAccount: !!testAccountReason({ email: profile?.email, isAdmin: profile?.is_admin, metadata: profile?.metadata }),
            prefs: mealReminderPrefsFrom(profile?.preferences),
          });
          if (d.send && d.slot === u.slot) {
            const res = await NotificationOrchestrator.send(u.userId, FIRST_MEAL_NUDGE_TYPE, {
              mealType: d.slot,
              localDate: d.localDate,
              dedupeKey: firstMealNudgeDedupeKey(u.userId),
              slotKey: mealDedupeKey(d.slot, d.localDate),
              nextMealNudge: nudge.nextMealNudge.has(u.userId),
            });
            if (res.sent) {
              summary.sent++;
              summary.firstMealNudges++;
            } else bump(`first_meal_nudge_${res.reason ?? 'not_sent'}`);
            continue;
          }
        }
        const mine = (entriesBy.get(u.userId) ?? []) as Array<MealEntryLite & { created_at?: string }>;
        const lastRecent = mine.map((e) => e.logged_at ?? e.created_at ?? '').filter(Boolean).sort().pop() ?? null;
        // Dormancy needs history only when there's no meal in the 8-day window (cheap path otherwise).
        let lastMealAt = lastRecent;
        let remindersSinceLastMeal = 0;
        const signupAt = profiles.get(u.userId)?.created_at ?? null;
        if (!isNewUser(signupAt, now) && (!lastRecent || now.getTime() - Date.parse(lastRecent) >= DORMANT_NO_MEAL_DAYS * 86_400_000)) {
          ({ lastMealAt, remindersSinceLastMeal } = await this.dormancyFacts(u.userId, profiles.get(u.userId)?.created_at ?? null, now));
        }
        const decision = decideMealReminder({
          now,
          timezone: u.tz,
          prefs: mealReminderPrefsFrom(profiles.get(u.userId)?.preferences),
          entries: mine.filter((e) => e.entry_date >= addDays(u.localDate, -1)),
          lastMealAt,
          remindersSinceLastMeal,
          signupAt,
          attemptedKeys: attemptedBy.get(u.userId) ?? new Set(),
        });
        if (!decision.send) {
          bump(decision.skip);
          continue;
        }
        const currentMomentum = decision.slot === 'dinner' ? await this.streakStillOpen(u.userId, decision.localDate) : 0;
        const res = await NotificationOrchestrator.send(u.userId, decision.type as any, {
          mealType: decision.slot,
          dedupeKey: decision.dedupeKey,
          localDate: decision.localDate,
          // Only mention the streak when it is genuinely still on the line today.
          currentMomentum,
        });
        if (res.sent) {
          summary.sent++;
          summary.bySlot[decision.slot] = (summary.bySlot[decision.slot] ?? 0) + 1;
        } else bump(res.reason ?? 'not_sent');
      } catch (err: any) {
        console.error('[MealReminderService] failed for', u.userId, err?.message ?? err);
        bump('error');
      }
    }
    if (summary.sent || Object.keys(summary.skipped).length) console.log('[MealReminderService] run', JSON.stringify(summary));
    return summary;
  }

  /**
   * first_meal_nudge inputs for the due users who could get it (lunch / dinner due, switch on,
   * onboarding finished in the last 24 h): any food entry ever (drafts included), any earlier
   * attempt, and the onboarding `next_meal_nudge` flag. Fail-soft: a failed read → no nudge.
   */
  static async firstMealNudgeFacts(
    due: Array<{ userId: string; slot: MealSlot }>,
    profiles: Map<string, any>,
    now: Date
  ): Promise<{ candidates: Set<string>; hasMeal: Set<string>; attempted: Set<string>; nextMealNudge: Set<string> }> {
    const out = { candidates: new Set<string>(), hasMeal: new Set<string>(), attempted: new Set<string>(), nextMealNudge: new Set<string>() };
    if (!firstMealNudgeEnabled()) return out;
    const since = now.getTime() - FIRST_MEAL_NUDGE_MAX_DELAY_MS - 3_600_000;
    for (const u of due) {
      const completed = Date.parse(profiles.get(u.userId)?.onboarding_completed_at ?? '');
      if ((FIRST_MEAL_NUDGE_SLOTS as readonly string[]).includes(u.slot) && Number.isFinite(completed) && completed >= since) out.candidates.add(u.userId);
    }
    if (out.candidates.size === 0) return out;
    const ids = [...out.candidates];
    try {
      const supabase = createAdminSupabase();
      const [meals, logs, progress] = await Promise.all([
        // Drafts count here on purpose ("no confirmed meal and no draft"): drafts-included.
        chunked(ids, async (p) =>
          ((await supabase.from('food_log_entries').select('user_id').in('user_id', p).eq('entry_type', 'food').is('deleted_at', null).limit(p.length * 3)).data ?? []) as any[]
        ),
        chunked(ids, async (p) => ((await supabase.from('notification_log').select('user_id').in('user_id', p).eq('notification_type', FIRST_MEAL_NUDGE_TYPE)).data ?? []) as any[]),
        chunked(ids, async (p) => ((await supabase.from('onboarding_progress').select('user_id, data').in('user_id', p)).data ?? []) as any[]),
      ]);
      for (const m of meals) out.hasMeal.add(m.user_id);
      for (const l of logs) out.attempted.add(l.user_id);
      for (const g of progress) if (nextMealNudgeFrom(g.data)) out.nextMealNudge.add(g.user_id);
    } catch (err: any) {
      console.warn('[MealReminderService] first_meal_nudge facts failed (no nudge this run):', err?.message ?? err);
      out.candidates.clear();
    }
    return out;
  }

  /** Last meal ever + delivered meal reminders since then (or since sign-up), for the dormancy backoff. */
  static async dormancyFacts(userId: string, signupAt: string | null, now: Date): Promise<{ lastMealAt: string | null; remindersSinceLastMeal: number }> {
    const supabase = createAdminSupabase();
    const { data } = await confirmedOnly(supabase.from('food_log_entries')
      .select('logged_at, created_at'))
      .eq('user_id', userId)
      .eq('entry_type', 'food')
      .is('deleted_at', null)
      .order('logged_at', { ascending: false })
      .limit(1);
    const row = (data ?? [])[0] as { logged_at?: string; created_at?: string } | undefined;
    const lastMealAt = row ? (row.logged_at ?? row.created_at ?? null) : null;
    const floor = new Date(now.getTime() - DORMANCY_LOOKBACK_DAYS * 86_400_000).toISOString();
    const since = [lastMealAt, signupAt, floor].filter((v): v is string => !!v).sort().pop()!;
    const { count } = await supabase
      .from('notification_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('notification_type', MEAL_TYPES)
      .eq('suppressed', false)
      .gte('sent_at', since);
    return { lastMealAt, remindersSinceLastMeal: count ?? 0 };
  }

  /** Current streak if today's claim is still open (dinner copy), else 0. */
  static async streakStillOpen(userId: string, localDate: string): Promise<number> {
    const supabase = createAdminSupabase();
    const [{ data: claim }, { data: streak }] = await Promise.all([
      supabase.from('streak_claims').select('id').eq('user_id', userId).eq('claim_date', localDate).limit(1).maybeSingle(),
      supabase.from('engagement_streaks').select('current_streak').eq('user_id', userId).maybeSingle(),
    ]);
    if (claim) return 0;
    return Number((streak as any)?.current_streak) || 0;
  }
}
