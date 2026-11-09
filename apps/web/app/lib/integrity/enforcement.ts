/**
 * App-integrity enforcement (docs/INTEGRITY_CONTRACT.md).
 *
 * Applies to Android clients that declare `X-Client-Features: integrity_v1`. Others are
 * "legacy": never blocked here (rate limits still apply to them).
 *
 * Matrix (remote config `integrity_enforce_android`, default block):
 *   off   → no verification
 *   log   → verify and record; never block
 *   block → a failing check gets 403 INTEGRITY_FAILED {reason}
 *
 * Failure handling:
 *   - client faults (no token, bad device id, unknown/used nonce, token Google rejects,
 *     decoded verdict failing any check) → block
 *   - our / Google infrastructure (verifier not configured, token exchange, quota, 5xx,
 *     timeout, nonce store down) → fail OPEN: allow, log, Sentry (security=fail_open)
 *   - no token because of the PHONE's environment or a transient Play error (the client's
 *     X-Integrity-Error, see isDeviceEnvironmentError), while remote config
 *     `integrity_device_error_fail_open` is true (default) → device fail-open: allow and
 *     record (result fail_open, reason `device_error:<code>`), no Sentry exception; not
 *     counted as an infrastructure fail-open in reports or alerts.
 *
 * Bypass (resolveBypass), only after the identity is VERIFIED by the route:
 *   - integrity_bypass_user_ids: internal test accounts (login, refresh)
 *   - integrity_reviewer_emails: App Store / Play reviewers + pre-launch robots
 *     (exact emails: login, google, refresh; @domain entries: google only).
 *     Platform-agnostic: iOS App Attest will use the same list.
 *
 * Protected (non-session) calls accept a live device attestation for the session instead
 * of a token. Session-issuing calls (register/login/google/refresh) always need a token
 * and write the attestation for the new session (recordSessionAttestation).
 */
import * as Sentry from '@sentry/nextjs';
import jwt from 'jsonwebtoken';
import { NextResponse, type NextRequest } from 'next/server';

import { parseClientPlatform } from '@/lib/experiments/request-info';
import { RemoteConfigService } from '@/lib/remote-config/service';
import { recordSecurityEvent } from '@/lib/security/security-events';

import { findLiveAttestation, recordAttestation } from './attestations';
import {
  INTEGRITY_FEATURE,
  INTEGRITY_HEADERS,
  computeRequestHash,
  hasClientFeature,
  isWellFormedNonce,
  normalizeDeviceId,
  sha256Hex,
} from './contract';
import { consumeNonce, nonceIssuanceConfigured } from './nonce';
import { evaluateVerdict, playIntegrityClient, type VerdictSummary } from './play-integrity';

export type IntegrityAction =
  | 'register'
  | 'login'
  | 'google'
  | 'refresh'
  | 'food_ai'
  | 'fitzy'
  | 'referral_claim'
  | 'entitlement_sync';

/** Calls that issue a session: always need a fresh token. */
export const SESSION_ACTIONS: ReadonlySet<IntegrityAction> = new Set(['register', 'login', 'google', 'refresh']);
/** Calls whose block may be lifted by resolveBypass (the route verifies the identity first). */
export const BYPASS_ACTIONS: ReadonlySet<IntegrityAction> = new Set(['login', 'google', 'refresh']);
/** Calls where `integrity_bypass_user_ids` applies (google has no user id before the account exists). */
export const USER_BYPASS_ACTIONS: ReadonlySet<IntegrityAction> = new Set(['login', 'refresh']);

export type EnforceMode = 'block' | 'log' | 'off';

export type IntegrityFailReason =
  | 'missing_device_id'
  | 'missing_token'
  | 'nonce_invalid'
  | 'nonce_expired'
  | 'nonce_replayed'
  | 'token_invalid'
  | 'request_hash_mismatch'
  | 'stale_token'
  | 'package_mismatch'
  | 'cert_mismatch'
  | 'app_not_recognized'
  | 'device_integrity'
  | 'unlicensed';

export interface IntegrityDecision {
  allowed: boolean;
  /** legacy = not an integrity_v1 Android client; off = kill switch. */
  /**
   * device_error = no token because of the phone's environment (allowed, recorded, never
   * attested: every later protected call is checked again).
   */
  mode: 'legacy' | 'off' | 'verified' | 'attested' | 'fail_open' | 'device_error' | 'log_only' | 'blocked';
  /** Present when blocked. */
  response?: NextResponse;
  reason?: IntegrityFailReason;
  /** The X-Device-Id the decision was about (null for legacy). */
  deviceId: string | null;
  /** Device id proven by this decision (verified token or live verified attestation). */
  attestedDeviceId: string | null;
  verdict?: VerdictSummary;
  /** Blocked on a login / google / refresh whose identity may be on a bypass list (see resolveBypass). */
  bypassEligible?: boolean;
}

export interface CheckOptions {
  action: IntegrityAction;
  /** Authenticated user (protected calls). */
  userId?: string | null;
}

type HeaderSource = { headers: { get(name: string): string | null } };

const PLACEHOLDER_USER = '00000000-0000-0000-0000-000000000000';

/** Android + X-Client-Features integrity_v1. */
export function isIntegrityClient(request: HeaderSource): boolean {
  const platform = parseClientPlatform(request.headers.get('x-app-platform') ?? request.headers.get('x-platform'));
  return platform === 'android' && hasClientFeature(request.headers.get(INTEGRITY_HEADERS.clientFeatures), INTEGRITY_FEATURE);
}

export async function enforceMode(userId?: string | null): Promise<EnforceMode> {
  const v = await RemoteConfigService.enumValue('integrity_enforce_android', { userId: userId || PLACEHOLDER_USER, platform: 'android' });
  return v === 'log' || v === 'off' ? v : 'block';
}

export async function isBypassUser(userId: string): Promise<boolean> {
  const list = await RemoteConfigService.listValue('integrity_bypass_user_ids', { userId, platform: 'android' });
  return list.map((s) => s.toLowerCase()).includes(userId.toLowerCase());
}

/**
 * Exact email or `@domain` entry match (case-insensitive; a domain entry matches that
 * domain only, and only when `allowDomains`). Pure.
 */
export function matchesReviewerList(email: string | null | undefined, list: readonly string[], opts: { allowDomains?: boolean } = {}): boolean {
  const e = (email ?? '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at <= 0 || at === e.length - 1) return false;
  const domain = e.slice(at);
  return list.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    if (entry.startsWith('@')) return !!opts.allowDomains && domain === entry;
    return e === entry;
  });
}

/**
 * `integrity_reviewer_emails`: App Store / Play reviewers and pre-launch robots. The email
 * must come from a verified identity (password check, Google id token, our refresh token).
 * `@domain` entries need `allowDomains` (Google sign-in only: there Google proves the
 * mailbox; a password account's email is not proven while sign-up auto-confirms).
 * Platform-agnostic on purpose: the same list applies to iOS App Attest when it arrives.
 */
export async function isReviewerEmail(
  email: string,
  ctx: { userId?: string | null; platform?: 'ios' | 'android' | 'web' | null; allowDomains?: boolean } = {}
): Promise<boolean> {
  const list = await RemoteConfigService.listValue('integrity_reviewer_emails', { userId: ctx.userId || PLACEHOLDER_USER, platform: ctx.platform ?? 'android' });
  return matchesReviewerList(email, list, { allowDomains: ctx.allowDomains });
}

/** Remote config `integrity_device_error_fail_open` (default true; unreadable → true, the code default). */
export async function deviceErrorFailOpenEnabled(userId?: string | null): Promise<boolean> {
  try {
    const v = await RemoteConfigService.enumValue('integrity_device_error_fail_open', { userId: userId || PLACEHOLDER_USER, platform: 'android' });
    return v !== 'false';
  } catch {
    return true;
  }
}

const MESSAGE = "This device can't run FitCircle. Install FitCircle from Google Play on a device with Google Play services that isn't rooted.";

export function integrityFailedResponse(reason: IntegrityFailReason): NextResponse {
  return NextResponse.json(
    {
      success: false,
      data: null,
      code: 'INTEGRITY_FAILED',
      reason,
      message: MESSAGE,
      error: { code: 'INTEGRITY_FAILED', message: MESSAGE, details: { reason }, timestamp: new Date().toISOString() },
      meta: null,
    },
    { status: 403, headers: { 'Cache-Control': 'no-store' } }
  );
}

/** Session id (`sid`) of the request's bearer token. Auth must already be verified. */
export function sessionIdFromRequest(request: HeaderSource): string | null {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  return token ? sessionIdFromAccessToken(token) : null;
}

export function sessionIdFromAccessToken(token: string): string | null {
  try {
    const decoded = jwt.decode(token) as { sid?: unknown } | null;
    return typeof decoded?.sid === 'string' && decoded.sid ? decoded.sid : null;
  } catch {
    return null;
  }
}

/** userId claim of an access token we just issued. */
export function userIdFromAccessToken(token: string): string | null {
  try {
    const decoded = jwt.decode(token) as { userId?: unknown } | null;
    return typeof decoded?.userId === 'string' && decoded.userId ? decoded.userId : null;
  } catch {
    return null;
  }
}

async function bodySha256(request: NextRequest): Promise<string> {
  const buf = await request.clone().arrayBuffer();
  return sha256Hex(new Uint8Array(buf));
}

function requestPath(request: NextRequest): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return request.nextUrl?.pathname ?? '/';
  }
}

/** X-Integrity-Error: why the client has no token (e.g. `token_-6`, `nonce_unavailable`). */
export function clientIntegrityError(request: HeaderSource): string | null {
  const v = (request.headers.get(INTEGRITY_HEADERS.clientError) ?? '').trim().slice(0, 64);
  return /^[A-Za-z0-9_.:-]+$/.test(v) ? v : null;
}

/*
 * X-Integrity-Error classification (Android client: core/integrity/IntegrityManager.kt,
 * IntegrityInterceptor.kt). Formats: `prepare_<code>` / `token_<code>` (Play
 * StandardIntegrityErrorCode; non-Play exceptions arrive as -100), `prepare_timeout`,
 * `token_timeout`, `prepare_start`, `interrupted`, `token_provider_invalid`,
 * `nonce_unavailable` (handled separately), `disabled` (never sent with integrity_v1).
 *
 * DEVICE (fail open, logged): the phone's environment or a transient Play / network error.
 *   -3 NETWORK_ERROR, -8 TOO_MANY_REQUESTS, -9 CANNOT_BIND_TO_SERVICE,
 *   -12 GOOGLE_SERVER_UNAVAILABLE, -14 PLAY_STORE_VERSION_OUTDATED,
 *   -15 PLAY_SERVICES_VERSION_OUTDATED, -18 CLIENT_TRANSIENT_ERROR,
 *   -19 INTEGRITY_TOKEN_PROVIDER_INVALID (the client already re-prepared once),
 *   -100 INTERNAL_ERROR, prepare_timeout, token_timeout, prepare_start (SDK threw),
 *   interrupted, token_provider_invalid
 * BLOCK (missing_token): no Play / tampering / sideload signals, our own build bugs, and
 * anything unknown.
 *   -1 API_NOT_AVAILABLE, -2 PLAY_STORE_NOT_FOUND, -5 APP_NOT_INSTALLED,
 *   -6 PLAY_SERVICES_NOT_FOUND, -7 APP_UID_MISMATCH, -16 CLOUD_PROJECT_NUMBER_IS_INVALID,
 *   -17 REQUEST_HASH_TOO_LONG, any other code or string, no header at all.
 *
 * The header is client-controlled: a scripted client can claim a device error. Rate limits
 * still apply, every such request is recorded (`device_error:<code>`) for review, and remote
 * config `integrity_device_error_fail_open` = false turns this back into a block.
 */
const DEVICE_ERROR_CODES: ReadonlySet<number> = new Set([-3, -8, -9, -12, -14, -15, -18, -19, -100]);
const DEVICE_ERROR_STRINGS: ReadonlySet<string> = new Set(['prepare_timeout', 'token_timeout', 'prepare_start', 'interrupted', 'token_provider_invalid']);

/** Reason prefix of a device-environment fail-open (security_events.reason). */
export const DEVICE_ERROR_REASON_PREFIX = 'device_error:';

/** True when X-Integrity-Error names a device-environment / transient cause (fail open). Pure. */
export function isDeviceEnvironmentError(clientError: string | null | undefined): boolean {
  const v = (clientError ?? '').trim().toLowerCase();
  if (!v) return false;
  if (DEVICE_ERROR_STRINGS.has(v)) return true;
  const m = /^(prepare|token)_(-\d{1,4})$/.exec(v);
  return !!m && DEVICE_ERROR_CODES.has(Number(m[2]));
}

type IntegrityOutcome = 'pass' | 'block' | 'log_only' | 'fail_open' | 'bypass';

async function event(request: NextRequest, action: IntegrityAction, outcome: IntegrityOutcome, extra: { reason?: string | null; userId?: string | null; deviceId?: string | null; verdict?: VerdictSummary | Record<string, unknown> | null }) {
  const base = { action, userId: extra.userId ?? null, deviceId: extra.deviceId ?? null };
  // Awaited by callers: small inserts, and serverless may freeze after the response.
  await recordSecurityEvent(request, { kind: 'integrity', result: outcome, reason: extra.reason ?? null, verdict: (extra.verdict as Record<string, unknown>) ?? null, ...base });
  if (outcome === 'block' && action === 'register') {
    await recordSecurityEvent(request, { kind: 'signup_block', result: 'block', reason: `integrity_${extra.reason ?? 'failed'}`, ...base });
  }
  if (extra.reason === 'nonce_replayed' || extra.reason === 'reviewer:nonce_replayed') {
    await recordSecurityEvent(request, { kind: 'nonce_replay', result: outcome, reason: 'nonce_replayed', ...base });
  }
}

/** Stable class of a fail-open cause (Sentry fingerprint; no secrets in it). */
export function failOpenClass(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('not configured')) return 'verifier_not_configured';
  if (m.includes('google token')) return 'token_exchange';
  if (m.includes('timeout')) return 'decode_timeout';
  if (m.includes('decode http')) return 'decode_http';
  if (m.includes('nonce')) return 'nonce_store';
  if (m.includes('attestation')) return 'attestation_lookup';
  return 'unexpected';
}

function reportFailOpen(action: IntegrityAction, message: string) {
  console.error(`[integrity] fail-open on ${action}: ${message}`);
  try {
    const cls = failOpenClass(message);
    Sentry.captureException(new Error(`integrity fail-open: ${cls}`), {
      level: 'warning',
      tags: { security: 'fail_open', fail_open_reason: cls, integrity_action: action },
      fingerprint: ['security-fail-open', cls],
      extra: { message: message.slice(0, 200) },
    });
  } catch {
    // Sentry is best-effort
  }
}

/**
 * Decide one request. Never throws: an unexpected error is an infrastructure error
 * (fail open).
 */
export async function checkIntegrity(request: NextRequest, opts: CheckOptions): Promise<IntegrityDecision> {
  if (!isIntegrityClient(request)) return { allowed: true, mode: 'legacy', deviceId: null, attestedDeviceId: null };
  const { action } = opts;
  const userId = opts.userId ?? null;
  const deviceId = normalizeDeviceId(request.headers.get(INTEGRITY_HEADERS.deviceId));
  const clientError = clientIntegrityError(request);

  let mode: EnforceMode;
  try {
    mode = await enforceMode(userId);
  } catch {
    mode = 'block';
  }
  if (mode === 'off') return { allowed: true, mode: 'off', deviceId, attestedDeviceId: null };

  const fail = async (reason: IntegrityFailReason, verdict?: VerdictSummary): Promise<IntegrityDecision> => {
    if (mode === 'log') {
      await event(request, action, 'log_only', { reason, userId, deviceId, verdict });
      return { allowed: true, mode: 'log_only', reason, deviceId, attestedDeviceId: null, verdict };
    }
    const bypassEligible = BYPASS_ACTIONS.has(action);
    // A bypass-eligible block records its event in resolveBypass.
    if (!bypassEligible) await event(request, action, 'block', { reason, userId, deviceId, verdict });
    return { allowed: false, mode: 'blocked', reason, response: integrityFailedResponse(reason), deviceId, attestedDeviceId: null, verdict, bypassEligible };
  };

  const failOpen = async (message: string): Promise<IntegrityDecision> => {
    reportFailOpen(action, message);
    await event(request, action, 'fail_open', { reason: message.slice(0, 120), userId, deviceId });
    return { allowed: true, mode: 'fail_open', deviceId, attestedDeviceId: null };
  };

  // The phone could not produce a token for an environmental / transient reason: allow and
  // record. No Sentry exception (security=fail_open means OUR infrastructure is broken).
  const deviceFailOpen = async (code: string): Promise<IntegrityDecision> => {
    await event(request, action, 'fail_open', { reason: `${DEVICE_ERROR_REASON_PREFIX}${code}`, userId, deviceId });
    return { allowed: true, mode: 'device_error', deviceId, attestedDeviceId: null };
  };

  try {
    if (!deviceId) return await fail('missing_device_id');

    // Protected calls: a live attestation for this session + device is enough.
    let attestationLookupFailed = false;
    if (!SESSION_ACTIONS.has(action) && userId) {
      const sid = sessionIdFromRequest(request);
      if (sid) {
        const live = await findLiveAttestation(userId, sid, deviceId);
        if (live === 'verified' || live === 'fail_open') {
          return { allowed: true, mode: 'attested', deviceId, attestedDeviceId: live === 'verified' ? deviceId : null };
        }
        attestationLookupFailed = live === 'error';
      }
    }

    const token = (request.headers.get(INTEGRITY_HEADERS.token) ?? '').trim();
    const nonce = (request.headers.get(INTEGRITY_HEADERS.nonce) ?? '').trim();
    if (!token) {
      if (attestationLookupFailed) return await failOpen('attestation lookup failed');
      // The device could not produce a token. A block, except: a nonce we could not issue
      // (our signing secret is missing) and device-environment errors (see above).
      if (clientError === 'nonce_unavailable' && !nonceIssuanceConfigured()) return await failOpen('nonce issuance not configured');
      if (clientError && isDeviceEnvironmentError(clientError) && (await deviceErrorFailOpenEnabled(userId))) return await deviceFailOpen(clientError);
      return await fail('missing_token');
    }
    if (!isWellFormedNonce(nonce)) return await fail('nonce_invalid');

    const client = playIntegrityClient();
    if (!client.isConfigured()) return await failOpen('verifier not configured');

    // Hash the raw body bytes before anything parses them (multipart included).
    const path = requestPath(request);
    const bodyHash = await bodySha256(request);
    const consumed = await consumeNonce(nonce, deviceId, { path, bodySha256: bodyHash });
    if (consumed === 'error') return await failOpen('nonce store unavailable');
    if (consumed === 'expired') return await fail('nonce_expired');
    if (consumed === 'replayed') return await fail('nonce_replayed');
    if (consumed !== 'ok') return await fail('nonce_invalid');

    const expectedHash = computeRequestHash({ method: request.method, path, bodySha256: bodyHash, nonce, deviceId });

    const decoded = await client.decode(token);
    if (decoded.kind === 'infra') return await failOpen(decoded.message);
    if (decoded.kind === 'client') return await fail('token_invalid');

    const cfg = client.config!;
    const result = evaluateVerdict(decoded.payload, {
      requestHash: expectedHash,
      packageName: cfg.packageName,
      certDigests: cfg.certDigests,
      nowMs: Date.now(),
    });
    if (!result.pass) return await fail(result.reason, result.summary);

    await event(request, action, 'pass', { userId, deviceId, verdict: result.summary });
    return { allowed: true, mode: 'verified', deviceId, attestedDeviceId: deviceId, verdict: result.summary };
  } catch (err: any) {
    return await failOpen(err?.message ?? 'unexpected error');
  }
}

/** A VERIFIED identity (password check, Google id token, our refresh token). */
export interface BypassIdentity {
  userId?: string | null;
  /** Only from a verified source: never a request-body claim (e.g. register). */
  email?: string | null;
}

/**
 * Login, google and refresh: once the caller has a VERIFIED identity, a blocked request is
 * allowed for
 *   - a user on `integrity_bypass_user_ids` (login + refresh), event `bypass:<reason>`
 *   - an email on `integrity_reviewer_emails`, event `bypass:reviewer:<reason>`: exact
 *     entries on login, google, refresh; `@domain` entries on google only
 * Callers must still return the 403 for every other identity, whether or not the
 * credential was right. Accepts a bare user id (older call sites).
 */
export async function resolveBypass(
  request: NextRequest,
  decision: IntegrityDecision,
  identity: string | null | BypassIdentity,
  action: IntegrityAction = 'login'
): Promise<boolean> {
  if (decision.allowed || !decision.bypassEligible) return decision.allowed;
  const id: BypassIdentity = typeof identity === 'string' || identity === null ? { userId: identity } : identity;
  const userId = id.userId ?? null;
  const userBypass = !!userId && USER_BYPASS_ACTIONS.has(action) ? await isBypassUser(userId).catch(() => false) : false;
  const platform = parseClientPlatform(request.headers.get('x-app-platform') ?? request.headers.get('x-platform'));
  const reviewer = !userBypass && id.email ? await isReviewerEmail(id.email, { userId, platform, allowDomains: action === 'google' }).catch(() => false) : false;
  const bypass = userBypass || reviewer;
  const reason = reviewer ? `reviewer:${decision.reason ?? 'failed'}` : (decision.reason ?? null);
  await event(request, action, bypass ? 'bypass' : 'block', { reason, userId, deviceId: decision.deviceId, verdict: decision.verdict });
  return bypass;
}

/** Login: the user id (and the account's email) come from the password check. */
export function resolveLoginBypass(request: NextRequest, decision: IntegrityDecision, identity: string | null | BypassIdentity): Promise<boolean> {
  return resolveBypass(request, decision, identity, 'login');
}

/**
 * After a session-issuing call succeeds: bind the device to the new session. A verified
 * token → 24 h attestation; a fail-open → short `fail_open` attestation so the session
 * is not blocked on its next protected call while verification is down.
 */
export async function recordSessionAttestation(
  request: NextRequest,
  decision: IntegrityDecision,
  session: { userId: string; accessToken: string }
): Promise<void> {
  if (decision.mode !== 'verified' && decision.mode !== 'fail_open') return;
  if (!decision.deviceId) return;
  const sessionId = sessionIdFromAccessToken(session.accessToken);
  if (!sessionId) return;
  await recordAttestation({
    userId: session.userId,
    sessionId,
    deviceId: decision.deviceId,
    status: decision.mode === 'verified' ? 'verified' : 'fail_open',
    verdict: decision.verdict ?? {},
    appVersion: (request.headers.get('x-app-version') ?? '').trim().slice(0, 32) || null,
  });
}
