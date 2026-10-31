/** Engage server policy constants (docs/ENGAGE_SPEC.md §2, §5, §8). */
import { ENGAGE_CAPS } from './types';

export const GLOBAL_CAPS = ENGAGE_CAPS;
/** Default min hours between showings of the same in-app message. */
export const DEFAULT_IAM_MIN_HOURS = 24;
/** Impressions of one message by one user within this window count once. */
export const IMPRESSION_DEDUPE_MINUTES = 30;
export const MAX_EVENTS_PER_BATCH = 50;
/** Events older than this (client clock) are dropped at ingest. */
export const MAX_EVENT_AGE_DAYS = 7;

export const ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const ASSET_MIN_WIDTH = 320;
export const ASSET_VARIANT_WIDTHS = [480, 960, 1440] as const;
export const ASSET_BUCKET = 'engage-assets';
/** Supabase storage cacheControl (max-age seconds) for immutable, content-addressed files. */
export const ASSET_CACHE_CONTROL = '31536000';

/** Estimates stop counting here and report "≈". */
export const ESTIMATE_CAP = 50_000;

/** Per cron run, per message. */
export const PUSH_PER_RUN = 1000;
export const EMAIL_PER_RUN = 100;
export const AUDIENCE_PAGE = 1000;

/** Platforms push can reach (web push isn't supported — §15). */
export const PUSH_PLATFORMS = ['ios', 'android'] as const;
