/**
 * Enforcement matrix (docs/INTEGRITY_CONTRACT.md): legacy vs integrity_v1, kill switch
 * off / log / block, fail-open (infrastructure) vs fail-closed (client faults and failing
 * verdicts), the login bypass list, and live session attestations.
 */
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  mode: 'block' as string,
  deviceFailOpen: 'true' as string,
  internalPolicy: 'block' as string,
  bypass: [] as string[],
  reviewers: [] as string[],
  listCalls: [] as any[],
  live: 'none' as string,
  consume: 'ok' as string,
  nonceConfigured: true,
  decode: { kind: 'decoded', payload: {} } as any,
  verdictPass: true,
  verdictReason: 'device_integrity',
  configured: true,
  events: [] as any[],
  attestations: [] as any[],
  sentry: [] as any[],
  lastExpectedHash: null as string | null,
}));

vi.mock('@/lib/remote-config/service', () => ({
  RemoteConfigService: {
    enumValue: async (key: string) =>
      key === 'integrity_device_error_fail_open' ? h.deviceFailOpen : key === 'integrity_internal_error_policy' ? h.internalPolicy : h.mode,
    listValue: async (key: string, ctx: any) => {
      h.listCalls.push({ key, ctx });
      return key === 'integrity_reviewer_emails' ? h.reviewers : h.bypass;
    },
  },
}));
vi.mock('../attestations', () => ({
  findLiveAttestation: async () => h.live,
  recordAttestation: async (a: any) => void h.attestations.push(a),
}));
vi.mock('../nonce', () => ({
  consumeNonce: async () => h.consume,
  nonceIssuanceConfigured: () => h.nonceConfigured,
}));
vi.mock('@/lib/security/security-events', () => ({ recordSecurityEvent: async (_r: unknown, e: any) => void h.events.push(e) }));
vi.mock('@sentry/nextjs', () => ({ captureException: (e: Error, ctx: any) => void h.sentry.push({ message: e.message, ...ctx }) }));
vi.mock('../play-integrity', async (importOriginal) => {
  const original: any = await importOriginal();
  return {
    ...original,
    evaluateVerdict: (_p: unknown, expected: any) => {
      h.lastExpectedHash = expected.requestHash;
      return h.verdictPass
        ? { pass: true, summary: { appRecognition: 'PLAY_RECOGNIZED', deviceRecognition: ['MEETS_DEVICE_INTEGRITY'], licensing: 'LICENSED', versionCode: '1', tokenAgeMs: 1 } }
        : { pass: false, reason: h.verdictReason, summary: { appRecognition: 'PLAY_RECOGNIZED', deviceRecognition: [], licensing: 'LICENSED', versionCode: '1', tokenAgeMs: 1 } };
    },
    playIntegrityClient: () => ({
      isConfigured: () => h.configured,
      config: { packageName: 'com.inov8rlabs.apps.fitcircle', certDigests: ['x'] },
      decode: async () => h.decode,
    }),
  };
});

import {
  checkIntegrity,
  failOpenClass,
  isDeviceEnvironmentError,
  matchesReviewerList,
  recordSessionAttestation,
  resolveBypass,
  resolveLoginBypass,
} from '../enforcement';

const DEV = '00000000-0000-4000-8000-000000000001';
const NONCE = 'a'.repeat(54);
const USER = '11111111-1111-4111-8111-111111111111';

function req(opts: { android?: boolean; v1?: boolean; token?: boolean; device?: string | null; path?: string; body?: string; auth?: string; error?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.android !== false) headers['x-app-platform'] = 'android';
  if (opts.v1 !== false) headers['x-client-features'] = 'icon_keys,integrity_v1';
  if (opts.token !== false) {
    headers['x-integrity-token'] = 'tok';
    headers['x-integrity-nonce'] = NONCE;
  }
  if (opts.device !== null) headers['x-device-id'] = opts.device ?? DEV;
  if (opts.auth) headers.authorization = `Bearer ${opts.auth}`;
  if (opts.error) headers['x-integrity-error'] = opts.error;
  return new NextRequest(`http://localhost${opts.path ?? '/api/mobile/auth/login'}`, { method: 'POST', body: opts.body ?? '{"email":"a@b.co","password":"x"}', headers });
}

beforeEach(() => {
  Object.assign(h, {
    mode: 'block',
    deviceFailOpen: 'true',
    internalPolicy: 'block',
    bypass: [],
    reviewers: [],
    listCalls: [],
    live: 'none',
    consume: 'ok',
    nonceConfigured: true,
    decode: { kind: 'decoded', payload: {} },
    verdictPass: true,
    verdictReason: 'device_integrity',
    configured: true,
    events: [],
    attestations: [],
    sentry: [],
    lastExpectedHash: null,
  });
});

const results = () => h.events.filter((e) => e.kind === 'integrity').map((e) => `${e.result}:${e.reason ?? ''}`);

describe('who is enforced', () => {
  it('legacy clients (no integrity_v1) are never blocked or verified', async () => {
    h.verdictPass = false;
    expect(await checkIntegrity(req({ v1: false, token: false }), { action: 'login' })).toMatchObject({ allowed: true, mode: 'legacy' });
    expect(h.events).toEqual([]);
  });

  it('iOS / web declaring integrity_v1 are legacy (Android only for now)', async () => {
    expect(await checkIntegrity(req({ android: false, token: false }), { action: 'register' })).toMatchObject({ allowed: true, mode: 'legacy' });
  });
});

describe('kill switch integrity_enforce_android', () => {
  it('off: no verification at all', async () => {
    h.mode = 'off';
    h.verdictPass = false;
    expect(await checkIntegrity(req({ token: false }), { action: 'register' })).toMatchObject({ allowed: true, mode: 'off' });
    expect(h.events).toEqual([]);
  });

  it('log: a failing verdict is allowed and recorded as log_only', async () => {
    h.mode = 'log';
    h.verdictPass = false;
    expect(await checkIntegrity(req(), { action: 'register' })).toMatchObject({ allowed: true, mode: 'log_only', reason: 'device_integrity' });
    expect(results()).toEqual(['log_only:device_integrity']);
  });

  it('block (default): a failing verdict is 403 INTEGRITY_FAILED {reason}', async () => {
    h.verdictPass = false;
    h.verdictReason = 'app_not_recognized';
    const d = await checkIntegrity(req({ path: '/api/mobile/auth/register' }), { action: 'register' });
    expect(d.allowed).toBe(false);
    expect(d.response!.status).toBe(403);
    const body = await d.response!.json();
    expect(body).toMatchObject({ success: false, code: 'INTEGRITY_FAILED', reason: 'app_not_recognized', error: { code: 'INTEGRITY_FAILED', details: { reason: 'app_not_recognized' } } });
    expect(results()).toEqual(['block:app_not_recognized']);
    expect(h.events.map((e) => e.kind)).toContain('signup_block');
  });
});

describe('fail closed (client faults)', () => {
  it.each([
    ['missing token', { token: false }, 'missing_token'],
    ['missing device id', { device: null }, 'missing_device_id'],
  ])('%s → block', async (_n, opts, reason) => {
    const d = await checkIntegrity(req(opts as any), { action: 'google' });
    expect(d).toMatchObject({ allowed: false, reason });
  });

  it.each([
    ['expired', 'nonce_expired'],
    ['replayed', 'nonce_replayed'],
    ['bad_signature', 'nonce_invalid'],
    ['malformed', 'nonce_invalid'],
  ])('nonce %s → %s (reason contains "nonce" so the client retries once)', async (consume, reason) => {
    h.consume = consume;
    const d = await checkIntegrity(req(), { action: 'refresh' });
    expect(d).toMatchObject({ allowed: false, reason });
    expect(reason).toContain('nonce');
  });

  it('nonce replay is also its own security event', async () => {
    h.consume = 'replayed';
    await checkIntegrity(req(), { action: 'register' });
    expect(h.events.map((e) => e.kind)).toEqual(['integrity', 'signup_block', 'nonce_replay']);
    // Bypass-eligible calls (login / refresh) record it once the bypass is resolved.
    h.events = [];
    const d = await checkIntegrity(req(), { action: 'refresh' });
    expect(h.events).toEqual([]);
    await resolveBypass(req(), d, null, 'refresh');
    expect(h.events.map((e) => `${e.kind}:${e.result}`)).toEqual(['integrity:block', 'nonce_replay:block']);
  });

  it('a token Google rejects (400) blocks; it never earns a fail-open', async () => {
    h.decode = { kind: 'client', status: 400, message: 'INVALID_ARGUMENT' };
    expect(await checkIntegrity(req(), { action: 'register' })).toMatchObject({ allowed: false, reason: 'token_invalid' });
  });

  it('X-Integrity-Error that signals no Play / tampering (e.g. no Play services) is still a block', async () => {
    const d = await checkIntegrity(req({ token: false, error: 'token_-6' }), { action: 'login' });
    expect(d).toMatchObject({ allowed: false, reason: 'missing_token' });
  });
});

describe('fail open (our / Google infrastructure)', () => {
  it.each([
    ['decode outage', () => (h.decode = { kind: 'infra', message: 'decode HTTP 503' }), 'decode_http'],
    ['verifier not configured', () => (h.configured = false), 'verifier_not_configured'],
    ['nonce store down', () => (h.consume = 'error'), 'nonce_store'],
  ])('%s → allowed, event + Sentry exception tagged security=fail_open', async (_n, setup, cls) => {
    setup();
    const d = await checkIntegrity(req(), { action: 'login' });
    expect(d).toMatchObject({ allowed: true, mode: 'fail_open' });
    expect(results()[0]).toMatch(/^fail_open:/);
    expect(h.sentry[0]).toMatchObject({ tags: { security: 'fail_open', fail_open_reason: cls }, fingerprint: ['security-fail-open', cls] });
  });

  it('nonce_unavailable fails open only when OUR nonce issuance is broken', async () => {
    h.nonceConfigured = false;
    expect(await checkIntegrity(req({ token: false, error: 'nonce_unavailable' }), { action: 'login' })).toMatchObject({ allowed: true, mode: 'fail_open' });
    h.nonceConfigured = true;
    expect(await checkIntegrity(req({ token: false, error: 'nonce_unavailable' }), { action: 'login' })).toMatchObject({ allowed: false, reason: 'missing_token' });
  });

  it('classifies fail-open causes for Sentry grouping', () => {
    expect(failOpenClass('Google token: invalid_grant')).toBe('token_exchange');
    expect(failOpenClass('decode timeout')).toBe('decode_timeout');
    expect(failOpenClass('boom')).toBe('unexpected');
  });
});

describe('pass + request binding', () => {
  it('hashes METHOD, PATH (no query), raw body, nonce and device', async () => {
    const d = await checkIntegrity(req({ path: '/api/mobile/auth/login?x=1' }), { action: 'login' });
    expect(d).toMatchObject({ allowed: true, mode: 'verified', attestedDeviceId: DEV });
    // Golden vector shape: same request with nonce/device of the vector would produce its hash.
    const { computeRequestHash, sha256Hex } = await import('../contract');
    expect(h.lastExpectedHash).toBe(computeRequestHash({ method: 'POST', path: '/api/mobile/auth/login', bodySha256: sha256Hex('{"email":"a@b.co","password":"x"}'), nonce: NONCE, deviceId: DEV }));
  });

  it('the body is still readable by the route after the check', async () => {
    const r = req();
    await checkIntegrity(r, { action: 'login' });
    expect(await r.json()).toEqual({ email: 'a@b.co', password: 'x' });
  });

  it('a route that read a CLONE of the body first is still verified', async () => {
    const r = req();
    expect(await r.clone().json()).toEqual({ email: 'a@b.co', password: 'x' });
    expect(await checkIntegrity(r, { action: 'login' })).toMatchObject({ allowed: true, mode: 'verified' });
  });

  it('a route that consumed the body first is blocked with a retryable 503, never a fail-open (2026-11-11 auth bug)', async () => {
    const r = req();
    await r.json();
    const d = await checkIntegrity(r, { action: 'register' });
    expect(d).toMatchObject({ allowed: false, mode: 'blocked', reason: 'integrity_internal_error', internalErrorClass: 'body_consumed' });
    expect(failOpenClass('request body already read before the integrity check')).toBe('body_consumed');
  });
});

describe('our programming errors fail closed (integrity_internal_error_policy)', () => {
  const consumed = async () => {
    const r = req();
    await r.json();
    return r;
  };

  it('body_consumed → 503 INTEGRITY_UNAVAILABLE (not INTEGRITY_FAILED: the app must not show the device block), Retry-After, Sentry error', async () => {
    const d = await checkIntegrity(await consumed(), { action: 'food_ai', userId: USER });
    expect(d.response!.status).toBe(503);
    expect(d.response!.headers.get('retry-after')).toBe('30');
    const body = await d.response!.json();
    expect(body).toMatchObject({ success: false, code: 'INTEGRITY_UNAVAILABLE', reason: 'integrity_internal_error', error: { code: 'INTEGRITY_UNAVAILABLE', details: { retryable: true } } });
    expect(body.code).not.toBe('INTEGRITY_FAILED');
    // Android shows server sentences unless they look technical (LoginErrorResolver.looksTechnical).
    expect(body.message).not.toMatch(/timeout|exception|null|\d{3}|error/i);
    expect(results()).toEqual(['block:integrity_internal_error:body_consumed']);
    expect(h.sentry).toEqual([expect.objectContaining({ message: 'integrity internal error: body_consumed', level: 'error', fingerprint: ['integrity-internal-error', 'body_consumed'] })]);
  });

  it('an unexpected exception inside the check is a block too (class unexpected)', async () => {
    h.decode = null; // decoded.kind on null → TypeError inside the check
    const d = await checkIntegrity(req(), { action: 'register' });
    expect(d).toMatchObject({ allowed: false, reason: 'integrity_internal_error', internalErrorClass: 'unexpected' });
    expect(d.response!.status).toBe(503);
  });

  it('a TypeError that mentions "nonce" is still our bug, not a nonce-store outage', async () => {
    const { thrownErrorClass } = await import('../enforcement');
    expect(thrownErrorClass("Cannot read properties of undefined (reading 'nonce')")).toBe('unexpected');
    expect(thrownErrorClass('INTEGRITY_NONCE_SECRET (or JWT_SECRET) is not configured')).toBe('verifier_not_configured');
    expect(thrownErrorClass('request body already read before the integrity check')).toBe('body_consumed');
  });

  it('login / google / refresh: the 503 is bypass-eligible (reviewers still get in), recorded with the class', async () => {
    h.reviewers = ['fitcircle.user@gmail.com'];
    const d = await checkIntegrity(await consumed(), { action: 'login' });
    expect(d).toMatchObject({ allowed: false, bypassEligible: true });
    expect(h.events).toEqual([]);
    expect(await resolveLoginBypass(req(), d, { userId: USER, email: 'someone@gmail.com' })).toBe(false);
    expect(await resolveLoginBypass(req(), d, { userId: USER, email: 'fitcircle.user@gmail.com' })).toBe(true);
    expect(results()).toEqual(['block:integrity_internal_error:body_consumed', 'bypass:reviewer:integrity_internal_error:body_consumed']);
  });

  it('policy fail_open (emergency switch): allowed, recorded as fail_open, still Sentry error', async () => {
    h.internalPolicy = 'fail_open';
    const d = await checkIntegrity(await consumed(), { action: 'login' });
    expect(d).toMatchObject({ allowed: true, mode: 'fail_open', internalErrorClass: 'body_consumed' });
    expect(results()).toEqual(['fail_open:integrity_internal_error:body_consumed']);
    expect(h.sentry[0]).toMatchObject({ level: 'error', tags: { integrity_outcome: 'fail_open' } });
  });

  it('log mode never blocks, even on our bug', async () => {
    h.mode = 'log';
    expect(await checkIntegrity(await consumed(), { action: 'register' })).toMatchObject({ allowed: true, mode: 'fail_open' });
  });

  it('remote config unreadable → block (the code default)', async () => {
    const { RemoteConfigService } = await import('@/lib/remote-config/service');
    const real = RemoteConfigService.enumValue;
    const spy = vi.spyOn(RemoteConfigService, 'enumValue').mockImplementation(async (key: any, ctx: any) => {
      if (key === 'integrity_internal_error_policy') throw new Error('db down');
      return real(key, ctx);
    });
    const d = await checkIntegrity(await consumed(), { action: 'register' });
    spy.mockRestore();
    expect(d).toMatchObject({ allowed: false, reason: 'integrity_internal_error' });
  });

  it('external causes still fail open: any decode error (network, bad key) is decode_error, not unexpected', async () => {
    h.decode = { kind: 'infra', message: 'fetch failed' };
    const d = await checkIntegrity(req(), { action: 'login' });
    expect(d).toMatchObject({ allowed: true, mode: 'fail_open' });
    expect(h.sentry[0]).toMatchObject({ tags: { fail_open_reason: 'decode_error' } });
  });

  it('a missing nonce secret (thrown while verifying) is configuration: fail open, Sentry error', async () => {
    const { isInternalErrorClass } = await import('../enforcement');
    expect(isInternalErrorClass('verifier_not_configured')).toBe(false);
    expect(isInternalErrorClass('body_consumed')).toBe(true);
    expect(isInternalErrorClass('unexpected')).toBe(true);
    h.configured = false;
    await checkIntegrity(req(), { action: 'login' });
    expect(h.sentry[0]).toMatchObject({ level: 'error', tags: { fail_open_reason: 'verifier_not_configured' } });
  });
});

describe('routes never consume the body before checkIntegrity', () => {
  it('every route calling checkIntegrity reads the body only through a clone, or after the check', async () => {
    const { readFileSync, readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(__dirname, '../../../api');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) { if (n !== '__tests__') walk(f); } else if (n === 'route.ts') files.push(f);
      }
    };
    walk(root);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const check = src.indexOf('checkIntegrity(');
      if (check < 0) continue;
      const before = src.slice(0, check);
      if (/await\s+request\.(json|text|formData|arrayBuffer|blob)\(\)/.test(before)) offenders.push(f.slice(root.length));
    }
    expect(files.length).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });

  it('every route calling checkIntegrity has a real end-to-end verified test (__tests__/integrity-e2e.test.ts)', async () => {
    const { existsSync, readFileSync, readdirSync, statSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const root = join(__dirname, '../../../api');
    const missing: string[] = [];
    let enforced = 0;
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) {
          if (n !== '__tests__') walk(f);
        } else if (n === 'route.ts' && readFileSync(f, 'utf8').includes('checkIntegrity(')) {
          enforced += 1;
          const e2e = join(dirname(f), '__tests__', 'integrity-e2e.test.ts');
          if (!existsSync(e2e) || !readFileSync(e2e, 'utf8').includes('expectVerified(')) missing.push(f.slice(root.length));
        }
      }
    };
    walk(root);
    expect(enforced).toBeGreaterThanOrEqual(10);
    expect(missing).toEqual([]);
  });
});

describe('session attestations', () => {
  const token = jwt.sign({ userId: USER, sid: 'sess-1', type: 'access' }, 'k');

  it('a verified session-issuing call binds the device to the new session (24 h)', async () => {
    const d = await checkIntegrity(req(), { action: 'login' });
    await recordSessionAttestation(req(), d, { userId: USER, accessToken: token });
    expect(h.attestations).toEqual([expect.objectContaining({ userId: USER, sessionId: 'sess-1', deviceId: DEV, status: 'verified' })]);
  });

  it('a fail-open records a short fail_open attestation', async () => {
    h.decode = { kind: 'infra', message: 'decode timeout' };
    const d = await checkIntegrity(req(), { action: 'refresh' });
    await recordSessionAttestation(req(), d, { userId: USER, accessToken: token });
    expect(h.attestations[0]).toMatchObject({ status: 'fail_open' });
  });

  it('protected calls accept a live attestation instead of a token', async () => {
    h.live = 'verified';
    const d = await checkIntegrity(req({ token: false, auth: token, path: '/api/mobile/fitzy/chat' }), { action: 'fitzy', userId: USER });
    expect(d).toMatchObject({ allowed: true, mode: 'attested', attestedDeviceId: DEV });
  });

  it('protected calls with no attestation and no token are blocked', async () => {
    const d = await checkIntegrity(req({ token: false, auth: token, path: '/api/mobile/food/photo-parse' }), { action: 'food_ai', userId: USER });
    expect(d).toMatchObject({ allowed: false, reason: 'missing_token' });
  });

  it('session-issuing calls never accept an attestation (always a fresh token)', async () => {
    h.live = 'verified';
    expect(await checkIntegrity(req({ token: false, auth: token }), { action: 'refresh' })).toMatchObject({ allowed: false, reason: 'missing_token' });
  });
});

describe('integrity_bypass_user_ids (login + refresh)', () => {
  it('a blocked login is let through for a listed user, after the password check', async () => {
    h.verdictPass = false;
    h.bypass = [USER];
    const d = await checkIntegrity(req(), { action: 'login' });
    expect(d).toMatchObject({ allowed: false, bypassEligible: true });
    expect(await resolveLoginBypass(req(), d, USER)).toBe(true);
    expect(results()).toEqual(['bypass:device_integrity']);
  });

  it('anyone else stays blocked (also with a wrong password: userId null)', async () => {
    h.verdictPass = false;
    h.bypass = [USER];
    const d = await checkIntegrity(req(), { action: 'login' });
    expect(await resolveLoginBypass(req(), d, '22222222-2222-4222-8222-222222222222')).toBe(false);
    expect(await resolveLoginBypass(req(), d, null)).toBe(false);
  });

  it('applies to refresh too (user id from the verified refresh token)', async () => {
    h.verdictPass = false;
    h.bypass = [USER];
    const d = await checkIntegrity(req({ path: '/api/mobile/auth/refresh' }), { action: 'refresh' });
    expect(d).toMatchObject({ allowed: false, bypassEligible: true });
    expect(await resolveBypass(req(), d, USER, 'refresh')).toBe(true);
    expect(h.events.at(-1)).toMatchObject({ kind: 'integrity', action: 'refresh', result: 'bypass' });
    expect(await resolveBypass(req(), d, null, 'refresh')).toBe(false);
  });

  it('never applies to register or protected calls', async () => {
    h.verdictPass = false;
    h.bypass = [USER];
    for (const action of ['register', 'fitzy', 'food_ai', 'referral_claim', 'entitlement_sync'] as const) {
      const d = await checkIntegrity(req(), { action, userId: USER });
      expect(d.bypassEligible).toBe(false);
      expect(await resolveBypass(req(), d, USER, action)).toBe(false);
    }
  });

  it('the user-id list does not apply to google (no user id before the account exists)', async () => {
    h.verdictPass = false;
    h.bypass = [USER];
    const d = await checkIntegrity(req({ path: '/api/mobile/auth/google' }), { action: 'google' });
    expect(d.bypassEligible).toBe(true);
    expect(await resolveBypass(req(), d, { userId: USER }, 'google')).toBe(false);
    expect(results()).toEqual(['block:device_integrity']);
  });
});

describe('device-environment errors fail open (logged, not alerted)', () => {
  it.each([
    'prepare_-3', 'prepare_-8', 'prepare_-9', 'prepare_-12', 'prepare_-14', 'prepare_-15', 'prepare_-18', 'prepare_-19', 'prepare_-100',
    'token_-3', 'token_-8', 'token_-9', 'token_-12', 'token_-14', 'token_-15', 'token_-18', 'token_-19', 'token_-100',
    'prepare_timeout', 'token_timeout', 'prepare_start', 'interrupted', 'token_provider_invalid',
  ])('%s → allowed, fail_open device_error:<code>, no Sentry', async (code) => {
    const d = await checkIntegrity(req({ token: false, error: code }), { action: 'login' });
    expect(d).toMatchObject({ allowed: true, mode: 'device_error', deviceId: DEV, attestedDeviceId: null });
    expect(results()).toEqual([`fail_open:device_error:${code}`]);
    expect(h.sentry).toEqual([]);
  });

  it.each([
    'prepare_-1', 'prepare_-2', 'prepare_-5', 'prepare_-6', 'prepare_-7', 'prepare_-16', 'prepare_-17',
    'token_-1', 'token_-2', 'token_-5', 'token_-6', 'token_-7', 'token_-16', 'token_-17',
    'token_-99', 'disabled', 'nonce_unavailable', 'prepare_-14x', 'foo_-14', 'request_-14',
  ])('%s → still a block (missing_token)', async (code) => {
    const d = await checkIntegrity(req({ token: false, error: code }), { action: 'register' });
    expect(d).toMatchObject({ allowed: false, reason: 'missing_token' });
    expect(results()).toEqual(['block:missing_token']);
  });

  it('no token and no error header is still a block', async () => {
    expect(await checkIntegrity(req({ token: false }), { action: 'register' })).toMatchObject({ allowed: false, reason: 'missing_token' });
  });

  it('applies to every action (session-issuing and protected) and in log mode', async () => {
    for (const action of ['register', 'google', 'refresh', 'food_ai', 'fitzy', 'referral_claim', 'entitlement_sync'] as const) {
      expect(await checkIntegrity(req({ token: false, error: 'prepare_-14' }), { action, userId: USER })).toMatchObject({ allowed: true, mode: 'device_error' });
    }
    h.mode = 'log';
    expect(await checkIntegrity(req({ token: false, error: 'prepare_-9' }), { action: 'login' })).toMatchObject({ allowed: true, mode: 'device_error' });
    expect(h.sentry).toEqual([]);
  });

  it('a token that IS sent is verified as usual, whatever the error header says', async () => {
    h.verdictPass = false;
    const d = await checkIntegrity(req({ error: 'prepare_-14' }), { action: 'register' });
    expect(d).toMatchObject({ allowed: false, reason: 'device_integrity' });
    h.decode = { kind: 'client', status: 400, message: 'INVALID_ARGUMENT' };
    expect(await checkIntegrity(req({ error: 'prepare_-14' }), { action: 'register' })).toMatchObject({ allowed: false, reason: 'token_invalid' });
  });

  it('a missing device id is still a block', async () => {
    expect(await checkIntegrity(req({ token: false, device: null, error: 'prepare_-14' }), { action: 'login' })).toMatchObject({ allowed: false, reason: 'missing_device_id' });
  });

  it('never writes a session attestation (the next protected call is checked again)', async () => {
    const token = jwt.sign({ userId: USER, sid: 'sess-1', type: 'access' }, 'k');
    const d = await checkIntegrity(req({ token: false, error: 'prepare_-14' }), { action: 'login' });
    await recordSessionAttestation(req(), d, { userId: USER, accessToken: token });
    expect(h.attestations).toEqual([]);
  });

  it('infrastructure fail-opens still report to Sentry (security=fail_open)', async () => {
    h.decode = { kind: 'infra', message: 'decode HTTP 503' };
    await checkIntegrity(req({ error: 'prepare_-14' }), { action: 'login' });
    expect(h.sentry).toHaveLength(1);
    expect(results()[0]).not.toMatch(/device_error/);
  });

  it('integrity_device_error_fail_open = false: device errors block again (missing_token)', async () => {
    h.deviceFailOpen = 'false';
    for (const code of ['prepare_-14', 'prepare_-9', 'token_timeout']) {
      expect(await checkIntegrity(req({ token: false, error: code }), { action: 'register' })).toMatchObject({ allowed: false, reason: 'missing_token' });
    }
    expect(results()).toEqual(['block:missing_token', 'block:missing_token', 'block:missing_token']);
    // ...and a login can still be lifted by the reviewer list after the password check.
    h.reviewers = ['fitcircle.user@gmail.com'];
    const d = await checkIntegrity(req({ token: false, error: 'prepare_-14' }), { action: 'login' });
    expect(d).toMatchObject({ allowed: false, bypassEligible: true });
    expect(await resolveLoginBypass(req(), d, { userId: USER, email: 'fitcircle.user@gmail.com' })).toBe(true);
  });

  it('integrity_device_error_fail_open unreadable → code default (fail open)', async () => {
    const { RemoteConfigService } = await import('@/lib/remote-config/service');
    const real = RemoteConfigService.enumValue;
    const spy = vi.spyOn(RemoteConfigService, 'enumValue').mockImplementation(async (key: any, ctx: any) => {
      if (key === 'integrity_device_error_fail_open') throw new Error('db down');
      return real(key, ctx);
    });
    expect(await checkIntegrity(req({ token: false, error: 'prepare_-14' }), { action: 'login' })).toMatchObject({ allowed: true, mode: 'device_error' });
    spy.mockRestore();
  });

  it('isDeviceEnvironmentError is case-insensitive and rejects junk', () => {
    expect(isDeviceEnvironmentError('PREPARE_-14')).toBe(true);
    expect(isDeviceEnvironmentError(null)).toBe(false);
    expect(isDeviceEnvironmentError('')).toBe(false);
    expect(isDeviceEnvironmentError('prepare_-140000')).toBe(false);
  });
});

describe('integrity_reviewer_emails (verified identities only)', () => {
  const REVIEWERS = ['fitcircle.user@gmail.com', '@cloudtestlabaccounts.com'];

  it('matches exact emails always and @domain entries only with allowDomains, case-insensitively', () => {
    const D = { allowDomains: true };
    expect(matchesReviewerList('Fitcircle.User@Gmail.com', REVIEWERS)).toBe(true);
    expect(matchesReviewerList('robot.123@cloudtestlabaccounts.com', REVIEWERS)).toBe(false);
    expect(matchesReviewerList('robot.123@cloudtestlabaccounts.com', REVIEWERS, D)).toBe(true);
    expect(matchesReviewerList('fitcircle.user2@gmail.com', REVIEWERS, D)).toBe(false);
    expect(matchesReviewerList('x@evil-cloudtestlabaccounts.com', REVIEWERS, D)).toBe(false);
    expect(matchesReviewerList('x@sub.cloudtestlabaccounts.com', REVIEWERS, D)).toBe(false);
    expect(matchesReviewerList('cloudtestlabaccounts.com', REVIEWERS, D)).toBe(false);
    expect(matchesReviewerList('@cloudtestlabaccounts.com', REVIEWERS, D)).toBe(false);
    expect(matchesReviewerList(null, REVIEWERS)).toBe(false);
    expect(matchesReviewerList('a@b.co', [])).toBe(false);
  });

  it.each(['login', 'google', 'refresh'] as const)('%s: a blocked reviewer is let through, recorded as bypass:reviewer:<reason>', async (action) => {
    h.verdictPass = false;
    h.reviewers = REVIEWERS;
    const d = await checkIntegrity(req(), { action });
    expect(d).toMatchObject({ allowed: false, bypassEligible: true });
    expect(await resolveBypass(req(), d, { userId: action === 'google' ? null : USER, email: 'fitcircle.user@gmail.com' }, action)).toBe(true);
    expect(results()).toEqual(['bypass:reviewer:device_integrity']);
    expect(h.events.at(-1)).toMatchObject({ action, result: 'bypass' });
  });

  it('google: a pre-launch robot domain is let through', async () => {
    h.reviewers = REVIEWERS;
    const d = await checkIntegrity(req({ token: false, error: 'token_-6' }), { action: 'google' });
    expect(await resolveBypass(req(), d, { email: 'abc.12345@cloudtestlabaccounts.com' }, 'google')).toBe(true);
    expect(results()).toEqual(['bypass:reviewer:missing_token']);
  });

  it.each(['login', 'refresh'] as const)('%s: @domain entries never match (the email is not proven); exact entries do', async (action) => {
    h.reviewers = REVIEWERS;
    const d = await checkIntegrity(req({ token: false, error: 'token_-6' }), { action });
    expect(await resolveBypass(req(), d, { userId: USER, email: 'abc.12345@cloudtestlabaccounts.com' }, action)).toBe(false);
    expect(await resolveBypass(req(), d, { userId: USER, email: 'fitcircle.user@gmail.com' }, action)).toBe(true);
    expect(results()).toEqual(['block:missing_token', 'bypass:reviewer:missing_token']);
  });

  it('anyone else (or no verified email) stays blocked', async () => {
    h.verdictPass = false;
    h.reviewers = REVIEWERS;
    const d = await checkIntegrity(req(), { action: 'login' });
    expect(await resolveLoginBypass(req(), d, { userId: USER, email: 'someone@gmail.com' })).toBe(false);
    expect(await resolveLoginBypass(req(), d, { userId: null, email: null })).toBe(false);
    expect(await resolveLoginBypass(req(), d, null)).toBe(false);
    expect(results()).toEqual(['block:device_integrity', 'block:device_integrity', 'block:device_integrity']);
  });

  it('never applies to register (the body email is an unverified claim) or protected calls', async () => {
    h.verdictPass = false;
    h.reviewers = REVIEWERS;
    for (const action of ['register', 'fitzy', 'food_ai', 'referral_claim', 'entitlement_sync'] as const) {
      const d = await checkIntegrity(req(), { action, userId: USER });
      expect(d.bypassEligible).toBe(false);
      expect(await resolveBypass(req(), d, { userId: USER, email: 'fitcircle.user@gmail.com' }, action)).toBe(false);
    }
  });

  it('the user-id list keeps working and is recorded without the reviewer tag', async () => {
    h.verdictPass = false;
    h.bypass = [USER];
    h.reviewers = REVIEWERS;
    const d = await checkIntegrity(req(), { action: 'login' });
    expect(await resolveLoginBypass(req(), d, { userId: USER, email: 'fitcircle.user@gmail.com' })).toBe(true);
    expect(results()).toEqual(['bypass:device_integrity']);
  });

  it('a remote-config failure fails closed (stays blocked)', async () => {
    h.verdictPass = false;
    const { RemoteConfigService } = await import('@/lib/remote-config/service');
    const spy = vi.spyOn(RemoteConfigService, 'listValue').mockRejectedValue(new Error('db down'));
    const d = await checkIntegrity(req(), { action: 'login' });
    expect(await resolveLoginBypass(req(), d, { userId: USER, email: 'fitcircle.user@gmail.com' })).toBe(false);
    spy.mockRestore();
  });

  it('reads the list with the request platform (platform-agnostic list)', async () => {
    h.verdictPass = false;
    h.reviewers = REVIEWERS;
    const d = await checkIntegrity(req(), { action: 'login' });
    await resolveLoginBypass(req(), d, { userId: USER, email: 'fitcircle.user@gmail.com' });
    expect(h.listCalls.find((c) => c.key === 'integrity_reviewer_emails')?.ctx).toMatchObject({ userId: USER, platform: 'android' });
  });
});
