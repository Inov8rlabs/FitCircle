/**
 * Fitzy daily focus (docs/FITZY_V2_SPEC.md §3.4): one card per user per local
 * day, cached in fitzy_daily.
 *  - New users with no recent data → a static `welcome` focus (no model call).
 *  - Sunday + Pro + a plan this week → weekly recap (deep model).
 *  - Otherwise a tip / plan nudge from the chat model, grounded like chat.
 * Free gets the full focus, but its CTA is always "Make this my plan" → start_plan (Pro).
 * Every text passes the Fitzy output guard; a failed or unsafe generation falls back to a
 * static focus that is NOT cached (so the next open retries).
 */
import { isSunday, todayFor } from '../fitzy/dates';
import { chatModel, deepModel, generateWithFallback, systemMessages } from '../fitzy/models';
import { addDays } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';
import type { FitzyAction, FitzyDailyFocus, FitzyTier } from '../types/fitzy';

import { FitzyPlanService } from './fitzy-plan-service';
import { FitzyService } from './fitzy-service';
import { UsageService } from './usage-service';

const FOCUS_PROMPT = [
  'You are Fitzy, a warm, body-neutral and food-neutral fitness + nutrition coach.',
  "Write today's focus for the user: ONE small, specific, doable idea for today, grounded in their data.",
  'headline ≤ 70 chars, body ≤ 240 chars (2 short sentences, friendly, no lists), plus one call to action.',
  'NEVER mention calorie targets, deficits, restriction, skipping meals, weight targets or rates, or',
  'good/bad foods; never shame; no medical advice. Celebrate consistency, add rather than remove.',
  'Reply with ONLY JSON: {"kind":"tip"|"plan_nudge","headline":"…","body":"…",',
  '"cta":{"label":"≤ 28 chars","type":"log_meal"|"log_workout"|"start_plan"|"open_circle"}}',
].join('\n');

const RECAP_PROMPT = [
  'You are Fitzy, a warm, body-neutral fitness + nutrition coach. It is Sunday: write a short weekly recap',
  'of the user’s plan progress — celebrate what they did (any amount counts), name one thing to carry into',
  'next week. Never judge misses. headline ≤ 70 chars, body ≤ 240 chars.',
  'NEVER mention calorie targets, deficits, restriction, weight targets or rates, or good/bad foods.',
  'Reply with ONLY JSON: {"headline":"…","body":"…"}',
].join('\n');

const CTA_TYPES = ['log_meal', 'log_workout', 'start_plan', 'open_circle'] as const;
const cp = (s: string) => [...s].length;

const FREE_CTA = (): FitzyDailyFocus['cta'] => ({ label: 'Make this my plan', action: { type: 'start_plan', label: 'Make this my plan' } });

function looseJson(text: string): any {
  const m = text.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0].replace(/,\s*([}\]])/g, '$1'));
  } catch {
    return null;
  }
}

export function welcomeFocus(date: string, tier: FitzyTier): FitzyDailyFocus {
  return {
    date,
    kind: 'welcome',
    headline: "Hi, I'm Fitzy, your coach",
    body: 'Log a meal or a short walk today and I will tailor tips to you. Ask me anything about food, movement or staying consistent.',
    cta: tier === 'pro' ? { label: 'Log your first meal', action: { type: 'log_meal', label: 'Log your first meal' } } : FREE_CTA(),
    tier,
  };
}

function staticFocus(date: string, tier: FitzyTier): FitzyDailyFocus {
  return {
    date,
    kind: 'tip',
    headline: 'A 10-minute walk counts',
    body: 'Short walks add up and lift your mood. Pick a time today, maybe after a meal, and enjoy the fresh air.',
    cta: tier === 'pro' ? { label: 'Log a walk', action: { type: 'log_workout', label: 'Log a walk' } } : FREE_CTA(),
    tier,
  };
}

export class FitzyFocusService {
  /** Any food log, workout or streak claim in the last 14 days. */
  static async hasRecentData(userId: string, today: string): Promise<boolean> {
    const since = addDays(today, -14);
    const supabase = createAdminSupabase();
    const [food, workouts, claims] = await Promise.all([
      supabase.from('food_log_entries').select('id').eq('user_id', userId).gte('entry_date', since).is('deleted_at', null).limit(1),
      supabase.from('exercise_logs').select('id').eq('user_id', userId).gte('exercise_date', since).eq('is_deleted', false).limit(1),
      supabase.from('streak_claims').select('id').eq('user_id', userId).gte('claim_date', since).limit(1),
    ]);
    return [food, workouts, claims].some((r) => ((r as any).data ?? []).length > 0);
  }

  static async get(userId: string, timezone?: string | null, now: Date = new Date()): Promise<FitzyDailyFocus> {
    const date = timezone ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) : todayFor(null);
    const tier = await UsageService.fitzyTier(userId);
    const supabase = createAdminSupabase();
    const { data: cached } = await supabase.from('fitzy_daily').select('payload').eq('user_id', userId).eq('date', date).maybeSingle();
    if (cached && (cached as any).payload) return this.forTier((cached as any).payload as FitzyDailyFocus, tier);

    let focus: FitzyDailyFocus | null = null;
    let cacheable = true;
    if (!(await this.hasRecentData(userId, date))) {
      focus = welcomeFocus(date, tier);
    } else {
      const plan = await FitzyPlanService.current(userId, date).catch(() => null);
      const grounding = await FitzyService.grounding(userId, tier, { timezone });
      try {
        if (tier === 'pro' && plan && isSunday(date)) {
          const res = await generateWithFallback({
            primary: deepModel(),
            system: systemMessages(RECAP_PROMPT, grounding),
            messages: [{ role: 'user', content: `Week of ${plan.weekOf}. Goal: ${plan.goal}. Progress: ${FitzyPlanService.progressLine(plan)}` }],
            maxOutputTokens: 300,
          });
          const j = looseJson(res.text);
          focus = this.validate(j, date, tier, 'recap', { label: 'Plan next week', action: { type: 'start_plan', label: 'Plan next week' } });
        } else {
          const res = await generateWithFallback({
            primary: chatModel(),
            system: systemMessages(FOCUS_PROMPT, grounding),
            messages: [{ role: 'user', content: `Today is ${date}.${plan ? ' The user has a plan this week.' : ' The user has no plan this week.'}` }],
            maxOutputTokens: 300,
          });
          const j = looseJson(res.text);
          const type = (CTA_TYPES as readonly string[]).includes(j?.cta?.type) ? (j.cta.type as FitzyAction['type']) : 'log_workout';
          const label = typeof j?.cta?.label === 'string' && j.cta.label.trim() && cp(j.cta.label.trim()) <= 28 ? j.cta.label.trim() : 'Log it';
          const kind = j?.kind === 'plan_nudge' ? 'plan_nudge' : 'tip';
          focus = this.validate(j, date, tier, kind, { label, action: { type, label } });
        }
      } catch (err) {
        console.error('[FitzyFocus] generation failed:', (err as any)?.message ?? err);
      }
      if (!focus) {
        focus = staticFocus(date, tier);
        cacheable = false;
      }
    }
    if (cacheable) {
      const { error } = await supabase.from('fitzy_daily').upsert({ user_id: userId, date, payload: focus, created_at: now.toISOString() }, { onConflict: 'user_id,date' });
      if (error) console.error('[FitzyFocus] cache write failed:', error.message);
    }
    return this.forTier(focus, tier);
  }

  /** Length + guard checks; null when unusable. */
  static validate(j: any, date: string, tier: FitzyTier, kind: FitzyDailyFocus['kind'], cta: FitzyDailyFocus['cta']): FitzyDailyFocus | null {
    const headline = typeof j?.headline === 'string' ? j.headline.trim() : '';
    const body = typeof j?.body === 'string' ? j.body.trim() : '';
    if (!headline || !body || cp(headline) > 70 || cp(body) > 240) return null;
    if (FitzyService.containsForbiddenContent(`${headline}\n${body}\n${cta.label}`)) return null;
    return { date, kind, headline, body, cta, tier };
  }

  /** The cached payload re-shaped for the caller's current tier (free CTA is always start_plan). */
  static forTier(f: FitzyDailyFocus, tier: FitzyTier): FitzyDailyFocus {
    return { ...f, tier, cta: tier === 'pro' ? f.cta : FREE_CTA() };
  }
}
