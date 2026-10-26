/**
 * compose (spec §5): context → candidates → ranker → guardrails → response.
 * Pure — the caller (HomeFeedService) loads context/rules and records the
 * decision.
 */
import { randomUUID } from 'node:crypto';

import { buildCandidates, clientSupports } from './candidates';
import { DEFAULT_LAYOUT_KEY, FEED_TTL_SECONDS } from './catalog';
import { applyGuardrails } from './guardrails';
import { DefaultRanker, RulesRanker, type Ranker } from './rankers';
import type { FeedRule } from './rules';
import type { Candidate, CardType, ClientCardSupport, FeedCard, FeedContext, HomeFeedResponse, ScoredCard } from './types';

const MAX_LAYOUT_KEY = 200;

export interface ComposeInput {
  support: ClientCardSupport;
  /** null → no context (kill switch): static default, no rules. */
  ctx: FeedContext | null;
  rules?: readonly FeedRule[];
  /** Override the ranker (tests, future ModelRanker). Default: RulesRanker(rules). */
  ranker?: Ranker;
  includeDisabledRules?: boolean;
  now?: Date;
  decisionId?: string;
  /** promo@1 cards from the promo engine (lib/promos). */
  promos?: readonly Candidate[];
  /** Legacy card types replaced by promos for this client (suppressed). */
  replacedTypes?: ReadonlySet<CardType>;
  /** The client declared promo@1 → promo guardrails G7–G9 apply. */
  promoV1?: boolean;
}

export interface ComposeTrace {
  ranker: string;
  appliedRules: string[];
  suppressed: string[];
  guardrailAdjustments: string[];
  /** Promo engine outcomes (key → selected / skip reason), when promos ran. */
  promos?: Array<{ key: string; outcome: string; creativeId?: string }>;
  /** Cards a ranker produced that the client can't render (always 0 unless a ranker misbehaves). */
  droppedUnsupported: string[];
}

export interface ComposeResult {
  response: HomeFeedResponse;
  trace: ComposeTrace;
}

export function toFeedCard(c: ScoredCard): FeedCard {
  const card: FeedCard = { id: c.id, type: c.type, version: c.version };
  if (c.variant) card.variant = c.variant;
  if (c.props && Object.keys(c.props).length > 0) card.props = c.props;
  return card;
}

export function composeFeed(input: ComposeInput): ComposeResult {
  const { support, ctx } = input;
  const now = input.now ?? new Date();
  const candidates = buildCandidates(ctx, support, ctx === null ? {} : { replaced: input.replacedTypes, promos: input.promos });
  const ranker: Ranker = ctx === null ? new DefaultRanker() : input.ranker ?? new RulesRanker(input.rules ?? [], { includeDisabled: input.includeDisabledRules });

  const ranked = ranker.rank({ candidates, ctx, support });

  // The server never returns a card the client didn't declare (type + version ≤ client version).
  const droppedUnsupported: string[] = [];
  const renderable = ranked.cards.filter((c) => {
    const ok = clientSupports(support, c.type, c.version);
    if (!ok) droppedUnsupported.push(c.id);
    return ok;
  });

  const guarded = applyGuardrails(renderable, { promoV1: input.promoV1 === true && ctx !== null });
  const layoutKey = [DEFAULT_LAYOUT_KEY, ...ranked.layoutSegments].join('+').slice(0, MAX_LAYOUT_KEY);

  return {
    response: {
      schema: 1,
      decision_id: input.decisionId ?? randomUUID(),
      generated_at: now.toISOString(),
      ttl_seconds: FEED_TTL_SECONDS,
      layout_key: layoutKey,
      experiment: ranked.experiment,
      cards: guarded.cards.map(toFeedCard),
    },
    trace: {
      ranker: ranker.name,
      appliedRules: ranked.appliedRules,
      suppressed: candidates.suppressed.map((c) => c.id),
      guardrailAdjustments: guarded.adjustments,
      droppedUnsupported,
    },
  };
}
