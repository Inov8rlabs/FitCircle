/**
 * RulesRanker (v1) — the default order adjusted by DB rules (rules.ts).
 *
 * Per request:
 *  1. selectRules → applicable rules in ascending priority.
 *  2. Walk every action in that order: hide / show change the card set,
 *     variant sets a variant (last one wins), boost adds score points.
 *  3. Score the final set with the default scores + boosts and sort.
 *  4. Apply `move` actions, in rule order, to the sorted list.
 * Guardrails run afterwards (compose.ts), so no rule can break them.
 *
 * Anchors a client doesn't have. Rules are written against the whole catalog
 * (the Admin Tools editor chains "X after <the card above it>"), but each
 * client only gets the cards it declares and is eligible for. A move whose
 * anchor is a catalog card missing from THIS feed (not declared — iOS has no
 * `missing_days` — or hint-suppressed / hidden) must still land where that
 * anchor would have been, or the same rule orders the feed differently per
 * platform. So steps 3–4 also carry a placeholder ("ghost") for every absent
 * catalog type, scored like the real card; ghosts are dropped after the moves.
 * Each client's feed is then the full layout filtered to what it can show.
 */
import { clientSupports } from '../candidates';
import { CATALOG, DEFAULT_ORDER, EXTRA_CARDS, cardMatchesRef, catalogEntry } from '../catalog';
import { selectRules, type FeedRule, type RuleAction } from '../rules';
import type { Candidate, ScoredCard } from '../types';

import { DefaultRanker, SLOT_POINTS, baseScore, scoreDefault, sortScored } from './default-ranker';
import type { RankInput, RankOutput, Ranker } from './types';

type MoveAction = Extract<RuleAction, { op: 'move' }>;

/** Id prefix of an anchor placeholder (never a valid card id: ids are snake_case / `promo:` / `campaign:`). */
const GHOST_PREFIX = '\u0000ghost:';
const isGhost = (c: { id: string }) => c.id.startsWith(GHOST_PREFIX);

/** Default-order slot of every single-instance catalog card (EXTRA_CARDS sit just below their `after`). */
const CATALOG_SLOTS: ReadonlyArray<{ type: string; baseScore?: number }> = [
  ...DEFAULT_ORDER.map((type) => ({ type })),
  ...EXTRA_CARDS.map((e) => ({ type: e.type, baseScore: baseScore(e.after) - SLOT_POINTS / 2 })),
];

/** Placeholders for the catalog cards this feed doesn't carry (see the header comment). */
export function anchorGhosts(present: readonly Candidate[]): Candidate[] {
  const have = new Set(present.map((c) => c.type));
  return CATALOG_SLOTS.filter((s) => !have.has(s.type) && CATALOG[s.type]).map((s) => ({
    id: `${GHOST_PREFIX}${s.type}`,
    type: s.type,
    version: CATALOG[s.type].version,
    ...(s.baseScore !== undefined ? { baseScore: s.baseScore } : {}),
  }));
}

/** Move the first card matching `move.card` (type or `promo:<key>` id). */
export function applyMove(cards: ScoredCard[], move: MoveAction): ScoredCard[] {
  const from = cards.findIndex((c) => cardMatchesRef(c, move.card));
  if (from === -1) return cards;
  const rest = cards.filter((_, i) => i !== from);
  const card = cards[from];
  if (move.toTop) return [card, ...rest];
  if (move.toBottom) return [...rest, card];
  const anchorRef = (move.before ?? move.after)!;
  const anchor = rest.findIndex((c) => cardMatchesRef(c, anchorRef));
  if (anchor === -1) return cards; // anchor not in this feed → no-op
  const at = move.before ? anchor : anchor + 1;
  return [...rest.slice(0, at), card, ...rest.slice(at)];
}

export class RulesRanker implements Ranker {
  readonly name = 'rules';

  constructor(
    private readonly rules: readonly FeedRule[],
    private readonly opts: { includeDisabled?: boolean } = {}
  ) {}

  rank(input: RankInput): RankOutput {
    const { candidates, ctx, support } = input;
    if (!ctx || this.rules.length === 0) return new DefaultRanker().rank(input);

    const applied = selectRules(this.rules, ctx, this.opts);
    if (applied.length === 0) return new DefaultRanker().rank(input);

    // Cards are keyed by id (several `promo` cards share a type); a rule's
    // `card` matches by type or by id (cardMatchesRef).
    let present: Candidate[] = candidates.eligible.map((c) => ({ ...c }));
    let restorable: Candidate[] = [...candidates.suppressed];
    const variants: Array<[string, string]> = [];
    const boosts: Array<[string, number]> = [];
    const moves: MoveAction[] = [];

    for (const rule of applied) {
      for (const action of rule.actions) {
        switch (action.op) {
          case 'hide': {
            const hit = present.filter((c) => cardMatchesRef(c, action.card));
            if (hit.length) {
              present = present.filter((c) => !cardMatchesRef(c, action.card));
              restorable = [...restorable.filter((c) => !hit.some((h) => h.id === c.id)), ...hit];
            }
            break;
          }
          case 'show': {
            if (present.some((c) => cardMatchesRef(c, action.card))) break;
            const back = restorable.filter((c) => cardMatchesRef(c, action.card));
            if (back.length) {
              present.push(...back);
              restorable = restorable.filter((c) => !cardMatchesRef(c, action.card));
              break;
            }
            // A type the catalog doesn't know yet: only if the rule names a
            // version and the client declared it can render that version.
            if (!catalogEntry(action.card) && action.version && clientSupports(support, action.card, action.version)) {
              present.push({ id: action.card, type: action.card, version: action.version });
            }
            break;
          }
          case 'variant':
            variants.push([action.card, action.variant]);
            break;
          case 'boost':
            boosts.push([action.card, action.by]);
            break;
          case 'move':
            moves.push(action);
            break;
        }
      }
    }

    // Real cards decide the campaign-leads tweak; ghosts only hold anchor slots.
    const campaignPresent = present.some((c) => c.type === 'campaign');
    const scored = scoreDefault([...present, ...anchorGhosts(present)], campaignPresent).map((c) => {
      const boost = boosts.reduce((sum, [ref, by]) => (cardMatchesRef(c, ref) ? sum + by : sum), 0);
      // Last matching variant action wins (rules apply in ascending priority).
      const variant = variants.filter(([ref]) => cardMatchesRef(c, ref)).pop()?.[1];
      return { ...c, score: c.score + boost, boost, ...(variant ? { variant } : {}) };
    });
    let cards = sortScored(scored);
    for (const move of moves) cards = applyMove(cards, move);
    cards = cards.filter((c) => !isGhost(c));

    const experiment = applied.find((r) => r.experiment)?.experiment ?? null;
    return {
      cards,
      layoutSegments: applied.map((r) => r.layoutSegment),
      experiment,
      appliedRules: applied.map((r) => r.key),
    };
  }
}
