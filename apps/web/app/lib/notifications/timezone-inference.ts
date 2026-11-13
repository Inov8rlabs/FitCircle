/**
 * Infer a real device timezone for a profile still on a placeholder ('UTC' /
 * null) — docs/PUSH_NOTIFICATIONS.md §8.7. PURE; used by
 * scripts/backfill-placeholder-timezones.ts.
 *
 * Going forward the zone is fixed live: every authenticated mobile request
 * carries X-Client-Timezone and mobile-auth backfills a placeholder
 * (AppOpenService.pendingTimezoneBackfill), and the home feed keeps it in sync
 * (ProfileTimezoneService). This covers users who have not made a request
 * since, from data they left behind. Sources, most exact first:
 *   1. exact   streak_claims.timezone — the device zone the app sent with a claim.
 *   2. exact   app_opens.timezone when it is not the server fallback (a placeholder
 *              profile + no header is recorded as America/New_York, so that value
 *              proves nothing and is ignored).
 *   3. offset  app_opens (local_date vs first_open_at): each open bounds the UTC
 *              offset. When the bounds pin ONE whole/half-hour offset and exactly
 *              one candidate zone (zones real users already have) has that offset
 *              now, it is proposed — flagged `inferred`, written only with
 *              --include-inferred, because offsets are ambiguous across countries.
 */
import { isPlaceholderTimezone } from './user-timezone';

export const SERVER_FALLBACK_TZ = 'America/New_York';

export interface TimezoneEvidence {
  claimTimezones: Array<{ timezone: string | null; at: string }>;
  opens: Array<{ local_date: string; first_open_at: string; timezone: string | null }>;
}

export type TimezoneInference =
  | { timezone: string; source: 'streak_claim' | 'app_open'; exact: true }
  | { timezone: string; source: 'open_offset'; exact: false; offsetMinutes: number }
  | null;

/** UTC offset (minutes, east positive) of `tz` at `at`. */
export function offsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * Offset bounds from opens: local_date = date(first_open_at + offset), so
 * offset ∈ [local_date 00:00 − t, local_date 24:00 − t). Null when inconsistent.
 */
export function offsetBounds(opens: TimezoneEvidence['opens']): { min: number; max: number } | null {
  let min = -14 * 60;
  let max = 14 * 60;
  let n = 0;
  for (const o of opens) {
    const t = Date.parse(o.first_open_at);
    const day = Date.parse(`${o.local_date}T00:00:00Z`);
    if (!Number.isFinite(t) || !Number.isFinite(day)) continue;
    const lo = (day - t) / 60_000;
    const hi = lo + 24 * 60 - 1;
    min = Math.max(min, lo);
    max = Math.min(max, hi);
    n++;
  }
  if (n === 0 || min > max) return null;
  return { min, max };
}

export function inferTimezone(evidence: TimezoneEvidence, candidates: readonly string[], now: Date = new Date()): TimezoneInference {
  const claims = [...evidence.claimTimezones].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const claim = claims.find((c) => !isPlaceholderTimezone(c.timezone));
  if (claim) return { timezone: claim.timezone!, source: 'streak_claim', exact: true };

  const opens = [...evidence.opens].sort((a, b) => Date.parse(b.first_open_at) - Date.parse(a.first_open_at));
  const open = opens.find((o) => !isPlaceholderTimezone(o.timezone) && o.timezone !== SERVER_FALLBACK_TZ);
  if (open) return { timezone: open.timezone!, source: 'app_open', exact: true };

  const bounds = offsetBounds(evidence.opens);
  if (!bounds) return null;
  const fits = [...new Set(candidates)].filter((tz) => {
    if (isPlaceholderTimezone(tz)) return false;
    try {
      return evidence.opens.every((o) => {
        const off = offsetMinutes(tz, new Date(o.first_open_at));
        return off >= bounds.min && off <= bounds.max;
      });
    } catch {
      return false;
    }
  });
  const offsets = new Set(fits.map((tz) => offsetMinutes(tz, now)));
  if (fits.length === 1 || (offsets.size === 1 && fits.length > 0)) {
    // One offset; when several zones share it, pick the most common candidate (first in the list).
    const tz = fits[0];
    return { timezone: tz, source: 'open_offset', exact: false, offsetMinutes: offsetMinutes(tz, now) };
  }
  return null;
}
