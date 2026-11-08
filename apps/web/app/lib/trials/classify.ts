/**
 * Pure rules for the admin Trials page (no I/O, no clock reads: callers pass `now`).
 * Unit-tested in __tests__/classify.test.ts.
 */
import { classifyTestUser } from '@/lib/ads/test-users';
import { canonicalEmail } from '@/lib/validation/email-canonical';

import {
  TRIAL_PLATFORMS,
  TRIAL_RANGES,
  type CountrySource,
  type TrialBreakdownRow,
  type TrialCounts,
  type TrialEnvironment,
  type TrialPlan,
  type TrialPlatform,
  type TrialRange,
  type TrialRow,
  type TrialStatus,
  type TrialTestFlag,
  type TrialTestReason,
  type TrialsListQuery,
} from './types';

const DAY_MS = 86_400_000;

/** A subscription_events row (raw = the RevenueCat event object; Stripe-native rows have ids `stripe:<evt>`). */
export interface SubEventRow {
  id: string;
  user_id: string | null;
  type: string;
  store: string | null;
  environment: string | null;
  event_timestamp: string | null;
  raw: Record<string, any> | null;
}

export interface TrialProfileRow {
  id: string;
  email: string | null;
  email_canonical?: string | null;
  display_name: string | null;
  username: string | null;
  created_at: string | null;
  is_admin: boolean | null;
  metadata: Record<string, any> | null;
  country_code: string | null;
  subscription_tier: string | null;
  subscription_status: string | null;
  subscription_platform: string | null;
  subscription_product_id: string | null;
  subscription_expires_at: string | null;
  subscription_will_renew: boolean | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  trial_converted_at: string | null;
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

const truthy = (v: string | null | undefined) => v === '1' || v === 'true';

export function parseTrialsQuery(params: URLSearchParams): TrialsListQuery {
  const range = params.get('range');
  const platform = params.get('platform');
  return {
    range: (TRIAL_RANGES as readonly string[]).includes(range ?? '') ? (range as TrialRange) : 'all',
    includeSandbox: truthy(params.get('includeSandbox')),
    includeTest: truthy(params.get('includeTest')),
    platform: (TRIAL_PLATFORMS as readonly string[]).includes(platform ?? '') ? (platform as TrialPlatform) : null,
  };
}

/** Inclusive lower bound on trial start for a range; null = all time. */
export function rangeStart(range: TrialRange, now: Date): Date | null {
  if (range === 'all') return null;
  return new Date(now.getTime() - Number.parseInt(range, 10) * DAY_MS);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const msToIso = (v: unknown): string | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

export const isStripeNative = (e: Pick<SubEventRow, 'id' | 'raw'>) => String(e.id ?? '').startsWith('stripe:') || e.raw?.object === 'event';

export const eventEnvironment = (e: Pick<SubEventRow, 'environment' | 'raw'>): TrialEnvironment => {
  const env = String(e.environment ?? e.raw?.environment ?? '').toUpperCase();
  return env === 'PRODUCTION' ? 'production' : env === 'SANDBOX' ? 'sandbox' : 'unknown';
};

export const eventPeriodType = (e: Pick<SubEventRow, 'raw'>): string | null => (e.raw?.period_type ? String(e.raw.period_type).toUpperCase() : null);

/** Event time: event_timestamp, else raw.event_timestamp_ms. */
export const eventAt = (e: Pick<SubEventRow, 'event_timestamp' | 'raw'>): string | null =>
  e.event_timestamp ? new Date(e.event_timestamp).toISOString() : msToIso(e.raw?.event_timestamp_ms);

const eventMs = (e: SubEventRow) => {
  const at = eventAt(e);
  return at ? Date.parse(at) : 0;
};

export function sortEvents<T extends SubEventRow>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => eventMs(a) - eventMs(b) || a.id.localeCompare(b.id));
}

/** RevenueCat store → our subscription_platform. PROMOTIONAL and unknown stores are not trials. */
export function storePlatform(store: string | null | undefined): TrialPlatform | null {
  switch (String(store ?? '').toUpperCase()) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'app_store';
    case 'PLAY_STORE':
      return 'play_store';
    case 'STRIPE':
      return 'stripe';
    default:
      return null;
  }
}

/** An INITIAL_PURCHASE that starts a free trial (RevenueCat period_type TRIAL), from a store we sell on. */
export function isTrialStartEvent(e: SubEventRow): boolean {
  if (e.type !== 'INITIAL_PURCHASE' || isStripeNative(e)) return false;
  if (eventPeriodType(e) !== 'TRIAL') return false;
  return storePlatform(e.store ?? e.raw?.store) !== null;
}

/** A paid charge: RENEWAL / INITIAL_PURCHASE (not TRIAL) with price > 0 (or price unknown on a RENEWAL). */
export function isPaidCharge(e: SubEventRow): boolean {
  if (isStripeNative(e)) return false;
  if (e.type !== 'RENEWAL' && e.type !== 'INITIAL_PURCHASE' && e.type !== 'PRODUCT_CHANGE') return false;
  if (eventPeriodType(e) === 'TRIAL') return false;
  const price = num(e.raw?.price);
  if (price !== null) return price > 0;
  return e.type === 'RENEWAL';
}

export function planOf(productId: string | null | undefined): TrialPlan | null {
  if (!productId) return null;
  const p = productId.toLowerCase();
  if (p.includes('annual') || p.includes('yearly') || p.includes('year')) return 'annual';
  if (p.includes('monthly') || p.includes('month')) return 'monthly';
  if (p.includes('weekly') || p.includes('week')) return 'weekly';
  return 'other';
}

// ---------------------------------------------------------------------------
// Trial record + status
// ---------------------------------------------------------------------------

export interface TrialCore {
  platform: TrialPlatform;
  productId: string | null;
  environment: TrialEnvironment;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  convertedAt: string | null;
  status: TrialStatus;
  /** The INITIAL_PURCHASE (TRIAL) event this trial came from, if recorded. */
  startEvent: SubEventRow | null;
}

const toIso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null);

/**
 * The user's (latest) store trial, or null when the user never had one.
 * Promotional grants are never trials, even with trial_* set.
 * `events` = all of the user's subscription_events (any order).
 */
export function resolveTrial(profile: TrialProfileRow, events: readonly SubEventRow[], now: Date): TrialCore | null {
  const sorted = sortEvents(events);
  const starts = sorted.filter(isTrialStartEvent);
  const startEvent = starts.length ? starts[starts.length - 1]! : null;

  const profilePlatform = (TRIAL_PLATFORMS as readonly string[]).includes(profile.subscription_platform ?? '') ? (profile.subscription_platform as TrialPlatform) : null;
  let platform: TrialPlatform | null;
  if (startEvent) platform = storePlatform(startEvent.store ?? startEvent.raw?.store);
  else if (profile.trial_started_at && profilePlatform) platform = profilePlatform;
  else return null;
  if (!platform) return null;

  const environment: TrialEnvironment = startEvent ? eventEnvironment(startEvent) : 'unknown';
  const trialStartedAt = toIso(profile.trial_started_at) ?? (startEvent ? (msToIso(startEvent.raw?.purchased_at_ms) ?? eventAt(startEvent)) : null);
  const trialEndsAt = toIso(profile.trial_ends_at) ?? (startEvent ? msToIso(startEvent.raw?.expiration_at_ms) : null);
  const productId = (startEvent?.raw?.product_id as string | undefined) ?? profile.subscription_product_id ?? null;

  // Events that belong to this trial: after it started, in the same environment (sandbox renewals never convert a production trial).
  const startMs = trialStartedAt ? Date.parse(trialStartedAt) : startEvent ? eventMs(startEvent) : 0;
  const after = sorted.filter((e) => eventMs(e) >= startMs - 60_000 && (!startEvent || eventEnvironment(e) === environment));

  const firstCharge = after.find(isPaidCharge);
  const convertedAt = toIso(profile.trial_converted_at) ?? (firstCharge ? eventAt(firstCharge) : null);

  const status = classifyTrialStatus({
    convertedAt,
    trialEndsAt,
    subscriptionStatus: profile.subscription_status,
    subscriptionPlatform: profile.subscription_platform,
    trialPlatform: platform,
    willRenew: profile.subscription_will_renew,
    expiresAt: profile.subscription_expires_at,
    events: after,
    now,
  });
  return { platform, productId, environment, trialStartedAt, trialEndsAt, convertedAt, status, startEvent };
}

export interface StatusInput {
  convertedAt: string | null;
  trialEndsAt: string | null;
  subscriptionStatus: string | null;
  subscriptionPlatform: string | null;
  trialPlatform: TrialPlatform;
  willRenew: boolean | null;
  expiresAt: string | null;
  /** This trial's events (same environment, after the start), oldest first. */
  events: readonly SubEventRow[];
  now: Date;
}

export function classifyTrialStatus(i: StatusInput): TrialStatus {
  if (i.convertedAt) return 'converted';
  const nowMs = i.now.getTime();
  const samePlatform = i.subscriptionPlatform === i.trialPlatform;
  const endsMs = i.trialEndsAt ? Date.parse(i.trialEndsAt) : null;
  // A trial still marked trialing on the profile is live until its expiry.
  const profileTrialing = samePlatform && i.subscriptionStatus === 'trialing' && (!i.expiresAt || Date.parse(i.expiresAt) > nowMs);
  const inWindow = endsMs !== null ? endsMs > nowMs : profileTrialing;

  if (!inWindow) {
    // Ended. Paid now on the same store without a recorded charge (webhook gap) → converted.
    if (samePlatform && i.subscriptionStatus === 'active' && (!i.expiresAt || Date.parse(i.expiresAt) > nowMs)) return 'converted';
    return 'expired';
  }

  // In the window: did the user turn auto-renew off? Last CANCELLATION / UNCANCELLATION wins.
  let cancelled: boolean | null = null;
  for (const e of i.events) {
    if (e.type === 'CANCELLATION') cancelled = true;
    else if (e.type === 'UNCANCELLATION') cancelled = false;
    else if (e.type === 'EXPIRATION') cancelled = true;
  }
  if (cancelled === null && samePlatform && i.willRenew === false) cancelled = true;
  return cancelled ? 'cancelled' : 'trialing';
}

// ---------------------------------------------------------------------------
// Test / QA flags
// ---------------------------------------------------------------------------

const TEST_REASON_DETAIL: Record<TrialTestReason, string> = {
  internal: 'Admin account or internal email domain',
  review: 'App Store reviewer demo account',
  test_lab: 'Firebase Test Lab account',
  qa: 'Throwaway QA email domain',
  play_testers: 'Looks like a Google Play test robot account',
  mock_attribution: 'Attribution marked as test (TestFlight / dev build mock payload)',
  admin_alias: "Alias of an admin's mailbox (same canonical email)",
  test_device: 'Signed in from a Firebase Test Lab / Play pre-launch device',
};

export interface TestFlagInput {
  profile: Pick<TrialProfileRow, 'email' | 'email_canonical' | 'is_admin' | 'metadata'>;
  attributionIsTest: boolean;
  /** Canonical emails of is_admin profiles. */
  adminCanonicals: ReadonlySet<string>;
  env?: Record<string, string | undefined>;
}

/** Every test / QA signal for a user (empty = a real customer). */
export function testFlags(i: TestFlagInput): TrialTestFlag[] {
  const reasons = new Set<TrialTestReason>();
  const base = classifyTestUser({ email: i.profile.email, isAdmin: i.profile.is_admin, mockAttribution: false }, i.env);
  if (base) reasons.add(base);
  if (i.attributionIsTest) reasons.add('mock_attribution');
  const canonical = i.profile.email_canonical ?? canonicalEmail(i.profile.email);
  if (!i.profile.is_admin && canonical && i.adminCanonicals.has(canonical)) reasons.add('admin_alias');
  if (i.profile.metadata?.test_device) reasons.add('test_device');
  return [...reasons].map((reason) => ({ reason, detail: TEST_REASON_DETAIL[reason] }));
}

// ---------------------------------------------------------------------------
// Country
// ---------------------------------------------------------------------------

const COUNTRY_RE = /^[A-Za-z]{2}$/;
export const normCountry = (v: unknown): string | null => (typeof v === 'string' && COUNTRY_RE.test(v.trim()) ? v.trim().toUpperCase() : null);

/** Best single country: ad network → store storefront → experiment assignment (request) → profile. */
export function bestCountry(c: { attribution?: unknown; store?: unknown; assignment?: unknown; profile?: unknown }): { country: string; source: CountrySource } | null {
  const order: [CountrySource, unknown][] = [
    ['attribution', c.attribution],
    ['store', c.store],
    ['experiment_assignment', c.assignment],
    ['profile', c.profile],
  ];
  for (const [source, v] of order) {
    const country = normCountry(v);
    if (country) return { country, source };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function countTrials(rows: readonly Pick<TrialRow, 'status'>[]): TrialCounts {
  const c = { trialing: 0, cancelled: 0, converted: 0, expired: 0 };
  for (const r of rows) c[r.status] += 1;
  const ended = c.converted + c.expired;
  return {
    total: rows.length,
    activeNow: c.trialing + c.cancelled,
    ...c,
    ended,
    conversionRate: ended > 0 ? c.converted / ended : null,
  };
}

const PLATFORM_LABEL: Record<string, string> = { app_store: 'App Store', play_store: 'Google Play', stripe: 'Web (Stripe)' };
const CHANNEL_LABEL: Record<string, string> = { google_ads: 'Google Ads', apple_ads: 'Apple Ads', meta: 'Meta', organic: 'Organic', unknown: 'Unknown', none: 'Not reported' };

function breakdown(rows: readonly TrialRow[], keys: (r: TrialRow) => { key: string; label: string }[]): TrialBreakdownRow[] {
  const groups = new Map<string, { label: string; rows: TrialRow[] }>();
  for (const r of rows) {
    for (const k of keys(r)) {
      const g = groups.get(k.key) ?? { label: k.label, rows: [] };
      g.rows.push(r);
      groups.set(k.key, g);
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, label: g.label, ...countTrials(g.rows) }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
}

export function breakdowns(rows: readonly TrialRow[]) {
  return {
    byPlatform: breakdown(rows, (r) => [{ key: r.platform, label: PLATFORM_LABEL[r.platform] ?? r.platform }]),
    byChannel: breakdown(rows, (r) => {
      const key = r.channel ?? 'none';
      return [{ key, label: CHANNEL_LABEL[key] ?? key }];
    }),
    byArm: breakdown(rows, (r) =>
      r.arms.map((a) => ({ key: `${a.experimentKey}:${a.arm}`, label: `${a.experimentKey} · ${a.armName ? `${a.arm} (${a.armName})` : a.arm}` }))
    ),
  };
}

/** Which rows the toggles keep. 'unknown' environment stays visible (flagged) so a dropped webhook never hides a real trial. */
export function visible(row: Pick<TrialRow, 'environment' | 'isTest' | 'platform'>, q: TrialsListQuery): { show: boolean; hiddenBy: 'sandbox' | 'test' | 'platform' | null } {
  if (q.platform && row.platform !== q.platform) return { show: false, hiddenBy: 'platform' };
  if (!q.includeSandbox && row.environment === 'sandbox') return { show: false, hiddenBy: 'sandbox' };
  if (!q.includeTest && row.isTest) return { show: false, hiddenBy: 'test' };
  return { show: true, hiddenBy: null };
}
