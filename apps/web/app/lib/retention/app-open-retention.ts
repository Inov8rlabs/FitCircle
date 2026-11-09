/**
 * D1 / D7 retention from server-side app opens (retention fix 4). PURE.
 * I/O: lib/services/retention-report-service.ts; route GET /api/admin/retention.
 *
 * Definitions (local days, in the user's own timezone):
 *   signup day  = the local date of profiles.created_at
 *   D1 retained = an app_opens row (any platform) on signup day + 1
 *   D7 retained = an app_opens row on signup day + 7
 * A user counts toward Dn only once that local day has fully passed AND they
 * signed up after app-open recording started (signalSince) — otherwise a
 * missing row would read as churn.
 *
 * An app open = an authenticated GET of /api/mobile/entitlements, /targets or
 * /home-feed, which the apps make on every foreground and never from
 * background work (AppOpenService). Background step syncs never count.
 */
import { addDays } from '@/lib/streaks/streak-calculator';

import { localClockIn } from '../notifications/user-timezone';

export type RetentionPlatform = 'ios' | 'android' | 'web' | 'unknown';

export interface RetentionUser {
  userId: string;
  signupAt: string;
  timezone: string;
  platform: RetentionPlatform;
  /** Acquisition source: invite | paid_apple | paid_google | … | organic | unknown. */
  source: string;
}

export interface OpenRow {
  user_id: string;
  local_date: string;
  platform: string;
}

export interface UserRetention {
  /** null = not eligible yet (or before the signal existed). */
  d1: boolean | null;
  d7: boolean | null;
}

export function userRetention(u: RetentionUser, opens: readonly OpenRow[], now: Date, signalSince: string | null): UserRetention {
  if (!signalSince || Date.parse(u.signupAt) < Date.parse(signalSince)) return { d1: null, d7: null };
  const signupDay = localClockIn(new Date(u.signupAt), u.timezone).date;
  const today = localClockIn(now, u.timezone).date;
  const days = new Set(opens.map((o) => o.local_date));
  const at = (n: number): boolean | null => {
    const day = addDays(signupDay, n);
    return today > day ? days.has(day) : null;
  };
  return { d1: at(1), d7: at(7) };
}

export interface RetentionCell {
  signups: number;
  d1Eligible: number;
  d1Retained: number;
  d1Rate: number | null;
  d7Eligible: number;
  d7Retained: number;
  d7Rate: number | null;
}

const emptyCell = (): RetentionCell => ({ signups: 0, d1Eligible: 0, d1Retained: 0, d1Rate: null, d7Eligible: 0, d7Retained: 0, d7Rate: null });
const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);

function add(cell: RetentionCell, r: UserRetention): void {
  cell.signups++;
  if (r.d1 !== null) {
    cell.d1Eligible++;
    if (r.d1) cell.d1Retained++;
  }
  if (r.d7 !== null) {
    cell.d7Eligible++;
    if (r.d7) cell.d7Retained++;
  }
}

function finish(cell: RetentionCell): RetentionCell {
  return { ...cell, d1Rate: rate(cell.d1Retained, cell.d1Eligible), d7Rate: rate(cell.d7Retained, cell.d7Eligible) };
}

export interface RetentionReport {
  totals: RetentionCell;
  byPlatform: Array<{ platform: RetentionPlatform } & RetentionCell>;
  bySource: Array<{ source: string } & RetentionCell>;
  byPlatformSource: Array<{ platform: RetentionPlatform; source: string } & RetentionCell>;
  signalSince: string | null;
}

export function buildRetention(users: readonly RetentionUser[], opensByUser: ReadonlyMap<string, readonly OpenRow[]>, now: Date, signalSince: string | null): RetentionReport {
  const totals = emptyCell();
  const plat = new Map<RetentionPlatform, RetentionCell>();
  const src = new Map<string, RetentionCell>();
  const both = new Map<string, { platform: RetentionPlatform; source: string; cell: RetentionCell }>();
  for (const u of users) {
    const r = userRetention(u, opensByUser.get(u.userId) ?? [], now, signalSince);
    add(totals, r);
    if (!plat.has(u.platform)) plat.set(u.platform, emptyCell());
    add(plat.get(u.platform)!, r);
    if (!src.has(u.source)) src.set(u.source, emptyCell());
    add(src.get(u.source)!, r);
    const k = `${u.platform}\u0000${u.source}`;
    if (!both.has(k)) both.set(k, { platform: u.platform, source: u.source, cell: emptyCell() });
    add(both.get(k)!.cell, r);
  }
  const bySignups = <T extends { signups: number }>(a: T, b: T) => b.signups - a.signups;
  return {
    totals: finish(totals),
    byPlatform: [...plat].map(([platform, c]) => ({ platform, ...finish(c) })).sort(bySignups),
    bySource: [...src].map(([source, c]) => ({ source, ...finish(c) })).sort(bySignups),
    byPlatformSource: [...both.values()].map(({ platform, source, cell }) => ({ platform, source, ...finish(cell) })).sort(bySignups),
    signalSince,
  };
}

/** The platform a user is reported under: their first recorded open, else attribution / push device, else unknown. */
export function userPlatform(opens: readonly (OpenRow & { first_open_at?: string })[], fallback: string | null | undefined): RetentionPlatform {
  const known = opens.filter((o) => o.platform === 'ios' || o.platform === 'android' || o.platform === 'web');
  if (known.length) {
    const first = [...known].sort((a, b) => (a.local_date + (a.first_open_at ?? '')).localeCompare(b.local_date + (b.first_open_at ?? '')))[0];
    return first.platform as RetentionPlatform;
  }
  return fallback === 'ios' || fallback === 'android' || fallback === 'web' ? fallback : 'unknown';
}

/** Acquisition source: a referral invitee is 'invite'; else the attribution channel; else 'unknown'. */
export function userSource(isInvitee: boolean, channel: string | null | undefined): string {
  if (isInvitee) return 'invite';
  return channel && channel.trim() ? channel : 'unknown';
}
