/**
 * Promo selection (PROMO_CARD_SPEC §7) — pure.
 *
 *  1. Eligible: kill switches, client declared promo@1, audience matches the
 *     context (unknown → no match), a creative in a declared layout whose
 *     primary action resolves for this client.
 *  2. Caps from promo_user_state: dismiss cooldown, converted +
 *     hideAfterConversion, perDay / perWeek / total.
 *  3. Creative: deterministic bucket sha256(`${experimentKey ?? key}:${userId}`) % 100
 *     against the creatives' weights; a user keeps the same creative for the
 *     promo's life (if it becomes unavailable they move to the next available
 *     one by the same bucket).
 *  4. Each survivor becomes a `promo` candidate card (id `promo:<key>`) with a
 *     base score; the feed ranker + guardrails place it like any other card.
 */
import { bucketOf } from '../home-feed/rules';
import type { Candidate, FeedContext } from '../home-feed/types';
import { addDays } from '../streaks/streak-calculator';

import { isPromoLive, type PromosConfig } from './config';
import { buildPromoProps } from './creative';
import {
  PROMO_CARD_TYPE,
  PROMO_CARD_VERSION,
  promoCardId,
  type JourneyContext,
  type PromoCaps,
  type PromoClientSupport,
  type PromoCreative,
  type PromoProps,
  type PromoUserState,
} from './types';

export interface PromoMatchInput {
  ctx: FeedContext;
  journey: JourneyContext;
  /** Pro feature keys whose gate is live (required_tier = premium); null = unknown. */
  liveProFeatures: Set<string> | null;
}

export type CreativeOption = PromoCreative & { available?: boolean };

export interface PromoDefinition {
  key: string;
  /** Guardrail category: `utility` promos (first_meal) are exempt from the promo density rules. */
  kind: 'promo' | 'utility';
  /** Feed score anchor (DefaultRanker scale: 1000 − 10 × default-order index). */
  score: number;
  priority?: number;
  caps: PromoCaps;
  /** false → may still show when promo_user_state couldn't be read. */
  requiresState: boolean;
  experimentKey?: string;
  /** null = matches; otherwise why not. Unknown context values must NOT match. */
  audience(input: PromoMatchInput): string | null;
  creatives(input: PromoMatchInput): CreativeOption[];
}

export interface PromoCandidate extends Candidate {
  type: typeof PROMO_CARD_TYPE;
  props: PromoProps & Record<string, unknown>;
  /** Ranking score (DefaultRanker scale); scoreDefault uses it instead of the type's default slot. */
  baseScore: number;
  promoKey: string;
  creativeId: string;
  kind: 'promo' | 'utility';
}

export interface PromoTraceEntry {
  key: string;
  outcome: 'selected' | string;
  creativeId?: string;
}

export interface SelectPromosInput {
  definitions: readonly PromoDefinition[];
  ctx: FeedContext;
  journey: JourneyContext | null;
  /** null = the state read failed (unknown). */
  state: Map<string, PromoUserState> | null;
  liveProFeatures: Set<string> | null;
  client: PromoClientSupport;
  config: PromosConfig;
}

export const CONVERSION_WINDOW_DAYS = 7;

/** Why caps block this promo right now, or null. */
export function capReason(caps: PromoCaps, s: PromoUserState | undefined, now: Date, localDate: string): string | null {
  if (!s) return null;
  if (caps.hideAfterConversion && s.convertedAt) return 'converted';
  if (caps.cooldownHoursAfterDismiss !== undefined && s.dismissedAt) {
    const until = Date.parse(s.dismissedAt) + caps.cooldownHoursAfterDismiss * 3_600_000;
    if (now.getTime() < until) return 'dismiss_cooldown';
  }
  if (caps.total !== undefined && s.impressionsTotal >= caps.total) return 'total_cap';
  if (caps.perDay !== undefined && s.day === localDate && s.impressionsDay >= caps.perDay) return 'day_cap';
  if (caps.perWeek !== undefined) {
    const since = addDays(localDate, -6);
    const days = new Set(s.seenDays.filter((d) => d >= since && d <= localDate));
    if (!days.has(localDate) && days.size >= caps.perWeek) return 'week_cap';
  }
  return null;
}

/**
 * Deterministic creative choice. Buckets 0–99 are split by weight over ALL
 * creatives (so a user's creative is stable); if that one isn't usable for
 * this request, the next usable one in list order (wrapping) is used.
 */
export function pickCreative(
  options: readonly CreativeOption[],
  usable: (c: CreativeOption) => boolean,
  salt: string,
  userId: string
): CreativeOption | null {
  if (options.length === 0) return null;
  const total = options.reduce((s, c) => s + Math.max(0, c.weight), 0);
  const bucket = bucketOf(userId, salt);
  let idx = options.length - 1;
  if (total > 0) {
    let upper = 0;
    for (let i = 0; i < options.length; i++) {
      upper += (Math.max(0, options[i].weight) / total) * 100;
      if (bucket < upper) {
        idx = i;
        break;
      }
    }
  } else idx = bucket % options.length;
  for (let k = 0; k < options.length; k++) {
    const c = options[(idx + k) % options.length];
    if (usable(c)) return c;
  }
  return null;
}

export function selectPromos(input: SelectPromosInput): { candidates: PromoCandidate[]; trace: PromoTraceEntry[] } {
  const { ctx, journey, client, config } = input;
  const candidates: PromoCandidate[] = [];
  const trace: PromoTraceEntry[] = [];
  const skip = (key: string, outcome: string) => void trace.push({ key, outcome });

  for (const def of input.definitions) {
    if (!isPromoLive(def.key, config)) {
      skip(def.key, config.enabled ? 'paused' : 'promos_disabled');
      continue;
    }
    if (!client.promoCard) {
      skip(def.key, 'client_no_promo');
      continue;
    }
    if (!journey) {
      skip(def.key, 'no_context');
      continue;
    }
    const match: PromoMatchInput = { ctx, journey, liveProFeatures: input.liveProFeatures };
    const why = def.audience(match);
    if (why) {
      skip(def.key, `audience:${why}`);
      continue;
    }
    if (input.state === null && def.requiresState) {
      skip(def.key, 'state_unknown');
      continue;
    }
    const capped = capReason(def.caps, input.state?.get(def.key), ctx.now, ctx.localDate);
    if (capped) {
      skip(def.key, capped);
      continue;
    }

    const options = def.creatives(match);
    const built = new Map<string, PromoProps>();
    const creative = pickCreative(
      options,
      (c) => {
        if (c.available === false || !client.layouts.has(c.layout)) return false;
        const props = buildPromoProps(def.key, c, client.actions);
        if (props) built.set(c.id, props);
        return props !== null;
      },
      def.experimentKey ?? def.key,
      ctx.userId
    );
    if (!creative) {
      skip(def.key, options.length === 0 ? 'no_creative' : 'unrenderable');
      continue;
    }
    candidates.push({
      id: promoCardId(def.key),
      type: PROMO_CARD_TYPE,
      version: PROMO_CARD_VERSION,
      props: built.get(creative.id)! as PromoProps & Record<string, unknown>,
      baseScore: def.score + (def.priority ?? 0),
      promoKey: def.key,
      creativeId: creative.id,
      kind: def.kind,
    });
    trace.push({ key: def.key, outcome: 'selected', creativeId: creative.id });
  }
  return { candidates, trace };
}
