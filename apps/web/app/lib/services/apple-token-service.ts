/**
 * Sign in with Apple: server-to-server token exchange and revocation.
 *
 * Apple requires apps that offer Sign in with Apple to revoke the user's tokens
 * when the account is deleted (App Store Review Guideline 5.1.1(v)).
 *
 *   sign-in   : authorization_code -> POST /auth/token  -> refresh_token (stored)
 *   deletion  : refresh_token      -> POST /auth/revoke
 *
 * Configuration (all four are required, otherwise every function is a no-op):
 *   APPLE_TEAM_ID      Apple Developer team id (JWT `iss`)
 *   APPLE_KEY_ID       id of the "Sign in with Apple" key (JWT header `kid`)
 *   APPLE_PRIVATE_KEY  the .p8 key, PEM; `\n`-escaped newlines are accepted
 *   APPLE_CLIENT_ID    the app's bundle id for native sign-in (JWT `sub`)
 *
 * Nothing here throws. Callers (sign-in, account deletion) must never fail
 * because Apple is slow, unreachable or not configured.
 *
 * Tokens and the client secret are never logged.
 */
import { createPrivateKey, sign as signBytes, type KeyObject } from 'crypto';

import { createAdminSupabase } from '../supabase-admin';

export const APPLE_ISSUER_AUDIENCE = 'https://appleid.apple.com';
export const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
export const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
export const APPLE_AUTH_TOKENS_TABLE = 'apple_auth_tokens';

/** Apple's maximum lifetime for a client secret: 15777000 s (6 months). */
export const APPLE_CLIENT_SECRET_MAX_TTL_SECONDS = 15_777_000;
/** A fresh secret is signed for every call, so a short lifetime is enough. */
const CLIENT_SECRET_TTL_SECONDS = 5 * 60;
const REQUEST_TIMEOUT_MS = 8_000;

interface AppleConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  clientId: string;
}

let warnedNotConfigured = false;

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

/** Accepts a PEM with real or `\n`-escaped newlines, quoted or not, or the bare base64 body. */
function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '').trim();
  if (key && !key.includes('-----BEGIN')) {
    const body = key.replace(/\s+/g, '');
    const lines = body.match(/.{1,64}/g) ?? [];
    key = `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
  }
  return key;
}

function readConfig(): AppleConfig | null {
  const teamId = env('APPLE_TEAM_ID');
  const keyId = env('APPLE_KEY_ID');
  const privateKey = env('APPLE_PRIVATE_KEY');
  const clientId = env('APPLE_CLIENT_ID');
  if (!teamId || !keyId || !privateKey || !clientId) return null;
  return { teamId, keyId, privateKey: normalizePrivateKey(privateKey), clientId };
}

function configOrWarn(): AppleConfig | null {
  const config = readConfig();
  if (!config && !warnedNotConfigured) {
    warnedNotConfigured = true;
    console.warn(
      '[AppleTokenService] Not configured (APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, ' +
        'APPLE_CLIENT_ID): Apple token exchange and revocation are skipped.'
    );
  }
  return config;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

async function postForm(url: string, form: Record<string, string>): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Apple error bodies are `{ "error": "invalid_grant" }`; only that code is logged. */
async function appleErrorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body?.error === 'string' ? body.error : 'unknown';
  } catch {
    return 'unknown';
  }
}

function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const text = (error.message ?? '').toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    text.includes('does not exist') ||
    text.includes('could not find the table')
  );
}

export class AppleTokenService {
  /** False when any of the four environment variables is missing. */
  static isConfigured(): boolean {
    return readConfig() !== null;
  }

  /**
   * The ES256 client secret Apple expects as `client_secret`
   * ("Generate and validate tokens"). Null when not configured or when the
   * private key cannot be read.
   */
  static buildClientSecret(nowSeconds: number = Math.floor(Date.now() / 1000)): string | null {
    const config = configOrWarn();
    if (!config) return null;

    let key: KeyObject;
    try {
      key = createPrivateKey(config.privateKey);
    } catch {
      console.error('[AppleTokenService] APPLE_PRIVATE_KEY is not a valid PEM private key');
      return null;
    }

    try {
      const header = { alg: 'ES256', kid: config.keyId, typ: 'JWT' };
      const payload = {
        iss: config.teamId,
        iat: nowSeconds,
        exp: nowSeconds + Math.min(CLIENT_SECRET_TTL_SECONDS, APPLE_CLIENT_SECRET_MAX_TTL_SECONDS),
        aud: APPLE_ISSUER_AUDIENCE,
        sub: config.clientId,
      };
      const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
      // JWS wants the raw r||s signature (IEEE P1363), not the DER default.
      const signature = signBytes('sha256', Buffer.from(signingInput), {
        key,
        dsaEncoding: 'ieee-p1363',
      });
      return `${signingInput}.${base64url(signature)}`;
    } catch (error) {
      console.error(
        '[AppleTokenService] Could not sign the client secret:',
        error instanceof Error ? error.message : 'unknown error'
      );
      return null;
    }
  }

  /**
   * Exchange the authorization code the app received at sign-in for a refresh
   * token. Codes are single use and expire after five minutes.
   * Returns null when not configured or when Apple rejects the code.
   */
  static async exchangeAuthorizationCode(code: string | null | undefined): Promise<string | null> {
    const authorizationCode = (code ?? '').trim();
    if (!authorizationCode) return null;

    const config = configOrWarn();
    if (!config) return null;
    const clientSecret = this.buildClientSecret();
    if (!clientSecret) return null;

    try {
      const response = await postForm(APPLE_TOKEN_URL, {
        client_id: config.clientId,
        client_secret: clientSecret,
        code: authorizationCode,
        grant_type: 'authorization_code',
      });
      if (!response) return null;
      if (!response.ok) {
        console.error(
          `[AppleTokenService] Code exchange failed: HTTP ${response.status} (${await appleErrorCode(response)})`
        );
        return null;
      }
      const body = (await response.json()) as { refresh_token?: unknown };
      const refreshToken = typeof body?.refresh_token === 'string' ? body.refresh_token.trim() : '';
      if (!refreshToken) {
        console.error('[AppleTokenService] Code exchange returned no refresh token');
        return null;
      }
      return refreshToken;
    } catch (error) {
      console.error(
        '[AppleTokenService] Code exchange request failed:',
        error instanceof Error ? error.message : 'unknown error'
      );
      return null;
    }
  }

  /**
   * Revoke a refresh token. True when Apple confirmed the revocation.
   * False when not configured, on any error, and for an empty token.
   */
  static async revokeToken(refreshToken: string | null | undefined): Promise<boolean> {
    const token = (refreshToken ?? '').trim();
    if (!token) return false;

    const config = configOrWarn();
    if (!config) return false;
    const clientSecret = this.buildClientSecret();
    if (!clientSecret) return false;

    try {
      const response = await postForm(APPLE_REVOKE_URL, {
        client_id: config.clientId,
        client_secret: clientSecret,
        token,
        token_type_hint: 'refresh_token',
      });
      if (!response) return false;
      if (!response.ok) {
        console.error(
          `[AppleTokenService] Revocation failed: HTTP ${response.status} (${await appleErrorCode(response)})`
        );
        return false;
      }
      return true;
    } catch (error) {
      console.error(
        '[AppleTokenService] Revocation request failed:',
        error instanceof Error ? error.message : 'unknown error'
      );
      return false;
    }
  }

  /**
   * Sign-in helper: exchange the code and keep the refresh token for the day the
   * account is deleted. True when a token was stored. Never throws, so a sign-in
   * can await it safely. Needs the `apple_auth_tokens` table.
   */
  static async exchangeAndStoreRefreshToken(
    userId: string,
    code: string | null | undefined
  ): Promise<boolean> {
    try {
      if (!userId || !this.isConfigured()) {
        if (code) configOrWarn();
        return false;
      }
      const refreshToken = await this.exchangeAuthorizationCode(code);
      if (!refreshToken) return false;

      const now = new Date().toISOString();
      const { error } = await createAdminSupabase()
        .from(APPLE_AUTH_TOKENS_TABLE)
        .upsert(
          { user_id: userId, refresh_token: refreshToken, updated_at: now },
          { onConflict: 'user_id' }
        );
      if (error) {
        console.error(
          isMissingTable(error)
            ? `[AppleTokenService] Table ${APPLE_AUTH_TOKENS_TABLE} does not exist yet; refresh token not stored`
            : `[AppleTokenService] Could not store the refresh token: ${error.message}`
        );
        return false;
      }
      return true;
    } catch (error) {
      console.error(
        '[AppleTokenService] Could not store the refresh token:',
        error instanceof Error ? error.message : 'unknown error'
      );
      return false;
    }
  }

  /** The stored refresh token, or null (no row, table missing, any error). Never throws. */
  static async getStoredRefreshToken(userId: string): Promise<string | null> {
    try {
      const { data, error } = await createAdminSupabase()
        .from(APPLE_AUTH_TOKENS_TABLE)
        .select('refresh_token')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        if (!isMissingTable(error)) {
          console.error(`[AppleTokenService] Could not read the refresh token: ${error.message}`);
        }
        return null;
      }
      const token = typeof data?.refresh_token === 'string' ? data.refresh_token.trim() : '';
      return token || null;
    } catch (error) {
      console.error(
        '[AppleTokenService] Could not read the refresh token:',
        error instanceof Error ? error.message : 'unknown error'
      );
      return null;
    }
  }
}

/** Test hook: the "not configured" warning is printed once per process. */
export function resetAppleTokenServiceWarningForTests(): void {
  warnedNotConfigured = false;
}
