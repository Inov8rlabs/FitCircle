/**
 * Ads Console configuration from env (docs/ADS_CONSOLE_SPEC.md §10). Read at
 * call time (not module load) so tests and env changes apply immediately.
 */
import type { AdChannel, AdsTargets } from './types';

const num = (v: string | undefined, fallback: number) => {
  const n = v === undefined || v.trim() === '' ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function writeEnabled(channel: AdChannel): boolean {
  if (channel === 'apple_ads') return process.env.APPLE_ADS_WRITE_ENABLED === 'true';
  if (channel === 'meta') return process.env.META_ADS_WRITE_ENABLED === 'true';
  return false;
}

export interface GuardrailCaps {
  maxBid: number;
  maxDailyBudget: number;
  minDailyBudget: number;
  maxStepPct: number;
  freshnessMs: number;
}

export function guardrailCaps(): GuardrailCaps {
  return {
    maxBid: num(process.env.ADS_MAX_BID_USD, 10),
    maxDailyBudget: num(process.env.ADS_MAX_DAILY_BUDGET_USD, 200),
    minDailyBudget: 1,
    maxStepPct: 50,
    freshnessMs: 15 * 60 * 1000,
  };
}

/** Channel minimum bids (major units). */
export const MIN_BID: Record<AdChannel, number> = {
  apple_ads: 0.1,
  meta: 0.01,
  google_ads: 0.01,
};

/** v1 constants (spec §5); later configurable in ads_settings. */
export const TARGETS: AdsTargets = {
  costPerPayerMax: 35,
  roasD7Min: 0.1,
  roasD30Min: 0.3,
  roas12mMin: 1,
};

/**
 * Time zone used for cohort days (profiles.created_at → date) so they line up
 * with network report days. Apple reports use the org time zone (ORTZ); the
 * FitCircle org is US Eastern.
 */
export function reportTimeZone(): string {
  return process.env.ADS_REPORT_TIMEZONE || 'America/New_York';
}

/** Mock AdServices campaign id Apple returns on simulators / dev builds. */
export const APPLE_MOCK_CAMPAIGN_ID = '1234567890';
