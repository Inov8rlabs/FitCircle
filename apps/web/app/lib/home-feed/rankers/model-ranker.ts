/**
 * ModelRanker — STUB for a future learned ranker. Not wired into compose.ts.
 *
 * Plan: train a per-card engagement model (tap / dismiss given impression)
 * offline from home_feed_decisions ⨝ home_feed_events, export it as something
 * evaluable synchronously in-process (e.g. logistic-regression weights or a
 * small GBDT as JSON), and implement `ScoringModel` with it. The ranker then
 * blends model scores with the default prior, so a weak or missing model
 * degrades to the default order. Guardrails still run after it.
 *
 * Feature vectors are built here (buildFeatureVector) so training and serving
 * share one definition. Values must stay coarse: no health values (privacy
 * conventions in analytics/tracking-plan.json apply to features too).
 */
import { DEFAULT_ORDER, defaultIndex, isPromo } from '../catalog';
import type { Candidate, FeedContext } from '../types';

import { scoreDefault, sortScored } from './default-ranker';
import type { RankInput, RankOutput, Ranker } from './types';

export type FeatureVector = Record<string, number>;

/** Bump when features change so the decision log says which features a model saw. */
export const FEATURE_VERSION = 1;

const tri = (v: boolean | null): number => (v === null ? -1 : v ? 1 : 0);

/** Context + card features for one candidate. Deterministic and pure. */
export function buildFeatureVector(card: Candidate, ctx: FeedContext): FeatureVector {
  const f: FeatureVector = {
    feature_version: FEATURE_VERSION,
    default_index: defaultIndex(card.type),
    default_index_norm: defaultIndex(card.type) / DEFAULT_ORDER.length,
    is_promo: isPromo(card.type) ? 1 : 0,
    local_hour: ctx.localHour,
    local_weekday: ctx.localWeekday,
    is_evening: ctx.localHour >= 18 ? 1 : 0,
    platform_ios: ctx.platform === 'ios' ? 1 : 0,
    platform_android: ctx.platform === 'android' ? 1 : 0,
    days_since_signup: ctx.daysSinceSignup ?? -1,
    is_new_user: ctx.daysSinceSignup !== null && ctx.daysSinceSignup < 7 ? 1 : 0,
    is_pro: tri(ctx.isPro),
    has_circle: tri(ctx.hasCircle),
    circle_count: ctx.circleCount ?? -1,
    campaign_present: ctx.campaign ? tri(ctx.campaign.present) : -1,
    referral_enabled: tri(ctx.referralProgramEnabled),
    checked_in_today: tri(ctx.checkedInToday),
    streak_at_risk: ctx.streakAtRisk ? 1 : 0,
    water_logged_today: tri(ctx.waterLoggedToday),
  };
  // One-hot card type (catalog types; unknown future types share "other").
  const known = DEFAULT_ORDER.includes(card.type);
  f[`card_${known ? card.type : 'other'}`] = 1;
  return f;
}

/** A synchronous, in-process model: one engagement score per feature vector (higher = show earlier). */
export interface ScoringModel {
  readonly id: string;
  score(features: FeatureVector[]): number[];
}

/**
 * Blend: final = (1 − weight) × default prior + weight × model score × 1000.
 * weight = 0 reproduces the default order exactly.
 */
export class ModelRanker implements Ranker {
  readonly name = 'model';

  constructor(
    private readonly model: ScoringModel,
    private readonly weight = 0.5
  ) {}

  rank({ candidates, ctx }: RankInput): RankOutput {
    const prior = scoreDefault(candidates.eligible);
    if (!ctx || prior.length === 0) return { cards: sortScored(prior), layoutSegments: [], experiment: null, appliedRules: [] };
    const scores = this.model.score(prior.map((c) => buildFeatureVector(c, ctx)));
    const cards = prior.map((c, i) => ({
      ...c,
      score: (1 - this.weight) * c.score + this.weight * (Number.isFinite(scores[i]) ? scores[i] : 0) * 1000,
    }));
    return { cards: sortScored(cards), layoutSegments: [`model.${this.model.id}`], experiment: null, appliedRules: [] };
  }
}
