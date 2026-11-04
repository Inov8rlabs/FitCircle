/**
 * "Pro is ending / Pro ended" prompts (docs/PRO_LIFECYCLE_PROMPTS.md) — shared types.
 *
 * Everything in lib/pro-lifecycle is pure; I/O lives in
 * services/pro-lifecycle-service.ts (config, facts, admin) and
 * services/pro-lifecycle-push-service.ts (cron pushes).
 */
import type { PromoLayout } from '../promos/types';

export const PRO_LIFECYCLE_STATES = ['pro_expiring', 'pro_expired', 'trial_expiring'] as const;
export type ProLifecycleState = (typeof PRO_LIFECYCLE_STATES)[number];

/** Promo key (card id `promo:<key>`) per state — also the promo_user_state key (dismiss = snooze). */
export const PRO_LIFECYCLE_PROMO_KEYS: Record<ProLifecycleState, string> = {
  pro_expiring: 'pro_expiring',
  pro_expired: 'pro_expired',
  trial_expiring: 'trial_expiring',
};

/** paywall@1 `placement` per state (= the `Paywall Viewed.source`). */
export const PRO_LIFECYCLE_PAYWALL_SOURCES: Record<ProLifecycleState, string> = {
  pro_expiring: 'pro_expiring_card',
  pro_expired: 'pro_expired_card',
  trial_expiring: 'trial_expiring_card',
};

/** Push notification types (NotificationOrchestrator). trial_expiring has none: TrialReminderService owns it. */
export const PRO_LIFECYCLE_PUSH_TYPES = {
  pro_expiring: 'pro_expiring_reminder',
  pro_expired: 'pro_expired',
} as const;
export type ProLifecyclePushType = (typeof PRO_LIFECYCLE_PUSH_TYPES)[keyof typeof PRO_LIFECYCLE_PUSH_TYPES];

/** Where the Pro time came from. */
export type ProSource = 'referral' | 'complimentary' | 'store_trial';

/** Card copy for one state. Placeholders: see PLACEHOLDERS (copy.ts). */
export interface StateCopy {
  eyebrow: string;
  title: string;
  /** Body when there is no meaningful usage to mention. */
  body: string;
  /** Body when there is: must contain {{usage}}. */
  usageBody: string;
  /** Primary button when the 3-day free trial is available. */
  cta: string;
  /** Primary button when it isn't (the user already had a trial). */
  ctaNoTrial: string;
}

export interface PushCopy {
  enabled: boolean;
  title: string;
  /** Body when the free trial is available. */
  body: string;
  bodyNoTrial: string;
}

export interface StateConfig {
  enabled: boolean;
  layout: PromoLayout;
  copy: StateCopy;
  /** Expiring states: show the card when Pro ends within this many hours. */
  hoursBefore: number;
  /** pro_expired: show the card for this many days after Pro ended. */
  daysAfter: number;
  /** A dismiss hides the card for this many days (0 = until the next feed refresh window, 1 h). */
  snoozeDays: number;
  /** trial_expiring: push is always off (the existing trial_ending_reminder covers it). */
  push: PushCopy;
}

export interface ProLifecycleConfig {
  version: 1;
  states: Record<ProLifecycleState, StateConfig>;
}

/** Real usage while Pro was on (only collected numbers; never estimated). */
export interface ProUsage {
  /** Meals logged with AI (photo or voice analysis: nutrition_source llm_*). */
  aiMeals: number;
  /** All meals logged. */
  meals: number;
  /** Messages the user sent to Fitzy. */
  fitzyChats: number;
  /** Weekly plans Fitzy built (non-preview). */
  plans: number;
}

/** A complimentary_grants row (subset). */
export interface GrantRow {
  id?: string;
  granted_by: string;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** The profile columns the state needs. */
export interface LifecycleProfile {
  id: string;
  email?: string | null;
  is_admin?: boolean | null;
  display_name?: string | null;
  timezone?: string | null;
  subscription_tier?: string | null;
  subscription_status?: string | null;
  subscription_platform?: string | null;
  subscription_product_id?: string | null;
  subscription_expires_at?: string | null;
  subscription_will_renew?: boolean | null;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  trial_converted_at?: string | null;
}

/** Everything computeLifecycleState looks at (one user). */
export interface LifecycleFacts {
  profile: LifecycleProfile;
  /** Every complimentary_grants row of the user (any status), newest first is fine. */
  grants: GrantRow[];
  /** The user has paid before: trial_converted_at, or a real (non-TEST, non-SANDBOX) paid store event. */
  hasPurchased: boolean;
  /** The user already had a store/web free trial (trial_started_at or a real TRIAL purchase event). */
  hadTrial: boolean;
}

export type LifecycleSkip =
  | 'internal_account'
  | 'purchased'
  | 'store_subscription'
  | 'lifetime'
  | 'no_grant'
  | 'not_ending_soon'
  | 'ended_too_long_ago'
  | 'still_pro'
  | 'awaiting_downgrade'
  | 'revoked'
  | 'trial_renews';

/** The user's lifecycle state right now (null state = no prompt, with why). */
export interface LifecycleResult {
  state: ProLifecycleState | null;
  reason: LifecycleSkip | null;
  /** When Pro ends / ended (ISO). */
  endsAt: string | null;
  /** When the Pro time started (grant created_at / trial start), for the usage window. */
  startedAt: string | null;
  source: ProSource | null;
  /** The 3-day free trial is still available to this user. */
  trialAvailable: boolean;
  /** Length of the Pro period in days (ends − started), rounded to 0.1. */
  periodDays: number | null;
}
