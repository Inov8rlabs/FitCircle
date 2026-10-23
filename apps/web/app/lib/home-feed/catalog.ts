/**
 * Card catalog v1 (docs/HOME_FEED_SPEC.md §3–4): every card type the server
 * knows, its current version, and static metadata the guardrails use.
 */
import type { CardType } from './types';

/**
 * - `chrome`: structural (offline banner, header) — pinned by guardrails.
 * - `promo`: asks the user for something (join, invite, pay) — spaced out.
 * - `ad`: the native ad slot — kept out of the first 3 positions.
 * - `utility`: everything else.
 */
export type CardKind = 'chrome' | 'promo' | 'ad' | 'utility';

export interface CatalogEntry {
  type: CardType;
  version: number;
  kind: CardKind;
  /** Default dismissibility on the clients (informational; not sent unless a rule overrides). */
  dismissible: boolean;
}

const entry = (type: CardType, kind: CardKind, dismissible = false, version = 1): CatalogEntry => ({
  type,
  version,
  kind,
  dismissible,
});

/** §4 default order — also the clients' built-in fallback. `missing_days` added 2026-10-22 (Android). */
export const DEFAULT_ORDER: readonly CardType[] = [
  'offline_banner',
  'header',
  'health_sync_banner',
  'campaign',
  'hydration',
  'referral',
  'pro_upsell',
  'streak_warning',
  'missing_days',
  'daily_goals',
  'fitzy_focus',
  'progress',
  'vitals',
  'body_comp',
  'past_date_log',
  'native_ad',
  'charts',
] as const;

export const CATALOG: Readonly<Record<string, CatalogEntry>> = Object.freeze({
  offline_banner: entry('offline_banner', 'chrome'),
  header: entry('header', 'chrome'),
  health_sync_banner: entry('health_sync_banner', 'utility', true),
  campaign: entry('campaign', 'promo', true),
  hydration: entry('hydration', 'utility'),
  referral: entry('referral', 'promo', true),
  pro_upsell: entry('pro_upsell', 'promo', true),
  streak_warning: entry('streak_warning', 'utility'),
  /** "You have unlogged days" prompt (Android today; iOS doesn't declare it yet). */
  missing_days: entry('missing_days', 'utility', true),
  daily_goals: entry('daily_goals', 'utility'),
  fitzy_focus: entry('fitzy_focus', 'utility'),
  progress: entry('progress', 'utility'),
  vitals: entry('vitals', 'utility'),
  body_comp: entry('body_comp', 'utility'),
  past_date_log: entry('past_date_log', 'utility'),
  native_ad: entry('native_ad', 'ad'),
  charts: entry('charts', 'utility'),
});

export const PROMO_TYPES: ReadonlySet<CardType> = new Set(
  Object.values(CATALOG)
    .filter((e) => e.kind === 'promo')
    .map((e) => e.type)
);

/** The layout_key of the static default (no rules, kill switch, fallback). */
export const DEFAULT_LAYOUT_KEY = 'default-v1';

/** How long a client may reuse this response before refetching. */
export const FEED_TTL_SECONDS = 900;

/** Card type names: lowercase snake_case, ≤ 40 chars (also what `cards=` accepts). */
export const CARD_TYPE_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export function catalogEntry(type: CardType): CatalogEntry | undefined {
  return Object.prototype.hasOwnProperty.call(CATALOG, type) ? CATALOG[type] : undefined;
}

export function isPromo(type: CardType): boolean {
  return PROMO_TYPES.has(type);
}

/** Position of a type in the default order (unknown/future types sort after charts). */
export function defaultIndex(type: CardType): number {
  const i = DEFAULT_ORDER.indexOf(type);
  return i === -1 ? DEFAULT_ORDER.length : i;
}

/** Stable instance id: the type, or `campaign:<slug>` for a specific campaign. */
export function cardId(type: CardType, props?: Record<string, unknown>): string {
  if (type === 'campaign' && typeof props?.slug === 'string' && props.slug) return `campaign:${props.slug}`;
  return type;
}
