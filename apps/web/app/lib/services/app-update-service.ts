/**
 * App update policy: tells an iOS / Android client whether a newer store build
 * exists and how hard to push it (APP_UPDATE contract, GET /api/mobile/app-update).
 *
 * The policy lives in the `feature_flags` row `app_update_policy` (migration
 * 121), so it changes without a release:
 *   - `is_enabled`  = the global kill switch (false → every client gets `none`);
 *   - `metadata`    = { ios: PlatformPolicy, android: PlatformPolicy }.
 * A missing or unreadable row also answers `none` (fail closed: never block or
 * nag anyone because of a bad config).
 *
 * Per platform (all versions are plain dotted numbers, "1.1.0"):
 *   latest_version        the build in the store
 *   recommended_version   below this → soft prompt (dismissible, frequency-capped on device)
 *   min_supported_version below this → force update (blocking screen)
 *   enabled               per-platform kill switch (default true)
 *   release_notes         { title?, subtitle?, highlights: [{ icon?, title, body? }] }
 *   reprompt_after_days / max_prompts_per_version   client frequency caps
 *
 * Status for the caller's version (X-App-Version):
 *   required    < min_supported_version
 *   recommended < recommended_version
 *   available   < latest_version
 *   none        up to date, unknown version, platform off, or kill switch
 */
import { type SupabaseClient } from '@supabase/supabase-js';

export const APP_UPDATE_FLAG = 'app_update_policy';

export type AppUpdatePlatform = 'ios' | 'android';
export type AppUpdateStatus = 'none' | 'available' | 'recommended' | 'required';

export interface AppUpdateHighlight {
  /** Server icon key (design/icons.json); clients fall back on unknown keys. */
  icon: string | null;
  title: string;
  body: string | null;
}

export interface AppUpdateReleaseNotes {
  title: string | null;
  subtitle: string | null;
  highlights: AppUpdateHighlight[];
}

export interface PlatformUpdatePolicy {
  enabled: boolean;
  latest_version: string;
  recommended_version: string | null;
  min_supported_version: string | null;
  release_notes: AppUpdateReleaseNotes | null;
  reprompt_after_days: number;
  max_prompts_per_version: number;
}

export interface AppUpdateDecision {
  platform: AppUpdatePlatform;
  current_version: string | null;
  status: AppUpdateStatus;
  latest_version: string | null;
  recommended_version: string | null;
  min_supported_version: string | null;
  release_notes: AppUpdateReleaseNotes | null;
  store: { app_store_id: string | null; package_name: string | null; url: string };
  prompt: { reprompt_after_days: number; max_prompts_per_version: number };
}

export const IOS_APP_STORE_ID = '6811432467';
export const ANDROID_PACKAGE = 'com.inov8rlabs.apps.fitcircle';

const STORE: Record<AppUpdatePlatform, AppUpdateDecision['store']> = {
  ios: { app_store_id: IOS_APP_STORE_ID, package_name: null, url: `https://apps.apple.com/app/id${IOS_APP_STORE_ID}` },
  android: {
    app_store_id: null,
    package_name: ANDROID_PACKAGE,
    url: `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`,
  },
};

export const DEFAULT_REPROMPT_AFTER_DAYS = 3;
export const DEFAULT_MAX_PROMPTS_PER_VERSION = 3;
const MAX_HIGHLIGHTS = 4;

// ---------------------------------------------------------------- versions

/**
 * Parse a plain dotted version ("1.1.0", "1.1", " 1.0.9 "). A pre-release /
 * build suffix ("1.1.0-dev", "1.1.0 (70)") is dropped. Anything without a
 * leading number → null.
 */
export function parseVersion(raw: string | null | undefined): number[] | null {
  const m = /^\s*v?(\d{1,6}(?:\.\d{1,6}){0,3})/.exec(raw ?? '');
  if (!m) return null;
  return m[1].split('.').map((n) => Number(n));
}

/** -1 / 0 / 1; missing components count as 0 ("1.1" == "1.1.0"). */
export function compareVersions(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

const normalized = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const v = parseVersion(raw);
  return v ? v.join('.') : null;
};

// ---------------------------------------------------------------- policy

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

const clampInt = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

function parseReleaseNotes(raw: unknown): AppUpdateReleaseNotes | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const highlights = (Array.isArray(r.highlights) ? r.highlights : [])
    .map((h): AppUpdateHighlight | null => {
      if (!h || typeof h !== 'object') return null;
      const o = h as Record<string, unknown>;
      const title = str(o.title, 80);
      return title ? { icon: str(o.icon, 40), title, body: str(o.body, 200) } : null;
    })
    .filter((h): h is AppUpdateHighlight => h !== null)
    .slice(0, MAX_HIGHLIGHTS);
  const notes = { title: str(r.title, 80), subtitle: str(r.subtitle, 200), highlights };
  return notes.title || notes.subtitle || highlights.length ? notes : null;
}

/** A platform's policy from flag metadata; null when unusable (no valid latest_version). */
export function parsePlatformPolicy(raw: unknown): PlatformUpdatePolicy | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const latest = normalized(r.latest_version);
  if (!latest) return null;
  return {
    enabled: r.enabled !== false,
    latest_version: latest,
    recommended_version: normalized(r.recommended_version),
    min_supported_version: normalized(r.min_supported_version),
    release_notes: parseReleaseNotes(r.release_notes),
    reprompt_after_days: clampInt(r.reprompt_after_days, 1, 90, DEFAULT_REPROMPT_AFTER_DAYS),
    max_prompts_per_version: clampInt(r.max_prompts_per_version, 1, 20, DEFAULT_MAX_PROMPTS_PER_VERSION),
  };
}

/** Pure status for a version against a policy (thresholds above latest are capped at latest). */
export function updateStatus(current: string | null, policy: PlatformUpdatePolicy | null): AppUpdateStatus {
  const cur = parseVersion(current);
  if (!cur || !policy || !policy.enabled) return 'none';
  const latest = parseVersion(policy.latest_version);
  if (!latest || compareVersions(cur, latest) >= 0) return 'none';
  const below = (threshold: string | null) => {
    const t = parseVersion(threshold);
    if (!t) return false;
    // A threshold above the store build can't be satisfied; treat it as latest.
    return compareVersions(cur, compareVersions(t, latest) > 0 ? latest : t) < 0;
  };
  if (below(policy.min_supported_version)) return 'required';
  if (below(policy.recommended_version)) return 'recommended';
  return 'available';
}

export function decideAppUpdate(input: {
  platform: AppUpdatePlatform;
  currentVersion: string | null;
  flag: { is_enabled?: boolean | null; metadata?: unknown } | null | undefined;
}): AppUpdateDecision {
  const { platform, currentVersion, flag } = input;
  const meta = flag?.metadata && typeof flag.metadata === 'object' ? (flag.metadata as Record<string, unknown>) : {};
  const policy = flag?.is_enabled ? parsePlatformPolicy(meta[platform]) : null;
  const status = updateStatus(currentVersion, policy);
  const live = policy && policy.enabled ? policy : null;
  return {
    platform,
    current_version: normalized(currentVersion),
    status,
    latest_version: live?.latest_version ?? null,
    recommended_version: live?.recommended_version ?? null,
    min_supported_version: live?.min_supported_version ?? null,
    release_notes: live?.release_notes ?? null,
    store: STORE[platform],
    prompt: {
      reprompt_after_days: live?.reprompt_after_days ?? DEFAULT_REPROMPT_AFTER_DAYS,
      max_prompts_per_version: live?.max_prompts_per_version ?? DEFAULT_MAX_PROMPTS_PER_VERSION,
    },
  };
}

// ---------------------------------------------------------------- loading

type FlagRow = { is_enabled: boolean | null; metadata: unknown };

/** Short in-process memo: every launch / foreground asks, the row rarely changes. */
const CACHE_MS = 60_000;
let cache: { at: number; row: FlagRow | null } | null = null;

export function resetAppUpdatePolicyCache() {
  cache = null;
}

export async function loadAppUpdateFlag(supabase: SupabaseClient, now = Date.now()): Promise<FlagRow | null> {
  if (cache && now - cache.at < CACHE_MS) return cache.row;
  const { data, error } = await supabase
    .from('feature_flags')
    .select('is_enabled, metadata')
    .eq('name', APP_UPDATE_FLAG)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data as FlagRow | null) ?? null;
  cache = { at: now, row };
  return row;
}
