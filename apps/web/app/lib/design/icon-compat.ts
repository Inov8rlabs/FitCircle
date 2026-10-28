/**
 * Icon keys with backward compatibility (docs/RELEASE_1.2.0_PLAN.md W4).
 *
 * Shipped apps (≤ 1.1.x) render emoji fields: `emoji`, `badge`, `badge_emoji`,
 * `icon_name`, and the challenge template's `icon`. Services always build both
 * the legacy emoji and the new key (`icon`, or `icon_key` where `icon` is
 * already the emoji on the wire), so every client gets the key. For clients
 * that render keys (X-App-Version ≥ 1.2.0) applyIconCompat() then nulls the
 * legacy emoji fields and promotes `icon_key` into `icon`.
 *
 * A missing or unparseable X-App-Version is treated as a shipped client
 * (emoji kept). iOS ≤ 1.1.x sends the header only on a few endpoints and
 * Android on all of them, so "no header" must mean "old".
 */
import { readExperimentRequestInfo } from '@/lib/experiments/request-info';
import { compareVersions, parseVersion } from '@/lib/home-feed/rules';

import { isIconKey } from './icons';

/** First app version that renders icon keys instead of emoji. */
export const ICON_KEYS_MIN_APP_VERSION = '1.2.0';

/** Fields that hold an emoji for shipped clients. Only string values are touched. */
export const LEGACY_EMOJI_FIELDS = ['emoji', 'badge', 'badge_emoji', 'badgeEmoji', 'icon_name'] as const;

type HeaderSource = { headers: { get(name: string): string | null } };

export function clientRendersIconKeys(appVersion: string | null | undefined): boolean {
  const v = parseVersion(appVersion ?? null);
  return !!v && compareVersions(v, parseVersion(ICON_KEYS_MIN_APP_VERSION)!) >= 0;
}

export function requestRendersIconKeys(request: HeaderSource): boolean {
  return clientRendersIconKeys(readExperimentRequestInfo(request).appVersion);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

function modernize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(modernize);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = modernize(v);
  const keyed = isIconKey(out.icon) || isIconKey(out.icon_key);
  if (!keyed) return out;
  if (isIconKey(out.icon_key) && typeof out.icon === 'string' && !isIconKey(out.icon)) out.icon = out.icon_key;
  for (const f of LEGACY_EMOJI_FIELDS) if (typeof out[f] === 'string') out[f] = null;
  return out;
}

/**
 * The payload as this client should see it. Shipped clients get it unchanged
 * (same reference); 1.2.0+ get a copy with legacy emoji fields nulled on every
 * object that carries an icon key.
 */
export function applyIconCompat<T>(payload: T, rendersIconKeys: boolean): T {
  return rendersIconKeys ? (modernize(payload) as T) : payload;
}

/** applyIconCompat keyed off the request's X-App-Version. */
export function iconCompatFor<T>(request: HeaderSource, payload: T): T {
  return applyIconCompat(payload, requestRendersIconKeys(request));
}
