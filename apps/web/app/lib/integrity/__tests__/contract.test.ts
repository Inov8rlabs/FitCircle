/**
 * Pins the request-hash contract (docs/INTEGRITY_CONTRACT.md). The Android client
 * computes the same strings; the golden vectors below are shared with its test suite.
 * Changing any expectation here breaks shipped clients.
 */
import { describe, expect, it } from 'vitest';

import {
  EMPTY_BODY_SHA256,
  INTEGRITY_FEATURE,
  INTEGRITY_HEADERS,
  canonicalRequestString,
  computeRequestHash,
  hasClientFeature,
  isWellFormedNonce,
  normalizeDeviceId,
  sha256Hex,
} from '../contract';

describe('canonical request string', () => {
  it('is METHOD\\nPATH\\nBODY_SHA256\\nNONCE\\nDEVICE_ID, no trailing newline', () => {
    expect(canonicalRequestString({ method: 'post', path: '/api/x', bodySha256: 'ABC', nonce: 'n', deviceId: 'd' })).toBe('POST\n/api/x\nabc\nn\nd');
  });

  it('empty body hashes the empty byte string', () => {
    expect(sha256Hex('')).toBe(EMPTY_BODY_SHA256);
    expect(sha256Hex(new Uint8Array())).toBe(EMPTY_BODY_SHA256);
  });

  it('golden vector 1: login JSON body', () => {
    const body = '{"email":"a@b.co","password":"x"}';
    const bodySha256 = sha256Hex(body);
    expect(bodySha256).toBe('38565dbbaf56e57905d37e570b7ba60734777056b170fc82929b62a0680153ca');
    expect(
      computeRequestHash({ method: 'POST', path: '/api/mobile/auth/login', bodySha256, nonce: 'n-123', deviceId: '00000000-0000-4000-8000-000000000001' })
    ).toBe('c6c10179f22e1dda3fa94fa693d712486c7d3117d5bf1aee55a20da8c7ccd590');
  });

  it('golden vector 2: no-body POST', () => {
    expect(
      computeRequestHash({ method: 'POST', path: '/api/mobile/subscriptions/sync', bodySha256: EMPTY_BODY_SHA256, nonce: 'n-456', deviceId: 'dev-1' })
    ).toBe('509e9da311b54760152912a187f295459949bf0282ea19bb6ef2976852dc1a66');
  });

  it('hashes raw bytes (multipart bodies are hashed as received)', () => {
    const bytes = new TextEncoder().encode('--b\r\nContent-Disposition: form-data; name="image"\r\n\r\nÿ\r\n--b--');
    expect(sha256Hex(bytes)).toBe(sha256Hex(Buffer.from(bytes)));
    expect(sha256Hex(bytes.buffer)).toBe(sha256Hex(bytes));
  });

  it('output is lower-case hex', () => {
    expect(computeRequestHash({ method: 'GET', path: '/', bodySha256: EMPTY_BODY_SHA256, nonce: 'n', deviceId: 'd' })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('headers and parsing', () => {
  it('header names are fixed', () => {
    expect(INTEGRITY_HEADERS).toMatchObject({ token: 'x-integrity-token', nonce: 'x-integrity-nonce', deviceId: 'x-device-id', clientError: 'x-integrity-error' });
    expect(INTEGRITY_FEATURE).toBe('integrity_v1');
  });

  it('X-Client-Features is a comma list, case-insensitive', () => {
    expect(hasClientFeature('icon_keys, integrity_v1', 'integrity_v1')).toBe(true);
    expect(hasClientFeature('INTEGRITY_V1', 'integrity_v1')).toBe(true);
    expect(hasClientFeature('integrity_v10', 'integrity_v1')).toBe(false);
    expect(hasClientFeature(null, 'integrity_v1')).toBe(false);
  });

  it('device ids: 4-128 of [A-Za-z0-9._:-]', () => {
    expect(normalizeDeviceId(' 00000000-0000-4000-8000-000000000001 ')).toBe('00000000-0000-4000-8000-000000000001');
    expect(normalizeDeviceId('dev-1')).toBe('dev-1');
    expect(normalizeDeviceId('abc')).toBeNull();
    expect(normalizeDeviceId('has space')).toBeNull();
  });

  it('nonces: 16-128 base64url chars', () => {
    expect(isWellFormedNonce('a'.repeat(54))).toBe(true);
    expect(isWellFormedNonce('short')).toBe(false);
    expect(isWellFormedNonce('a+b/c=' + 'x'.repeat(20))).toBe(false);
  });
});
