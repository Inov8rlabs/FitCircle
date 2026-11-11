/**
 * Server-side subscription conversions → GA4 (Firebase app stream) via the
 * Measurement Protocol (docs/GA4_SERVER_CONVERSIONS.md). Pure: no I/O, no clock
 * reads (callers pass `nowMs`).
 *
 * Revenue rules are NOT redefined here: every RevenueCat event goes through
 * lib/ads/metrics.ts classifyEvent (production only, Stripe-native audit rows,
 * family sharing, promotional, trial vs charge vs refund, USD gross price).
 *
 * Event names are distinct from the Android client's own Firebase events
 * (`trial_start`, `purchase`, no transaction_id), so nothing is counted twice:
 * GA4 transaction_id de-duplication cannot help because the client never sends
 * a transaction id (and Google does not promise it for app streams).
 */
import { planOf } from '@/lib/trials/classify';

import { classifyEvent, eventTime, isProduction, type RevenueEvent } from '../metrics';
import { classifyTestUser, type TestUserReason } from '../test-users';

// ---------------------------------------------------------------------------
// Event mapping
// ---------------------------------------------------------------------------

export const GA4_EVENT = {
  /** INITIAL_PURCHASE with period_type TRIAL. Client twin: `trial_start`. */
  trialStarted: 'trial_started_server',
  /** Paid INITIAL_PURCHASE (NORMAL / INTRO) or NON_RENEWING_PURCHASE. Client twin: `purchase`. */
  purchase: 'purchase_server',
  /** RENEWAL with is_trial_conversion: the first paid charge after a free trial. Server only. */
  trialConverted: 'trial_converted',
  /** Any other RENEWAL. Server only. */
  renewed: 'subscription_renewed',
  /** CANCELLATION that RevenueCat reports as a refund (negative price / CUSTOMER_SUPPORT). GA4 recommended event. */
  refund: 'refund',
} as const;

export type Ga4EventName = (typeof GA4_EVENT)[keyof typeof GA4_EVENT];

/** RevenueCat types that can map to a conversion (the sweep only reads these). */
export const CONVERSION_RC_TYPES = ['INITIAL_PURCHASE', 'RENEWAL', 'NON_RENEWING_PURCHASE', 'CANCELLATION'] as const;

export type NoConversionReason =
  | 'sandbox'
  | 'stripe_native'
  | 'family_share'
  | 'promotional'
  | 'not_a_conversion'
  | 'zero_value'
  | 'no_transaction_id';

export interface Ga4Conversion {
  name: Ga4EventName;
  /** Event time (ms) as RevenueCat reported it, null when unknown. */
  atMs: number | null;
  /** Gross amount (positive, also for refunds); null = count-only. */
  value: number | null;
  currency: string | null;
  transactionId: string | null;
  plan: string;
  store: string;
  productId: string | null;
  periodType: string | null;
}

export type Ga4Mapping = { send: true; conversion: Ga4Conversion } | { send: false; reason: NoConversionReason };

const none = (reason: NoConversionReason): Ga4Mapping => ({ send: false, reason });
const CURRENCY_RE = /^[A-Z]{3}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

const finite = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * Value of a money event: USD gross (RevenueCat `price`, tax-inclusive, what
 * classifyEvent reports) — one currency across App Store / Play / Stripe, the
 * same number the Ads Console and Finance use. Only when RevenueCat sent no
 * USD price does it fall back to price_in_purchased_currency + currency (GA4
 * converts to the property currency on ingestion).
 */
function moneyOf(gross: number, missingPrice: boolean, raw: Record<string, any>): { value: number | null; currency: string | null } {
  if (gross > 0) return { value: round2(gross), currency: 'USD' };
  if (missingPrice) {
    const local = finite(raw.price_in_purchased_currency);
    const cur = String(raw.currency ?? '').toUpperCase();
    if (local !== null && local !== 0 && CURRENCY_RE.test(cur)) return { value: round2(Math.abs(local)), currency: cur };
  }
  return { value: null, currency: null };
}

/** RevenueCat event (subscription_events row) → the GA4 event to send, or why none. */
export function mapRevenueCatEvent(e: RevenueEvent): Ga4Mapping {
  if (!isProduction(e)) return none('sandbox');
  const c = classifyEvent(e);
  if (c.excluded === 'sandbox' || c.excluded === 'stripe_native' || c.excluded === 'family_share' || c.excluded === 'promotional') {
    return none(c.excluded);
  }
  const raw = e.raw ?? {};
  const tx = raw.transaction_id === null || raw.transaction_id === undefined || raw.transaction_id === '' ? null : String(raw.transaction_id);

  let name: Ga4EventName;
  let money: { value: number | null; currency: string | null };
  if (c.excluded === 'trial') {
    if (e.type !== 'INITIAL_PURCHASE') return none('not_a_conversion');
    name = GA4_EVENT.trialStarted;
    money = { value: 0, currency: 'USD' };
  } else if (c.kind === 'charge') {
    if (c.grossUsd === 0 && !c.missingPrice) return none('zero_value');
    if (e.type === 'RENEWAL') name = raw.is_trial_conversion === true ? GA4_EVENT.trialConverted : GA4_EVENT.renewed;
    else name = GA4_EVENT.purchase;
    money = moneyOf(c.grossUsd, c.missingPrice, raw);
  } else if (c.kind === 'refund') {
    // GA4's refund event is keyed by transaction_id; without one it means nothing.
    if (!tx) return none('no_transaction_id');
    name = GA4_EVENT.refund;
    money = moneyOf(c.grossUsd, c.missingPrice, raw);
  } else {
    return none('not_a_conversion');
  }

  const store = String(e.store ?? raw.store ?? '').toLowerCase() || 'unknown';
  const productId = raw.product_id ? String(raw.product_id) : null;
  return {
    send: true,
    conversion: {
      name,
      atMs: eventTime(e),
      value: money.value,
      currency: money.currency,
      transactionId: tx,
      plan: planOf(productId) ?? 'unknown',
      store,
      productId,
      periodType: raw.period_type ? String(raw.period_type).toUpperCase() : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/**
 * GA4 accepts timestamp_micros up to 72 h in the past; older events are NOT
 * rejected in RELAXED mode but silently re-stamped to "72 h ago", which would
 * put revenue on the wrong day. We stop 15 min short of the limit.
 */
export const MP_MAX_BACKDATE_MS = 72 * 3_600_000;
export const SEND_WINDOW_MS = MP_MAX_BACKDATE_MS - 15 * 60_000;

/** The timestamp to send (never in the future), or null when it is outside the backdating window. */
export function sendTimestampMs(atMs: number | null, nowMs: number, windowMs = SEND_WINDOW_MS): number | null {
  if (atMs === null) return nowMs;
  const t = Math.min(atMs, nowMs);
  return nowMs - t <= windowMs ? t : null;
}

// ---------------------------------------------------------------------------
// User eligibility
// ---------------------------------------------------------------------------

export interface Ga4UserFacts {
  email: string | null;
  isAdmin: boolean | null;
  /** user_attribution.app_instance_id (Android Firebase app instance id). */
  appInstanceId: string | null;
  /** user_attribution.platform. */
  platform: string | null;
  /** user_attribution.is_test (Apple mock AdServices payload). */
  mockAttribution: boolean;
}

export type UserSkipReason = 'no_user' | 'test_user' | 'ios_user' | 'no_app_instance_id';

/** Same shape the Android app sends (lib/ads/attribution.ts appInstanceId). */
const APP_INSTANCE_RE = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Who may be sent: a real (non-test) user with a Firebase app instance id from
 * the Android app. The id is only reported while the user's analytics consent
 * permits collection (docs/ADS_ATTRIBUTION_GA4.md §2), and the request omits
 * `consent` so GA4 applies the instance's current consent state.
 * iOS never reports an app instance id today, and the configured firebase_app_id
 * is the Android app's, so an `ios` attribution row is never sent.
 */
export function userEligibility(
  user: Ga4UserFacts | null,
  env: Record<string, string | undefined> = process.env
): { ok: true; appInstanceId: string } | { ok: false; reason: UserSkipReason; testReason?: TestUserReason } {
  if (!user) return { ok: false, reason: 'no_user' };
  const testReason = classifyTestUser({ email: user.email, isAdmin: user.isAdmin, mockAttribution: user.mockAttribution }, env);
  if (testReason) return { ok: false, reason: 'test_user', testReason };
  if (String(user.platform ?? '').toLowerCase() === 'ios') return { ok: false, reason: 'ios_user' };
  const id = user.appInstanceId?.trim() ?? '';
  if (!APP_INSTANCE_RE.test(id)) return { ok: false, reason: 'no_app_instance_id' };
  return { ok: true, appInstanceId: id };
}

// ---------------------------------------------------------------------------
// Config + payload
// ---------------------------------------------------------------------------

export interface Ga4MpConfig {
  firebaseAppId: string;
  apiSecret: string;
}

export type Ga4ConfigState =
  | { enabled: true; config: Ga4MpConfig }
  | { enabled: false; reason: 'disabled' | 'not_configured'; config: Ga4MpConfig | null };

/** GA4_SERVER_CONVERSIONS_ENABLED=true AND both GA4_MP_FIREBASE_APP_ID and GA4_MP_API_SECRET set. Default off. */
export function ga4MpConfig(env: Record<string, string | undefined> = process.env): Ga4ConfigState {
  const firebaseAppId = env.GA4_MP_FIREBASE_APP_ID?.trim() ?? '';
  const apiSecret = env.GA4_MP_API_SECRET?.trim() ?? '';
  const config = firebaseAppId && apiSecret ? { firebaseAppId, apiSecret } : null;
  if (env.GA4_SERVER_CONVERSIONS_ENABLED !== 'true') return { enabled: false, reason: 'disabled', config };
  if (!config) return { enabled: false, reason: 'not_configured', config: null };
  return { enabled: true, config };
}

export const MP_HOST = 'https://www.google-analytics.com';

/** Collect (or /debug validation) URL. Contains the API secret: never log it. */
export function mpUrl(config: Ga4MpConfig, debug = false): string {
  const q = new URLSearchParams({ firebase_app_id: config.firebaseAppId, api_secret: config.apiSecret });
  return `${MP_HOST}/${debug ? 'debug/mp' : 'mp'}/collect?${q.toString()}`;
}

export interface MpPayload {
  app_instance_id: string;
  user_id: string;
  timestamp_micros: number;
  validation_behavior?: 'ENFORCE_RECOMMENDATIONS';
  events: Array<{ name: string; params: Record<string, string | number> }>;
}

const clip = (s: string) => (s.length > 100 ? s.slice(0, 100) : s);

/**
 * One Measurement Protocol request for one conversion. `user_id` is the
 * profile UUID (the Android app sets the same GA4 user id). No consent block:
 * GA4 then uses the app instance's own consent (ad_personalization is always
 * denied on the device). Param values ≤ 100 chars (standard property limit).
 */
export function buildMpPayload(input: {
  appInstanceId: string;
  userId: string;
  eventId: string;
  conversion: Ga4Conversion;
  timestampMs: number;
  enforce?: boolean;
}): MpPayload {
  const c = input.conversion;
  const params: Record<string, string | number> = {
    plan: c.plan,
    store: clip(c.store),
    source: 'server',
    rc_event_id: clip(input.eventId),
  };
  if (c.value !== null && c.currency) {
    params.value = c.value;
    params.currency = c.currency;
  }
  if (c.transactionId) params.transaction_id = clip(c.transactionId);
  if (c.productId) params.product_id = clip(c.productId);
  if (c.periodType) params.period_type = clip(c.periodType);
  return {
    app_instance_id: input.appInstanceId,
    user_id: input.userId,
    timestamp_micros: Math.floor(input.timestampMs) * 1000,
    ...(input.enforce ? { validation_behavior: 'ENFORCE_RECOMMENDATIONS' as const } : {}),
    events: [{ name: c.name, params }],
  };
}

// ---------------------------------------------------------------------------
// Idempotency (ga4_conversion_sends, migration 135)
// ---------------------------------------------------------------------------

export type SendStatus = 'sending' | 'sent' | 'failed' | 'skipped';

export interface SendRow {
  status: SendStatus;
  skip_reason: string | null;
  attempts: number;
  updated_at: string | null;
}

export const MAX_ATTEMPTS = 5;
/** A 'sending' claim older than this is a crashed attempt and may be retried. */
export const STALE_CLAIM_MS = 10 * 60_000;

/**
 * Whether an existing send row may be claimed again:
 *  - sent → never (exactly-once);
 *  - sending → only once stale (crashed function);
 *  - skipped → only for `no_app_instance_id` (the id may be reported later);
 *  - failed → until MAX_ATTEMPTS.
 */
export function reclaimDecision(row: SendRow, nowMs: number): 'reclaim' | 'sent' | 'in_progress' | 'final' {
  switch (row.status) {
    case 'sent':
      return 'sent';
    case 'sending': {
      const at = row.updated_at ? Date.parse(row.updated_at) : NaN;
      return Number.isFinite(at) && nowMs - at < STALE_CLAIM_MS ? 'in_progress' : 'reclaim';
    }
    case 'skipped':
      return row.skip_reason === 'no_app_instance_id' ? 'reclaim' : 'final';
    case 'failed':
      return row.attempts >= MAX_ATTEMPTS ? 'final' : 'reclaim';
    default:
      return 'final';
  }
}
