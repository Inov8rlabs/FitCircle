/**
 * Resolved streak-shield rules (docs/STREAKS-SPEC.md §Shields).
 *
 * The three economy numbers are admin-tunable through remote config
 * (Admin Tools → Limits):
 *   streak_shield_earn_interval_days  — +1 shield per this many streak days
 *   streak_shield_starter_count       — shields granted at onboarding completion
 *   streak_shield_max_balance         — most shields a free user can bank
 *
 * Every server path that earns, grants, caps or describes shields reads them
 * here, and the streak responses serve them to clients as `shield_rules`, so
 * no app or web surface hard-codes 7 / 2 / 3. On any error the code defaults
 * in SHIELD_RULES apply.
 */

import { RemoteConfigService, type RemoteConfigContext } from '@/lib/remote-config/service';

import { SHIELD_RULES } from './streak-config';

export interface ShieldRules {
  /** +1 shield each time the streak crosses a multiple of this. */
  earnIntervalDays: number;
  /** Shields a new user starts with (never above maxBalance). */
  starterCount: number;
  /** Most shields a free user can bank across all shield types. */
  maxBalance: number;
}

/** Wire shape, served as `shield_rules` on the streak responses (additive). */
export interface ShieldRulesDto {
  earn_interval_days: number;
  starter_count: number;
  max_balance: number;
}

export const DEFAULT_SHIELD_RULES: ShieldRules = Object.freeze({
  earnIntervalDays: SHIELD_RULES.EARN_INTERVAL_DAYS,
  starterCount: SHIELD_RULES.STARTER_SHIELDS,
  maxBalance: SHIELD_RULES.MAX_SHIELD_BALANCE,
});

const posInt = (v: unknown, fallback: number, min: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min ? v : fallback;

/** Pure: sanitize raw values (bad value → code default; starter clamped to the cap). */
export function normalizeShieldRules(raw: Partial<ShieldRules>): ShieldRules {
  const earnIntervalDays = posInt(raw.earnIntervalDays, DEFAULT_SHIELD_RULES.earnIntervalDays, 1);
  const maxBalance = posInt(raw.maxBalance, DEFAULT_SHIELD_RULES.maxBalance, 1);
  const starterCount = Math.min(posInt(raw.starterCount, DEFAULT_SHIELD_RULES.starterCount, 0), maxBalance);
  return { earnIntervalDays, starterCount, maxBalance };
}

/**
 * The rules for one user (remote-config rules can target platform, version,
 * country, signup date, channel, experiment). Never throws.
 */
export async function resolveShieldRules(
  userId: string,
  ctx: Omit<RemoteConfigContext, 'userId'> = {}
): Promise<ShieldRules> {
  try {
    const full: RemoteConfigContext = { ...ctx, userId };
    const [earnIntervalDays, starterCount, maxBalance] = await Promise.all([
      RemoteConfigService.value('streak_shield_earn_interval_days', full),
      RemoteConfigService.value('streak_shield_starter_count', full),
      RemoteConfigService.value('streak_shield_max_balance', full),
    ]);
    return normalizeShieldRules({ earnIntervalDays, starterCount, maxBalance });
  } catch (err: any) {
    console.warn('[shield-rules] resolve failed; code defaults', err?.message ?? err);
    return { ...DEFAULT_SHIELD_RULES };
  }
}

export function shieldRulesDto(rules: ShieldRules): ShieldRulesDto {
  return {
    earn_interval_days: rules.earnIntervalDays,
    starter_count: rules.starterCount,
    max_balance: rules.maxBalance,
  };
}
