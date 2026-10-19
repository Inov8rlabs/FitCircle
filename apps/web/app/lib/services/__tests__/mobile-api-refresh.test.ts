import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MobileAPIService.refreshAccessToken: only a bad token or a deleted account is
 * an invalid session (null → 401, which signs the apps out). A database error
 * must throw (→ 500, which the apps retry) — users were being signed out by
 * transient profile-lookup failures.
 */
const db = {
  result: { data: { id: 'u1', email: 'a@example.com' } as Record<string, any> | null, error: null as { message: string } | null },
};

vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => db.result }) }),
    }),
  }),
}));

import { MobileAPIService } from '../mobile-api-service';

let refreshToken = '';

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-access-secret-0123456789abcdef';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef';
  refreshToken = (await MobileAPIService.generateTokens('u1', 'a@example.com')).refresh_token;
});

beforeEach(() => {
  db.result = { data: { id: 'u1', email: 'a@example.com' }, error: null };
});

describe('refreshAccessToken', () => {
  it('issues a new token pair for a valid refresh token', async () => {
    const tokens = await MobileAPIService.refreshAccessToken(refreshToken);
    expect(tokens?.access_token).toBeTruthy();
    expect(tokens?.refresh_token).toBeTruthy();
  });

  it('returns null for a malformed or foreign token', async () => {
    expect(await MobileAPIService.refreshAccessToken('not-a-jwt')).toBeNull();
  });

  it('returns null when the account no longer exists', async () => {
    db.result = { data: null, error: null };
    expect(await MobileAPIService.refreshAccessToken(refreshToken)).toBeNull();
  });

  it('throws (500) instead of returning null (401) when the profile lookup fails', async () => {
    db.result = { data: null, error: { message: 'connection terminated' } };
    await expect(MobileAPIService.refreshAccessToken(refreshToken)).rejects.toThrow(/profile lookup failed/);
  });
});
