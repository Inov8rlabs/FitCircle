/**
 * Guardrails (spec §5) — applied after ANY ranker, always. No rule, model or
 * bug upstream can produce a layout that violates these:
 *
 *  G1  `header` is first (after `offline_banner`, which the client forces to
 *      the top when offline anyway; the server keeps it at index 0).
 *  G2  no two promo cards (campaign, referral, pro_upsell) adjacent.
 *  G3  at most 2 promo cards in the first 6 positions.
 *  G4  `hydration` sits immediately above `referral` when both are present.
 *  G5  `native_ad` is never in the first 3 positions.
 *  G6  card ids are unique (first occurrence wins).
 *
 * promo@1 clients (PROMO_CARD_SPEC §6.2, ACTIVATION_JOURNEY_SPEC §3) add:
 *  G7  at most 2 promo-category cards in the whole feed (promo + campaign +
 *      referral + pro_upsell all count); lower-ranked extras are dropped.
 *  G8  at most 1 promo-category card in the first 4 positions.
 *  G9  utility promos (`promo:first_meal`) are not promo-category for G2/G3/
 *      G7/G8 and sit at position ≤ 2 (index ≤ 1, right under the header).
 *
 * Positions are counted without `offline_banner` (it only renders offline).
 * The fixers run to a fixed point; if that ever fails validation, promos /
 * the ad are dropped until it passes (never ship a violating layout).
 */
import { UTILITY_PROMO_IDS, isPromoCard } from './catalog';

export interface GuardCard {
  id: string;
  type: string;
}

export interface GuardrailOptions {
  /** The client declared promo@1: apply G7–G9. */
  promoV1?: boolean;
}

interface PromoWindow {
  size: number;
  max: number;
  label: string;
}

function promoWindows(opts: GuardrailOptions): PromoWindow[] {
  const w: PromoWindow[] = [{ size: PROMO_WINDOW, max: MAX_PROMOS_IN_WINDOW, label: 'G3 >2 promos in first 6' }];
  if (opts.promoV1) w.push({ size: PROMO_TOP_WINDOW, max: MAX_PROMOS_IN_TOP, label: 'G8 >1 promo in first 4' });
  return w;
}

export interface GuardrailResult<T> {
  cards: T[];
  /** Human-readable notes of what changed (admin preview / debugging). */
  adjustments: string[];
}

const AD_MIN_INDEX = 3;
const PROMO_WINDOW = 6;
const MAX_PROMOS_IN_WINDOW = 2;
const MAX_PASSES = 8;
/** G7 / G8 (promo@1 clients). */
export const MAX_PROMOS_PER_FEED = 2;
const PROMO_TOP_WINDOW = 4;
const MAX_PROMOS_IN_TOP = 1;
/** G9: utility promos at index ≤ 1. */
const UTILITY_PROMO_MAX_INDEX = 1;

const promo = (c: GuardCard | undefined) => !!c && isPromoCard(c);

/** G7 — keep the first MAX_PROMOS_PER_FEED promo-category cards (rank order), drop the rest. */
export function capPromoTotal<T extends GuardCard>(cards: T[]): T[] {
  let n = 0;
  return cards.filter((c) => !promo(c) || ++n <= MAX_PROMOS_PER_FEED);
}

/** G9 — utility promos move up to index ≤ 1. */
export function utilityPromoTop<T extends GuardCard>(cards: T[]): T[] {
  let out = cards;
  for (const id of UTILITY_PROMO_IDS) {
    const i = out.findIndex((c) => c.id === id);
    if (i > UTILITY_PROMO_MAX_INDEX) out = moveTo(out, i, UTILITY_PROMO_MAX_INDEX);
  }
  return out;
}

function moveTo<T>(cards: T[], from: number, to: number): T[] {
  const out = cards.filter((_, i) => i !== from);
  out.splice(Math.min(to, out.length), 0, cards[from]);
  return out;
}

export function dedupe<T extends GuardCard>(cards: readonly T[]): T[] {
  const seen = new Set<string>();
  return cards.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

/** G1 */
export function headerFirst<T extends GuardCard>(cards: T[]): T[] {
  const i = cards.findIndex((c) => c.type === 'header');
  return i > 0 ? moveTo(cards, i, 0) : cards;
}

/** G5 — move the ad to index 3 (4 if 3 would split hydration→referral); drop it if the feed is too short. */
export function nativeAdNotInFirst3<T extends GuardCard>(cards: T[]): T[] {
  const i = cards.findIndex((c) => c.type === 'native_ad');
  if (i === -1 || i >= AD_MIN_INDEX) return cards;
  const rest = cards.filter((_, k) => k !== i);
  if (rest.length < AD_MIN_INDEX) return rest;
  let at = AD_MIN_INDEX;
  if (rest[at - 1]?.type === 'hydration' && rest[at]?.type === 'referral') at += 1;
  rest.splice(at, 0, cards[i]);
  return rest;
}

/** G4 — hydration moves to directly above referral. */
export function hydrationAboveReferral<T extends GuardCard>(cards: T[]): T[] {
  const h = cards.findIndex((c) => c.type === 'hydration');
  const r = cards.findIndex((c) => c.type === 'referral');
  if (h === -1 || r === -1 || h === r - 1) return cards;
  const rest = cards.filter((_, k) => k !== h);
  rest.splice(rest.findIndex((c) => c.type === 'referral'), 0, cards[h]);
  return rest;
}

/**
 * G2 + G3 — defer promos that would sit next to another promo or exceed the
 * first-6 cap until after the next non-promo. `hydration → referral` moves as
 * one unit so G4 holds, and the ad is deferred too so G5 holds. Leftovers go
 * into the latest valid slot, else are dropped (a unit keeps its hydration).
 */
export function promoSpacing<T extends GuardCard>(cards: T[], opts: GuardrailOptions = {}): T[] {
  const windows = promoWindows(opts);
  const units: T[][] = [];
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].type === 'hydration' && cards[i + 1]?.type === 'referral') {
      units.push([cards[i], cards[i + 1]]);
      i++;
    } else units.push([cards[i]]);
  }

  const out: T[] = [];
  const pending: T[][] = [];
  const canPlace = (u: T[]) => {
    if (promo(out[out.length - 1]) && promo(u[0])) return false;
    // Pulling cards forward must not drag the ad into the first 3 (G5).
    if (u.some((c) => c.type === 'native_ad') && out.length < AD_MIN_INDEX) return false;
    return windows.every((w) => {
      let count = out.slice(0, w.size).filter(promo).length;
      u.forEach((c, k) => {
        if (out.length + k < w.size && promo(c)) count++;
      });
      return count <= w.max;
    });
  };
  const flush = () => {
    for (let k = 0; k < pending.length; ) {
      if (canPlace(pending[k])) {
        out.push(...pending.splice(k, 1)[0]);
        k = 0;
      } else k++;
    }
  };

  for (const u of units) {
    if (canPlace(u)) {
      out.push(...u);
      flush();
    } else pending.push(u);
  }
  // Leftovers (e.g. promos ranked last, back to back): insert at the latest
  // slot that keeps G2/G3/G4; otherwise drop (a unit keeps its hydration).
  for (const u of pending) {
    if (canPlace(u)) {
      out.push(...u);
      continue;
    }
    const at = latestValidSlot(out, u, opts);
    if (at !== -1) out.splice(at, 0, ...u);
    else if (u.length === 2) {
      const h = latestValidSlot(out, [u[0]], opts);
      out.splice(h === -1 ? out.length : h, 0, u[0]);
    }
  }
  return out;
}

const promoRulesHold = (cards: readonly GuardCard[], opts: GuardrailOptions) => violations(cards, opts).every((v) => !/^G[2-58]/.test(v));

/** Latest index ≥ 1 where inserting `unit` keeps the promo rules (−1 if none). */
function latestValidSlot<T extends GuardCard>(cards: T[], unit: T[], opts: GuardrailOptions): number {
  if (!promoRulesHold(cards, opts)) return -1;
  for (let at = cards.length; at >= 1; at--) {
    if (promoRulesHold([...cards.slice(0, at), ...unit, ...cards.slice(at)], opts)) return at;
  }
  return -1;
}

/** Every violated invariant (empty = valid). `cards` excludes offline_banner. */
export function violations(cards: readonly GuardCard[], opts: GuardrailOptions = {}): string[] {
  const v: string[] = [];
  const idx = (t: string) => cards.findIndex((c) => c.type === t);
  if (idx('header') > 0) v.push('G1 header not first');
  for (let i = 1; i < cards.length; i++) {
    if (promo(cards[i - 1]) && promo(cards[i])) v.push(`G2 promos adjacent at ${i - 1},${i}`);
  }
  for (const w of promoWindows(opts)) {
    if (cards.slice(0, w.size).filter(promo).length > w.max) v.push(w.label);
  }
  const h = idx('hydration');
  const r = idx('referral');
  if (h !== -1 && r !== -1 && h !== r - 1) v.push('G4 hydration not directly above referral');
  const ad = idx('native_ad');
  if (ad !== -1 && ad < AD_MIN_INDEX) v.push('G5 native_ad in first 3');
  if (new Set(cards.map((c) => c.id)).size !== cards.length) v.push('G6 duplicate ids');
  if (opts.promoV1) {
    if (cards.filter(promo).length > MAX_PROMOS_PER_FEED) v.push('G7 >2 promos in feed');
    for (const id of UTILITY_PROMO_IDS) {
      if (cards.findIndex((c) => c.id === id) > UTILITY_PROMO_MAX_INDEX) v.push(`G9 ${id} below position 2`);
    }
  }
  return v;
}

/** Last resort: drop the ad / promos until valid. */
function enforceByDropping<T extends GuardCard>(cards: T[], opts: GuardrailOptions): T[] {
  let out = dedupe(headerFirst(cards));
  if (opts.promoV1) out = utilityPromoTop(capPromoTotal(out));
  const ad = out.findIndex((c) => c.type === 'native_ad');
  if (ad !== -1 && ad < AD_MIN_INDEX) out = out.filter((_, i) => i !== ad);
  const h = out.findIndex((c) => c.type === 'hydration');
  const r = out.findIndex((c) => c.type === 'referral');
  if (h !== -1 && r !== -1 && h !== r - 1) out = out.filter((c) => c.type !== 'referral');
  const windows = promoWindows(opts);
  const kept: T[] = [];
  for (const c of out) {
    const overWindow = windows.some((w) => kept.length < w.size && kept.slice(0, w.size).filter(promo).length >= w.max);
    if (promo(c) && (promo(kept[kept.length - 1]) || overWindow)) continue;
    kept.push(c);
  }
  // Dropping a promo can make the ad slide into the first 3 or orphan hydration's pair: re-check once more.
  return violations(kept, opts).length === 0 ? kept : kept.filter((c) => !promo(c) && c.type !== 'native_ad');
}

const sameOrder = (a: readonly GuardCard[], b: readonly GuardCard[]) => a.length === b.length && a.every((c, i) => c.id === b[i].id);

export function applyGuardrails<T extends GuardCard>(input: readonly T[], opts: GuardrailOptions = {}): GuardrailResult<T> {
  const adjustments: string[] = [];
  const all = dedupe(input);
  if (all.length !== input.length) adjustments.push('removed duplicate ids');

  const offline = all.find((c) => c.type === 'offline_banner');
  let cards = all.filter((c) => c.type !== 'offline_banner');

  if (opts.promoV1) {
    const capped = capPromoTotal(cards);
    if (capped.length !== cards.length) adjustments.push('extra promos dropped');
    cards = capped;
  }

  const fixers: Array<[string, (c: T[]) => T[]]> = [
    ['header moved first', headerFirst],
    ...(opts.promoV1 ? ([['utility promo moved up', utilityPromoTop]] as Array<[string, (c: T[]) => T[]]>) : []),
    ['native_ad moved out of the first 3', nativeAdNotInFirst3],
    ['hydration moved above referral', hydrationAboveReferral],
    ['promos spaced out', (c: T[]) => promoSpacing(c, opts)],
  ];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (const [label, fix] of fixers) {
      const next = fix(cards);
      if (!sameOrder(next, cards)) {
        changed = true;
        if (!adjustments.includes(label)) adjustments.push(label);
        cards = next;
      }
    }
    if (!changed) break;
  }

  if (violations(cards, opts).length > 0) {
    adjustments.push(`fallback: ${violations(cards, opts).join('; ')}`);
    cards = enforceByDropping(cards, opts);
  }
  return { cards: offline ? [offline, ...cards] : cards, adjustments };
}
