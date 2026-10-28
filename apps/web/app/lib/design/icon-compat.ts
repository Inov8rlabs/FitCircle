/**
 * Icon keys with backward compatibility (docs/RELEASE_1.1.0_PLAN.md W4).
 *
 * Shipped apps render emoji fields: `emoji`, `badge`, `badge_emoji`,
 * `icon_name`, and the challenge template's `icon`. Services always build both
 * the legacy emoji and the new key (`icon`, or `icon_key` where `icon` is
 * already the emoji on the wire), so every client gets the key. For clients
 * that render keys applyIconCompat() then nulls the legacy emoji fields and
 * promotes `icon_key` into `icon`.
 *
 * A client opts in by capability, not version: it sends
 * `X-Client-Features: icon_keys` (comma-separated list). Early 1.1.0 test
 * builds predate icon keys but share the version number, so "no header" must
 * mean "render emoji".
 */
import { isIconKey } from './icons';

/** Request header listing client capabilities, comma-separated. */
export const CLIENT_FEATURES_HEADER = 'x-client-features';
/** Capability a client sends when it renders icon keys instead of emoji. */
export const ICON_KEYS_FEATURE = 'icon_keys';

/** Fields that hold an emoji for shipped clients. Only string values are touched. */
export const LEGACY_EMOJI_FIELDS = ['emoji', 'badge', 'badge_emoji', 'badgeEmoji', 'icon_name'] as const;

type HeaderSource = { headers: { get(name: string): string | null } };

/** True when the X-Client-Features value lists `icon_keys`. */
export function clientRendersIconKeys(features: string | null | undefined): boolean {
  return (features ?? '')
    .split(',')
    .some((f) => f.trim().toLowerCase() === ICON_KEYS_FEATURE);
}

export function requestRendersIconKeys(request: HeaderSource): boolean {
  return clientRendersIconKeys(request.headers.get(CLIENT_FEATURES_HEADER));
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
 * (same reference); icon-key clients get a copy with legacy emoji fields nulled on every
 * object that carries an icon key.
 */
export function applyIconCompat<T>(payload: T, rendersIconKeys: boolean): T {
  return rendersIconKeys ? (modernize(payload) as T) : payload;
}

/** applyIconCompat keyed off the request's X-Client-Features. */
export function iconCompatFor<T>(request: HeaderSource, payload: T): T {
  return applyIconCompat(payload, requestRendersIconKeys(request));
}
