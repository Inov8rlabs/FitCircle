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
 */
import { clientSupports } from '../candidates';
import { catalogEntry } from '../catalog';
import { selectRules, type FeedRule, type RuleAction } from '../rules';
import type { Candidate, ScoredCard } from '../types';

import { DefaultRanker, scoreDefault, sortScored } from './default-ranker';
import type { RankInput, RankOutput, Ranker } from './types';

type MoveAction = Extract<RuleAction, { op: 'move' }>;

export function applyMove(cards: ScoredCard[], move: MoveAction): ScoredCard[] {
  const from = cards.findIndex((c) => c.type === move.card);
  if (from === -1) return cards;
  const rest = cards.filter((_, i) => i !== from);
  const card = cards[from];
  if (move.toTop) return [card, ...rest];
  if (move.toBottom) return [...rest, card];
  const anchorType = move.before ?? move.after;
  const anchor = rest.findIndex((c) => c.type === anchorType);
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

    // Present cards keyed by type, in default order (insertion order kept for new types).
    const present = new Map<string, Candidate>(candidates.eligible.map((c) => [c.type, { ...c }]));
    const restorable = new Map<string, Candidate>(candidates.suppressed.map((c) => [c.type, c]));
    const variants = new Map<string, string>();
    const boosts = new Map<string, number>();
    const moves: MoveAction[] = [];

    for (const rule of applied) {
      for (const action of rule.actions) {
        switch (action.op) {
          case 'hide': {
            const c = present.get(action.card);
            if (c) {
              present.delete(action.card);
              restorable.set(action.card, c);
            }
            break;
          }
          case 'show': {
            if (present.has(action.card)) break;
            const back = restorable.get(action.card);
            if (back) {
              present.set(action.card, back);
              restorable.delete(action.card);
              break;
            }
            // A type the catalog doesn't know yet: only if the rule names a
            // version and the client declared it can render that version.
            if (!catalogEntry(action.card) && action.version && clientSupports(support, action.card, action.version)) {
              present.set(action.card, { id: action.card, type: action.card, version: action.version });
            }
            break;
          }
          case 'variant':
            variants.set(action.card, action.variant);
            break;
          case 'boost':
            boosts.set(action.card, (boosts.get(action.card) ?? 0) + action.by);
            break;
          case 'move':
            moves.push(action);
            break;
        }
      }
    }

    const scored = scoreDefault([...present.values()]).map((c) => {
      const boost = boosts.get(c.type) ?? 0;
      const variant = variants.get(c.type);
      return { ...c, score: c.score + boost, boost, ...(variant ? { variant } : {}) };
    });
    let cards = sortScored(scored);
    for (const move of moves) cards = applyMove(cards, move);

    const experiment = applied.find((r) => r.experiment)?.experiment ?? null;
    return {
      cards,
      layoutSegments: applied.map((r) => r.layoutSegment),
      experiment,
      appliedRules: applied.map((r) => r.key),
    };
  }
}
