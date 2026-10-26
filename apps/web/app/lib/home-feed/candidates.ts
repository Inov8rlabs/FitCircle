/**
 * Eligibility (spec §5 candidates.ts): which catalog cards apply to this
 * request, filtered by what the client can render (`cards=` query).
 *
 * Eligibility hints only drop a card when the context KNOWS it has nothing to
 * show (e.g. campaign lookup succeeded and found none). Unknown → keep: the
 * clients self-gate every card anyway, so an extra slot just collapses.
 */
import { CARD_TYPE_PATTERN, CATALOG, DEFAULT_ORDER, cardId } from './catalog';
import type { Candidate, CardType, ClientCardSupport, FeedContext } from './types';

/** Hard cap on parsed `cards=` entries (a typo can't make the server do unbounded work). */
const MAX_CLIENT_CARDS = 64;

/**
 * Parse `cards=header@1,campaign@1,...` → type → max version.
 * Lenient: whitespace trimmed, `type` without `@n` = version 1, malformed
 * tokens ignored, duplicates keep the highest version.
 */
export function parseClientCards(raw: string | null | undefined): ClientCardSupport {
  const support: ClientCardSupport = new Map();
  if (!raw) return support;
  for (const token of raw.split(',').slice(0, MAX_CLIENT_CARDS)) {
    const t = token.trim();
    if (!t) continue;
    const [type, versionPart, ...rest] = t.split('@');
    if (rest.length > 0 || !CARD_TYPE_PATTERN.test(type)) continue;
    let version = 1;
    if (versionPart !== undefined) {
      if (!/^\d{1,4}$/.test(versionPart)) continue;
      version = Number(versionPart);
    }
    if (version < 1) continue;
    support.set(type, Math.max(support.get(type) ?? 0, version));
  }
  return support;
}

/** Can the client render `type` at server version `version`? (type match + version ≤ client version) */
export function clientSupports(support: ClientCardSupport, type: CardType, version: number): boolean {
  const max = support.get(type);
  return max !== undefined && version <= max;
}

export interface CandidateSet {
  /** Client-renderable cards the hints consider eligible, in default order. */
  eligible: Candidate[];
  /** Client-renderable catalog cards dropped by a hint (a rule `show` can restore them). */
  suppressed: Candidate[];
}

/** Why a card is hinted ineligible, or null when it is eligible. */
export function ineligibleReason(type: CardType, ctx: FeedContext | null): string | null {
  if (!ctx) return null;
  switch (type) {
    case 'campaign':
      return ctx.campaign?.present === false ? 'no_campaign' : null;
    case 'referral':
      return ctx.referralProgramEnabled === false ? 'referrals_off' : null;
    case 'pro_upsell':
      if (ctx.isPro === true) return 'already_pro';
      return ctx.subscriptionsEnabled === false ? 'subscriptions_off' : null;
    case 'native_ad':
      return ctx.isPro === true || ctx.adsEligible === false ? 'ads_ineligible' : null;
    default:
      return null;
  }
}

function candidateFor(type: CardType, ctx: FeedContext | null): Candidate {
  const version = CATALOG[type].version;
  if (type === 'campaign' && ctx?.campaign?.slug) {
    const props = { slug: ctx.campaign.slug };
    return { id: cardId(type, props), type, version, props };
  }
  return { id: cardId(type), type, version };
}

/**
 * Catalog cards ∩ client support, split by the context hints. `ctx = null`
 * (kill switch / no context) → every client-supported card is eligible.
 */
export function buildCandidates(
  ctx: FeedContext | null,
  support: ClientCardSupport,
  opts: {
    /** Legacy types a promo replaces for this client (e.g. pro_upsell → pro_value): suppressed, a rule `show` can restore. */
    replaced?: ReadonlySet<CardType>;
    /** Extra eligible cards from the promo engine (already client-checked). */
    promos?: readonly Candidate[];
  } = {}
): CandidateSet {
  const eligible: Candidate[] = [];
  const suppressed: Candidate[] = [];
  for (const type of DEFAULT_ORDER) {
    if (!clientSupports(support, type, CATALOG[type].version)) continue;
    const candidate = candidateFor(type, ctx);
    (ineligibleReason(type, ctx) || opts.replaced?.has(type) ? suppressed : eligible).push(candidate);
  }
  for (const p of opts.promos ?? []) {
    if (clientSupports(support, p.type, p.version)) eligible.push(p);
  }
  return { eligible, suppressed };
}
