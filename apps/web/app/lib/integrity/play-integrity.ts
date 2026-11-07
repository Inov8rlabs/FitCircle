/**
 * Google Play Integrity: server-side decode + verdict evaluation.
 *
 * Decode: POST https://playintegrity.googleapis.com/v1/{packageName}:decodeIntegrityToken
 * with an OAuth token for a service account (PLAY_INTEGRITY_SA_JSON = key JSON, raw or
 * base64), JWT-bearer grant, scope playintegrity.
 *
 * Errors are split in two on purpose:
 *   - `infra`: our configuration, Google auth, quota, 5xx, network, timeout. The caller
 *     fails OPEN (allow + log + Sentry): a Google outage must not lock everyone out.
 *   - `client`: Google rejected the token itself (HTTP 400): malformed, forged, wrong
 *     package. The caller BLOCKS, otherwise garbage tokens would earn a fail-open.
 * A token that decodes but fails any check always blocks (evaluateVerdict).
 */
import { createSign } from 'node:crypto';

import { parseServiceAccountKey, type GoogleServiceAccountKey } from '@/lib/ads/connectors/google-ads';

export const PLAY_INTEGRITY_API = 'https://playintegrity.googleapis.com/v1';
export const PLAY_INTEGRITY_SCOPE = 'https://www.googleapis.com/auth/playintegrity';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const DEFAULT_PACKAGE_NAME = 'com.inov8rlabs.apps.fitcircle';
/** Max age of the token's requestDetails.timestampMillis. */
export const MAX_TOKEN_AGE_MS = 2 * 60_000;
/** Allowed clock skew into the future. */
const MAX_FUTURE_SKEW_MS = 30_000;
const DECODE_TIMEOUT_MS = 4_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PlayIntegrityConfig {
  key: GoogleServiceAccountKey;
  packageName: string;
  /** Allowed signing-certificate SHA-256 digests, lower-case hex without separators. */
  certDigests: string[];
}

/**
 * Normalise a certificate digest to lower-case hex. Accepts the Play Console form
 * (`AB:CD:…`), plain hex, or the base64url form Google puts in the verdict.
 */
export function normalizeCertDigest(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const hex = v.replace(/:/g, '');
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return hex.toLowerCase();
  try {
    const bytes = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    return bytes.length === 32 ? bytes.toString('hex') : null;
  } catch {
    return null;
  }
}

export function playIntegrityConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PlayIntegrityConfig | null {
  const key = parseServiceAccountKey(env.PLAY_INTEGRITY_SA_JSON);
  if (!key) return null;
  const certDigests = (env.PLAY_INTEGRITY_CERT_SHA256 ?? '')
    .split(',')
    .map(normalizeCertDigest)
    .filter((d): d is string => !!d);
  return {
    key,
    packageName: env.PLAY_INTEGRITY_PACKAGE_NAME?.trim() || DEFAULT_PACKAGE_NAME,
    certDigests,
  };
}

// ---------------------------------------------------------------------------- verdict

/** Subset of the decoded tokenPayloadExternal this server reads. */
export interface IntegrityPayload {
  requestDetails?: { requestPackageName?: string; requestHash?: string; timestampMillis?: string | number };
  appIntegrity?: {
    appRecognitionVerdict?: string;
    packageName?: string;
    certificateSha256Digest?: string[];
    versionCode?: string | number;
  };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
  accountDetails?: { appLicensingVerdict?: string };
}

export type VerdictFailure =
  | 'request_hash_mismatch'
  | 'stale_token'
  | 'package_mismatch'
  | 'cert_mismatch'
  | 'app_not_recognized'
  | 'device_integrity'
  | 'unlicensed';

/** What is stored about a verdict (never the token). */
export interface VerdictSummary {
  appRecognition: string | null;
  deviceRecognition: string[];
  licensing: string | null;
  versionCode: string | null;
  tokenAgeMs: number | null;
}

export type VerdictResult = { pass: true; summary: VerdictSummary } | { pass: false; reason: VerdictFailure; summary: VerdictSummary };

export function summarizeVerdict(payload: IntegrityPayload, nowMs: number): VerdictSummary {
  const ts = Number(payload.requestDetails?.timestampMillis);
  const device = payload.deviceIntegrity?.deviceRecognitionVerdict;
  return {
    appRecognition: payload.appIntegrity?.appRecognitionVerdict ?? null,
    deviceRecognition: Array.isArray(device) ? device.map(String) : [],
    licensing: payload.accountDetails?.appLicensingVerdict ?? null,
    versionCode: payload.appIntegrity?.versionCode != null ? String(payload.appIntegrity.versionCode) : null,
    tokenAgeMs: Number.isFinite(ts) ? nowMs - ts : null,
  };
}

/**
 * Every check must pass: request hash, freshness, package, signing certificate,
 * PLAY_RECOGNIZED, MEETS_DEVICE_INTEGRITY, LICENSED. Order is fixed so the reported
 * reason is deterministic (request binding first, then app, then device, then licence).
 */
export function evaluateVerdict(
  payload: IntegrityPayload,
  expected: { requestHash: string; packageName: string; certDigests: string[]; nowMs: number }
): VerdictResult {
  const summary = summarizeVerdict(payload, expected.nowMs);
  const fail = (reason: VerdictFailure): VerdictResult => ({ pass: false, reason, summary });

  const gotHash = (payload.requestDetails?.requestHash ?? '').toLowerCase();
  if (!gotHash || gotHash !== expected.requestHash.toLowerCase()) return fail('request_hash_mismatch');

  if (summary.tokenAgeMs === null || summary.tokenAgeMs > MAX_TOKEN_AGE_MS || summary.tokenAgeMs < -MAX_FUTURE_SKEW_MS) {
    return fail('stale_token');
  }

  if (payload.requestDetails?.requestPackageName !== expected.packageName) return fail('package_mismatch');

  const verdict = payload.appIntegrity?.appRecognitionVerdict;
  // UNEVALUATED carries no package/cert; it is not a pass either way.
  if (verdict !== 'PLAY_RECOGNIZED') return fail('app_not_recognized');
  if (payload.appIntegrity?.packageName !== expected.packageName) return fail('package_mismatch');

  if (expected.certDigests.length === 0) return fail('cert_mismatch');
  const certs = (payload.appIntegrity?.certificateSha256Digest ?? [])
    .map((c) => normalizeCertDigest(String(c)))
    .filter((c): c is string => !!c);
  if (!certs.some((c) => expected.certDigests.includes(c))) return fail('cert_mismatch');

  if (!summary.deviceRecognition.includes('MEETS_DEVICE_INTEGRITY')) return fail('device_integrity');

  if (summary.licensing !== 'LICENSED') return fail('unlicensed');

  return { pass: true, summary };
}

// ---------------------------------------------------------------------------- decode

export type DecodeResult =
  | { kind: 'decoded'; payload: IntegrityPayload }
  | { kind: 'client'; status: number; message: string }
  | { kind: 'infra'; message: string };

export function integrityJwtAssertion(key: GoogleServiceAccountKey, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = { alg: 'RS256', typ: 'JWT', ...(key.private_key_id ? { kid: key.private_key_id } : {}) };
  const claims = { iss: key.client_email, scope: PLAY_INTEGRITY_SCOPE, aud: key.token_uri || GOOGLE_TOKEN_URL, iat: nowSec, exp: nowSec + 3600 };
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${enc(header)}.${enc(claims)}`;
  return `${input}.${createSign('RSA-SHA256').update(input).sign(key.private_key).toString('base64url')}`;
}

async function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await p(ctl.signal);
  } finally {
    clearTimeout(t);
  }
}

export class PlayIntegrityClient {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    readonly config: PlayIntegrityConfig | null = playIntegrityConfigFromEnv(),
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  isConfigured(): boolean {
    return !!this.config;
  }

  private async token(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresAt - 60_000 > now) return this.accessToken.value;
    const key = this.config!.key;
    const res = await withTimeout(
      (signal) =>
        this.fetchImpl(key.token_uri || GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: integrityJwtAssertion(key) }).toString(),
          signal,
        }),
      DECODE_TIMEOUT_MS
    );
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw new Error(`Google token: ${json.error ?? `HTTP ${res.status}`}`);
    this.accessToken = { value: json.access_token, expiresAt: now + (Number(json.expires_in) || 3600) * 1000 };
    return this.accessToken.value;
  }

  async decode(integrityToken: string): Promise<DecodeResult> {
    if (!this.config) return { kind: 'infra', message: 'PLAY_INTEGRITY_SA_JSON not configured' };
    let access: string;
    try {
      access = await this.token();
    } catch (err: any) {
      return { kind: 'infra', message: err?.message ?? 'token exchange failed' };
    }
    try {
      const url = `${PLAY_INTEGRITY_API}/${encodeURIComponent(this.config.packageName)}:decodeIntegrityToken`;
      const res = await withTimeout(
        (signal) =>
          this.fetchImpl(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ integrityToken }),
            signal,
          }),
        DECODE_TIMEOUT_MS
      );
      const json: any = await res.json().catch(() => null);
      if (res.ok && json?.tokenPayloadExternal) return { kind: 'decoded', payload: json.tokenPayloadExternal as IntegrityPayload };
      if (res.status === 400) return { kind: 'client', status: 400, message: String(json?.error?.status ?? 'INVALID_ARGUMENT') };
      if (res.status === 401) this.accessToken = null;
      return { kind: 'infra', message: `decode HTTP ${res.status} ${json?.error?.status ?? ''}`.trim() };
    } catch (err: any) {
      return { kind: 'infra', message: err?.name === 'AbortError' ? 'decode timeout' : (err?.message ?? 'decode failed') };
    }
  }
}

let shared: PlayIntegrityClient | null = null;

/** Process-wide client (caches the OAuth access token). */
export function playIntegrityClient(): PlayIntegrityClient {
  if (!shared) shared = new PlayIntegrityClient();
  return shared;
}

/** Test hook. */
export function setPlayIntegrityClient(client: PlayIntegrityClient | null): void {
  shared = client;
}
