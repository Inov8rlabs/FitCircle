/**
 * Kill switches (spec §5). Disabled → the endpoint still answers 200 with the
 * static default layout, so clients behave identically either way.
 *
 *  HOME_FEED_ENABLED    default on; "0" | "false" | "off" | "no" turns the
 *                       server-driven layout off everywhere.
 *  HOME_FEED_PLATFORMS  optional comma list (e.g. "ios,android"). When set,
 *                       only those platforms get the server-driven layout;
 *                       requests without a platform header get the default.
 *  HOME_FEED_RULES_ENABLED  default on; off = context-aware default ranking
 *                       but ignore every DB rule (rules incident switch).
 */
import type { AppPlatform } from './types';

type Env = Record<string, string | undefined>;

const OFF = new Set(['0', 'false', 'off', 'no']);
const isOff = (v: string | undefined) => v !== undefined && OFF.has(v.trim().toLowerCase());

export function isFeedEnabled(platform: AppPlatform | null, env: Env = process.env): boolean {
  if (isOff(env.HOME_FEED_ENABLED)) return false;
  const list = (env.HOME_FEED_PLATFORMS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return true;
  return platform !== null && list.includes(platform);
}

export function areRulesEnabled(env: Env = process.env): boolean {
  return !isOff(env.HOME_FEED_RULES_ENABLED);
}
