/**
 * The D+1 job (docs/ENGAGEMENT_115_SPEC.md §5.2): one push the day after a FIRST missed day —
 * `dont_miss_twice` (variants shield_saved / meal / workout / streak_restart / plain) or, for a
 * free user whose streak (>= streak_save_offer_min_streak) just broke with no shield,
 * `streak_save_offer` (+ a streak_save_offers row). Never both, never twice for one D.
 *
 * Hourly at :10 (/api/cron/dont-miss-twice). Each user is due in their send hour only (modal
 * first-log hour, 8–20, after quiet hours). Every push goes through NotificationOrchestrator
 * (audience = HABIT_TYPES, category toggle, cap, quiet hours, dedupe dmt:<D> / streak_save:<D>).
 *
 * Kill switches: env DONT_MISS_TWICE_PUSH_ENABLED (hard; OFF unless 'true': off also brings the
 * night streak_lost / shield_applied pushes back) and remote config `dont_miss_twice_push`
 * (per user: userIds / percent rules only — a cron has no platform or version).
 *
 * Dry run (`dryRun`): decides and builds the copy with NO side effects (no protect-or-break, no
 * offer row, no push); the break outcome is predicted from claims + shields.
 */
import {
  activityFacts,
  chooseDmt,
  dmtCopy,
  dmtDedupeKey,
  DMT_PUSH_TYPES,
  dontMissTwiceEnabled,
  episodeSkip,
  firstMissedDay,
  HISTORY_DAYS,
  localDayHour,
  saveOfferExpiresAt,
  sendHour,
  trailingAutoShields,
  type DayClaim,
  type DmtBreak,
  type DmtChoice,
  type DmtCopy,
  type DmtSkip,
} from '../journey/dont-miss-twice';
import { localClockIn, resolveNotificationTimezone } from '../notifications/user-timezone';
import { RemoteConfigService } from '../remote-config/service';
import { addDays } from '../streaks/streak-calculator';
import { GRACE_PERIOD_HOURS, SHIELD_RULES } from '../streaks/streak-config';
import { createAdminSupabase } from '../supabase-admin';

import { NotificationOrchestrator } from './notification-orchestrator';
import { StreakClaimingService } from './streak-claiming-service';
import { confirmedOnly } from '@/lib/meal-drafts/config';

type Row = Record<string, any>;

const CHUNK = 200;
const CLAIM_LOOKBACK_DAYS = 21;
const PREVIOUS_PUSH_LOOKBACK_DAYS = 10;

export interface DmtRunOptions {
  now?: Date;
  dryRun?: boolean;
  /** Dry run: ignore the send hour ("who would get one today"). */
  allHours?: boolean;
  userIds?: string[];
  /** Tests: override the env switch. */
  env?: Record<string, string | undefined>;
}

export interface DmtDecision {
  userId: string;
  timezone: string;
  localDate: string;
  missedDate?: string;
  sendHour?: number;
  skip?: DmtSkip;
  type?: DmtChoice['type'];
  variant?: DmtChoice['variant'];
  copy?: DmtCopy;
  offerId?: string | null;
  result?: { sent: boolean; reason?: string };
}

export interface DmtRunResult {
  enabled: boolean;
  dryRun: boolean;
  candidates: number;
  sent: number;
  byType: Record<string, number>;
  skipped: Record<string, number>;
  decisions: DmtDecision[];
}

async function chunked<T>(ids: string[], fn: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fn(ids.slice(i, i + CHUNK))));
  return out;
}

const isMissingRelation = (e: { code?: string } | null | undefined) => !!e && ['42P01', 'PGRST205', 'PGRST204', '42703'].includes(e.code ?? '');

export class DontMissTwiceService {
  static async run(opts: DmtRunOptions = {}): Promise<DmtRunResult> {
    const now = opts.now ?? new Date();
    const dryRun = !!opts.dryRun;
    const result: DmtRunResult = {
      enabled: dontMissTwiceEnabled(opts.env ?? process.env),
      dryRun,
      candidates: 0,
      sent: 0,
      byType: {},
      skipped: {},
      decisions: [],
    };
    // The hard kill stops real runs; a dry run still answers (to check before enabling).
    if (!result.enabled && !dryRun) return result;
    const bump = (k: string) => (result.skipped[k] = (result.skipped[k] ?? 0) + 1);

    const db = createAdminSupabase();
    let userIds = opts.userIds;
    if (!userIds) {
      const { data, error } = await db.from('push_tokens').select('user_id').eq('is_active', true);
      if (error) throw new Error(`push_tokens read failed: ${error.message}`);
      userIds = [...new Set(((data ?? []) as Row[]).map((r) => r.user_id as string))];
    }
    result.candidates = userIds.length;
    if (userIds.length === 0) return result;

    // Batched: zone sources + quiet hours, profiles, recent claims.
    const claimSince = addDays(now.toISOString().slice(0, 10), -CLAIM_LOOKBACK_DAYS);
    const [prefRows, profileRows, claimRows] = await Promise.all([
      chunked(userIds, async (p) => ((await db.from('notification_preferences').select('user_id, quiet_hours_start, quiet_hours_end, quiet_hours_timezone').in('user_id', p)).data ?? []) as Row[]),
      chunked(userIds, async (p) => ((await db.from('profiles').select('id, timezone, subscription_tier').in('id', p)).data ?? []) as Row[]),
      chunked(userIds, async (p) =>
        ((await db.from('streak_claims').select('user_id, claim_date, claim_method, timezone, metadata, claimed_at').in('user_id', p).gte('claim_date', claimSince)).data ?? []) as Row[]
      ),
    ]);
    const prefs = new Map(prefRows.map((r) => [r.user_id as string, r]));
    const profiles = new Map(profileRows.map((r) => [r.id as string, r]));
    const claimsBy = new Map<string, Row[]>();
    for (const c of claimRows) claimsBy.set(c.user_id, [...(claimsBy.get(c.user_id) ?? []), c]);

    for (const userId of userIds) {
      const claims = claimsBy.get(userId) ?? [];
      const latestClaimTz = [...claims].sort((a, b) => String(b.claim_date).localeCompare(String(a.claim_date)))[0]?.timezone ?? null;
      const pref = prefs.get(userId);
      const timezone = resolveNotificationTimezone({
        quietHoursTimezone: pref?.quiet_hours_timezone ?? null,
        profileTimezone: profiles.get(userId)?.timezone ?? null,
        claimTimezone: latestClaimTz,
      });
      const local = localClockIn(now, timezone);
      const decision: DmtDecision = { userId, timezone, localDate: local.date };
      try {
        await this.decideAndSend(userId, decision, { now, dryRun, allHours: !!opts.allHours, claims, pref, profile: profiles.get(userId) ?? null, localMinutes: local.minutes });
      } catch (err: any) {
        decision.result = { sent: false, reason: `error:${err?.message ?? err}` };
      }
      if (decision.skip) {
        bump(decision.skip);
        // Keep the list readable: claimed / not-first-miss users are the common case.
        if (!['claimed_yesterday', 'claimed_today', 'not_first_miss'].includes(decision.skip)) result.decisions.push(decision);
        continue;
      }
      result.decisions.push(decision);
      if (decision.result?.sent) {
        result.sent++;
        result.byType[decision.type as string] = (result.byType[decision.type as string] ?? 0) + 1;
      } else if (decision.result && !decision.result.sent) bump(decision.result.reason ?? 'not_sent');
    }
    if (!dryRun && (result.sent || Object.keys(result.skipped).length)) {
      console.log('[DontMissTwiceService] run', JSON.stringify({ candidates: result.candidates, sent: result.sent, byType: result.byType, skipped: result.skipped }));
    }
    return result;
  }

  private static async decideAndSend(
    userId: string,
    decision: DmtDecision,
    ctx: { now: Date; dryRun: boolean; allHours: boolean; claims: Row[]; pref: Row | undefined; profile: Row | null; localMinutes: number }
  ): Promise<void> {
    const today = decision.localDate;
    let claims = toClaimMap(ctx.claims);
    const first = firstMissedDay(claims, today);
    if ('skip' in first) {
      decision.skip = first.skip;
      return;
    }
    const missedDate = first.missedDate;
    decision.missedDate = missedDate;

    // History → send hour + variant facts.
    const activity = await this.activity(userId, decision.timezone, today, ctx.now);
    const quiet = ctx.pref?.quiet_hours_start && ctx.pref?.quiet_hours_end ? { start: String(ctx.pref.quiet_hours_start), end: String(ctx.pref.quiet_hours_end) } : null;
    decision.sendHour = sendHour(activity.firstLogHours, quiet);
    if (!ctx.allHours && Math.floor(ctx.localMinutes / 60) !== decision.sendHour) {
      decision.skip = 'outside_send_hour';
      return;
    }

    // Per-user switch (rules by userIds / percent only).
    if ((await RemoteConfigService.enumValue('dont_miss_twice_push', { userId, platform: null, appVersion: null, country: null }).catch(() => 'on')) === 'off') {
      decision.skip = 'switched_off';
      return;
    }

    // One per lapse episode, never twice for one D.
    const previous = await this.previousMissedDates(userId, ctx.now);
    const episode = episodeSkip(missedDate, previous, claims);
    if (episode) {
      decision.skip = episode;
      return;
    }

    // 2. Make sure the nightly protect-or-break ran (idempotent), then re-read D.
    let outcome: DmtBreak;
    if (ctx.dryRun) {
      const predicted = await this.predictOutcome(userId, claims, missedDate);
      outcome = predicted.outcome;
      if (predicted.shielded) claims = new Map(claims).set(missedDate, { date: missedDate, method: 'freeze', auto: true });
    } else {
      const r = await StreakClaimingService.checkAndBreakStreak(userId);
      outcome = { broken: r.broken, zombieGuard: r.zombieGuard === true, lostStreak: r.lostStreak };
      claims = await this.reloadClaims(userId, claims);
      // The user (or a race) claimed D or today meanwhile: nothing to send.
      const again = firstMissedDay(claims, today);
      if ('skip' in again) {
        decision.skip = again.skip;
        return;
      }
    }

    const pro = ctx.profile?.subscription_tier === 'premium' || ctx.profile?.subscription_tier === 'enterprise';
    const shieldSavedD = claims.get(missedDate)?.auto === true;
    const [saveOfferOn, minStreak, shields] = await Promise.all([
      RemoteConfigService.enumValue('streak_save_offer', { userId, platform: null, appVersion: null, country: null }).catch(() => 'on'),
      RemoteConfigService.value('streak_save_offer_min_streak', { userId, platform: null, appVersion: null, country: null }).catch(() => 3),
      shieldSavedD && !pro ? StreakClaimingService.getAvailableShields(userId).catch(() => null) : Promise.resolve(null),
    ]);
    const input = {
      shieldSavedD,
      currentStreak: runLength(claims, missedDate),
      shieldsLeft: pro || !shields || shields.unlimited ? null : shields.total,
      lastAutoProtect: shieldSavedD && trailingAutoShields(claims, missedDate) >= SHIELD_RULES.MAX_CONSECUTIVE_AUTO_PROTECTS,
      outcome,
      saveOfferOn: saveOfferOn !== 'off',
      saveOfferMinStreak: minStreak,
      activity: activity.facts,
      pro,
    };
    let choice = chooseDmt(input);

    // Streak save offer row (unique per user + D). A missing table (138 not applied) → the
    // dont_miss_twice restart variant instead (never an offer the server can't track).
    let offerId: string | null = null;
    if (choice.type === 'streak_save_offer' && !ctx.dryRun) {
      offerId = await this.createOffer(userId, missedDate, outcome.lostStreak, saveOfferExpiresAt(missedDate, decision.timezone, GRACE_PERIOD_HOURS));
      if (!offerId) choice = { type: 'dont_miss_twice', variant: 'streak_restart' };
    }
    const copy = dmtCopy(choice, input);
    decision.type = choice.type;
    decision.variant = choice.variant;
    decision.copy = copy;
    decision.offerId = offerId;
    if (ctx.dryRun) return;

    // 7. Send. Neither type is deferrable (the job already avoids quiet hours).
    const data: Record<string, unknown> =
      choice.type === 'streak_save_offer'
        ? { title: copy.title, body: copy.body, route: copy.route, missedDate, lostStreak: outcome.lostStreak, offerId, localDate: today, dedupeKey: dmtDedupeKey(choice.type, missedDate) }
        : {
            title: copy.title,
            body: copy.body,
            screen: copy.screen,
            ...(copy.route ? { route: copy.route } : {}),
            ...(copy.mealType ? { mealType: copy.mealType } : {}),
            variant: choice.variant,
            missedDate,
            streakDays: choice.variant === 'shield_saved' ? input.currentStreak : outcome.broken ? 0 : input.currentStreak,
            localDate: today,
            dedupeKey: dmtDedupeKey(choice.type, missedDate),
          };
    decision.result = await NotificationOrchestrator.send(userId, choice.type, data);
  }

  /** Food rows (local day / hour / slot) and workout days in the last 14 days. */
  private static async activity(userId: string, timezone: string, today: string, now: Date) {
    const db = createAdminSupabase();
    const since = addDays(today, -HISTORY_DAYS);
    const sinceIso = new Date(now.getTime() - (HISTORY_DAYS + 1) * 86_400_000).toISOString();
    const [{ data: food }, { data: workouts }] = await Promise.all([
      confirmedOnly(db.from('food_log_entries').select('logged_at, meal_type')).eq('user_id', userId).eq('entry_type', 'food').is('deleted_at', null).gte('logged_at', sinceIso),
      db.from('exercise_logs').select('exercise_date, is_deleted').eq('user_id', userId).gte('exercise_date', since).lt('exercise_date', today),
    ]);
    const foodRows = ((food ?? []) as Row[])
      .filter((f) => typeof f.logged_at === 'string')
      .map((f) => ({ ...localDayHour(f.logged_at, timezone), mealType: (f.meal_type as string | null) ?? null }))
      .filter((f) => f.day >= since && f.day < today);
    const workoutDays = ((workouts ?? []) as Row[]).filter((w) => !w.is_deleted).map((w) => String(w.exercise_date).slice(0, 10));
    const facts = activityFacts(
      foodRows.map((f) => ({ day: f.day, hour: f.hour, mealType: f.mealType })),
      workoutDays
    );
    // First log hour per day (food), for the send hour.
    const first = new Map<string, number>();
    for (const f of foodRows) if (!first.has(f.day) || f.hour < (first.get(f.day) as number)) first.set(f.day, f.hour);
    return { facts, firstLogHours: [...first.values()] };
  }

  /** missedDate of every dont_miss_twice / streak_save_offer push delivered recently. */
  private static async previousMissedDates(userId: string, now: Date): Promise<string[]> {
    const { data, error } = await createAdminSupabase()
      .from('notification_log')
      .select('data, sent_at')
      .eq('user_id', userId)
      .in('notification_type', [...DMT_PUSH_TYPES])
      .eq('suppressed', false)
      .gte('sent_at', new Date(now.getTime() - PREVIOUS_PUSH_LOOKBACK_DAYS * 86_400_000).toISOString());
    if (error) throw new Error(`notification_log read failed: ${error.message}`);
    return ((data ?? []) as Row[]).map((r) => r.data?.missedDate).filter((d): d is string => typeof d === 'string');
  }

  private static async reloadClaims(userId: string, fallback: ReadonlyMap<string, DayClaim>): Promise<Map<string, DayClaim>> {
    const since = addDays(new Date().toISOString().slice(0, 10), -CLAIM_LOOKBACK_DAYS);
    const { data, error } = await createAdminSupabase()
      .from('streak_claims')
      .select('user_id, claim_date, claim_method, metadata')
      .eq('user_id', userId)
      .gte('claim_date', since);
    if (error) return new Map(fallback);
    return toClaimMap((data ?? []) as Row[]);
  }

  /** Dry run: what protect-or-break WOULD do for D (read-only). */
  private static async predictOutcome(userId: string, claims: ReadonlyMap<string, DayClaim>, missedDate: string): Promise<{ outcome: DmtBreak; shielded: boolean }> {
    if (claims.get(missedDate)?.auto) return { outcome: { broken: false, zombieGuard: false, lostStreak: 0 }, shielded: true };
    const run = runLength(claims, addDays(missedDate, -1));
    if (run < 2) return { outcome: { broken: false, zombieGuard: false, lostStreak: 0 }, shielded: false };
    const zombie = trailingAutoShields(claims, addDays(missedDate, -1)) >= SHIELD_RULES.MAX_CONSECUTIVE_AUTO_PROTECTS;
    if (!zombie) {
      const shields = await StreakClaimingService.getAvailableShields(userId).catch(() => null);
      if (shields && (shields.unlimited || shields.total > 0)) return { outcome: { broken: false, zombieGuard: false, lostStreak: 0 }, shielded: true };
    }
    return { outcome: { broken: true, zombieGuard: zombie, lostStreak: run }, shielded: false };
  }

  /** Insert the offer (status offered) or return the existing one for (user, D). Null = table missing / failed. */
  static async createOffer(userId: string, missedDate: string, lostStreak: number, expiresAt: Date): Promise<string | null> {
    const db = createAdminSupabase();
    const { data, error } = await db
      .from('streak_save_offers')
      .insert({ user_id: userId, missed_date: missedDate, lost_streak: lostStreak, status: 'offered', expires_at: expiresAt.toISOString() })
      .select('id')
      .single();
    if (!error && data?.id) return data.id as string;
    if (error && isMissingRelation(error)) return null;
    if (error?.code === '23505') {
      const { data: existing } = await db.from('streak_save_offers').select('id').eq('user_id', userId).eq('missed_date', missedDate).maybeSingle();
      return (existing?.id as string | undefined) ?? null;
    }
    console.error('[DontMissTwiceService] offer insert failed:', error?.message);
    return null;
  }
}

/** streak_claims rows → local date → claim (auto = an automatic nightly shield). */
export function toClaimMap(rows: readonly Row[]): Map<string, DayClaim> {
  const out = new Map<string, DayClaim>();
  for (const r of rows) {
    const date = String(r.claim_date).slice(0, 10);
    const method = (r.claim_method as string | null) ?? null;
    out.set(date, { date, method, auto: method === 'freeze' && r.metadata?.auto_applied === true });
  }
  return out;
}

/** Consecutive claimed days ending at `day`. */
function runLength(claims: ReadonlyMap<string, DayClaim>, day: string): number {
  let n = 0;
  for (let cursor = day; claims.has(cursor); cursor = addDays(cursor, -1)) n++;
  return n;
}
