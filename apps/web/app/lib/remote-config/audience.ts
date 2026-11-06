/**
 * Remote config rule audiences (docs/TRIAL_FIRST_SPEC.md §6.3). All specified conditions AND;
 * an empty audience matches everyone. Unknown context values NEVER match a condition that
 * needs them (e.g. a platform rule never matches a request without X-App-Platform).
 *
 * Reuses the shared helpers: bucketOf (lib/experiments/bucket.ts) and the version compare
 * of the home feed rules (lib/home-feed/rules.ts).
 */
import { z } from 'zod';

import { bucketOf } from '../experiments/bucket';
import { compareVersions, parseVersion } from '../home-feed/rules';

const version = z.string().trim().regex(/^\d+(\.\d+){0,3}$/, 'Expected a version like 1.2.0');
const isoDate = z
  .string()
  .trim()
  .refine((s) => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s)), 'Expected an ISO date (YYYY-MM-DD or full timestamp)');
const uuid = z.string().uuid();
const slug = z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/i, 'Expected a key like onboarding_paywall');

export const PLATFORMS = ['ios', 'android', 'web'] as const;
export type RcPlatform = (typeof PLATFORMS)[number];

export const audienceSchema = z
  .object({
    platforms: z.array(z.enum(PLATFORMS)).min(1).optional(),
    appVersionGte: version.optional(),
    appVersionLt: version.optional(),
    countries: z.array(z.string().trim().regex(/^[A-Za-z]{2}$/, 'Expected an ISO alpha-2 country code').transform((c) => c.toUpperCase())).min(1).optional(),
    channels: z.array(z.string().trim().min(1).max(64)).min(1).optional(),
    signupAfter: isoDate.optional(),
    signupBefore: isoDate.optional(),
    daysSinceSignupGte: z.number().int().min(0).max(100_000).optional(),
    daysSinceSignupLt: z.number().int().min(0).max(100_000).optional(),
    percent: z.number().min(0).max(100).optional(),
    bucketSalt: z.string().trim().min(1).max(64).optional(),
    experiment: z.object({ key: slug, arms: z.array(z.string().trim().min(1).max(64)).min(1) }).strict().optional(),
    userIds: z.array(uuid).min(1).max(1000).optional(),
    excludeUserIds: z.array(uuid).min(1).max(1000).optional(),
  })
  .strict();

export type RcAudience = z.infer<typeof audienceSchema>;

/** Facts the audience is evaluated against. `undefined` fields were not loaded; null = unknown. */
export interface AudienceFacts {
  userId: string;
  now: Date;
  platform: RcPlatform | null;
  appVersion: string | null;
  country: string | null;
  channel?: string | null;
  signupAt?: string | null;
  /** experiment key → the user's assigned arm (null = no assignment). */
  experimentArms?: Record<string, string | null>;
}

/** Which lazily-loaded facts an audience needs. */
export function audienceNeeds(a: RcAudience): { channel: boolean; signup: boolean; experiment: string | null } {
  return {
    channel: !!a.channels,
    signup: a.signupAfter !== undefined || a.signupBefore !== undefined || a.daysSinceSignupGte !== undefined || a.daysSinceSignupLt !== undefined,
    experiment: a.experiment?.key ?? null,
  };
}

const lower = (s: string) => s.toLowerCase();

/**
 * Pure match. `ruleId` is the default bucket salt for `percent`. Returns null on a match,
 * else the first failing condition (shown by the admin preview).
 */
export function audienceMismatch(a: RcAudience, f: AudienceFacts, ruleId: string): string | null {
  const uid = lower(f.userId);
  if (a.excludeUserIds?.some((id) => lower(id) === uid)) return 'excludeUserIds';
  if (a.userIds && !a.userIds.some((id) => lower(id) === uid)) return 'userIds';
  if (a.platforms && (!f.platform || !a.platforms.includes(f.platform))) return 'platforms';
  if (a.appVersionGte || a.appVersionLt) {
    const v = parseVersion(f.appVersion);
    if (!v) return a.appVersionGte ? 'appVersionGte' : 'appVersionLt';
    if (a.appVersionGte && compareVersions(v, parseVersion(a.appVersionGte)!) < 0) return 'appVersionGte';
    if (a.appVersionLt && compareVersions(v, parseVersion(a.appVersionLt)!) >= 0) return 'appVersionLt';
  }
  if (a.countries && (!f.country || !a.countries.includes(f.country.toUpperCase()))) return 'countries';
  if (a.channels && (!f.channel || !a.channels.includes(f.channel))) return 'channels';
  const signupMs = f.signupAt ? Date.parse(f.signupAt) : NaN;
  if (a.signupAfter !== undefined && (Number.isNaN(signupMs) || !(signupMs >= Date.parse(a.signupAfter)))) return 'signupAfter';
  if (a.signupBefore !== undefined && (Number.isNaN(signupMs) || !(signupMs < Date.parse(a.signupBefore)))) return 'signupBefore';
  if (a.daysSinceSignupGte !== undefined || a.daysSinceSignupLt !== undefined) {
    const days = Number.isNaN(signupMs) ? null : Math.floor((f.now.getTime() - signupMs) / 86_400_000);
    if (a.daysSinceSignupGte !== undefined && (days === null || days < a.daysSinceSignupGte)) return 'daysSinceSignupGte';
    if (a.daysSinceSignupLt !== undefined && (days === null || days >= a.daysSinceSignupLt)) return 'daysSinceSignupLt';
  }
  if (a.experiment) {
    const arm = f.experimentArms?.[a.experiment.key] ?? null;
    if (!arm || !a.experiment.arms.includes(arm)) return 'experiment';
  }
  if (a.percent !== undefined && !(bucketOf(uid, a.bucketSalt ?? ruleId) < a.percent)) return 'percent';
  return null;
}
