/**
 * Trial-first teaser support (docs/TRIAL_FIRST_SPEC.md §3): make sure a REAL free weekly-plan
 * preview exists early, so the `fitzy_recommendations` card has true content in session 1.
 *
 *  - fitzyPlanPreviewReady: one indexed read — a plan row for this week or last week whose
 *    commitments came from the model (is_preview + model set), or a real plan (lapsed Pro).
 *    The deterministic FALLBACK_COMMITMENTS (model failed → model null) do NOT count.
 *  - warmFitzyPlanPreview: generate the free teaser now (chat model, cached per week by
 *    FitzyPlanService.preview). Called after onboarding completes and, for users who finished
 *    onboarding before this shipped, after a feed request that found no preview. Free users with
 *    goals only; at most one in-flight warm-up per user per instance.
 */
import { addDays } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';

import { mondayOf, todayFor } from './dates';

export async function fitzyPlanPreviewReady(userId: string, localDate: string): Promise<boolean> {
  const thisWeek = mondayOf(localDate);
  const lastWeek = addDays(thisWeek, -7);
  const { data, error } = await createAdminSupabase()
    .from('fitzy_plans')
    .select('week_of, is_preview, model, commitments')
    .eq('user_id', userId)
    .in('week_of', [thisWeek, lastWeek]);
  if (error) throw error;
  return ((data ?? []) as Array<{ is_preview: boolean; model: string | null; commitments: unknown[] | null }>).some(
    (r) => Array.isArray(r.commitments) && r.commitments.length > 0 && (!r.is_preview || !!r.model)
  );
}

const inflight = new Set<string>();

/** Best-effort; never throws. Returns true when a preview was generated now. */
export async function warmFitzyPlanPreview(userId: string, timezone?: string | null): Promise<boolean> {
  if (inflight.has(userId)) return false;
  inflight.add(userId);
  try {
    // Lazy: keeps this module light for the feed route and avoids an import cycle.
    const [{ UsageService }, { FitzyService }, { FitzyPlanService }] = await Promise.all([
      import('../services/usage-service'),
      import('../services/fitzy-service'),
      import('../services/fitzy-plan-service'),
    ]);
    const tier = await UsageService.fitzyTier(userId);
    if (tier === 'pro') return false;
    const { data: profile } = await createAdminSupabase().from('profiles').select('goals, onboarding_completed').eq('id', userId).maybeSingle();
    const goals = Array.isArray(profile?.goals) ? profile.goals.filter((g: unknown) => typeof g === 'string' && g.trim()) : [];
    if (profile?.onboarding_completed !== true || goals.length === 0) return false;
    const today = todayFor(timezone);
    if (await fitzyPlanPreviewReady(userId, today)) return false;
    // Server-initiated AI: a consent record or the chat evidence (lib/fitzy/ai-consent.ts), else nothing
    // (FitzyPlanService.preview would only return the static teaser; skip the grounding reads too).
    const { hasAiConsentEvidence } = await import('./ai-consent');
    if (!(await hasAiConsentEvidence(userId))) return false;
    const grounding = await FitzyService.grounding(userId, tier, { timezone });
    await FitzyPlanService.preview(userId, today, null, grounding, FitzyService.guard);
    return true;
  } catch (err: any) {
    console.warn('[fitzy] plan preview warm-up failed:', err?.message ?? err);
    return false;
  } finally {
    inflight.delete(userId);
  }
}
