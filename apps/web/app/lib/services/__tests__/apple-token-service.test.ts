import { createPublicKey, generateKeyPairSync, verify } from 'crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import {
  APPLE_AUTH_TOKENS_TABLE,
  APPLE_CLIENT_SECRET_MAX_TTL_SECONDS,
  APPLE_REVOKE_URL,
  APPLE_TOKEN_URL,
  AppleTokenService,
  resetAppleTokenServiceWarningForTests,
} from '../apple-token-service';

let currentDb: any;
vi.mock('../../supabase-admin', () => ({
  createAdminSupabase: () => currentDb,
}));

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ENV_KEYS = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_CLIENT_ID'] as const;

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const savedEnv: Record<string, string | undefined> = {};
let fetchMock: ReturnType<typeof vi.fn>;

function configure(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}) {
  const values: Record<string, string | undefined> = {
    APPLE_TEAM_ID: 'TEAM123456',
    APPLE_KEY_ID: 'KEY1234567',
    APPLE_PRIVATE_KEY: PRIVATE_PEM,
    APPLE_CLIENT_ID: 'com.inov8rlabs.apps.fitcircle',
    ...overrides,
  };
  for (const key of ENV_KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function decodeJwt(jwt: string) {
  const [header, payload, signature] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(payload, 'base64url').toString()),
    signingInput: `${header}.${payload}`,
    signature: Buffer.from(signature, 'base64url'),
  };
}

function formOf(call: unknown[]): URLSearchParams {
  return new URLSearchParams((call[1] as RequestInit).body as string);
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetAppleTokenServiceWarningForTests();
  currentDb = new FakeSupabase({ [APPLE_AUTH_TOKENS_TABLE]: { uniqueKey: ['user_id'] } });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AppleTokenService.isConfigured', () => {
  it('is true only when all four variables are set', () => {
    expect(AppleTokenService.isConfigured()).toBe(false);
    configure();
    expect(AppleTokenService.isConfigured()).toBe(true);
  });

  it.each(ENV_KEYS)('is false when %s is missing', (key) => {
    configure({ [key]: undefined });
    expect(AppleTokenService.isConfigured()).toBe(false);
  });

  it.each(ENV_KEYS)('is false when %s is blank', (key) => {
    configure({ [key]: '   ' });
    expect(AppleTokenService.isConfigured()).toBe(false);
  });
});

describe('AppleTokenService when not configured', () => {
  it('does nothing, calls nobody and warns once', async () => {
    configure({ APPLE_PRIVATE_KEY: undefined });

    expect(AppleTokenService.buildClientSecret()).toBeNull();
    expect(await AppleTokenService.exchangeAuthorizationCode('code-1')).toBeNull();
    expect(await AppleTokenService.revokeToken('refresh-1')).toBe(false);
    expect(await AppleTokenService.exchangeAndStoreRefreshToken(USER, 'code-1')).toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(currentDb.getRows(APPLE_AUTH_TOKENS_TABLE)).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe('AppleTokenService.buildClientSecret', () => {
  it('signs an ES256 JWT with the claims Apple requires', () => {
    configure();
    const now = 1_790_000_000;

    const jwt = AppleTokenService.buildClientSecret(now);
    expect(jwt).toBeTruthy();

    const { header, payload, signingInput, signature } = decodeJwt(jwt!);
    expect(header).toMatchObject({ alg: 'ES256', kid: 'KEY1234567' });
    expect(payload).toMatchObject({
      iss: 'TEAM123456',
      sub: 'com.inov8rlabs.apps.fitcircle',
      aud: 'https://appleid.apple.com',
      iat: now,
    });
    expect(payload.exp).toBeGreaterThan(now);
    expect(payload.exp - now).toBeLessThanOrEqual(APPLE_CLIENT_SECRET_MAX_TTL_SECONDS);

    // JWS ES256 signatures are the raw 64-byte r||s pair, not DER.
    expect(signature).toHaveLength(64);
    expect(
      verify(
        'sha256',
        Buffer.from(signingInput),
        { key: createPublicKey(PUBLIC_PEM), dsaEncoding: 'ieee-p1363' },
        signature
      )
    ).toBe(true);
  });

  it('accepts a key with \\n-escaped newlines, quoted', () => {
    configure({ APPLE_PRIVATE_KEY: `"${PRIVATE_PEM.trim().replace(/\n/g, '\\n')}"` });

    const jwt = AppleTokenService.buildClientSecret();
    expect(jwt).toBeTruthy();

    const { signingInput, signature } = decodeJwt(jwt!);
    expect(
      verify(
        'sha256',
        Buffer.from(signingInput),
        { key: createPublicKey(PUBLIC_PEM), dsaEncoding: 'ieee-p1363' },
        signature
      )
    ).toBe(true);
  });

  it('accepts the bare base64 body of the key', () => {
    const body = PRIVATE_PEM.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
    configure({ APPLE_PRIVATE_KEY: body });
    expect(AppleTokenService.buildClientSecret()).toBeTruthy();
  });

  it('returns null for a key that cannot be read, without throwing or logging it', () => {
    configure({ APPLE_PRIVATE_KEY: 'not-a-key' });
    expect(AppleTokenService.buildClientSecret()).toBeNull();
    const logged = JSON.stringify((console.error as any).mock.calls);
    expect(logged).not.toContain('not-a-key');
  });
});

describe('AppleTokenService.exchangeAuthorizationCode', () => {
  it('posts the code to /auth/token and returns the refresh token', async () => {
    configure();
    fetchMock.mockResolvedValue(
      jsonResponse(200, { access_token: 'a', refresh_token: 'refresh-1', id_token: 'i' })
    );

    expect(await AppleTokenService.exchangeAuthorizationCode(' code-1 ')).toBe('refresh-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe(APPLE_TOKEN_URL);
    expect(call[0]).toBe('https://appleid.apple.com/auth/token');
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const form = formOf(call);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('code-1');
    expect(form.get('client_id')).toBe('com.inov8rlabs.apps.fitcircle');
    expect(decodeJwt(form.get('client_secret')!).header.alg).toBe('ES256');
  });

  it('returns null when Apple rejects the code', async () => {
    configure();
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'invalid_grant' }));
    expect(await AppleTokenService.exchangeAuthorizationCode('used-code')).toBeNull();
  });

  it('returns null when the response has no refresh token', async () => {
    configure();
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'a' }));
    expect(await AppleTokenService.exchangeAuthorizationCode('code-1')).toBeNull();
  });

  it('returns null when the request fails', async () => {
    configure();
    fetchMock.mockRejectedValue(new Error('network down'));
    expect(await AppleTokenService.exchangeAuthorizationCode('code-1')).toBeNull();
  });

  it('does not call Apple without a code', async () => {
    configure();
    expect(await AppleTokenService.exchangeAuthorizationCode(undefined)).toBeNull();
    expect(await AppleTokenService.exchangeAuthorizationCode('  ')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AppleTokenService.revokeToken', () => {
  it('posts the refresh token to /auth/revoke', async () => {
    configure();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    expect(await AppleTokenService.revokeToken('refresh-1')).toBe(true);

    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe(APPLE_REVOKE_URL);
    expect(call[0]).toBe('https://appleid.apple.com/auth/revoke');
    expect(call[1].method).toBe('POST');

    const form = formOf(call);
    expect(form.get('token')).toBe('refresh-1');
    expect(form.get('token_type_hint')).toBe('refresh_token');
    expect(form.get('client_id')).toBe('com.inov8rlabs.apps.fitcircle');
    expect(form.get('client_secret')).toBeTruthy();
  });

  it('returns false on an error response, without logging the token', async () => {
    configure();
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'invalid_client' }));

    expect(await AppleTokenService.revokeToken('refresh-secret-value')).toBe(false);
    expect(JSON.stringify((console.error as any).mock.calls)).not.toContain('refresh-secret-value');
  });

  it('returns false when the request fails', async () => {
    configure();
    fetchMock.mockRejectedValue(new Error('timeout'));
    expect(await AppleTokenService.revokeToken('refresh-1')).toBe(false);
  });

  it('does not call Apple without a token', async () => {
    configure();
    expect(await AppleTokenService.revokeToken('')).toBe(false);
    expect(await AppleTokenService.revokeToken(null)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AppleTokenService refresh token storage', () => {
  it('stores the token at sign-in and replaces it at the next one', async () => {
    configure();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { refresh_token: 'refresh-1' }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { refresh_token: 'refresh-2' }));

    expect(await AppleTokenService.exchangeAndStoreRefreshToken(USER, 'code-1')).toBe(true);
    expect(await AppleTokenService.getStoredRefreshToken(USER)).toBe('refresh-1');

    expect(await AppleTokenService.exchangeAndStoreRefreshToken(USER, 'code-2')).toBe(true);
    expect(currentDb.getRows(APPLE_AUTH_TOKENS_TABLE)).toHaveLength(1);
    expect(await AppleTokenService.getStoredRefreshToken(USER)).toBe('refresh-2');
  });

  it('stores nothing when the exchange fails', async () => {
    configure();
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'invalid_grant' }));

    expect(await AppleTokenService.exchangeAndStoreRefreshToken(USER, 'code-1')).toBe(false);
    expect(currentDb.getRows(APPLE_AUTH_TOKENS_TABLE)).toHaveLength(0);
  });

  it('returns null when the user has no token', async () => {
    expect(await AppleTokenService.getStoredRefreshToken(USER)).toBeNull();
  });

  it('tolerates the table not existing yet', async () => {
    configure();
    fetchMock.mockResolvedValue(jsonResponse(200, { refresh_token: 'refresh-1' }));
    const missing = {
      code: 'PGRST205',
      message: "Could not find the table 'public.apple_auth_tokens' in the schema cache",
    };
    currentDb = {
      from: () => ({
        upsert: () => Promise.resolve({ data: null, error: missing }),
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: missing }) }),
        }),
      }),
    };

    expect(await AppleTokenService.exchangeAndStoreRefreshToken(USER, 'code-1')).toBe(false);
    expect(await AppleTokenService.getStoredRefreshToken(USER)).toBeNull();
  });

  it('never throws when the database client does', async () => {
    configure();
    fetchMock.mockResolvedValue(jsonResponse(200, { refresh_token: 'refresh-1' }));
    currentDb = {
      from: () => {
        throw new Error('connection refused');
      },
    };

    expect(await AppleTokenService.exchangeAndStoreRefreshToken(USER, 'code-1')).toBe(false);
    expect(await AppleTokenService.getStoredRefreshToken(USER)).toBeNull();
  });
});
