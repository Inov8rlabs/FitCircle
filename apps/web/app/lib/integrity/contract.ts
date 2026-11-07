/**
 * Request-hash contract between integrity-capable clients and the server
 * (docs/INTEGRITY_CONTRACT.md). Pure: no I/O. Unit tests pin the exact format,
 * so a change here is a breaking change for shipped clients.
 *
 *   canonical   = METHOD + "\n" + PATH + "\n" + SHA256_HEX(body bytes) + "\n" + NONCE + "\n" + DEVICE_ID
 *   requestHash = SHA256_HEX(UTF-8 bytes of canonical)
 *
 * METHOD upper-case; PATH the URL path only (no scheme, host or query string),
 * exactly as sent; an empty body hashes the empty byte string; hex is lower-case.
 */
import { createHash } from 'node:crypto';

export const INTEGRITY_FEATURE = 'integrity_v1';

export const INTEGRITY_HEADERS = {
  token: 'x-integrity-token',
  nonce: 'x-integrity-nonce',
  deviceId: 'x-device-id',
  /** Optional: why the client has no token (logged only). */
  clientError: 'x-integrity-error',
  clientFeatures: 'x-client-features',
} as const;

/** SHA-256 of the empty byte string (an empty body). */
export const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const DEVICE_ID_RE = /^[A-Za-z0-9._:-]{4,128}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function sha256Hex(data: string | Uint8Array | ArrayBuffer): string {
  const h = createHash('sha256');
  if (typeof data === 'string') h.update(data, 'utf8');
  else if (ArrayBuffer.isView(data)) h.update(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  else h.update(Buffer.from(data));
  return h.digest('hex');
}

export interface CanonicalRequestParts {
  method: string;
  path: string;
  /** Lower-case hex SHA-256 of the raw body bytes. */
  bodySha256: string;
  nonce: string;
  deviceId: string;
}

export function canonicalRequestString(p: CanonicalRequestParts): string {
  return [p.method.toUpperCase(), p.path, p.bodySha256.toLowerCase(), p.nonce, p.deviceId].join('\n');
}

export function computeRequestHash(p: CanonicalRequestParts): string {
  return sha256Hex(canonicalRequestString(p));
}

/** A device id as the client must send it (app-generated install id). */
export function normalizeDeviceId(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  return DEVICE_ID_RE.test(v) ? v : null;
}

export function isWellFormedNonce(raw: string | null | undefined): raw is string {
  return NONCE_RE.test(raw ?? '');
}

/** True when the X-Client-Features list contains `feature` (comma-separated, case-insensitive). */
export function hasClientFeature(raw: string | null | undefined, feature: string): boolean {
  const want = feature.toLowerCase();
  return (raw ?? '').split(',').some((f) => f.trim().toLowerCase() === want);
}
