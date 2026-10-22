/**
 * Ranker interface (spec §5 rankers/). A ranker turns eligible candidates into
 * an ordered, scored list. Rankers are pure and synchronous; guardrails run
 * after any ranker, always.
 */
import type { CandidateSet } from '../candidates';
import type { ClientCardSupport, FeedContext, FeedExperiment, ScoredCard } from '../types';

export interface RankInput {
  candidates: CandidateSet;
  /** null when the feed runs without context (kill switch). */
  ctx: FeedContext | null;
  /** What the client can render — rules may only `show` cards in here. */
  support: ClientCardSupport;
}

export interface RankOutput {
  /** Ordered best-first. */
  cards: ScoredCard[];
  /** Segments appended to the base layout key (rule keys / experiment arms). */
  layoutSegments: string[];
  experiment: FeedExperiment | null;
  /** Keys of rules that applied (for decisions + preview). */
  appliedRules: string[];
}

export interface Ranker {
  readonly name: string;
  rank(input: RankInput): RankOutput;
}
