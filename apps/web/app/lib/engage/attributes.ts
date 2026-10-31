/**
 * Segment attribute engine (docs/ENGAGE_SPEC.md §6). Attributes are computed
 * from existing tables — one snapshot per user per request, or in bulk for
 * audiences/estimates (only the tables the filters need are read):
 *
 *   platform, push_enabled        push_tokens (active; most recently used platform)
 *   days_since_signup             profiles.created_at
 *   is_pro                        profiles.subscription_tier / subscription_expires_at
 *   current_streak, last_active_days  engagement_streaks (current_streak, last_engagement_date),
 *                                 falling back to profiles.last_active_at
 *   active_circle_count, has_active_circle  fitcircle_members (active) × fitcircles (upcoming/active)
 *   referral_qualified_count      referrals (inviter_id, status 'qualified')
 *   campaign_joined               campaign_participants × campaigns.slug
 *   country, timezone             profiles.timezone (country best effort from the zone)
 *   app_version                   request header x-app-version (single-user only)
 *   email_opt_in                  profiles.email + preferences.marketingEmails !== false
 *   random_bucket                 stable hash of the user id (0–99)
 */
import { createAdminSupabase } from '../supabase-admin';

import { randomBucket } from './assignment';
import type { AttributeKey, EngagePlatform, FilterCondition } from './types';

export const ATTRIBUTE_KEYS: readonly AttributeKey[] = [
  'platform', 'days_since_signup', 'is_pro', 'current_streak', 'last_active_days',
  'active_circle_count', 'has_active_circle', 'referral_qualified_count', 'campaign_joined',
  'country', 'timezone', 'app_version', 'email_opt_in', 'push_enabled', 'random_bucket',
];

/** Profile columns the engine reads (select these when paging profiles). */
export const PROFILE_COLUMNS =
  'id, email, display_name, username, created_at, timezone, preferences, subscription_tier, subscription_expires_at, last_active_at';

export interface ProfileLite {
  id: string;
  email?: string | null;
  display_name?: string | null;
  username?: string | null;
  created_at?: string | null;
  timezone?: string | null;
  preferences?: Record<string, any> | null;
  subscription_tier?: string | null;
  subscription_expires_at?: string | null;
  last_active_at?: string | null;
}

export interface AttributeSnapshot {
  userId: string;
  platform: EngagePlatform | null;
  /** Every platform the user has an active push token on. */
  tokenPlatforms: EngagePlatform[];
  days_since_signup: number | null;
  is_pro: boolean;
  current_streak: number;
  last_active_days: number | null;
  active_circle_count: number;
  has_active_circle: boolean;
  referral_qualified_count: number;
  campaign_joined: string[];
  country: string | null;
  timezone: string | null;
  app_version: string | null;
  email_opt_in: boolean;
  push_enabled: boolean;
  random_bucket: number;
}

export interface SnapshotContext {
  now?: Date;
  /** Request platform (x-platform) — wins over the push-token platform for the caller. */
  platform?: EngagePlatform | null;
  appVersion?: string | null;
  /** Restrict loading to what these keys need (default: everything). */
  keys?: Set<string>;
}

const DAY = 86_400_000;
const CHUNK = 200;
const chunks = <T>(xs: T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

const LOADER_KEYS = {
  tokens: ['platform', 'push_enabled'],
  streak: ['current_streak', 'last_active_days'],
  circles: ['active_circle_count', 'has_active_circle'],
  referrals: ['referral_qualified_count'],
  campaigns: ['campaign_joined'],
} as const;

export function filterKeys(...lists: Array<FilterCondition[] | null | undefined>): Set<string> {
  const keys = new Set<string>();
  for (const l of lists) for (const f of l ?? []) keys.add(f.key);
  return keys;
}

const needs = (keys: Set<string> | undefined, loader: keyof typeof LOADER_KEYS) =>
  !keys || LOADER_KEYS[loader].some((k) => keys.has(k));

// Best-effort country from an IANA zone (only unambiguous zones).
const ZONE_COUNTRY: Record<string, string> = {
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US', 'America/Phoenix': 'US',
  'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Detroit': 'US', 'America/Boise': 'US', 'America/Indiana/Indianapolis': 'US',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA', 'America/Halifax': 'CA', 'America/St_Johns': 'CA',
  'America/Mexico_City': 'MX', 'America/Sao_Paulo': 'BR', 'America/Argentina/Buenos_Aires': 'AR', 'America/Bogota': 'CO', 'America/Lima': 'PE', 'America/Santiago': 'CL',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE', 'Europe/Zurich': 'CH', 'Europe/Vienna': 'AT', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ', 'Europe/Lisbon': 'PT', 'Europe/Athens': 'GR', 'Europe/Istanbul': 'TR', 'Europe/Kyiv': 'UA', 'Europe/Kiev': 'UA', 'Europe/Moscow': 'RU',
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Singapore': 'SG', 'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR', 'Asia/Shanghai': 'CN', 'Asia/Hong_Kong': 'HK', 'Asia/Taipei': 'TW', 'Asia/Manila': 'PH', 'Asia/Jakarta': 'ID', 'Asia/Bangkok': 'TH', 'Asia/Kuala_Lumpur': 'MY',
  'Asia/Jerusalem': 'IL', 'Africa/Cairo': 'EG', 'Africa/Lagos': 'NG', 'Africa/Johannesburg': 'ZA', 'Africa/Nairobi': 'KE', 'Africa/Casablanca': 'MA',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU', 'Pacific/Auckland': 'NZ',
};

export function countryOfTimezone(tz: string | null | undefined): string | null {
  return tz ? ZONE_COUNTRY[tz] ?? null : null;
}

function isProProfile(p: ProfileLite, now: Date): boolean {
  if (p.subscription_tier !== 'premium' && p.subscription_tier !== 'enterprise') return false;
  return !p.subscription_expires_at || new Date(p.subscription_expires_at).getTime() > now.getTime();
}

const daysSince = (iso: string | null | undefined, now: Date) =>
  iso ? Math.max(0, Math.floor((now.getTime() - new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).getTime()) / DAY)) : null;

/** Bulk snapshots for `profiles`. */
export async function loadSnapshots(profiles: ProfileLite[], ctx: SnapshotContext = {}): Promise<Map<string, AttributeSnapshot>> {
  const now = ctx.now ?? new Date();
  const ids = profiles.map((p) => p.id);
  const supabase = createAdminSupabase();
  const tokens = new Map<string, Array<{ platform: EngagePlatform; last: string }>>();
  const streaks = new Map<string, { current: number; last: string | null }>();
  const circleCount = new Map<string, number>();
  const referralCount = new Map<string, number>();
  const joined = new Map<string, string[]>();

  for (const part of chunks(ids)) {
    const jobs: Array<Promise<void>> = [];
    if (needs(ctx.keys, 'tokens')) {
      jobs.push(
        (async () => {
          const { data, error } = await supabase.from('push_tokens').select('user_id, platform, last_used_at').in('user_id', part).eq('is_active', true);
          if (error) throw error;
          for (const t of (data ?? []) as Array<{ user_id: string; platform: EngagePlatform; last_used_at: string | null }>) {
            tokens.set(t.user_id, [...(tokens.get(t.user_id) ?? []), { platform: t.platform, last: t.last_used_at ?? '' }]);
          }
        })()
      );
    }
    if (needs(ctx.keys, 'streak')) {
      jobs.push(
        (async () => {
          const { data, error } = await supabase.from('engagement_streaks').select('user_id, current_streak, last_engagement_date').in('user_id', part);
          if (error) throw error;
          for (const s of (data ?? []) as Array<{ user_id: string; current_streak: number | null; last_engagement_date: string | null }>) {
            streaks.set(s.user_id, { current: s.current_streak ?? 0, last: s.last_engagement_date });
          }
        })()
      );
    }
    if (needs(ctx.keys, 'circles')) {
      jobs.push(
        (async () => {
          const { data, error } = await supabase.from('fitcircle_members').select('user_id, fitcircle_id').in('user_id', part).eq('status', 'active');
          if (error) throw error;
          const rows = (data ?? []) as Array<{ user_id: string; fitcircle_id: string }>;
          const circleIds = [...new Set(rows.map((r) => r.fitcircle_id))];
          const live = new Set<string>();
          for (const cpart of chunks(circleIds)) {
            const { data: circles, error: cErr } = await supabase.from('fitcircles').select('id').in('id', cpart).in('status', ['upcoming', 'active']);
            if (cErr) throw cErr;
            for (const c of (circles ?? []) as Array<{ id: string }>) live.add(c.id);
          }
          const seen = new Set<string>();
          for (const r of rows) {
            const k = `${r.user_id}|${r.fitcircle_id}`;
            if (!live.has(r.fitcircle_id) || seen.has(k)) continue;
            seen.add(k);
            circleCount.set(r.user_id, (circleCount.get(r.user_id) ?? 0) + 1);
          }
        })()
      );
    }
    if (needs(ctx.keys, 'referrals')) {
      jobs.push(
        (async () => {
          const { data, error } = await supabase.from('referrals').select('inviter_id').in('inviter_id', part).eq('status', 'qualified');
          if (error) throw error;
          for (const r of (data ?? []) as Array<{ inviter_id: string }>) referralCount.set(r.inviter_id, (referralCount.get(r.inviter_id) ?? 0) + 1);
        })()
      );
    }
    if (needs(ctx.keys, 'campaigns')) {
      jobs.push(
        (async () => {
          const { data, error } = await supabase.from('campaign_participants').select('user_id, campaign_id').in('user_id', part);
          if (error) throw error;
          const rows = (data ?? []) as Array<{ user_id: string; campaign_id: string }>;
          const cids = [...new Set(rows.map((r) => r.campaign_id))];
          const slugs = new Map<string, string>();
          if (cids.length) {
            const { data: cs, error: cErr } = await supabase.from('campaigns').select('id, slug').in('id', cids);
            if (cErr) throw cErr;
            for (const c of (cs ?? []) as Array<{ id: string; slug: string }>) slugs.set(c.id, c.slug);
          }
          for (const r of rows) {
            const s = slugs.get(r.campaign_id);
            if (s) joined.set(r.user_id, [...(joined.get(r.user_id) ?? []), s]);
          }
        })()
      );
    }
    await Promise.all(jobs);
  }

  const out = new Map<string, AttributeSnapshot>();
  for (const p of profiles) {
    const toks = (tokens.get(p.id) ?? []).sort((a, b) => b.last.localeCompare(a.last));
    const st = streaks.get(p.id);
    const lastActive = st?.last ?? p.last_active_at ?? null;
    const circles = circleCount.get(p.id) ?? 0;
    out.set(p.id, {
      userId: p.id,
      platform: ctx.platform ?? toks[0]?.platform ?? null,
      tokenPlatforms: [...new Set(toks.map((t) => t.platform))],
      days_since_signup: daysSince(p.created_at, now),
      is_pro: isProProfile(p, now),
      current_streak: st?.current ?? 0,
      last_active_days: daysSince(lastActive, now),
      active_circle_count: circles,
      has_active_circle: circles > 0,
      referral_qualified_count: referralCount.get(p.id) ?? 0,
      campaign_joined: joined.get(p.id) ?? [],
      country: countryOfTimezone(p.timezone),
      timezone: p.timezone ?? null,
      app_version: ctx.appVersion ?? null,
      email_opt_in: !!p.email && p.preferences?.marketingEmails !== false,
      push_enabled: toks.length > 0,
      random_bucket: randomBucket(p.id),
    });
  }
  return out;
}

export async function snapshotFor(profile: ProfileLite, ctx: SnapshotContext = {}): Promise<AttributeSnapshot> {
  return (await loadSnapshots([profile], ctx)).get(profile.id)!;
}

/** Semver-ish compare ("1.0.10" > "1.0.9"); non-numeric parts compare as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

const norm = (v: unknown) => (typeof v === 'boolean' ? String(v) : v === null || v === undefined ? null : String(v).toLowerCase());

function compare(key: string, a: unknown, b: unknown): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (key === 'app_version') return compareVersions(String(a), String(b));
  const x = Number(a);
  const y = Number(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return String(a).localeCompare(String(b));
  return x === y ? 0 : x > y ? 1 : -1;
}

export function matchesCondition(snap: AttributeSnapshot, c: FilterCondition): boolean {
  const raw = (snap as unknown as Record<string, unknown>)[c.key];
  const values = Array.isArray(c.value) ? c.value : c.value === undefined ? [] : [c.value];
  if (Array.isArray(raw)) {
    const have = raw.map(norm);
    switch (c.op) {
      case 'eq':
        return have.includes(norm(c.value));
      case 'neq':
        return !have.includes(norm(c.value));
      case 'in':
        return values.some((v) => have.includes(norm(v)));
      case 'not_in':
        return !values.some((v) => have.includes(norm(v)));
      case 'exists':
        return have.length > 0;
      case 'not_exists':
        return have.length === 0;
      default:
        return false;
    }
  }
  switch (c.op) {
    case 'exists':
      return raw !== null && raw !== undefined;
    case 'not_exists':
      return raw === null || raw === undefined;
    case 'eq':
      return raw !== null && raw !== undefined && norm(raw) === norm(c.value);
    case 'neq':
      return norm(raw) !== norm(c.value);
    case 'in':
      return values.some((v) => norm(raw) === norm(v));
    case 'not_in':
      return !values.some((v) => norm(raw) === norm(v));
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const r = compare(c.key, raw, c.value);
      if (r === null) return false;
      return c.op === 'gt' ? r > 0 : c.op === 'gte' ? r >= 0 : c.op === 'lt' ? r < 0 : r <= 0;
    }
    default:
      return false;
  }
}

export function matchesFilters(snap: AttributeSnapshot, filters: FilterCondition[] | null | undefined): boolean {
  return (filters ?? []).every((c) => matchesCondition(snap, c));
}
