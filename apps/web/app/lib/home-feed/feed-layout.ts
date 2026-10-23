/**
 * Web side of the server-driven home feed (docs/HOME_FEED_SPEC.md, schema 1).
 * The server decides which dashboard cards appear and in what order; the web,
 * like iOS and Android, renders each card from its own code. When the feed is
 * unavailable (endpoint not deployed, timeout, non-200, bad payload) the web
 * uses the same built-in default the apps use (§5 "effective default layouts").
 */

/** Card types the web dashboard can draw, with the version it supports. */
export const WEB_HOME_CARDS = [
  'header',
  'campaign',
  'hydration',
  'referral',
  'pro_upsell',
  'streak_warning',
  'daily_goals',
  'fitzy_focus',
  'progress',
  'vitals',
  'body_comp',
  'past_date_log',
  'charts',
] as const;
export type HomeCardType = (typeof WEB_HOME_CARDS)[number];

export interface HomeFeedCard {
  id: string;
  type: HomeCardType;
  version: number;
  variant?: string;
  props?: Record<string, unknown>;
}

export interface HomeFeedLayout {
  source: 'server' | 'default';
  layoutKey: string;
  decisionId: string | null;
  cards: HomeFeedCard[];
}

const card = (type: HomeCardType): HomeFeedCard => ({ id: type, type, version: 1 });

/** §5 effective defaults (iOS list: no offline_banner / health_sync_banner / missing_days / native_ad on web). */
export function defaultLayout(hasCampaign: boolean): HomeFeedLayout {
  const order: HomeCardType[] = hasCampaign
    ? ['header', 'campaign', 'streak_warning', 'pro_upsell', 'daily_goals', 'fitzy_focus', 'progress', 'hydration', 'referral', 'vitals', 'body_comp', 'past_date_log', 'charts']
    : ['header', 'hydration', 'referral', 'streak_warning', 'pro_upsell', 'daily_goals', 'fitzy_focus', 'progress', 'vitals', 'body_comp', 'past_date_log', 'charts'];
  return { source: 'default', layoutKey: 'builtin_default', decisionId: null, cards: order.map(card) };
}

/** `cards=` query value: every type this client can render, at version 1. */
export function cardsParam(): string {
  return WEB_HOME_CARDS.map((t) => `${t}@1`).join(',');
}

const KNOWN = new Set<string>(WEB_HOME_CARDS);

/**
 * Validates a schema-1 response and keeps only cards the web can draw.
 * Unknown types and duplicate ids are dropped; `header` is forced first
 * (guardrail G1). Returns null for anything that isn't a usable layout.
 */
export function parseHomeFeed(body: unknown): HomeFeedLayout | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  // Bare object per spec; tolerate the { success, data } envelope too.
  const root = (b.schema === undefined && b.data && typeof b.data === 'object' ? b.data : b) as Record<string, unknown>;
  if (root.schema !== 1 || !Array.isArray(root.cards)) return null;
  const seen = new Set<string>();
  const cards: HomeFeedCard[] = [];
  for (const raw of root.cards as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    const type = typeof c.type === 'string' ? c.type : '';
    const id = typeof c.id === 'string' && c.id ? c.id : type;
    const version = typeof c.version === 'number' ? c.version : 1;
    if (!KNOWN.has(type) || version > 1 || seen.has(id)) continue;
    seen.add(id);
    cards.push({
      id,
      type: type as HomeCardType,
      version,
      ...(typeof c.variant === 'string' ? { variant: c.variant } : {}),
      ...(c.props && typeof c.props === 'object' ? { props: c.props as Record<string, unknown> } : {}),
    });
  }
  if (cards.length === 0) return null;
  const header = cards.findIndex((c) => c.type === 'header');
  if (header > 0) cards.unshift(...cards.splice(header, 1));
  if (header < 0) cards.unshift(card('header'));
  return {
    source: 'server',
    layoutKey: typeof root.layout_key === 'string' ? root.layout_key : 'server',
    decisionId: typeof root.decision_id === 'string' ? root.decision_id : null,
    cards,
  };
}

/**
 * GET /api/mobile/home-feed with the session cookie (verifyMobileAuth accepts
 * it). Never throws: any failure, or no answer within `timeoutMs`, is null.
 */
export async function fetchHomeFeed(opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<HomeFeedLayout | null> {
  const { timeoutMs = 3000, fetchImpl = fetch } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await fetchImpl(`/api/mobile/home-feed?cards=${encodeURIComponent(cardsParam())}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: ctrl.signal,
      headers: { 'X-Feed-Schema': '1', 'X-App-Platform': 'web', ...(tz ? { 'x-client-timezone': tz } : {}) },
    });
    if (!res.ok) return null;
    return parseHomeFeed(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
