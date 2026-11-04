/**
 * Server-driven store rating prompt: who is eligible and at which moments
 * (decideRatingPrompt), config validation and the env kill switch.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG, configVersion, diffConfigs, envEnabled, parseConfig, validateConfig, type RatingPromptConfig } from '../config';
import { decideRatingPrompt, rolloutBucket, type RatingPromptFacts, type RatingPromptRequest } from '../eligibility';

const NOW = new Date('2026-11-04T12:00:00Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const facts = (over: Partial<RatingPromptFacts> = {}): RatingPromptFacts => ({
  userId: '11111111-2222-4333-8444-555555555555',
  email: 'jane@gmail.com',
  isAdmin: false,
  signupAt: ago(10),
  mealDaysBeforeToday: 2,
  lastPromptAt: null,
  promptCount: 0,
  ...over,
});
const req = (over: Partial<RatingPromptRequest> = {}): RatingPromptRequest => ({ platform: 'ios', appVersion: '1.1.3', country: 'US', ...over });
const cfg = (change: (c: RatingPromptConfig) => void = () => {}): RatingPromptConfig => {
  const c = structuredClone(DEFAULT_CONFIG);
  change(c);
  return c;
};
const decide = (o: { config?: RatingPromptConfig; enabled?: boolean; envEnabled?: boolean; facts?: RatingPromptFacts; request?: RatingPromptRequest } = {}) =>
  decideRatingPrompt({
    config: o.config ?? DEFAULT_CONFIG,
    enabled: o.enabled ?? true,
    envEnabled: o.envEnabled ?? true,
    configVersion: 'rp1-test',
    facts: o.facts ?? facts(),
    request: o.request ?? req(),
    now: NOW,
    env: {},
  });
const keys = (d: ReturnType<typeof decide>) => d.triggers.map((t) => t.key);

describe('defaults (no feature_flags row)', () => {
  it('are valid and match the product rules', () => {
    expect(parseConfig(DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.minDaysSinceSignup).toBe(2);
    expect(DEFAULT_CONFIG.minMealDays).toBe(3);
    expect(DEFAULT_CONFIG.cooldownDays).toBe(120);
    expect(DEFAULT_CONFIG.triggers.streak_reached.streakLengths).toEqual([3, 7]);
    expect(DEFAULT_CONFIG.platforms.ios.minAppVersion).toBe('1.1.3');
  });

  it('an eligible user gets every trigger, the exclusions and the version', () => {
    const d = decide();
    expect(d.eligible).toBe(true);
    expect(d.reason).toBeNull();
    expect(d.triggers).toEqual([{ key: 'challenge_day_completed' }, { key: 'meal_saved' }, { key: 'streak_reached', streakLengths: [3, 7] }]);
    expect(d.exclusions).toEqual({ paywallSameSession: true, paywallSameDay: false, recentErrorMinutes: 30 });
    expect(d.configVersion).toBe('rp1-test');
  });
});

describe('kill switches', () => {
  it('RATING_PROMPT_ENABLED=false', () => {
    expect(envEnabled({})).toBe(true);
    expect(envEnabled({ RATING_PROMPT_ENABLED: 'false' })).toBe(false);
    expect(envEnabled({ RATING_PROMPT_ENABLED: ' OFF ' })).toBe(false);
    expect(decide({ envEnabled: false })).toMatchObject({ eligible: false, reason: 'kill_switch', triggers: [] });
  });

  it('admin master switch (feature_flags.is_enabled)', () => {
    expect(decide({ enabled: false })).toMatchObject({ eligible: false, reason: 'disabled' });
  });
});

describe('platform and version', () => {
  it('per-platform enable', () => {
    const c = cfg((c) => (c.platforms.android.enabled = false));
    expect(decide({ config: c, request: req({ platform: 'android' }) }).reason).toBe('platform_disabled');
    expect(decide({ config: c }).eligible).toBe(true);
  });

  it('min app version: shipped clients (≤ 1.1.2) and unknown versions never qualify', () => {
    expect(decide({ request: req({ appVersion: '1.1.2' }) }).reason).toBe('app_version');
    expect(decide({ request: req({ appVersion: null }) }).reason).toBe('app_version');
    expect(decide({ request: req({ appVersion: '1.2.0' }) }).eligible).toBe(true);
  });

  it('web / missing platform', () => {
    expect(decide({ request: req({ platform: 'web' }) }).reason).toBe('unsupported_platform');
    expect(decide({ request: req({ platform: null }) }).reason).toBe('unsupported_platform');
  });
});

describe('audience', () => {
  it('countries (empty = everywhere)', () => {
    const c = cfg((c) => (c.audience.countries = ['US', 'CA']));
    expect(decide({ config: c, request: req({ country: 'IN' }) }).reason).toBe('country');
    expect(decide({ config: c, request: req({ country: null }) }).reason).toBe('country');
    expect(decide({ config: c }).eligible).toBe(true);
  });

  it('rollout % is a stable per-user bucket', () => {
    const b = rolloutBucket(facts().userId);
    expect(b).toBe(rolloutBucket(facts().userId.toUpperCase()));
    expect(decide({ config: cfg((c) => (c.audience.rolloutPercent = b)) }).reason).toBe('rollout');
    expect(decide({ config: cfg((c) => (c.audience.rolloutPercent = b + 1)) }).eligible).toBe(true);
    expect(decide({ config: cfg((c) => (c.audience.rolloutPercent = 0)) }).reason).toBe('rollout');
  });

  it('internal / test accounts are excluded (switchable)', () => {
    expect(decide({ facts: facts({ isAdmin: true }) }).reason).toBe('internal_account');
    expect(decide({ facts: facts({ email: 'qa@fitcircle.ai' }) }).reason).toBe('internal_account');
    expect(decide({ facts: facts({ email: 'fitcircle.user@gmail.com' }) }).reason).toBe('internal_account');
    expect(decide({ config: cfg((c) => (c.exclusions.internalAccounts = false)), facts: facts({ isAdmin: true }) }).eligible).toBe(true);
  });
});

describe('per-user rules', () => {
  it('not in the first N days after signup', () => {
    expect(decide({ facts: facts({ signupAt: ago(1.9) }) }).reason).toBe('too_soon_after_signup');
    expect(decide({ facts: facts({ signupAt: null }) }).reason).toBe('too_soon_after_signup');
    expect(decide({ facts: facts({ signupAt: ago(2) }) }).eligible).toBe(true);
  });

  it('meal_saved needs the minimum distinct meal days (today counts)', () => {
    expect(keys(decide({ facts: facts({ mealDaysBeforeToday: 1 }) }))).toEqual(['challenge_day_completed', 'streak_reached']);
    expect(keys(decide({ facts: facts({ mealDaysBeforeToday: 2 }) }))).toContain('meal_saved');
  });

  it('cooldown from the last request', () => {
    const d = decide({ facts: facts({ lastPromptAt: ago(119), promptCount: 1 }) });
    expect(d).toMatchObject({ eligible: false, reason: 'cooldown' });
    expect(d.cooldownUntil).toBe(new Date(Date.parse(ago(119)) + 120 * DAY).toISOString());
    expect(decide({ facts: facts({ lastPromptAt: ago(120), promptCount: 1 }) }).eligible).toBe(true);
  });

  it('max prompts per user', () => {
    expect(decide({ facts: facts({ promptCount: 3, lastPromptAt: ago(400) }) }).reason).toBe('max_prompts');
    expect(decide({ config: cfg((c) => (c.maxPromptsPerUser = 4)), facts: facts({ promptCount: 3, lastPromptAt: ago(400) }) }).eligible).toBe(true);
  });
});

describe('triggers', () => {
  it('toggles, streak lengths and room for new keys', () => {
    const c = cfg((c) => {
      c.triggers.meal_saved.enabled = false;
      c.triggers.streak_reached.streakLengths = [14, 7, 7];
      c.triggers.weekly_goal_met = { enabled: true };
    });
    expect(decide({ config: c }).triggers).toEqual([
      { key: 'challenge_day_completed' },
      { key: 'streak_reached', streakLengths: [7, 14] },
      { key: 'weekly_goal_met' },
    ]);
  });

  it('no active trigger → not eligible', () => {
    const c = cfg((c) => {
      for (const t of Object.values(c.triggers)) t.enabled = false;
    });
    expect(decide({ config: c })).toMatchObject({ eligible: false, reason: 'no_active_triggers' });
  });
});

describe('config validation', () => {
  it('rejects bad values with paths', () => {
    const bad = cfg((c) => {
      c.cooldownDays = 0;
      c.platforms.ios.minAppVersion = 'latest';
      c.triggers.streak_reached.streakLengths = [];
      c.audience.countries = ['usa'];
    });
    const paths = validateConfig(bad).issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['cooldownDays', 'platforms.ios.minAppVersion', 'triggers.streak_reached.streakLengths', 'audience.countries.0']));
    expect(parseConfig({ version: 1 })).toBeNull();
    expect(parseConfig({ ...DEFAULT_CONFIG, extra: true })).toBeNull();
  });

  it('versions and diffs are stable', () => {
    expect(configVersion(true, DEFAULT_CONFIG)).toBe(configVersion(true, structuredClone(DEFAULT_CONFIG)));
    expect(configVersion(false, DEFAULT_CONFIG)).not.toBe(configVersion(true, DEFAULT_CONFIG));
    expect(diffConfigs(DEFAULT_CONFIG, cfg((c) => (c.cooldownDays = 90)))).toEqual([{ path: 'cooldownDays', before: 120, after: 90 }]);
  });
});
