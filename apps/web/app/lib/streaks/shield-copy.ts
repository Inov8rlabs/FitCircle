/**
 * User-facing shield-rule copy built from the server's `shield_rules`
 * (remote config). Pure and client-safe: used by web pages and server copy
 * alike, so no surface hard-codes the earn interval, starter count or cap.
 */

import { SHIELD_RULES } from './streak-config';

export interface ShieldRulesLike {
  earn_interval_days: number;
  starter_count?: number;
  max_balance: number;
}

/** "Earn a shield every 7 days of streak · bank up to 3" */
export function shieldEarnLine(rules: ShieldRulesLike): string {
  return `Earn a shield every ${rules.earn_interval_days} days of streak · bank up to ${rules.max_balance}`;
}

/** "You start with 2 streak shields", or null when the starter count is 0 / unknown. */
export function shieldStarterLine(rules: Pick<ShieldRulesLike, 'starter_count'>): string | null {
  const n = rules.starter_count ?? 0;
  if (n <= 0) return null;
  return `You start with ${n} streak shield${n === 1 ? '' : 's'}`;
}

/** Out-of-shields explanation (free tier). Falls back to rule-free copy without rules. */
export function outOfShieldsLine(rules: ShieldRulesLike | null | undefined): string {
  const earn = rules
    ? `Earn one every ${rules.earn_interval_days} days of streak (bank up to ${rules.max_balance})`
    : 'Earn more by keeping your streak going';
  return `You’re out of shields. ${earn} — or get FitCircle Pro for unlimited shields, so your streak is always protected.`;
}

/** Free-plan cell for plan comparisons: "Earn 1 every 7 days of streak · bank up to 3". */
export function shieldPlanLine(rules: Pick<ShieldRulesLike, 'earn_interval_days' | 'max_balance'>): string {
  return `Earn 1 every ${rules.earn_interval_days} days of streak · bank up to ${rules.max_balance}`;
}

/**
 * Code-default rules as a client-safe DTO, for surfaces with no `shield_rules` from
 * the server (signed-out pricing pages). Server responses always win when present.
 */
export const DEFAULT_SHIELD_RULES_DTO: Required<ShieldRulesLike> = Object.freeze({
  earn_interval_days: SHIELD_RULES.EARN_INTERVAL_DAYS,
  starter_count: SHIELD_RULES.STARTER_SHIELDS,
  max_balance: SHIELD_RULES.MAX_SHIELD_BALANCE,
});
