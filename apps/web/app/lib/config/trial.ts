/**
 * The Pro free-trial length: ONE source of truth (remote config key `trial_days`).
 *
 * - Code default: REMOTE_CONFIG_REGISTRY.trial_days.default (7). Pure and client-safe, so
 *   static marketing copy (landing FAQ) can use it.
 * - Live value: RemoteConfigService resolves `trial_days` per request (platform / app version
 *   rules, admin default) — see lib/services/trial-config.ts. Stripe checkout and every
 *   server-written trial promise use the resolved value.
 * - The real end of a store trial is never computed from this: it is the RevenueCat
 *   INITIAL_PURCHASE (period_type TRIAL) expiration_at_ms → profiles.trial_ends_at.
 */
import { REMOTE_CONFIG_REGISTRY } from '../remote-config/registry';

export const DEFAULT_TRIAL_DAYS: number = REMOTE_CONFIG_REGISTRY.trial_days.default;

/** A usable trial length: a positive integer, else the code default. */
export function normalizeTrialDays(days: unknown): number {
  return typeof days === 'number' && Number.isInteger(days) && days > 0 ? days : DEFAULT_TRIAL_DAYS;
}

/** "7-day" (adjective form: "your free 7-day trial"). */
export const trialDayAdjective = (days: number): string => `${normalizeTrialDays(days)}-day`;

/** "Try Pro free for 7 days". */
export const tryProFreeHeadline = (days: number): string => `Try Pro free for ${normalizeTrialDays(days)} days`;

/**
 * The web trial is on when STRIPE_TRIAL_DAYS is set to any positive number (unset / 0 = no web
 * trial). The VALUE is no longer the length — that is `trial_days` — it is only the on/off switch,
 * kept under its old name so the prod env needs no change.
 */
export function webTrialEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (Number(env.STRIPE_TRIAL_DAYS ?? 0) || 0) > 0;
}
