/**
 * Admin Trials contract (GET /api/admin/subscriptions/trials[/:userId]).
 * Returned inside the standard `{ success, data, error, meta }` envelope.
 * Admin Tools vendors a copy of this file (components/modules/trials/types.ts);
 * change both together.
 *
 * A "trial" is a store subscription (App Store, Play, Stripe via RevenueCat)
 * that started with a free trial: profiles.trial_started_at, or an
 * INITIAL_PURCHASE whose period_type is TRIAL. Promotional grants
 * (complimentary / referral Pro) are never trials.
 */
import type { TestUserReason } from '@/lib/ads/test-users';

export const TRIAL_RANGES = ['7d', '30d', '90d', 'all'] as const;
export type TrialRange = (typeof TRIAL_RANGES)[number];

export const TRIAL_PLATFORMS = ['app_store', 'play_store', 'stripe'] as const;
export type TrialPlatform = (typeof TRIAL_PLATFORMS)[number];

/** From the trial's RevenueCat event; 'unknown' when no event was recorded (webhook gap / sync-only). */
export type TrialEnvironment = 'production' | 'sandbox' | 'unknown';

/**
 * - trialing:  inside the trial window and set to renew
 * - cancelled: inside the trial window but will not renew (auto-renew off / CANCELLATION)
 * - converted: became a paid subscription (first charge after the trial)
 * - expired:   the trial ended without a charge
 */
export type TrialStatus = 'trialing' | 'cancelled' | 'converted' | 'expired';

/** classifyTestUser reasons plus: an alias of an admin's mailbox, a Firebase Test Lab device. */
export type TrialTestReason = TestUserReason | 'admin_alias' | 'test_device';

export type TrialPlan = 'monthly' | 'annual' | 'weekly' | 'other';

export interface TrialArm {
  experimentKey: string;
  arm: string;
  /** The arm's display name from experiments.arms, when known. */
  armName: string | null;
}

export type CountrySource = 'attribution' | 'store' | 'experiment_assignment' | 'profile';

export interface TrialRow {
  userId: string;
  email: string | null;
  displayName: string | null;
  username: string | null;
  signedUpAt: string | null;
  platform: TrialPlatform;
  productId: string | null;
  plan: TrialPlan | null;
  environment: TrialEnvironment;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  convertedAt: string | null;
  status: TrialStatus;
  /** profiles.subscription_will_renew (current subscription). */
  willRenew: boolean | null;
  /** profiles.subscription_status as stored ('trialing', 'active', 'cancelled', …). */
  subscriptionStatus: string | null;
  country: string | null;
  countrySource: CountrySource | null;
  /** user_attribution.channel ('google_ads', 'apple_ads', 'organic', 'unknown'); null = never reported. */
  channel: string | null;
  source: string | null;
  campaignId: string | null;
  campaignName: string | null;
  arms: TrialArm[];
  isTest: boolean;
  testReasons: TrialTestReason[];
}

export interface TrialCounts {
  total: number;
  /** In the trial window now (trialing + cancelled). */
  activeNow: number;
  trialing: number;
  cancelled: number;
  converted: number;
  expired: number;
  /** Trials whose outcome is known (converted + expired). */
  ended: number;
  /** converted / ended; null when nothing has ended yet. */
  conversionRate: number | null;
}

export interface TrialBreakdownRow extends TrialCounts {
  key: string;
  label: string;
}

export interface TrialsListQuery {
  range: TrialRange;
  includeSandbox: boolean;
  includeTest: boolean;
  platform: TrialPlatform | null;
}

export interface TrialsList {
  query: TrialsListQuery;
  generatedAt: string;
  summary: TrialCounts;
  byPlatform: TrialBreakdownRow[];
  byChannel: TrialBreakdownRow[];
  /** One row per experiment arm ('<experimentKey>:<arm>'); a user counts once per experiment. */
  byArm: TrialBreakdownRow[];
  /** Trials in range left out by the current toggles (so nothing is hidden silently). */
  hidden: { sandbox: number; test: number };
  /** Newest trial first. */
  trials: TrialRow[];
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export type LocationSignalSource = 'attribution' | 'store' | 'experiment_assignment' | 'profile' | 'timezone';

export interface LocationSignal {
  source: LocationSignalSource;
  /** ISO country code, or the IANA timezone for source 'timezone'. */
  value: string;
  /** Where exactly it came from, e.g. 'RevenueCat INITIAL_PURCHASE (APP_STORE)'. */
  detail: string;
  at: string | null;
}

export interface AdEntityRef {
  id: string;
  name: string | null;
}

export interface TrialAcquisition {
  channel: string;
  platform: string | null;
  source: string | null;
  campaign: AdEntityRef | null;
  adGroup: AdEntityRef | null;
  keyword: AdEntityRef | null;
  ad: AdEntityRef | null;
  clickAt: string | null;
  reportedAt: string | null;
  country: string | null;
  isTest: boolean;
  /** Top-level keys of the raw attribution payload (values are not exposed). */
  rawKeys: string[];
}

export interface TrialSubscription {
  platform: TrialPlatform;
  store: string | null;
  productId: string | null;
  plan: TrialPlan | null;
  environment: TrialEnvironment;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  convertedAt: string | null;
  status: TrialStatus;
  /** profiles.subscription_* (current state). */
  tier: string | null;
  subscriptionStatus: string | null;
  willRenew: boolean | null;
  expiresAt: string | null;
  /** Latest paid charge (RENEWAL / INITIAL_PURCHASE with price > 0), if any. */
  lastCharge: { price: number | null; priceInPurchasedCurrency: number | null; currency: string | null; at: string | null } | null;
  /** From the trial-start event. */
  currency: string | null;
  storeCountry: string | null;
  offerCode: string | null;
  presentedOfferingId: string | null;
  originalTransactionId: string | null;
}

export interface TrialEvent {
  id: string;
  type: string;
  store: string | null;
  environment: string | null;
  at: string | null;
  periodType: string | null;
  productId: string | null;
  price: number | null;
  priceInPurchasedCurrency: number | null;
  currency: string | null;
  countryCode: string | null;
  offerCode: string | null;
  cancelReason: string | null;
  expirationAt: string | null;
  /** Stripe's own webhook copy (audit only; RevenueCat sends the STRIPE event too). */
  stripeNative: boolean;
}

export interface TrialExperiment {
  experimentKey: string;
  experimentName: string | null;
  arm: string;
  armName: string | null;
  assignedAt: string | null;
  firstExposedAt: string | null;
  exposureSurface: string | null;
  platform: string | null;
  appVersion: string | null;
  country: string | null;
  reason: string | null;
}

export interface TrialEngagement {
  /** food_log_entries with entry_type 'food', not deleted. */
  mealsLogged: number;
  /** All food log entries (food, water, supplements, …), not deleted. */
  foodLogEntries: number;
  firstMealAt: string | null;
  lastMealAt: string | null;
  checkIns: number;
  fitzyConversations: number;
  /** Messages the user sent to Fitzy (role 'user'). */
  fitzyMessages: number;
  circlesJoined: number;
  /** profiles.last_active_at (not bumped on every request; see lastSeenAt). */
  lastActiveAt: string | null;
  /** Latest of last_active_at, push-token last use, last meal, last subscription event. */
  lastSeenAt: string | null;
}

export interface TrialDevice {
  platform: string | null;
  deviceName: string | null;
  isActive: boolean | null;
  lastUsedAt: string | null;
}

export interface TrialTestFlag {
  reason: TrialTestReason;
  detail: string;
}

export interface TrialDetail {
  trial: TrialRow;
  profile: {
    userId: string;
    email: string | null;
    displayName: string | null;
    username: string | null;
    joinedAt: string | null;
    lastActiveAt: string | null;
    onboardingCompleted: boolean | null;
    onboardingCompletedAt: string | null;
    onboardingFlow: string | null;
    timezone: string | null;
    isAdmin: boolean;
    /** From the latest experiment assignment. */
    appPlatform: string | null;
    appVersion: string | null;
  };
  location: { best: { country: string; source: CountrySource } | null; signals: LocationSignal[] };
  acquisition: TrialAcquisition | null;
  subscription: TrialSubscription;
  /** Every subscription_events row for the user, oldest first. */
  events: TrialEvent[];
  experiments: TrialExperiment[];
  engagement: TrialEngagement;
  devices: TrialDevice[];
  flags: { isTest: boolean; test: TrialTestFlag[]; environment: TrialEnvironment; sandboxEvents: number; productionEvents: number };
}
