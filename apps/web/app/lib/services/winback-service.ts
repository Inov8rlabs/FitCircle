/**
 * Win-back ladder runner (docs/PUSH_NOTIFICATIONS.md §8.4). Hourly cron
 * (/api/cron/winback, :30): each lapsed user with a push token is evaluated in
 * their local 18:00–19:00 window; the due step's copy is built from their real
 * data (lib/journey/winback.ts) and sent through NotificationOrchestrator, which
 * applies the audience gate, category toggle (journey), daily cap, quiet hours
 * and dedupe. `dryRun` returns the same decisions without sending.
 */
import { loadLiveCircles } from '../circles/live-circles';
import {
  WINBACK_STEPS,
  day14Copy,
  day30Copy,
  day3Copy,
  day7Copy,
  selectWinbackStep,
  typeForStep,
  winbackDedupeKey,
  type CircleWeek,
  type WinbackCopy,
  type WinbackHistory,
  type WinbackSkip,
  type WinbackStep,
} from '../journey/winback';
import { localClockIn } from '../notifications/user-timezone';
import { createAdminSupabase } from '../supabase-admin';

import { CampaignService, featuredCampaign } from './campaign-service';
import { NotificationOrchestrator } from './notification-orchestrator';
import { UsageService } from './usage-service';
import { UserAudienceService, type UserAudience } from './user-audience-service';

type Row = Record<string, any>;

export interface WinbackDecision {
  userId: string;
  stage: string | null;
  daysSinceSeen: number | null;
  lapseStart: string | null;
  step?: WinbackStep;
  skip?: WinbackSkip;
  copy?: WinbackCopy;
  /** Set when actually sent: the orchestrator's verdict. */
  result?: { sent: boolean; reason?: string };
}

export interface WinbackRunOptions {
  dryRun?: boolean;
  now?: Date;
  /** Evaluate every user as if it were their send window (dry runs / "who is due tomorrow"). */
  ignoreWindow?: boolean;
  /** Restrict to these users (tests, debugging). */
  userIds?: string[];
}

export interface WinbackRunResult {
  dryRun: boolean;
  candidates: number;
  due: Record<WinbackStep, number>;
  sent: number;
  skipped: Record<string, number>;
  decisions: WinbackDecision[];
}

const TRIGGER_TYPES = ['leaderboard_overtaken', 'health_sync_update'];
const WINBACK_TYPE_LIST = WINBACK_STEPS.map(typeForStep);
const HISTORY_LOOKBACK_DAYS = 40;

const chunks = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

export const firstName = (displayName: string | null | undefined): string => String(displayName ?? '').trim().split(/\s+/)[0] ?? '';

export class WinbackService {
  static async run(opts: WinbackRunOptions = {}): Promise<WinbackRunResult> {
    const now = opts.now ?? new Date();
    const db = createAdminSupabase();
    const result: WinbackRunResult = {
      dryRun: !!opts.dryRun,
      candidates: 0,
      due: { day3: 0, day7: 0, day14: 0, day30: 0 },
      sent: 0,
      skipped: {},
      decisions: [],
    };

    let userIds = opts.userIds;
    if (!userIds) {
      const { data, error } = await db.from('push_tokens').select('user_id').eq('is_active', true);
      if (error) throw new Error(error.message);
      userIds = [...new Set(((data ?? []) as Row[]).map((r) => r.user_id as string))];
    }
    if (userIds.length === 0) return result;
    result.candidates = userIds.length;

    const audiences = await UserAudienceService.loadMany(userIds, now);
    const history = await this.loadHistory(userIds, now);

    const due: Array<{ a: UserAudience; step: WinbackStep }> = [];
    for (const id of userIds) {
      const a = audiences.get(id);
      const lifecycle = a?.lifecycle ?? null;
      const local = localClockIn(now, a?.timezone ?? 'America/New_York');
      const h = history.get(id);
      const episodeSteps = new Set<WinbackStep>(
        (h?.winback ?? []).filter((r) => lifecycle && r.lapseStart === lifecycle.lastSeenLocalDate).map((r) => r.step)
      );
      const verdict = selectWinbackStep({
        lifecycle,
        testUser: !!a?.testReason,
        localMinutes: local.minutes,
        now,
        ignoreWindow: opts.ignoreWindow,
        history: {
          sentSteps: episodeSteps,
          lastWinbackAt: h?.lastWinbackAt ?? null,
          lastTriggerAt: h?.lastTriggerAt ?? null,
        } satisfies WinbackHistory,
      });
      const decision: WinbackDecision = {
        userId: id,
        stage: a?.stage ?? null,
        daysSinceSeen: lifecycle?.daysSinceSeen ?? null,
        lapseStart: lifecycle?.lastSeenLocalDate ?? null,
      };
      if ('skip' in verdict) {
        decision.skip = verdict.skip;
        result.skipped[verdict.skip] = (result.skipped[verdict.skip] ?? 0) + 1;
        // Only report the interesting skips in the decision list (lapsed users).
        if (verdict.skip !== 'not_lapsed' && verdict.skip !== 'unknown_stage') result.decisions.push(decision);
        continue;
      }
      decision.step = verdict.step;
      result.due[verdict.step]++;
      result.decisions.push(decision);
      due.push({ a: a!, step: verdict.step });
    }

    if (due.length === 0) return result;
    const content = await this.buildCopies(due, now);
    for (const { a, step } of due) {
      const decision = result.decisions.find((d) => d.userId === a.userId && d.step === step)!;
      const copy = content.get(a.userId);
      if (!copy) continue;
      decision.copy = copy;
      if (opts.dryRun) continue;
      try {
        const r = await NotificationOrchestrator.send(a.userId, typeForStep(step), {
          title: copy.title,
          body: copy.body,
          screen: copy.screen,
          ...(copy.circleId ? { circleId: copy.circleId } : {}),
          ...(copy.campaignSlug ? { campaignSlug: copy.campaignSlug } : {}),
          step,
          variant: copy.variant,
          lapseStart: a.lifecycle!.lastSeenLocalDate,
          daysSinceSeen: a.lifecycle!.daysSinceSeen,
          dedupeKey: winbackDedupeKey(step, a.lifecycle!.lastSeenLocalDate),
        });
        decision.result = r;
        if (r.sent) result.sent++;
      } catch (err: any) {
        decision.result = { sent: false, reason: `error:${err?.message ?? err}` };
      }
    }
    return result;
  }

  /** Delivered win-back steps (with their episode) and the last trigger push, per user. */
  static async loadHistory(
    userIds: string[],
    now: Date
  ): Promise<Map<string, { winback: Array<{ step: WinbackStep; lapseStart: string | null }>; lastWinbackAt: string | null; lastTriggerAt: string | null }>> {
    const db = createAdminSupabase();
    const since = new Date(now.getTime() - HISTORY_LOOKBACK_DAYS * 86_400_000).toISOString();
    const out = new Map<string, { winback: Array<{ step: WinbackStep; lapseStart: string | null }>; lastWinbackAt: string | null; lastTriggerAt: string | null }>();
    for (const part of chunks(userIds, 150)) {
      const { data, error } = await db
        .from('notification_log')
        .select('user_id, notification_type, data, sent_at')
        .in('user_id', part)
        .in('notification_type', [...WINBACK_TYPE_LIST, ...TRIGGER_TYPES])
        .eq('suppressed', false)
        .gte('sent_at', since);
      if (error) throw new Error(`notification_log read failed: ${error.message}`);
      for (const r of (data ?? []) as Row[]) {
        const h = out.get(r.user_id) ?? { winback: [], lastWinbackAt: null, lastTriggerAt: null };
        const later = (a: string | null, b: string) => (!a || Date.parse(b) > Date.parse(a) ? b : a);
        if (TRIGGER_TYPES.includes(r.notification_type)) h.lastTriggerAt = later(h.lastTriggerAt, r.sent_at);
        else {
          const step = String(r.notification_type).replace('winback_', '') as WinbackStep;
          h.winback.push({ step, lapseStart: (r.data?.lapseStart as string) ?? null });
          h.lastWinbackAt = later(h.lastWinbackAt, r.sent_at);
        }
        out.set(r.user_id, h);
      }
    }
    return out;
  }

  /** Copy per due user, from their real data. A failed lookup falls back to the plain variant. */
  static async buildCopies(due: Array<{ a: UserAudience; step: WinbackStep }>, now: Date): Promise<Map<string, WinbackCopy>> {
    const out = new Map<string, WinbackCopy>();
    const by = (s: WinbackStep) => due.filter((d) => d.step === s).map((d) => d.a);

    // Day 3: free scans left.
    const d3 = by('day3');
    if (d3.length) {
      const gateLive = await this.foodAiGateLive();
      const profiles = await this.profiles(d3.map((a) => a.userId), 'id, subscription_tier, created_at');
      for (const a of d3) {
        const p = profiles.get(a.userId);
        const isPro = p?.subscription_tier === 'premium' || p?.subscription_tier === 'enterprise';
        let scansLeft: number | null = null;
        try {
          scansLeft = (await UsageService.foodAiAllowance(a.userId, isPro ? 'premium' : 'free', gateLive, p?.created_at ?? null)).remaining;
        } catch {
          scansLeft = null; // unknown → the generic variant (never a guessed number)
        }
        out.set(a.userId, day3Copy({ scansLeft, isPro }));
      }
    }

    // Day 7: their live private circle's week.
    const d7 = by('day7');
    if (d7.length) {
      const weeks = await this.circleWeeks(d7.map((a) => a.userId), now).catch(() => new Map<string, CircleWeek>());
      for (const a of d7) out.set(a.userId, day7Copy(weeks.get(a.userId) ?? null));
    }

    // Day 14: their own history.
    const d14 = by('day14');
    if (d14.length) {
      const profiles = await this.profiles(d14.map((a) => a.userId), 'id, longest_streak');
      for (const a of d14) {
        let daysLogged = 0;
        try {
          daysLogged = await this.daysLogged(a.userId);
        } catch {
          daysLogged = 0;
        }
        out.set(a.userId, day14Copy({ daysLogged, longestStreak: Number(profiles.get(a.userId)?.longest_streak) || 0 }));
      }
    }

    // Day 30: the live campaign for the user's local today.
    const d30 = by('day30');
    if (d30.length) {
      let rows: any[] = [];
      try {
        rows = await CampaignService.fetchActiveRows();
      } catch {
        rows = [];
      }
      for (const a of d30) {
        const today = localClockIn(now, a.timezone).date;
        const featured = featuredCampaign(rows, a.userId, today);
        const row = featured && featured.phase === 'live' ? rows.find((r) => r.slug === featured.slug) : null;
        out.set(a.userId, day30Copy(row ? { slug: row.slug, title: row.title, tagline: row.tagline } : null));
      }
    }
    return out;
  }

  /**
   * For each user, the live private circle with the most other real members
   * active this week (streak claim days in the last 7 local days).
   */
  static async circleWeeks(userIds: string[], now: Date): Promise<Map<string, CircleWeek>> {
    const out = new Map<string, CircleWeek>();
    const circles = (await loadLiveCircles({ userIds, now })).filter((c) => c.memberIds.length >= 2);
    if (circles.length === 0) return out;
    const others = [...new Set(circles.flatMap((c) => c.memberIds))];
    const audiences = await UserAudienceService.loadMany(others, now);
    const db = createAdminSupabase();
    const since = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    const days = new Map<string, Set<string>>();
    for (const part of chunks(others, 150)) {
      const { data, error } = await db.from('streak_claims').select('user_id, claim_date').in('user_id', part).gte('claim_date', since);
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as Row[]) {
        const s = days.get(r.user_id) ?? new Set<string>();
        s.add(String(r.claim_date));
        days.set(r.user_id, s);
      }
    }
    const names = await this.profiles(others, 'id, display_name');
    for (const userId of userIds) {
      let best: CircleWeek | null = null;
      for (const c of circles) {
        if (!c.memberIds.includes(userId)) continue;
        const active = c.memberIds
          .filter((m) => m !== userId && !audiences.get(m)?.testReason)
          .map((m) => ({ id: m, days: days.get(m)?.size ?? 0, name: firstName(names.get(m)?.display_name) }))
          .filter((m) => m.days > 0 && m.name);
        if (active.length === 0) continue;
        active.sort((x, y) => y.days - x.days || x.name.localeCompare(y.name));
        const week: CircleWeek = { circleId: c.id, circleName: c.name, activeOthers: active.length, top: { name: active[0].name, days: active[0].days } };
        if (!best || week.activeOthers > best.activeOthers) best = week;
      }
      if (best) out.set(userId, best);
    }
    return out;
  }

  static async daysLogged(userId: string): Promise<number> {
    const { data, error } = await createAdminSupabase()
      .from('food_log_entries')
      .select('entry_date')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .limit(5000);
    if (error) throw new Error(error.message);
    return new Set(((data ?? []) as Row[]).map((r) => String(r.entry_date))).size;
  }

  private static async foodAiGateLive(): Promise<boolean> {
    try {
      const { data } = await createAdminSupabase().from('feature_gates').select('required_tier').eq('feature_key', 'food_ai_unlimited').maybeSingle();
      return (data as Row | null)?.required_tier === 'premium';
    } catch {
      return false;
    }
  }

  private static async profiles(ids: string[], cols: string): Promise<Map<string, Row>> {
    const out = new Map<string, Row>();
    for (const part of chunks(ids, 150)) {
      const { data, error } = await createAdminSupabase().from('profiles').select(cols).in('id', part);
      if (error) continue;
      for (const r of (data ?? []) as Row[]) out.set(r.id, r);
    }
    return out;
  }
}
