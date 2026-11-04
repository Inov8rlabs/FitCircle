/**
 * Store rating prompt — who is eligible and at which moments. Pure (no I/O):
 * the service loads the facts, this decides. The apps only ask the OS for the
 * system prompt (iOS RequestReview / Play In-App Review) when this said
 * `eligible` AND the moment's trigger is in `triggers`.
 */
import { createHash } from 'node:crypto';

import { classifyTestUser } from '@/lib/ads/test-users';
import { compareVersions, parseVersion } from '@/lib/services/app-update-service';

import type { RatingPromptConfig } from './config';

export type RatingPromptPlatform = 'ios' | 'android';

export type IneligibleReason =
  | 'kill_switch'
  | 'disabled'
  | 'unsupported_platform'
  | 'platform_disabled'
  | 'app_version'
  | 'country'
  | 'rollout'
  | 'internal_account'
  | 'too_soon_after_signup'
  | 'max_prompts'
  | 'cooldown'
  | 'no_active_triggers';

export interface RatingPromptFacts {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  /** profiles.created_at (account creation = signup). */
  signupAt: string | null;
  /** Distinct days with a food log entry BEFORE the user's today (capped at what the rules need). */
  mealDaysBeforeToday: number;
  /** profiles.metadata.rating_prompt */
  lastPromptAt: string | null;
  promptCount: number;
}

export interface RatingPromptRequest {
  platform: string | null;
  appVersion: string | null;
  country: string | null;
}

export interface ActiveTrigger {
  key: string;
  /** streak_reached only. */
  streakLengths?: number[];
}

/** The client payload (GET /api/mobile/rating-prompt `data`). */
export interface RatingPromptDecision {
  eligible: boolean;
  reason: IneligibleReason | null;
  /** Moments that may ask right now. Empty unless eligible. */
  triggers: ActiveTrigger[];
  /** Our cooldown end (ISO) when one applies. */
  cooldownUntil: string | null;
  promptCount: number;
  maxPrompts: number;
  /** Client-enforced exclusions (the server can't see the session). */
  exclusions: { paywallSameSession: boolean; paywallSameDay: boolean; recentErrorMinutes: number };
  configVersion: string;
}

const DAY_MS = 86_400_000;

/** Deterministic 0–99 bucket per user (independent of experiment buckets). */
export function rolloutBucket(userId: string): number {
  return createHash('sha256').update(`rating_prompt:${userId.toLowerCase()}`).digest().readUInt32BE(0) % 100;
}

export function decideRatingPrompt(input: {
  config: RatingPromptConfig;
  /** Admin master switch (feature_flags.is_enabled). */
  enabled: boolean;
  /** RATING_PROMPT_ENABLED env kill switch. */
  envEnabled: boolean;
  configVersion: string;
  facts: RatingPromptFacts;
  request: RatingPromptRequest;
  now: Date;
  env?: Record<string, string | undefined>;
}): RatingPromptDecision {
  const { config, facts, request, now } = input;
  const base = {
    triggers: [] as ActiveTrigger[],
    cooldownUntil: null as string | null,
    promptCount: facts.promptCount,
    maxPrompts: config.maxPromptsPerUser,
    exclusions: {
      paywallSameSession: config.exclusions.paywallSameSession,
      paywallSameDay: config.exclusions.paywallSameDay,
      recentErrorMinutes: config.exclusions.recentErrorMinutes,
    },
    configVersion: input.configVersion,
  };
  const no = (reason: IneligibleReason, extra: Partial<RatingPromptDecision> = {}): RatingPromptDecision => ({
    ...base,
    ...extra,
    eligible: false,
    reason,
  });

  if (!input.envEnabled) return no('kill_switch');
  if (!input.enabled) return no('disabled');

  const platform = request.platform === 'ios' || request.platform === 'android' ? request.platform : null;
  if (!platform) return no('unsupported_platform');
  const pc = config.platforms[platform];
  if (!pc.enabled) return no('platform_disabled');
  const have = parseVersion(request.appVersion);
  const need = parseVersion(pc.minAppVersion);
  if (!have || !need || compareVersions(have, need) < 0) return no('app_version');

  const countries = config.audience.countries;
  if (countries.length > 0 && !(request.country && countries.includes(request.country))) return no('country');
  if (rolloutBucket(facts.userId) >= config.audience.rolloutPercent) return no('rollout');

  if (config.exclusions.internalAccounts && classifyTestUser({ email: facts.email, isAdmin: facts.isAdmin }, input.env) !== null) {
    return no('internal_account');
  }

  const signup = facts.signupAt ? Date.parse(facts.signupAt) : NaN;
  if (!Number.isFinite(signup) || now.getTime() - signup < config.minDaysSinceSignup * DAY_MS) {
    return no('too_soon_after_signup');
  }

  if (facts.promptCount >= config.maxPromptsPerUser) return no('max_prompts');
  const last = facts.lastPromptAt ? Date.parse(facts.lastPromptAt) : NaN;
  if (Number.isFinite(last)) {
    const until = last + config.cooldownDays * DAY_MS;
    if (now.getTime() < until) return no('cooldown', { cooldownUntil: new Date(until).toISOString() });
  }

  const triggers: ActiveTrigger[] = [];
  for (const key of Object.keys(config.triggers).sort()) {
    const t = config.triggers[key];
    if (!t.enabled) continue;
    if (key === 'meal_saved') {
      // A meal_saved moment always has a meal today, so today counts.
      if (facts.mealDaysBeforeToday + 1 < config.minMealDays) continue;
      triggers.push({ key });
    } else if (key === 'streak_reached') {
      const lengths = [...new Set(t.streakLengths ?? [])].sort((a, b) => a - b);
      if (lengths.length > 0) triggers.push({ key, streakLengths: lengths });
    } else {
      triggers.push({ key });
    }
  }
  if (triggers.length === 0) return no('no_active_triggers');

  return { ...base, triggers, eligible: true, reason: null };
}
