/**
 * Fitzy coaching tips as push notifications (docs/FITZY_PUSH_NOTIFICATIONS.md).
 *
 * Runs from the hourly cron /api/cron/fitzy-coach. For every user with an active push token whose
 * LOCAL hour falls in a slot window (lib/fitzy/push.ts): cheap eligibility checks → claim the
 * (user, slot, local date) row in fitzy_push_deliveries (PK = idempotent across retries and
 * concurrent runs) → build the copy (AI via the Fitzy models, or a template) → send through
 * NotificationOrchestrator (category `coach`: preference, frequency cap, quiet hours, logging) →
 * record the outcome on the claim row.
 *
 * Privacy: AI copy is only generated for users who have chatted with Fitzy (server-side evidence
 * that they allowed AI data sharing in the app); everyone else gets templates. Lock-screen text
 * never carries weight / calorie / macro / body values (lockScreenSafe).
 */
import { mondayOf } from '../fitzy/dates';
import { generateWithFallback } from '../fitzy/models';
import {
  FITZY_PUSH_TYPES,
  SLOT_OF,
  commonSkip,
  deliveryKey,
  focusPushCopy,
  hydrationCopy,
  hydrationRelevant,
  localParts,
  morningKind,
  nudgeRequest,
  parseNudge,
  proteinBehind,
  proteinIdeas,
  proteinTemplate,
  pushConfig,
  slotForHour,
  weeklyPlanCopy,
  ACTIVE_WITHIN_DAYS,
  type FitzyPushConfig,
  type FitzyPushSlot,
  type FitzyPushType,
  type ProteinDay,
  type PushCopy,
  type SentRow,
  type Skip,
} from '../fitzy/push';
import { addDays } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';
import type { FitzyTier } from '../types/fitzy';

import { DietaryPreferencesService } from './dietary-preferences-service';
import { FitzyFocusService } from './fitzy-focus-service';
import { FitzyService } from './fitzy-service';
import { CAP_EXEMPT_TYPES, NotificationOrchestrator, isWithinQuietWindow, startOfLocalDay } from './notification-orchestrator';
import { UsageService } from './usage-service';

const DEFAULT_TZ = 'America/New_York';
/** Quiet window assumed for users without a preferences row (the createDefaults window). */
const DEFAULT_QUIET = { start: '22:00', end: '07:00' };
const AI_TIMEOUT_MS = 20_000;
const FOCUS_TIMEOUT_MS = 45_000;
const CHUNK = 200;

export interface FitzyPushRunOptions {
  now?: Date;
  /** Decide only: no claim, no model call, no send. */
  dryRun?: boolean;
  /** Restrict to one user (test sends). */
  userId?: string;
  /** With userId: send this kind now, ignoring the hour window, kill switch, spacing and weekly caps (prefs, quiet hours and the daily cap still apply in the orchestrator). */
  force?: FitzyPushType;
  /** Stop starting new users after this many ms (cron maxDuration headroom). */
  budgetMs?: number;
  concurrency?: number;
  config?: FitzyPushConfig;
}

export interface FitzyPushDecision {
  userId: string;
  localDate: string;
  hour: number;
  slot: FitzyPushSlot;
  kind: FitzyPushType | null;
  skip: Skip | 'duplicate' | 'claim_failed' | 'budget' | 'error' | null;
  sent?: boolean;
  reason?: string;
  source?: PushCopy['source'];
}

export interface FitzyPushSummary {
  enabled: boolean;
  candidates: number;
  inWindow: number;
  sent: number;
  skipped: Record<string, number>;
  byKind: Record<string, number>;
  decisions?: FitzyPushDecision[];
}

interface UserCtx {
  userId: string;
  tz: string;
  local: { date: string; hour: number; weekday: number };
  slot: FitzyPushSlot;
  slotKind: 'morning' | 'fitzy_hydration_nudge' | 'fitzy_protein_nudge';
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms))]);

async function chunked<T>(ids: string[], fn: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(...(await fn(ids.slice(i, i + CHUNK))));
  return out;
}

export class FitzyPushService {
  static async run(opts: FitzyPushRunOptions = {}): Promise<FitzyPushSummary> {
    const now = opts.now ?? new Date();
    const cfg = opts.config ?? pushConfig();
    const forced = !!(opts.userId && opts.force);
    const summary: FitzyPushSummary = { enabled: cfg.enabled, candidates: 0, inWindow: 0, sent: 0, skipped: {}, byKind: {}, ...(opts.dryRun || forced ? { decisions: [] } : {}) };
    if (!cfg.enabled && !forced && !opts.dryRun) return summary;

    const supabase = createAdminSupabase();
    let userIds: string[];
    if (opts.userId) {
      userIds = [opts.userId];
    } else {
      const { data } = await supabase.from('push_tokens').select('user_id').eq('is_active', true);
      userIds = [...new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
    }
    summary.candidates = userIds.length;
    if (!userIds.length) return summary;

    // Timezone priority mirrors ReminderService: notification_preferences → latest streak claim → New York.
    const [prefRows, claimRows] = await Promise.all([
      chunked(userIds, async (part) => ((await supabase.from('notification_preferences').select('*').in('user_id', part)).data ?? [])),
      chunked(userIds, async (part) =>
        ((await supabase.from('streak_claims').select('user_id, timezone, claim_date').in('user_id', part).order('claim_date', { ascending: false }).limit(part.length * 5)).data ?? []) as any[]
      ),
    ]);
    const prefsByUser = new Map<string, any>(prefRows.map((p) => [p.user_id, p]));
    const claimTz = new Map<string, string>();
    for (const c of claimRows) if (c.timezone && !claimTz.has(c.user_id)) claimTz.set(c.user_id, c.timezone);

    const inWindow: UserCtx[] = [];
    for (const userId of userIds) {
      const tz = prefsByUser.get(userId)?.quiet_hours_timezone || claimTz.get(userId) || DEFAULT_TZ;
      let local: UserCtx['local'];
      try {
        local = localParts(tz, now);
      } catch {
        local = localParts(DEFAULT_TZ, now);
      }
      if (forced) {
        const slot = SLOT_OF[opts.force!];
        inWindow.push({ userId, tz, local, slot, slotKind: slot === 'morning' ? 'morning' : (opts.force as UserCtx['slotKind']) });
        continue;
      }
      const s = slotForHour(local.hour, cfg);
      if (s) inWindow.push({ userId, tz, local, slot: s.slot, slotKind: s.kind });
    }
    summary.inWindow = inWindow.length;
    if (!inWindow.length) return summary;

    // Batched reads for the in-window users.
    const ids = inWindow.map((u) => u.userId);
    const since14 = new Date(now.getTime() - 14 * 86_400_000).toISOString();
    const sinceDate = addDays(now.toISOString().slice(0, 10), -(ACTIVE_WITHIN_DAYS + 1));
    const since8 = addDays(now.toISOString().slice(0, 10), -9);
    const [logRows, claims, food, workouts, convs] = await Promise.all([
      chunked(ids, async (part) =>
        ((await supabase.from('notification_log').select('user_id, notification_type, sent_at').in('user_id', part).eq('suppressed', false).gte('sent_at', since14)).data ?? []) as any[]
      ),
      chunked(ids, async (part) => ((await supabase.from('streak_claims').select('user_id, claim_date').in('user_id', part).gte('claim_date', sinceDate)).data ?? []) as any[]),
      chunked(ids, async (part) =>
        ((await supabase.from('food_log_entries').select('user_id, entry_date, entry_type, protein_g, water_ml').in('user_id', part).gte('entry_date', since8).is('deleted_at', null)).data ?? []) as any[]
      ),
      chunked(ids, async (part) =>
        ((await supabase.from('exercise_logs').select('user_id, exercise_date').in('user_id', part).gte('exercise_date', sinceDate).eq('is_deleted', false)).data ?? []) as any[]
      ),
      chunked(ids, async (part) => ((await supabase.from('fitzy_conversations').select('user_id').in('user_id', part).limit(part.length * 50)).data ?? []) as any[]),
    ]);
    const group = <T extends { user_id: string }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) m.set(r.user_id, [...(m.get(r.user_id) ?? []), r]);
      return m;
    };
    const logs = group(logRows);
    const claimsBy = group(claims);
    const foodBy = group(food);
    const workoutsBy = group(workouts);
    const aiEligible = new Set(convs.map((c) => c.user_id as string));

    const started = Date.now();
    const budget = opts.budgetMs ?? 240_000;
    const queue = [...inWindow];
    const worker = async () => {
      for (let u = queue.shift(); u; u = queue.shift()) {
        let d: FitzyPushDecision;
        if (Date.now() - started > budget) {
          d = { userId: u.userId, localDate: u.local.date, hour: u.local.hour, slot: u.slot, kind: null, skip: 'budget' };
        } else {
          try {
            d = await this.processUser(u, {
              now,
              cfg,
              dryRun: !!opts.dryRun,
              force: forced ? opts.force! : null,
              prefs: prefsByUser.get(u.userId) ?? null,
              sent: (logs.get(u.userId) ?? []).map((r: any) => ({ type: r.notification_type, sentAt: r.sent_at })),
              activityDates: [
                ...(claimsBy.get(u.userId) ?? []).map((r: any) => r.claim_date as string),
                ...(foodBy.get(u.userId) ?? []).map((r: any) => r.entry_date as string),
                ...(workoutsBy.get(u.userId) ?? []).map((r: any) => r.exercise_date as string),
              ],
              food: foodBy.get(u.userId) ?? [],
              aiEligible: aiEligible.has(u.userId),
            });
          } catch (err: any) {
            console.error('[FitzyPush] user failed:', u.userId, err?.message ?? err);
            d = { userId: u.userId, localDate: u.local.date, hour: u.local.hour, slot: u.slot, kind: null, skip: 'error' };
          }
        }
        if (d.sent) {
          summary.sent++;
          summary.byKind[d.kind!] = (summary.byKind[d.kind!] ?? 0) + 1;
        } else {
          const key = d.skip ?? d.reason ?? 'not_sent';
          summary.skipped[key] = (summary.skipped[key] ?? 0) + 1;
        }
        summary.decisions?.push(d);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 6, queue.length)) }, worker));
    if (summary.sent || Object.keys(summary.skipped).length) console.log('[FitzyPush] run', JSON.stringify({ ...summary, decisions: undefined }));
    return summary;
  }

  static async processUser(
    u: UserCtx,
    x: {
      now: Date;
      cfg: FitzyPushConfig;
      dryRun: boolean;
      force: FitzyPushType | null;
      prefs: any | null;
      sent: SentRow[];
      activityDates: string[];
      food: Array<{ entry_date: string; entry_type: string | null; protein_g: number | null; water_ml: number | null }>;
      aiEligible: boolean;
    }
  ): Promise<FitzyPushDecision> {
    const base = { userId: u.userId, localDate: u.local.date, hour: u.local.hour, slot: u.slot };
    const supabase = createAdminSupabase();
    const today = u.local.date;

    // 1. Shared gates (kill switch, toggle, quiet hours, activity, cap budget, spacing).
    const quiet = x.prefs
      ? x.prefs.quiet_hours_start && x.prefs.quiet_hours_end
        ? { start: x.prefs.quiet_hours_start, end: x.prefs.quiet_hours_end }
        : null
      : DEFAULT_QUIET;
    let startOfDay: Date;
    try {
      startOfDay = startOfLocalDay(u.tz, x.now);
    } catch {
      startOfDay = startOfLocalDay(DEFAULT_TZ, x.now);
    }
    const ctx = {
      now: x.now,
      startOfDay,
      sent: x.sent,
      countsTowardCap: (t: string) => !CAP_EXEMPT_TYPES.has(t as any),
      coachEnabled: x.prefs?.coach_enabled !== false,
      inQuietHours: !!quiet && isWithinQuietWindow(u.local.hour * 60 + Number(new Intl.DateTimeFormat('en-US', { timeZone: u.tz, minute: '2-digit' }).format(x.now)), quiet.start, quiet.end),
      active: x.activityDates.some((d) => d >= addDays(today, -ACTIVE_WITHIN_DAYS) && d <= today),
    };

    // 2. Which kind, and is it relevant for this user today?
    let kind: FitzyPushType;
    let tier: FitzyTier | null = null;
    if (x.force) {
      kind = x.force;
    } else if (u.slotKind === 'morning') {
      const pre = commonSkip('fitzy_daily_focus', ctx, x.cfg);
      if (pre) return { ...base, kind: null, skip: pre };
      tier = await UsageService.fitzyTier(u.userId);
      const [{ data: planRow }, { data: daily }] = await Promise.all([
        supabase.from('fitzy_plans').select('is_preview').eq('user_id', u.userId).eq('week_of', mondayOf(today)).maybeSingle(),
        supabase.from('fitzy_daily').select('user_id').eq('user_id', u.userId).eq('date', today).maybeSingle(),
      ]);
      const lastTeaser = x.sent.filter((r) => r.type === 'fitzy_weekly_plan').map((r) => r.sentAt).sort().pop() ?? null;
      const m = morningKind({
        weekday: u.local.weekday,
        tier,
        hasPlanThisWeek: !!planRow && !(planRow as any).is_preview,
        hasPreviewThisWeek: !!planRow && !!(planRow as any).is_preview,
        lastTeaserAt: lastTeaser,
        aiEligible: x.aiEligible,
        focusAlreadyGenerated: !!daily,
        now: x.now,
      });
      if ('skip' in m) return { ...base, kind: null, skip: m.skip };
      kind = m.kind;
      if (x.cfg.disabledKinds.has(kind)) return { ...base, kind, skip: 'kind_disabled' };
    } else {
      kind = u.slotKind;
      const pre = commonSkip(kind, ctx, x.cfg);
      if (pre) return { ...base, kind, skip: pre };
      if (kind === 'fitzy_hydration_nudge') {
        const waterDays = x.food.filter((f) => f.entry_type === 'water' && (f.water_ml ?? 0) > 0).map((f) => f.entry_date);
        const { data: bev } = await supabase
          .from('beverage_logs')
          .select('entry_date')
          .eq('user_id', u.userId)
          .eq('category', 'water')
          .is('deleted_at', null)
          .gte('entry_date', addDays(today, -8));
        waterDays.push(...((bev ?? []) as { entry_date: string }[]).map((b) => b.entry_date));
        if (!hydrationRelevant(waterDays, today)) return { ...base, kind, skip: 'not_relevant' };
      } else {
        if (!proteinBehind(proteinDays(x.food), today)) return { ...base, kind, skip: 'not_relevant' };
      }
    }

    if (x.dryRun) return { ...base, kind, skip: null, reason: 'dry_run' };

    // 3. Claim (user, slot, local date). The PK makes retries and concurrent runs send once.
    const key = deliveryKey(SLOT_OF[kind], today) + (x.force ? `:test:${x.now.getTime()}` : '');
    const { error: claimError } = await supabase.from('fitzy_push_deliveries').insert({ user_id: u.userId, delivery_key: key, kind, local_date: today, status: 'claimed' });
    if (claimError) {
      if ((claimError as any).code === '23505') return { ...base, kind, skip: 'duplicate' };
      console.error('[FitzyPush] claim failed (migration 107 applied?):', claimError.message);
      return { ...base, kind, skip: 'claim_failed' };
    }

    // 4. Copy.
    tier = tier ?? (await UsageService.fitzyTier(u.userId));
    const seed = `${u.userId}:${today}`;
    let copy: PushCopy;
    if (kind === 'fitzy_daily_focus' || kind === 'fitzy_weekly_recap') {
      try {
        const focus = await withTimeout(FitzyFocusService.get(u.userId, u.tz, x.now), FOCUS_TIMEOUT_MS);
        if (focus.kind === 'recap') kind = 'fitzy_weekly_recap';
        else if (kind === 'fitzy_weekly_recap') kind = 'fitzy_daily_focus';
        copy = focusPushCopy(focus, FitzyService.guard, 'ai');
      } catch (err: any) {
        console.error('[FitzyPush] focus failed, template:', err?.message ?? err);
        copy = focusPushCopy({ date: today, kind: 'tip', headline: '', body: '', cta: { label: '', action: { type: 'log_workout', label: '' } }, tier }, FitzyService.guard, 'template');
      }
    } else if (kind === 'fitzy_weekly_plan') {
      copy = weeklyPlanCopy(tier);
    } else if (kind === 'fitzy_hydration_nudge') {
      copy = hydrationCopy(seed);
    } else {
      copy = await this.proteinCopy(u.userId, tier, u.tz, x.aiEligible, seed);
    }

    // 5. Send (prefs, master switch, daily cap, quiet hours, suppression, logging).
    const res = await NotificationOrchestrator.send(u.userId, kind, { title: copy.title, body: copy.body, fitzyTip: copy.tip, fitzySource: copy.source, localDate: today });
    await supabase
      .from('fitzy_push_deliveries')
      .update({ kind, status: res.sent ? 'sent' : res.reason ?? 'not_sent', updated_at: new Date().toISOString() })
      .eq('user_id', u.userId)
      .eq('delivery_key', key);
    return { ...base, kind, skip: null, sent: res.sent, reason: res.reason, source: copy.source };
  }

  /** AI protein nudge for users who chat with Fitzy (Pro grounding includes memory); template otherwise or on any failure. */
  static async proteinCopy(userId: string, tier: FitzyTier, tz: string, aiEligible: boolean, seed: string): Promise<PushCopy> {
    const prefs = await DietaryPreferencesService.getPrefs(userId).catch(() => ({ diet: 'none', allergens: [] as string[] }));
    const template = proteinTemplate(prefs.diet, prefs.allergens, seed);
    if (!aiEligible) return template;
    try {
      const grounding = await FitzyService.grounding(userId, tier, { timezone: tz });
      const res = await generateWithFallback({ ...nudgeRequest(grounding, proteinIdeas(prefs.diet, prefs.allergens, 3, seed)), abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS) });
      return parseNudge(res.text, FitzyService.guard, prefs.allergens) ?? template;
    } catch (err: any) {
      console.error('[FitzyPush] protein nudge generation failed, template:', err?.message ?? err);
      return template;
    }
  }
}

/** Per-day entry count + protein from food_log_entries rows (water rows excluded). */
export function proteinDays(rows: Array<{ entry_date: string; entry_type: string | null; protein_g: number | null }>): ProteinDay[] {
  const m = new Map<string, ProteinDay>();
  for (const r of rows) {
    if (r.entry_type === 'water') continue;
    const d = m.get(r.entry_date) ?? { date: r.entry_date, entries: 0, proteinG: 0 };
    d.entries++;
    d.proteinG += r.protein_g ?? 0;
    m.set(r.entry_date, d);
  }
  return [...m.values()];
}

export { FITZY_PUSH_TYPES };
