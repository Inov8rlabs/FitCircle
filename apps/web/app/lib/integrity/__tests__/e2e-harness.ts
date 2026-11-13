/**
 * End-to-end integrity harness for ROUTE tests (docs/INTEGRITY_CONTRACT.md, "Invariants").
 *
 * Runs the REAL checkIntegrity, contract hashing, verdict evaluation and PlayIntegrityClient.
 * Only the outside world is stubbed:
 *   - Google: the OAuth token + decodeIntegrityToken HTTP calls (fake fetch). The "device"
 *     builds its verdict exactly like Play would: requestHash computed client-side over the
 *     exact body bytes sent (like the Android IntegrityInterceptor), PLAY_RECOGNIZED, etc.
 *   - the nonce store (in-memory; nonces are issued + HMAC-verified by the real nonce.ts)
 *   - the database: security_events (captured), device_attestations (in-memory), remote
 *     config (code defaults from the registry)
 *
 * Wire it in a route test with (vi.mock is hoisted; factories import this module lazily):
 *
 *   vi.mock('@/lib/remote-config/service', async () => (await import('@/lib/integrity/__tests__/e2e-harness')).remoteConfigModule());
 *   vi.mock('@/lib/security/security-events', async (orig) => (await import('@/lib/integrity/__tests__/e2e-harness')).securityEventsModule(await orig()));
 *   vi.mock('@/lib/integrity/attestations', async () => (await import('@/lib/integrity/__tests__/e2e-harness')).attestationsModule());
 *   vi.mock('@/lib/integrity/nonce', async (orig) => (await import('@/lib/integrity/__tests__/e2e-harness')).nonceModule(await orig()));
 *
 * then `installIntegrity()` in beforeEach and send `await signedRequest(...)`.
 * A route that consumes the body before checkIntegrity gets a 503 integrity_internal_error
 * (and before 2026-11-13 got a silent fail-open), so `expectVerified` fails for it.
 */
import { generateKeyPairSync } from 'node:crypto';

import { NextRequest } from 'next/server';
import { expect } from 'vitest';

import { codeDefault, isRemoteConfigKey } from '@/lib/remote-config/registry';
import type * as SecurityEventsNs from '@/lib/security/security-events';

import { computeRequestHash, sha256Hex } from '../contract';
import type * as NonceNs from '../nonce';
import { DEFAULT_PACKAGE_NAME, PlayIntegrityClient, setPlayIntegrityClient, type IntegrityPayload } from '../play-integrity';

export const E2E_DEVICE_ID = 'e2e-device-0001';
export const E2E_USER_ID = '11111111-1111-4111-8111-111111111111';
export const E2E_CERT = 'ab'.repeat(32);

type NonceModule = typeof NonceNs;
type SecurityEventsModule = typeof SecurityEventsNs;

export const integrityE2E = {
  events: [] as any[],
  attestations: [] as any[],
  nonces: new Map<string, { deviceId: string; path: string; bodySha256: string }>(),
  remoteConfig: {} as Record<string, unknown>,
  googleCalls: 0,
  originalNonce: null as NonceModule | null,
};

export function resetIntegrityE2E(): void {
  integrityE2E.events = [];
  integrityE2E.attestations = [];
  integrityE2E.nonces.clear();
  integrityE2E.remoteConfig = {};
  integrityE2E.googleCalls = 0;
}

// ---------------------------------------------------------------------------- module stubs

const resolveConfig = (key: string) => {
  if (key in integrityE2E.remoteConfig) return integrityE2E.remoteConfig[key];
  return isRemoteConfigKey(key) ? codeDefault(key) : undefined;
};

/** Remote config = the registry's code defaults (+ integrityE2E.remoteConfig overrides). */
export function remoteConfigModule() {
  const RemoteConfigService = {
    enumValue: async (key: string) => String(resolveConfig(key)),
    listValue: async (key: string) => (Array.isArray(resolveConfig(key)) ? (resolveConfig(key) as string[]) : []),
    value: async (key: string) => Number(resolveConfig(key)),
  };
  return { RemoteConfigService };
}

/** A multipart/form-data body with one JPEG `image` part (+ text fields), byte-exact. */
export function multipartBody(fields: Record<string, string> = {}): { body: Uint8Array; contentType: string } {
  const boundary = '----e2eIntegrityBoundary7MA4YWxkTrZu0gW';
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="meal.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`));
  parts.push(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]));
  parts.push(enc.encode(`\r\n--${boundary}--\r\n`));
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    body.set(p, o);
    o += p.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export function securityEventsModule(original: SecurityEventsModule) {
  return {
    ...original,
    recordSecurityEvent: async (_req: unknown, e: any) => void integrityE2E.events.push(e),
  };
}

export function attestationsModule() {
  return {
    findLiveAttestation: async () => 'none' as const,
    recordAttestation: async (a: any) => void integrityE2E.attestations.push(a),
    isAttestedDevice: async () => false,
    attestedDeviceIds: async () => [] as string[],
    ATTESTATION_TTL_MS: 24 * 60 * 60_000,
    FAIL_OPEN_ATTESTATION_TTL_MS: 60 * 60_000,
  };
}

/** Real HMAC nonces; only the single-use store is in memory. */
export function nonceModule(original: NonceModule) {
  integrityE2E.originalNonce = original;
  return {
    ...original,
    consumeNonce: async (nonce: string, deviceId: string, use: { path: string; bodySha256: string }) => {
      const v = original.verifyNonce(nonce, deviceId);
      if (!v.ok) return v.reason;
      const prior = integrityE2E.nonces.get(nonce);
      if (prior) return prior.deviceId === deviceId && prior.path === use.path && prior.bodySha256 === use.bodySha256 ? 'ok' : 'replayed';
      integrityE2E.nonces.set(nonce, { deviceId, ...use });
      return 'ok';
    },
  };
}

// ---------------------------------------------------------------------------- fake Google

let keyPem: string | null = null;
function privateKeyPem(): string {
  if (!keyPem) keyPem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return keyPem;
}

/** The "integrity token" a device would get from Play: here, the verdict itself (base64url JSON). */
function deviceToken(payload: IntegrityPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

const fakeGoogleFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  integrityE2E.googleCalls += 1;
  if (url.includes('oauth2')) return Response.json({ access_token: 'e2e-access', expires_in: 3600 });
  if (url.includes(':decodeIntegrityToken')) {
    const { integrityToken } = JSON.parse(String(init?.body ?? '{}'));
    try {
      return Response.json({ tokenPayloadExternal: JSON.parse(Buffer.from(integrityToken, 'base64url').toString('utf8')) });
    } catch {
      return Response.json({ error: { status: 'INVALID_ARGUMENT' } }, { status: 400 });
    }
  }
  return new Response('not found', { status: 404 });
};

/** Real PlayIntegrityClient against fake Google; nonce secret set. Call in beforeEach. */
export function installIntegrity(): void {
  resetIntegrityE2E();
  process.env.INTEGRITY_NONCE_SECRET = 'e2e-nonce-secret';
  setPlayIntegrityClient(
    new PlayIntegrityClient(
      { key: { client_email: 'e2e@test.iam.gserviceaccount.com', private_key: privateKeyPem(), token_uri: 'https://oauth2.googleapis.com/token' }, packageName: DEFAULT_PACKAGE_NAME, certDigests: [E2E_CERT] },
      fakeGoogleFetch as any
    )
  );
}

// ---------------------------------------------------------------------------- signed requests

export interface SignedRequestInit {
  path: string;
  method?: string;
  /** JSON-serialisable object, a raw string, raw bytes, or FormData (sent as multipart). */
  body?: unknown;
  headers?: Record<string, string>;
  bearer?: string;
}

/**
 * A request exactly as the Android app sends a protected call: X-App-Platform android,
 * X-Client-Features with integrity_v1, X-Device-Id, a fresh server nonce and a token whose
 * requestHash covers METHOD, PATH, the exact body bytes, nonce and device id.
 */
export async function signedRequest(init: SignedRequestInit): Promise<NextRequest> {
  if (!integrityE2E.originalNonce) throw new Error('integrity e2e: mock @/lib/integrity/nonce with nonceModule() first');
  const method = (init.method ?? 'POST').toUpperCase();
  const url = `http://localhost${init.path}`;
  const headers: Record<string, string> = {
    'x-app-platform': 'android',
    'x-app-version': '1.1.4',
    'x-client-features': 'promo@1,icon_keys,integrity_v1',
    'x-device-id': E2E_DEVICE_ID,
    ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}),
    ...(init.headers ?? {}),
  };

  let bytes: Uint8Array = new Uint8Array();
  if (init.body instanceof FormData) {
    const encoded = new Request(url, { method: 'POST', body: init.body });
    headers['content-type'] = encoded.headers.get('content-type')!;
    bytes = new Uint8Array(await encoded.arrayBuffer());
  } else if (init.body instanceof Uint8Array) {
    bytes = init.body; // raw bytes (e.g. a hand-built multipart body; set content-type in headers)
  } else if (init.body !== undefined) {
    headers['content-type'] ??= 'application/json';
    bytes = new TextEncoder().encode(typeof init.body === 'string' ? init.body : JSON.stringify(init.body));
  }

  const { nonce } = integrityE2E.originalNonce.issueNonce(E2E_DEVICE_ID);
  const path = new URL(url).pathname;
  const requestHash = computeRequestHash({ method, path, bodySha256: sha256Hex(bytes), nonce, deviceId: E2E_DEVICE_ID });
  headers['x-integrity-nonce'] = nonce;
  headers['x-integrity-token'] = deviceToken({
    requestDetails: { requestPackageName: DEFAULT_PACKAGE_NAME, requestHash, timestampMillis: String(Date.now()) },
    appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: DEFAULT_PACKAGE_NAME, certificateSha256Digest: [Buffer.from(E2E_CERT, 'hex').toString('base64url')], versionCode: '61' },
    deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
    accountDetails: { appLicensingVerdict: 'LICENSED' },
  });

  return new NextRequest(url, { method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body: bytes as Uint8Array<ArrayBuffer> }) });
}

// ---------------------------------------------------------------------------- assertions

export const integrityEvents = (action?: string) =>
  integrityE2E.events.filter((e) => e.kind === 'integrity' && (!action || e.action === action)).map((e) => `${e.result}:${e.reason ?? ''}`);

/**
 * The request was VERIFIED by Play Integrity: one `pass` security event for the action, no
 * fail-open / block, the route did not answer with the integrity 403 / 503, and Google was
 * really asked (token exchange + decode).
 */
export function expectVerified(res: Response, action: string): void {
  expect(integrityEvents(action)).toEqual(['pass:']);
  expect(integrityE2E.events.filter((e) => e.kind === 'integrity' && e.result !== 'pass')).toEqual([]);
  expect(res.status).not.toBe(403);
  expect(res.status).not.toBe(503);
  expect(integrityE2E.googleCalls).toBeGreaterThanOrEqual(1);
}

/** Session-issuing calls: the new session is bound to the device as `verified` (24 h). */
export function expectVerifiedSession(userId: string): void {
  expect(integrityE2E.attestations).toEqual([expect.objectContaining({ userId, deviceId: E2E_DEVICE_ID, status: 'verified' })]);
}
