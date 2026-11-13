/**
 * Security reporting over security_events (docs/SECURITY_TELEMETRY.md): tiles, time
 * series, top offenders, failed logins per account, the alert signals and the attack
 * status. Aggregation is in TypeScript over the rows of a window (no stored procedures);
 * a window is capped at MAX_ROWS rows (rate-limit floods are already one row per
 * prefix/route/limiter/minute).
 */
import { createAdminSupabase } from '@/lib/supabase-admin';

import type { SecurityEventResult, SecurityKind } from './security-events';

export const MAX_ROWS = 50_000;
const PAGE = 1000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface EventRow {
  id?: string;
  created_at: string;
  kind: SecurityKind;
  result: SecurityEventResult;
  reason: string | null;
  action: string | null;
  route: string | null;
  platform: string | null;
  app_version: string | null;
  user_id: string | null;
  device_id: string | null;
  account_hash: string | null;
  ip_prefix: string | null;
  asn: string | null;
  country: string | null;
  integrity_error: string | null;
  count: number;
}

const COLUMNS = 'created_at, kind, result, reason, action, route, platform, app_version, user_id, device_id, account_hash, ip_prefix, asn, country, integrity_error, count';

/** Rows with since <= created_at < until, newest first, at most MAX_ROWS. */
export async function loadEvents(since: Date, until: Date = new Date(), filter: { kind?: SecurityKind } = {}): Promise<{ rows: EventRow[]; truncated: boolean }> {
  const supabase = createAdminSupabase();
  const rows: EventRow[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q = supabase.from('security_events').select(COLUMNS).gte('created_at', since.toISOString()).lt('created_at', until.toISOString());
    if (filter.kind) q = q.eq('kind', filter.kind);
    const { data, error } = await q.order('created_at', { ascending: false }).range(from, from + PAGE - 1);
    if (error) throw new Error(`security_events: ${error.message}`);
    rows.push(...((data ?? []) as EventRow[]));
    if ((data ?? []).length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

const n = (r: EventRow) => (Number.isFinite(r.count) && r.count > 0 ? r.count : 1);
const sum = (rows: EventRow[], pred: (r: EventRow) => boolean) => rows.reduce((acc, r) => (pred(r) ? acc + n(r) : acc), 0);

// ---------------------------------------------------------------------------- tiles

export interface Tiles {
  integrityAttempts: number;
  integrityPasses: number;
  integrityPassRate: number | null;
  integrityBlocks: number;
  /** Infrastructure fail-opens only (our verifier / Google / nonce store): the alert signal. */
  failOpens: number;
  /** Device-environment fail-opens (outdated Play Store, ...): reason `device_error:<code>`; never alerts. */
  deviceErrorFailOpens: number;
  rateLimitHits: number;
  failedLogins: number;
  signupBlocks: number;
  referralRejections: number;
  freeAiDeviceLimitHits: number;
  /** Extras (not tiles on the page today). */
  signups: number;
  nonceReplays: number;
}

/** Integrity attempts = decisions that verified something (cheap attested passes are not logged). */
const isIntegrityAttempt = (r: EventRow) => r.kind === 'integrity' && ['pass', 'block', 'fail_open', 'log_only', 'bypass'].includes(r.result);
const isIntegrityBlock = (r: EventRow) => r.kind === 'integrity' && (r.result === 'block' || r.result === 'log_only');
/** Matches DEVICE_ERROR_REASON_PREFIX in lib/integrity/enforcement.ts. */
const DEVICE_ERROR_PREFIX = 'device_error:';
const isDeviceErrorReason = (reason: string | null | undefined) => (reason ?? '').startsWith(DEVICE_ERROR_PREFIX);
/** A fail-open caused by OUR infrastructure (or Google's verifier), not by the phone. */
export const isInfraFailOpen = (r: Pick<EventRow, 'kind' | 'result' | 'reason'>) => r.kind === 'integrity' && r.result === 'fail_open' && !isDeviceErrorReason(r.reason);
/** A fail-open because the phone could not produce a token (client X-Integrity-Error). */
export const isDeviceErrorFailOpen = (r: Pick<EventRow, 'kind' | 'result' | 'reason'>) => r.kind === 'integrity' && r.result === 'fail_open' && isDeviceErrorReason(r.reason);

export function tiles(rows: EventRow[]): Tiles {
  const attempts = sum(rows, isIntegrityAttempt);
  const passes = sum(rows, (r) => r.kind === 'integrity' && r.result === 'pass');
  return {
    integrityAttempts: attempts,
    integrityPasses: passes,
    integrityPassRate: attempts > 0 ? passes / attempts : null,
    integrityBlocks: sum(rows, isIntegrityBlock),
    failOpens: sum(rows, isInfraFailOpen),
    deviceErrorFailOpens: sum(rows, isDeviceErrorFailOpen),
    rateLimitHits: sum(rows, (r) => r.kind === 'rate_limit'),
    failedLogins: sum(rows, (r) => r.kind === 'login_failure'),
    signupBlocks: sum(rows, (r) => r.kind === 'signup_block'),
    referralRejections: sum(rows, (r) => r.kind === 'referral_rejection'),
    freeAiDeviceLimitHits: sum(rows, (r) => r.kind === 'free_ai_device_limit'),
    signups: sum(rows, (r) => r.kind === 'signup'),
    nonceReplays: sum(rows, (r) => r.kind === 'nonce_replay'),
  };
}

// ---------------------------------------------------------------------------- series + offenders

export interface SeriesPoint {
  hour: string;
  counts: Record<string, number>;
}

/** Hourly buckets (oldest first), counts per kind; hours with no events are omitted. */
export function hourlySeries(rows: EventRow[]): SeriesPoint[] {
  const buckets = new Map<number, Record<string, number>>();
  for (const r of rows) {
    const t = Math.floor(Date.parse(r.created_at) / HOUR) * HOUR;
    const b = buckets.get(t) ?? {};
    b[r.kind] = (b[r.kind] ?? 0) + n(r);
    buckets.set(t, b);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([t, counts]) => ({ hour: new Date(t).toISOString(), counts }));
}

export type OffenderColumn = 'asn' | 'ip_prefix' | 'country' | 'device_id';
export const OFFENDER_COLUMNS: Record<'asn' | 'ipPrefix' | 'country' | 'deviceId', OffenderColumn> = {
  asn: 'asn',
  ipPrefix: 'ip_prefix',
  country: 'country',
  deviceId: 'device_id',
};

export interface OffenderRow {
  key: string;
  label?: string | null;
  count: number;
  lastSeen: string | null;
  kinds: Record<string, number>;
}

/** Blocked / failed / limited rows only (never passes). */
export const isAdverse = (r: EventRow) => ['block', 'log_only', 'rejected', 'limited'].includes(r.result) || r.kind === 'nonce_replay';

export function topOffenders(rows: EventRow[], column: OffenderColumn, limit = 20): OffenderRow[] {
  const map = new Map<string, OffenderRow>();
  for (const r of rows) {
    if (!isAdverse(r)) continue;
    const key = r[column];
    if (!key) continue;
    const o = map.get(key) ?? { key, count: 0, lastSeen: r.created_at, kinds: {} };
    o.count += n(r);
    o.kinds[r.kind] = (o.kinds[r.kind] ?? 0) + n(r);
    if (!o.lastSeen || r.created_at > o.lastSeen) o.lastSeen = r.created_at;
    map.set(key, o);
  }
  return Array.from(map.values())
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1))
    .slice(0, limit);
}

export interface FailedLoginRow {
  accountHash: string;
  count: number;
  lastSeen: string | null;
  distinctIpPrefixes: number;
}

export function failedLoginsByAccount(rows: EventRow[], limit = 50): FailedLoginRow[] {
  const map = new Map<string, { count: number; prefixes: Set<string>; lastSeen: string }>();
  for (const r of rows) {
    if (r.kind !== 'login_failure' || !r.account_hash) continue;
    const e = map.get(r.account_hash) ?? { count: 0, prefixes: new Set<string>(), lastSeen: r.created_at };
    e.count += n(r);
    if (r.ip_prefix) e.prefixes.add(r.ip_prefix);
    if (r.created_at > e.lastSeen) e.lastSeen = r.created_at;
    map.set(r.account_hash, e);
  }
  return Array.from(map.entries())
    .map(([accountHash, e]) => ({ accountHash, count: e.count, lastSeen: e.lastSeen, distinctIpPrefixes: e.prefixes.size }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------- integrity health

/**
 * Reasons that mean the client sent NO token (so a missing pass is not our verifier's
 * fault): missing_token / missing_device_id blocks (also behind bypass:… / reviewer:…),
 * device-environment fail-opens, and the two token-less fail-opens.
 */
const NO_TOKEN_REASONS = new Set(['missing_token', 'missing_device_id', 'attestation lookup failed', 'nonce issuance not configured']);
export function isTokenlessReason(reason: string | null | undefined): boolean {
  const r = (reason ?? '').replace(/^(bypass:)?(reviewer:)?/, '');
  return NO_TOKEN_REASONS.has(r) || isDeviceErrorReason(r);
}
/** An integrity attempt where the client sent a Play Integrity token (we had something to verify). */
export const isTokenAttempt = (r: EventRow) => isIntegrityAttempt(r) && !isTokenlessReason(r.reason);

/** `integrity_broken` thresholds (docs/INTEGRITY_CONTRACT.md, "Detection"). */
export const INTEGRITY_HEALTH = {
  /** Token attempts per action (24 h) before "0 passes" means broken. */
  minTokenAttempts: 3,
  /** Infrastructure fail-open share of an action's attempts (24 h) that means broken. */
  maxFailOpenShare: 0.5,
  /** Release check (scripts/smoke/prod-smoke.mjs): stricter share. */
  releaseMaxFailOpenShare: 0.2,
} as const;

export interface IntegrityActionHealth {
  action: string;
  attempts: number;
  tokenAttempts: number;
  passes: number;
  infraFailOpens: number;
  /** infraFailOpens / attempts (null without attempts). */
  failOpenShare: number | null;
  /** Most common infra fail-open reason (e.g. `unusable`), for the alert text. */
  topFailOpenReason: string | null;
  broken: boolean;
  why: string[];
}

/**
 * Per action: is verification actually working? Broken when ≥ minTokenAttempts attempts
 * with a token and 0 passes (the verifier never says yes: 2026-11-11), or when infra
 * fail-opens are ≥ maxFailOpenShare of the attempts (with at least minTokenAttempts
 * attempts). Device-environment fail-opens never count as infra. Pure.
 */
export function integrityHealth(rows: EventRow[], opts: { maxFailOpenShare?: number; minTokenAttempts?: number } = {}): IntegrityActionHealth[] {
  const maxShare = opts.maxFailOpenShare ?? INTEGRITY_HEALTH.maxFailOpenShare;
  const minTok = opts.minTokenAttempts ?? INTEGRITY_HEALTH.minTokenAttempts;
  const by = new Map<string, EventRow[]>();
  for (const r of rows) {
    if (!isIntegrityAttempt(r)) continue;
    const a = r.action ?? 'unknown';
    by.set(a, [...(by.get(a) ?? []), r]);
  }
  return Array.from(by.entries())
    .map(([action, rs]) => {
      const attempts = sum(rs, () => true);
      const tokenAttempts = sum(rs, isTokenAttempt);
      const passes = sum(rs, (r) => r.result === 'pass');
      const infraFailOpens = sum(rs, isInfraFailOpen);
      const failOpenShare = attempts > 0 ? infraFailOpens / attempts : null;
      const reasons = new Map<string, number>();
      for (const r of rs) if (isInfraFailOpen(r)) reasons.set(r.reason ?? '', (reasons.get(r.reason ?? '') ?? 0) + n(r));
      const topFailOpenReason = Array.from(reasons.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const why: string[] = [];
      if (tokenAttempts >= minTok && passes === 0) why.push(`${tokenAttempts} attempts with a token, 0 passes`);
      if (attempts >= minTok && failOpenShare !== null && failOpenShare >= maxShare) {
        why.push(`${Math.round(failOpenShare * 100)}% infra fail-open (${infraFailOpens}/${attempts}${topFailOpenReason ? `, mostly "${topFailOpenReason}"` : ''})`);
      }
      return { action, attempts, tokenAttempts, passes, infraFailOpens, failOpenShare, topFailOpenReason, broken: why.length > 0, why };
    })
    .sort((a, b) => (a.action < b.action ? -1 : 1));
}

// ---------------------------------------------------------------------------- alert signals

export type AttackLevel = 'normal' | 'elevated' | 'under_attack';
export type SignalLevel = Exclude<AttackLevel, 'normal'>;
export type SignalId =
  | 'failed_logins'
  | 'signup_concentration'
  | 'integrity_block_rate'
  | 'fail_open'
  | 'integrity_broken'
  | 'rate_limit_hits'
  | 'referral_rejections';

/**
 * Spec thresholds ("alert when value > threshold"). A signal is `under_attack` when the
 * value is above ATTACK_MULTIPLIER × threshold (block rate: above 30 %; fail-open: above 50).
 */
export const THRESHOLDS = {
  failed_logins_total: 50, // per hour
  failed_logins_account: 10, // per hour, one account
  failed_logins_ip_prefix: 20, // per hour, one IP prefix
  signups_per_asn: 5, // per hour
  signups_per_ip_prefix: 5, // per hour
  integrity_block_rate: 0.1, // last hour, with at least MIN_INTEGRITY_ATTEMPTS attempts
  fail_open: 0, // last 15 minutes
  rate_limit_hits: 500, // per hour
  referral_rejections: 5, // per 24 hours
} as const;
export const ATTACK_MULTIPLIER = 3;
export const MIN_INTEGRITY_ATTEMPTS = 20;

export interface Signal {
  signal: SignalId;
  level: SignalLevel;
  value: number;
  threshold: number;
  /** Which account hash prefix / IP prefix / ASN tripped it, or the sub-check. */
  detail?: string | null;
  /** 7-day average of the same measure (per hour; referral rejections per day), when known. */
  baseline?: number | null;
}

function maxBy(rows: EventRow[], pred: (r: EventRow) => boolean, key: (r: EventRow) => string | null): { key: string; value: number } | null {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!pred(r)) continue;
    const k = key(r);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + n(r));
  }
  let best: { key: string; value: number } | null = null;
  for (const [k, v] of m) if (!best || v > best.value) best = { key: k, value: v };
  return best;
}

export interface SignalInput {
  /** Last 60 minutes. */
  hour: EventRow[];
  /** Last 15 minutes. */
  quarter: EventRow[];
  /** Last 24 hours. */
  day: EventRow[];
  baseline?: Partial<Record<SignalId, number>>;
}

interface Check {
  value: number;
  threshold: number;
  detail: string;
  attackAt?: number;
}

/** The worst check (highest value/threshold ratio) above its threshold, as one signal. */
function worst(signal: SignalId, checks: Check[], baseline?: number | null): Signal | null {
  const firing = checks.filter((c) => c.value > c.threshold);
  if (!firing.length) return null;
  const ratio = (c: Check) => (c.threshold > 0 ? c.value / c.threshold : c.value + 1);
  const c = firing.sort((a, b) => ratio(b) - ratio(a))[0];
  const attackAt = c.attackAt ?? c.threshold * ATTACK_MULTIPLIER;
  return { signal, level: c.value > attackAt ? 'under_attack' : 'elevated', value: c.value, threshold: c.threshold, detail: c.detail, baseline: baseline ?? null };
}

/** Pure: every signal above its threshold. */
export function evaluateSignals(input: SignalInput): Signal[] {
  const out: (Signal | null)[] = [];
  const b = input.baseline ?? {};
  const failure = (r: EventRow) => r.kind === 'login_failure';
  const acct = maxBy(input.hour, failure, (r) => r.account_hash);
  const fip = maxBy(input.hour, failure, (r) => r.ip_prefix);
  out.push(
    worst(
      'failed_logins',
      [
        { value: sum(input.hour, failure), threshold: THRESHOLDS.failed_logins_total, detail: 'all accounts, last hour' },
        ...(acct ? [{ value: acct.value, threshold: THRESHOLDS.failed_logins_account, detail: `account ${acct.key.slice(0, 12)}` }] : []),
        ...(fip ? [{ value: fip.value, threshold: THRESHOLDS.failed_logins_ip_prefix, detail: fip.key }] : []),
      ],
      b.failed_logins
    )
  );

  const signup = (r: EventRow) => r.kind === 'signup';
  const sasn = maxBy(input.hour, signup, (r) => r.asn);
  const sip = maxBy(input.hour, signup, (r) => r.ip_prefix);
  out.push(
    worst('signup_concentration', [
      ...(sasn ? [{ value: sasn.value, threshold: THRESHOLDS.signups_per_asn, detail: `AS ${sasn.key}` }] : []),
      ...(sip ? [{ value: sip.value, threshold: THRESHOLDS.signups_per_ip_prefix, detail: sip.key }] : []),
    ])
  );

  const attempts = sum(input.hour, isIntegrityAttempt);
  if (attempts >= MIN_INTEGRITY_ATTEMPTS) {
    const rate = sum(input.hour, isIntegrityBlock) / attempts;
    out.push(worst('integrity_block_rate', [{ value: rate, threshold: THRESHOLDS.integrity_block_rate, detail: `${attempts} attempts, last hour`, attackAt: 0.3 }]));
  }
  out.push(
    worst(
      'fail_open',
      // Infrastructure only: device-environment fail-opens are expected and never alert.
      [{ value: sum(input.quarter, isInfraFailOpen), threshold: THRESHOLDS.fail_open, detail: 'last 15 minutes', attackAt: 50 }],
      b.fail_open
    )
  );
  // Verification broken for some action over 24 h (2026-11-11: every auth call failed open
  // for two days while the 15-minute fail_open signal looked like noise).
  const broken = integrityHealth(input.day).filter((a) => a.broken);
  if (broken.length) {
    out.push({
      signal: 'integrity_broken',
      level: 'elevated',
      value: broken.length,
      threshold: 0,
      detail: broken.map((a) => `${a.action}: ${a.why.join('; ')}`).join(' | ') + ' (last 24 hours)',
      baseline: null,
    });
  }
  out.push(worst('rate_limit_hits', [{ value: sum(input.hour, (r) => r.kind === 'rate_limit'), threshold: THRESHOLDS.rate_limit_hits, detail: 'last hour' }], b.rate_limit_hits));
  out.push(
    worst(
      'referral_rejections',
      [{ value: sum(input.day, (r) => r.kind === 'referral_rejection' && r.result === 'rejected'), threshold: THRESHOLDS.referral_rejections, detail: 'last 24 hours' }],
      b.referral_rejections
    )
  );
  return out.filter((s): s is Signal => !!s);
}

export function attackLevel(signals: Signal[]): AttackLevel {
  if (signals.some((s) => s.level === 'under_attack')) return 'under_attack';
  return signals.length > 0 ? 'elevated' : 'normal';
}

/** 7-day baselines per measure (hourly averages; referral rejections per day). */
export async function loadBaselines(now: Date = new Date()): Promise<Partial<Record<SignalId, number>>> {
  const supabase = createAdminSupabase();
  const since = new Date(now.getTime() - 7 * DAY).toISOString();
  const until = new Date(now.getTime() - HOUR).toISOString();
  const countKind = async (kind: SecurityKind, result?: SecurityEventResult, keep?: (r: { kind: SecurityKind; result: SecurityEventResult; reason: string | null }) => boolean) => {
    let q = supabase.from('security_events').select('count, reason').eq('kind', kind).gte('created_at', since).lt('created_at', until);
    if (result) q = q.eq('result', result);
    const { data, error } = await q.limit(MAX_ROWS);
    if (error) return null;
    return ((data ?? []) as Array<{ count: number; reason: string | null }>)
      .filter((r) => !keep || keep({ kind, result: result ?? ('' as SecurityEventResult), reason: r.reason ?? null }))
      .reduce((a, r) => a + (Number(r.count) || 1), 0);
  };
  const [logins, limits, referrals, failOpen] = await Promise.all([
    countKind('login_failure'),
    countKind('rate_limit'),
    countKind('referral_rejection', 'rejected'),
    countKind('integrity', 'fail_open', isInfraFailOpen),
  ]);
  const hours = 7 * 24 - 1;
  const out: Partial<Record<SignalId, number>> = {};
  if (logins !== null) out.failed_logins = logins / hours;
  if (limits !== null) out.rate_limit_hits = limits / hours;
  if (referrals !== null) out.referral_rejections = referrals / 7;
  if (failOpen !== null) out.fail_open = failOpen / (hours * 4);
  return out;
}

/** Signals + level for "now" (the three windows and the baselines). */
export async function currentSignals(now: Date = new Date()): Promise<{ signals: Signal[]; level: AttackLevel; hourRows: EventRow[]; truncated: boolean }> {
  const day = await loadEvents(new Date(now.getTime() - DAY), now);
  const hour = day.rows.filter((r) => Date.parse(r.created_at) >= now.getTime() - HOUR);
  const quarter = hour.filter((r) => Date.parse(r.created_at) >= now.getTime() - 15 * 60_000);
  const baseline = await loadBaselines(now).catch(() => ({}));
  const signals = evaluateSignals({ hour, quarter, day: day.rows, baseline });
  return { signals, level: attackLevel(signals), hourRows: hour, truncated: day.truncated };
}
