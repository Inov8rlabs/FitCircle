import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * MobileAPIService.authenticateWithToken runs the token-blacklist check and the
 * profile fetch in parallel (one round trip on every authenticated request) —
 * but a revoked token must still be rejected.
 */
const db = vi.hoisted(() => ({
  blacklisted: false,
  blacklistThrows: false,
  profile: { id: 'u1', email: 'a@example.com', subscription_tier: 'free' } as Record<string, any> | null,
  inFlight: 0,
  maxInFlight: 0,
}));

vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            db.inFlight++;
            db.maxInFlight = Math.max(db.maxInFlight, db.inFlight);
            await new Promise((r) => setTimeout(r, 5));
            db.inFlight--;
            if (table === 'token_blacklist') {
              if (db.blacklistThrows) throw new Error('network');
              return db.blacklisted
                ? { data: { id: 'b1' }, error: null }
                : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
            }
            return db.profile ? { data: db.profile, error: null } : { data: null, error: { code: 'PGRST116' } };
          },
        }),
      }),
    }),
  }),
}));

import { MobileAPIService } from '../mobile-api-service';

let accessToken = '';

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-access-secret-0123456789abcdef';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef';
  accessToken = (await MobileAPIService.generateTokens('u1', 'a@example.com')).access_token;
});

beforeEach(() => {
  Object.assign(db, {
    blacklisted: false,
    blacklistThrows: false,
    profile: { id: 'u1', email: 'a@example.com', subscription_tier: 'free' },
    inFlight: 0,
    maxInFlight: 0,
  });
});

describe('authenticateWithToken', () => {
  it('returns the profile, with the blacklist check and profile fetch in flight together', async () => {
    expect(await MobileAPIService.authenticateWithToken(accessToken)).toMatchObject({ id: 'u1' });
    expect(db.maxInFlight).toBe(2);
  });

  it('rejects a blacklisted token even though the profile was fetched', async () => {
    db.blacklisted = true;
    expect(await MobileAPIService.authenticateWithToken(accessToken)).toBeNull();
  });

  it('rejects when the blacklist check throws (same as verifyAccessToken)', async () => {
    db.blacklistThrows = true;
    expect(await MobileAPIService.authenticateWithToken(accessToken)).toBeNull();
    expect(await MobileAPIService.verifyAccessToken(accessToken)).toBeNull();
  });

  it('rejects a bad token without touching the database', async () => {
    expect(await MobileAPIService.authenticateWithToken('not-a-jwt')).toBeNull();
    expect(db.maxInFlight).toBe(0);
  });

  it('returns null when the profile is missing', async () => {
    db.profile = null;
    expect(await MobileAPIService.authenticateWithToken(accessToken)).toBeNull();
  });
});
