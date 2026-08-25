/**
 * Resolve the user's IANA timezone for a request.
 *
 * Priority: explicit body field → `x-client-timezone` header (sent by the
 * iOS/Android/web clients on every request) → null. Callers that still have
 * nothing should fall back to the user's last-known claim timezone (see
 * StreakClaimingService.resolveTimezone) rather than assuming UTC.
 */
import { isValidTimezone } from './streak-calculator';

export const CLIENT_TIMEZONE_HEADER = 'x-client-timezone';

export function resolveClientTimezone(
  request: { headers: { get(name: string): string | null } },
  bodyTimezone?: unknown
): string | null {
  if (typeof bodyTimezone === 'string' && isValidTimezone(bodyTimezone)) return bodyTimezone;
  const header = request.headers.get(CLIENT_TIMEZONE_HEADER);
  if (isValidTimezone(header)) return header;
  return null;
}
