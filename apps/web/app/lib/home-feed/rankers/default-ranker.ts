/**
 * DefaultRanker — the static default order (spec §4), identical to the
 * clients' built-in fallback.
 *
 * Score = 1000 − 10 × (position in DEFAULT_ORDER). One context-free tweak
 * mirrors the 1.0.7 apps: when a campaign card is in the feed, the referral
 * card steps down to just below `progress` (two invite asks back to back feel
 * pushy). Hydration then follows it via the guardrails.
 */
import { DEFAULT_LAYOUT_KEY, defaultIndex } from '../catalog';
import type { Candidate, ScoredCard } from '../types';

import type { RankInput, RankOutput, Ranker } from './types';

export const SLOT_POINTS = 10;

export function baseScore(type: string): number {
  return 1000 - SLOT_POINTS * defaultIndex(type);
}

/** Default scores for a set of present cards (campaign-leads tweak included). */
export function scoreDefault(cards: readonly Candidate[]): ScoredCard[] {
  const campaignPresent = cards.some((c) => c.type === 'campaign');
  return cards.map((c) => ({
    ...c,
    score: c.type === 'referral' && campaignPresent ? baseScore('progress') - SLOT_POINTS / 2 : baseScore(c.type),
    boost: 0,
  }));
}

/** Best first: score, then more boost, then default order, then id (fully deterministic). */
export function sortScored(cards: ScoredCard[]): ScoredCard[] {
  return [...cards].sort(
    (a, b) =>
      b.score - a.score ||
      b.boost - a.boost ||
      defaultIndex(a.type) - defaultIndex(b.type) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export class DefaultRanker implements Ranker {
  readonly name = 'default';

  rank({ candidates }: RankInput): RankOutput {
    return {
      cards: sortScored(scoreDefault(candidates.eligible)),
      layoutSegments: [],
      experiment: null,
      appliedRules: [],
    };
  }
}

export { DEFAULT_LAYOUT_KEY };
