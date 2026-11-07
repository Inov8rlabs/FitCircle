/**
 * security_events: one row per security decision (docs/SECURITY_TELEMETRY.md).
 *
 * Every write also goes to Sentry as a structured log `security.<kind>` (warn for
 * blocks / fail-open / limits / failures, info for passes, passes sampled at 10 %)
 * and a `security.event` counter metric. A few product-level kinds also go to
 * Amplitude server-side (never raw IPs or emails).
 *
 * Privacy: no integrity tokens, the IP only as a /24 (IPv4) or /48 (IPv6) prefix,
 * and an account only as sha256(lower-cased email).
 *
 * Rate-limit floods are deduplicated: one row per (kind, ip prefix, route, minute)
 * whose `count` is incremented (dedupe_key unique; app-side increment, so two truly
 * concurrent hits can lose one increment; good enough for monitoring).
 *
 * Never throws; every sink is best-effort.
 */
import { createHash } from 'node:crypto';

import * as Sentry from '@sentry/nextjs';

import { trackServerEventInBackground } from '@/lib/analytics/amplitude-server';
import { AnalyticsEvents, type AnalyticsEventPayload, type SecurityAction, type SecurityResult } from '@/lib/analytics/events.generated';
import { parseAppBuild, parseClientPlatform } from '@/lib/experiments/request-info';
import { getClientIp } from '@/lib/http/client-ip';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { canonicalEmail } from '@/lib/validation/email-canonical';

export type SecurityKind =
  | 'integrity'
  | 'rate_limit'
  | 'signup'
  | 'signup_block'
  | 'login_failure'
  | 'referral_rejection'
  | 'free_ai_device_limit'
  | 'nonce_replay';

export type SecurityEventResult = 'pass' | 'attested' | 'block' | 'log_only' | 'fail_open' | 'bypass' | 'limited' | 'rejected';

export interface SecurityEventInput {
  kind: SecurityKind;
  result: SecurityEventResult;
  reason?: string | null;
  /** Integrity action / limiter name. */
  action?: string | null;
  /** Overrides the request path. */
  route?: string | null;
  userId?: string | null;
  deviceId?: string | null;
  /** Login failures: the email, hashed here (never stored or sent raw). */
  email?: string | null;
  verdict?: Record<string, unknown> | null;
  /** Deduplicate per (kind, ip prefix, route, minute) and count. */
  dedupe?: boolean;
  /** Extra Amplitude properties for kinds that go to Amplitude. */
  amplitude?: { limit?: number; used?: number };
}

type HeaderSource = { headers: { get(name: string): string | null }; url?: string };

/** IPv4 → /24, IPv6 → first 3 hextets (/48). Enough to group networks, not people. */
export function ipPrefix(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/i, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return v4.split('.').slice(0, 3).join('.') + '.0/24';
  if (ip.includes(':')) {
    const head = ip.split('::')[0].split(':').filter(Boolean);
    const groups = [...head, '0', '0', '0'].slice(0, 3);
    return groups.join(':').toLowerCase() + '::/48';
  }
  return null;
}

/** sha256 of the canonical mailbox (lower-cased; +tags and Gmail dots folded), hex. */
export function accountHash(email: string | null | undefined): string | null {
  const v = canonicalEmail(email) ?? (email ?? '').trim().toLowerCase();
  return v ? createHash('sha256').update(v, 'utf8').digest('hex') : null;
}

function routeOf(request: HeaderSource | null | undefined): string | null {
  if (!request?.url) return null;
  try {
    return new URL(request.url).pathname.slice(0, 200);
  } catch {
    return null;
  }
}

const cleanToken = (v: string | null | undefined, max = 64) => {
  const s = (v ?? '').trim().slice(0, max);
  return /^[A-Za-z0-9_.:-]+$/.test(s) ? s : null;
};

/** The row as stored. Pure; exported for tests. */
export function securityEventRow(request: HeaderSource | null | undefined, input: SecurityEventInput, now = new Date()) {
  const h = request?.headers;
  const country = (h?.get('x-vercel-ip-country') ?? '').trim().toUpperCase();
  const asn = (h?.get('x-vercel-ip-as-number') ?? '').trim();
  const route = (input.route ?? routeOf(request))?.slice(0, 200) ?? null;
  const prefix = h ? ipPrefix(getClientIp({ headers: h })) : null;
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  return {
    created_at: now.toISOString(),
    kind: input.kind,
    route,
    action: input.action ?? null,
    result: input.result,
    reason: input.reason ? String(input.reason).slice(0, 120) : null,
    platform: h ? parseClientPlatform(h.get('x-app-platform') ?? h.get('x-platform')) : null,
    app_version: (h?.get('x-app-version') ?? '').trim().slice(0, 32) || null,
    app_build: h ? parseAppBuild(h.get('x-app-build')) : null,
    user_id: input.userId ?? null,
    device_id: input.deviceId ?? null,
    account_hash: accountHash(input.email),
    ip_prefix: prefix,
    asn: /^\d{1,10}$/.test(asn) ? asn : null,
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    integrity_error: cleanToken(h?.get('x-integrity-error')),
    verdict: input.verdict ?? {},
    count: 1,
    dedupe_key: input.dedupe ? [input.kind, prefix ?? '-', route ?? '-', input.action ?? '-', minute].join('|') : null,
  };
}

type Row = ReturnType<typeof securityEventRow>;

async function writeRow(row: Row): Promise<void> {
  const supabase = createAdminSupabase();
  const { error } = await supabase.from('security_events').insert(row);
  if (!error) return;
  if (error.code === '23505' && row.dedupe_key) {
    const { data, error: readError } = await supabase.from('security_events').select('id, count').eq('dedupe_key', row.dedupe_key).maybeSingle();
    if (readError || !data) return;
    const { error: updateError } = await supabase
      .from('security_events')
      .update({ count: (Number((data as any).count) || 1) + 1 })
      .eq('id', (data as any).id);
    if (updateError) console.warn('[security] dedupe increment failed:', updateError.message);
    return;
  }
  console.warn('[security] event insert failed:', error.message);
}

const WARN_RESULTS: ReadonlySet<SecurityEventResult> = new Set(['block', 'fail_open', 'limited', 'rejected', 'log_only', 'bypass']);
const PASS_LOG_SAMPLE = 0.1;

/** Sentry structured log + counter. Never throws; never sends raw IP / email / token. */
export function emitToSentry(row: Row, random: () => number = Math.random): void {
  try {
    const attributes = {
      kind: row.kind,
      route: row.route ?? '',
      action: row.action ?? '',
      platform: row.platform ?? '',
      app_version: row.app_version ?? '',
      result: row.result,
      reason: row.reason ?? '',
      asn: row.asn ?? '',
      country: row.country ?? '',
      ip_prefix: row.ip_prefix ?? '',
      integrity_error: row.integrity_error ?? '',
    };
    const warn = WARN_RESULTS.has(row.result);
    if (warn) Sentry.logger?.warn?.(`security.${row.kind}`, attributes);
    else if (random() < PASS_LOG_SAMPLE) Sentry.logger?.info?.(`security.${row.kind}`, attributes);
    Sentry.metrics?.count?.('security.event', 1, {
      attributes: { kind: row.kind, result: row.result, reason: row.reason ?? '', platform: row.platform ?? '' },
    });
  } catch {
    // telemetry must never affect the request
  }
}

const ACTIONS: ReadonlySet<string> = new Set(['register', 'login', 'google', 'refresh', 'food_ai', 'fitzy', 'referral_claim', 'entitlement_sync']);
const SESSION_ACTIONS: ReadonlySet<string> = new Set(['register', 'login', 'google', 'refresh']);
const CHECKED_RESULTS: ReadonlySet<string> = new Set(['pass', 'block', 'fail_open', 'log_only', 'bypass']);

/** The Amplitude events for this row (product-level kinds only; never IP / email). Pure. */
export function amplitudeEventsFor(row: Row, input: SecurityEventInput): AnalyticsEventPayload[] {
  const platform = row.platform ?? undefined;
  const out: AnalyticsEventPayload[] = [];
  if (row.kind === 'integrity' && row.action && ACTIONS.has(row.action)) {
    const action = row.action as SecurityAction;
    if (SESSION_ACTIONS.has(action) && CHECKED_RESULTS.has(row.result)) {
      out.push(AnalyticsEvents.integrityChecked({ action, result: row.result as SecurityResult, reason: row.reason ?? undefined, platform }));
    }
    if (row.result === 'block') out.push(AnalyticsEvents.integrityBlocked({ action, reason: row.reason ?? 'unknown', platform }));
  }
  if (row.kind === 'signup_block') out.push(AnalyticsEvents.signupBlocked({ reason: row.reason ?? 'unknown', platform }));
  if (row.kind === 'referral_rejection') out.push(AnalyticsEvents.referralRejected({ reason: row.reason ?? 'unknown' }));
  if (row.kind === 'free_ai_device_limit') {
    out.push(AnalyticsEvents.freeAIDeviceLimitHit({ limit: input.amplitude?.limit ?? 0, used: input.amplitude?.used ?? 0 }));
  }
  return out;
}

/** Record one security event in every sink. Awaits only the DB write (one small insert). */
export async function recordSecurityEvent(request: HeaderSource | null | undefined, input: SecurityEventInput): Promise<void> {
  let row: Row;
  try {
    row = securityEventRow(request, input);
  } catch (err: any) {
    console.warn('[security] event build failed:', err?.message ?? err);
    return;
  }
  emitToSentry(row);
  try {
    for (const e of amplitudeEventsFor(row, input)) {
      trackServerEventInBackground(
        { event_type: e.name, user_id: row.user_id, device_id: row.device_id, event_properties: { ...e.properties } },
        e.name
      );
    }
  } catch {
    // never block on analytics
  }
  try {
    await writeRow(row);
  } catch (err: any) {
    console.warn('[security] event write threw:', err?.message ?? err);
  }
}
