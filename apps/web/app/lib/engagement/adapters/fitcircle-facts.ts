/**
 * UserFacts for FitCircle: the ONLY place lifecycle messaging reads FitCircle
 * activity tables. Sources (all soft-delete aware):
 *   meals      food_log_entries (entry_type food; input_method photo = AI scan)
 *   water      food_log_entries (entry_type water).water_ml + beverage_logs (category water).volume_ml
 *   workouts   exercise_logs (exercise_date, duration_minutes, not is_deleted)
 *   check-ins  streak_claims (claim_date)
 *   steps / weight  daily_tracking (steps, weight_kg)
 *   streak     engagement_streaks
 *   circles    fitcircle_members + fitcircles (active / upcoming)
 *   campaigns  campaigns (published, not archived) + campaign_participants
 *   referral   referral_codes + lib/referrals/referral-policy
 *   ledger     engagement_sends (growth-slot history, recent sends)
 * Mood / energy are never read: we don't show uncollected-by-design metrics.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { inviteeRewardDays, REFERRAL_POLICY } from '../../referrals/referral-policy';
import { createAdminSupabase } from '../../supabase-admin';
import type { CampaignFacts, CircleFacts, GoalFacts, LifecycleFacts, ReferralFacts, UserProfileFacts, WeekActivity, WeeklyReportFacts } from '../facts';
import { personalInviteUrl } from '../links';
import { addDays, isoWeekKey, localClock, userTimezone } from '../time';

import type { CandidateUser, UserFactsProvider } from './types';

type Db = SupabaseClient<any, any, any>;

const ROW_LIMIT = 5000;
const MEMBER_LIMIT = 60;

interface DayActivity {
  meals: number;
  photoMeals: number;
  workouts: number;
  workoutMinutes: number;
  checkIn: boolean;
  steps: number | null;
  weightKg: number | null;
  waterMl: number;
}

const emptyDay = (): DayActivity => ({ meals: 0, photoMeals: 0, workouts: 0, workoutMinutes: 0, checkIn: false, steps: null, weightKg: null, waterMl: 0 });

const isActiveDay = (d: DayActivity) => d.meals > 0 || d.workouts > 0 || d.checkIn || d.weightKg !== null || d.waterMl > 0;

export function firstNameOf(displayName: string | null | undefined, username: string | null | undefined): string {
  const name = (displayName ?? '').trim().split(/\s+/)[0] ?? '';
  if (name && !name.includes('@') && name.length <= 24) return name.charAt(0).toUpperCase() + name.slice(1);
  return '';
}

/** Per-day activity map for [from, to] (local dates as stored). */
async function activityByDay(db: Db, userId: string, from: string, to: string): Promise<Map<string, DayActivity>> {
  const [food, ex, claims, tracking, bev] = await Promise.all([
    db
      .from('food_log_entries')
      .select('entry_date, entry_type, input_method, water_ml')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .gte('entry_date', from)
      .lte('entry_date', to)
      .limit(ROW_LIMIT),
    db
      .from('exercise_logs')
      .select('exercise_date, duration_minutes, is_deleted')
      .eq('user_id', userId)
      .gte('exercise_date', from)
      .lte('exercise_date', to)
      .limit(ROW_LIMIT),
    db.from('streak_claims').select('claim_date').eq('user_id', userId).gte('claim_date', from).lte('claim_date', to).limit(ROW_LIMIT),
    db.from('daily_tracking').select('tracking_date, steps, weight_kg').eq('user_id', userId).gte('tracking_date', from).lte('tracking_date', to).limit(ROW_LIMIT),
    db
      .from('beverage_logs')
      .select('entry_date, volume_ml')
      .eq('user_id', userId)
      .eq('category', 'water')
      .is('deleted_at', null)
      .gte('entry_date', from)
      .lte('entry_date', to)
      .limit(ROW_LIMIT),
  ]);
  for (const r of [food, ex, claims, tracking, bev]) if (r.error) throw r.error;
  const days = new Map<string, DayActivity>();
  const day = (d: string) => {
    let v = days.get(d);
    if (!v) days.set(d, (v = emptyDay()));
    return v;
  };
  for (const r of (food.data ?? []) as any[]) {
    if (!r.entry_date) continue;
    if (r.entry_type === 'water') day(r.entry_date).waterMl += Number(r.water_ml) || 0;
    else if (r.entry_type === 'food') {
      day(r.entry_date).meals++;
      if (r.input_method === 'photo') day(r.entry_date).photoMeals++;
    }
  }
  for (const r of (ex.data ?? []) as any[]) {
    if (!r.exercise_date || r.is_deleted === true) continue;
    day(r.exercise_date).workouts++;
    day(r.exercise_date).workoutMinutes += Number(r.duration_minutes) || 0;
  }
  for (const r of (claims.data ?? []) as any[]) if (r.claim_date) day(r.claim_date).checkIn = true;
  for (const r of (tracking.data ?? []) as any[]) {
    if (!r.tracking_date) continue;
    if (Number(r.steps) > 0) day(r.tracking_date).steps = Number(r.steps);
    if (Number(r.weight_kg) > 0) day(r.tracking_date).weightKg = Number(r.weight_kg);
  }
  for (const r of (bev.data ?? []) as any[]) if (r.entry_date) day(r.entry_date).waterMl += Number(r.volume_ml) || 0;
  return days;
}

export function summarizeWeek(days: Map<string, DayActivity>, start: string, goals: GoalFacts): WeekActivity {
  const w: WeekActivity = {
    activeDays: 0,
    meals: { count: 0, days: 0 },
    photoMeals: 0,
    workouts: { count: 0, minutes: 0 },
    checkIns: 0,
    steps: null,
    water: null,
    weight: null,
  };
  for (let i = 0; i < 7; i++) {
    const d = days.get(addDays(start, i));
    if (!d) continue;
    if (isActiveDay(d)) w.activeDays++;
    if (d.meals > 0) {
      w.meals.count += d.meals;
      w.meals.days++;
    }
    w.photoMeals += d.photoMeals;
    w.workouts.count += d.workouts;
    w.workouts.minutes += d.workoutMinutes;
    if (d.checkIn) w.checkIns++;
    if (d.steps !== null) {
      w.steps ??= { total: 0, daysWithData: 0, daysAtGoal: goals.dailyStepsTarget ? 0 : null };
      w.steps.total += d.steps;
      w.steps.daysWithData++;
      if (goals.dailyStepsTarget && d.steps >= goals.dailyStepsTarget) w.steps.daysAtGoal = (w.steps.daysAtGoal ?? 0) + 1;
    }
    if (d.waterMl > 0) {
      w.water ??= { days: 0, daysAtGoal: goals.dailyWaterMlTarget ? 0 : null };
      w.water.days++;
      if (goals.dailyWaterMlTarget && d.waterMl >= goals.dailyWaterMlTarget) w.water.daysAtGoal = (w.water.daysAtGoal ?? 0) + 1;
    }
    if (d.weightKg !== null) {
      if (!w.weight) w.weight = { first: d.weightKg, last: d.weightKg, entries: 1 };
      else {
        w.weight.last = d.weightKg;
        w.weight.entries++;
      }
    }
  }
  return w;
}

function goalsOf(profile: any): GoalFacts {
  const goals = Array.isArray(profile?.goals) ? profile.goals : [];
  const steps = goals.find((g: any) => g?.type === 'steps' && Number(g.daily_steps_target) > 0);
  const weight = goals.find((g: any) => Number(g?.target_weight_kg) > 0);
  const water = Number(profile?.preferences?.hydration?.daily_water_ml_target);
  return {
    dailyStepsTarget: steps ? Number(steps.daily_steps_target) : null,
    dailyWaterMlTarget: Number.isFinite(water) && water > 0 ? water : null,
    targetWeightKg: weight ? Number(weight.target_weight_kg) : null,
  };
}

function profileFacts(p: any): UserProfileFacts {
  return {
    userId: p.id,
    email: p.email ?? null,
    firstName: firstNameOf(p.display_name, p.username),
    timezone: userTimezone(p.timezone),
    weightUnit: p.weight_unit_preference === 'lbs' || p.weight_unit_preference === 'lb' ? 'lbs' : 'kg',
    createdAt: p.created_at,
    isAdmin: p.is_admin === true,
  };
}

async function loadProfile(db: Db, userId: string): Promise<any | null> {
  const { data, error } = await db
    .from('profiles')
    .select('id, email, display_name, username, timezone, created_at, weight_unit_preference, is_admin, goals, preferences, fitzy_opened_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function referralOf(db: Db, userId: string): Promise<ReferralFacts | null> {
  const { data } = await db.from('referral_codes').select('code').eq('user_id', userId).maybeSingle();
  const code = (data as { code?: string } | null)?.code;
  if (!code) return null;
  const invitee = inviteeRewardDays();
  return {
    code,
    link: personalInviteUrl(code),
    rewardDays: invitee > 0 ? Math.min(invitee, REFERRAL_POLICY.inviterRewardDays) : 0,
    qualifyingDays: REFERRAL_POLICY.qualifyingDays,
  };
}

async function circlesOf(db: Db, userId: string, week: { start: string; end: string } | null): Promise<CircleFacts[]> {
  const { data: mine, error } = await db
    .from('fitcircle_members')
    .select('fitcircle_id, joined_at, created_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(50);
  if (error) throw error;
  const memberships = (mine ?? []) as Array<{ fitcircle_id: string; joined_at: string | null; created_at: string | null }>;
  if (memberships.length === 0) return [];
  const ids = memberships.map((m) => m.fitcircle_id);
  const { data: circles, error: cErr } = await db
    .from('fitcircles')
    .select('id, name, status, invite_code, created_at')
    .in('id', ids)
    .in('status', ['active', 'upcoming']);
  if (cErr) throw cErr;
  const live = ((circles ?? []) as any[]).sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1));
  if (live.length === 0) return [];
  const { data: members, error: mErr } = await db
    .from('fitcircle_members')
    .select('fitcircle_id, user_id')
    .in('fitcircle_id', live.map((c) => c.id))
    .eq('status', 'active')
    .limit(MEMBER_LIMIT * live.length);
  if (mErr) throw mErr;
  const byCircle = new Map<string, string[]>();
  for (const m of (members ?? []) as Array<{ fitcircle_id: string; user_id: string }>) {
    byCircle.set(m.fitcircle_id, [...(byCircle.get(m.fitcircle_id) ?? []), m.user_id]);
  }

  // Active days per member this week (aggregate only — never per-member details).
  const activeDays = new Map<string, Set<string>>();
  if (week) {
    const memberIds = [...new Set(live.slice(0, 3).flatMap((c) => byCircle.get(c.id) ?? []))].slice(0, MEMBER_LIMIT);
    if (memberIds.length) {
      const [f, e, c] = await Promise.all([
        db.from('food_log_entries').select('user_id, entry_date').in('user_id', memberIds).is('deleted_at', null).gte('entry_date', week.start).lte('entry_date', week.end).limit(ROW_LIMIT),
        db.from('exercise_logs').select('user_id, exercise_date').in('user_id', memberIds).gte('exercise_date', week.start).lte('exercise_date', week.end).limit(ROW_LIMIT),
        db.from('streak_claims').select('user_id, claim_date').in('user_id', memberIds).gte('claim_date', week.start).lte('claim_date', week.end).limit(ROW_LIMIT),
      ]);
      const add = (uid: string, d: string | null) => {
        if (!d) return;
        let s = activeDays.get(uid);
        if (!s) activeDays.set(uid, (s = new Set()));
        s.add(d);
      };
      for (const r of (f.data ?? []) as any[]) add(r.user_id, r.entry_date);
      for (const r of (e.data ?? []) as any[]) add(r.user_id, r.exercise_date);
      for (const r of (c.data ?? []) as any[]) add(r.user_id, r.claim_date);
    }
  }

  return live.map((c) => {
    const ids = byCircle.get(c.id) ?? [userId];
    const counts = ids.map((id) => activeDays.get(id)?.size ?? 0);
    const mineCount = activeDays.get(userId)?.size ?? 0;
    const membership = memberships.find((m) => m.fitcircle_id === c.id);
    return {
      id: c.id,
      name: String(c.name ?? 'Your circle'),
      memberCount: Math.max(1, ids.length),
      activeMembersThisWeek: counts.filter((n) => n > 0).length,
      yourActiveDays: mineCount,
      yourRank: 1 + counts.filter((n) => n > mineCount).length,
      upcoming: c.status === 'upcoming',
      inviteCode: c.invite_code ?? null,
      joinedAt: membership?.joined_at ?? membership?.created_at ?? c.created_at ?? null,
    };
  });
}

async function campaignsFor(db: Db, userId: string, today: string): Promise<CampaignFacts[]> {
  const { data, error } = await db
    .from('campaigns')
    .select('id, slug, title, tagline, starts_at, ends_at, template, published, archived_at, preview_user_ids')
    .eq('published', true)
    .is('archived_at', null)
    .gte('ends_at', today)
    .limit(20);
  if (error) return [];
  const rows = ((data ?? []) as any[]).filter((c) => c.starts_at && c.ends_at && ['seasonal_circle', 'daily_calendar'].includes(c.template));
  if (rows.length === 0) return [];
  const { data: joined } = await db.from('campaign_participants').select('campaign_id').eq('user_id', userId).in('campaign_id', rows.map((r) => r.id));
  const joinedIds = new Set(((joined ?? []) as any[]).map((j) => j.campaign_id));
  return rows.map((c) => ({
    slug: c.slug,
    title: String(c.title),
    tagline: c.tagline ?? null,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    joined: joinedIds.has(c.id),
  }));
}

async function countMeals(db: Db, userId: string, photoOnly = false): Promise<number> {
  let q = db.from('food_log_entries').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('entry_type', 'food').is('deleted_at', null);
  if (photoOnly) q = q.eq('input_method', 'photo');
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

async function ledgerRows(db: Db, userId: string, sinceIso: string): Promise<any[]> {
  const { data, error } = await db
    .from('engagement_sends')
    .select('message_key, period_key, channel, status, created_at, meta')
    .eq('user_id', userId)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as any[];
}

async function candidatePage(
  db: Db,
  opts: { afterUserId?: string | null; limit: number; onlyUserIds?: string[] | null }
): Promise<CandidateUser[]> {
  let q = db.from('profiles').select('id, timezone, created_at').order('id', { ascending: true }).limit(opts.limit);
  if (opts.afterUserId) q = q.gt('id', opts.afterUserId);
  if (opts.onlyUserIds?.length) q = q.in('id', opts.onlyUserIds);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({ userId: r.id, timezone: r.timezone ?? null, createdAt: r.created_at }));
}

export class FitCircleFactsProvider implements UserFactsProvider {
  constructor(private readonly db: Db = createAdminSupabase() as Db) {}

  lifecycleCandidates(opts: { afterUserId?: string | null; limit: number; onlyUserIds?: string[] | null }) {
    return candidatePage(this.db, opts);
  }

  weeklyReportCandidates(opts: { afterUserId?: string | null; limit: number; onlyUserIds?: string[] | null }) {
    return candidatePage(this.db, opts);
  }

  async weeklyReportFacts(userId: string, weekStart: string, now: Date): Promise<WeeklyReportFacts | null> {
    const p = await loadProfile(this.db, userId);
    if (!p) return null;
    const profile = profileFacts(p);
    const goals = goalsOf(p);
    const weekEnd = addDays(weekStart, 6);
    const weekKey = isoWeekKey(weekStart);
    const days = await activityByDay(this.db, userId, addDays(weekStart, -56), weekEnd);
    const thisWeek = summarizeWeek(days, weekStart, goals);
    const lastWeek = summarizeWeek(days, addDays(weekStart, -7), goals);
    const prior = Array.from({ length: 8 }, (_, i) => summarizeWeek(days, addDays(weekStart, -7 * (i + 1)), goals).activeDays);
    const weeksWithHistory = prior.filter((n) => n > 0).length;
    const today = localClock(profile.timezone, now).date;
    const [streakRow, circles, referral, mealsEver, photoMealsEver, campaigns, ledger] = await Promise.all([
      this.db.from('engagement_streaks').select('current_streak, longest_streak').eq('user_id', userId).maybeSingle(),
      circlesOf(this.db, userId, { start: weekStart, end: weekEnd }),
      referralOf(this.db, userId),
      countMeals(this.db, userId),
      countMeals(this.db, userId, true),
      campaignsFor(this.db, userId, today),
      ledgerRows(this.db, userId, new Date(now.getTime() - 35 * 86_400_000).toISOString()),
    ]);
    const s = (streakRow.data ?? {}) as { current_streak?: number; longest_streak?: number };
    const recentGrowthSlots = ledger
      .filter((r) => r.message_key === 'weekly_report' && r.channel === 'email' && r.period_key < weekKey)
      .slice(0, 2)
      .map((r) => (r.status === 'sent' ? String(r.meta?.growth_slot ?? 'none') : 'none'));
    return {
      profile,
      weekKey,
      weekStart,
      weekEnd,
      thisWeek,
      lastWeek,
      bestPriorActiveDays: weeksWithHistory >= 2 ? Math.max(...prior) : null,
      activeDaysPrior4Weeks: prior.slice(0, 4).reduce((a, b) => a + b, 0),
      streak: { current: s.current_streak ?? 0, longest: s.longest_streak ?? 0 },
      goals,
      circles,
      referral,
      fitzyUsed: !!p.fitzy_opened_at,
      mealsEver,
      photoMealsEver,
      campaigns,
      recentGrowthSlots,
    };
  }

  async lifecycleFacts(userId: string, now: Date): Promise<LifecycleFacts | null> {
    const p = await loadProfile(this.db, userId);
    if (!p) return null;
    const profile = profileFacts(p);
    const clock = localClock(profile.timezone, now);
    const [streakRow, mealsEver, firstMeal, days, circles, referral, ledger] = await Promise.all([
      this.db.from('engagement_streaks').select('current_streak, last_engagement_date').eq('user_id', userId).maybeSingle(),
      countMeals(this.db, userId),
      this.db.from('food_log_entries').select('logged_at').eq('user_id', userId).eq('entry_type', 'food').is('deleted_at', null).order('logged_at', { ascending: true }).limit(1).maybeSingle(),
      activityByDay(this.db, userId, addDays(clock.date, -30), clock.date),
      circlesOf(this.db, userId, null),
      referralOf(this.db, userId),
      ledgerRows(this.db, userId, new Date(now.getTime() - 30 * 86_400_000).toISOString()),
    ]);
    const s = (streakRow.data ?? {}) as { current_streak?: number; last_engagement_date?: string | null };
    const activeDates = [...days.entries()].filter(([, d]) => isActiveDay(d)).map(([d]) => d).sort();
    return {
      profile,
      today: clock.date,
      localHour: clock.hour,
      accountAgeHours: (now.getTime() - Date.parse(profile.createdAt)) / 3_600_000,
      mealsEver,
      firstMealAt: (firstMeal.data as { logged_at?: string } | null)?.logged_at ?? null,
      lastActiveDate: activeDates.length ? activeDates[activeDates.length - 1] : null,
      streak: { current: s.current_streak ?? 0, lastEngagementDate: s.last_engagement_date ?? null },
      circles,
      referral,
      recentSends: ledger.map((r) => ({ messageKey: r.message_key, periodKey: r.period_key, channel: r.channel, status: r.status, at: r.created_at })),
    };
  }
}
