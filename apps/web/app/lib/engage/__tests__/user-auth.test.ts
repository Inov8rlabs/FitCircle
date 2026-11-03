import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFitCircleUserAuth } from '../user-auth';
const state = vi.hoisted(() => ({
  id: '11111111-1111-4111-8111-111111111111',
  revoked: false,
  offline: false,
}));
vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (state.offline) throw new Error('policy unavailable');
            return table === 'token_blacklist'
              ? state.revoked
                ? { data: { id: 'revoked' }, error: null }
                : { data: null, error: { code: 'PGRST116' } }
              : { data: { id: state.id }, error: null };
          },
        }),
      }),
    }),
  }),
}));
import { MobileAPIService } from '../../services/mobile-api-service';
beforeEach(() => {
  state.revoked = false;
  state.offline = false;
  vi.stubEnv('JWT_SECRET', 'engage-mobile-test-secret-with-32-characters');
  vi.stubEnv(
    'JWT_REFRESH_SECRET',
    'engage-mobile-test-refresh-secret-with-32-characters',
  );
});
afterEach(() => vi.unstubAllEnvs());
describe('FitCircle explicit bearer verifiers', () => {
  it('cannot relabel FitCircle credentials as another app', () => {
    expect(() => createFitCircleUserAuth({ app_id: 'foreign', environment: 'test' }, {
      web: async () => state.id, mobile: async () => state.id,
    })).toThrow('FitCircle auth cannot verify another app');
  });
  it('accepts verified mobile access tokens and rejects revoked, unavailable, refresh and foreign signatures without web fallback', async () => {
    const web = vi.fn(async () => randomUUID()),
      mobile = vi.fn(
        async (token: string) =>
          (await MobileAPIService.authenticateWithToken(token))?.id ?? null,
      );
    const auth = createFitCircleUserAuth(
      { app_id: 'fitcircle', environment: 'test' },
      { web, mobile },
    );
    const tokens = await MobileAPIService.generateTokens(
      state.id,
      'test@example.test',
    );
    const request = (token: string) =>
      new Request('https://fitcircle.test/api/engage/client/session', {
        headers: {
          authorization: `Bearer ${token}`,
          'x-engage-auth': 'fitcircle-mobile',
        },
      });
    expect(await auth(request(tokens.access_token))).toEqual({
      user_id: state.id,
      tenant: { app_id: 'fitcircle', environment: 'test' },
    });
    state.revoked = true;
    expect(await auth(request(tokens.access_token))).toBeNull();
    state.revoked = false;
    state.offline = true;
    expect(await auth(request(tokens.access_token))).toBeNull();
    state.offline = false;
    expect(await auth(request(tokens.refresh_token))).toBeNull();
    vi.stubEnv(
      'JWT_SECRET',
      'different-app-secret-with-more-than-32-characters',
    );
    expect(await auth(request(tokens.access_token))).toBeNull();
    expect(web).not.toHaveBeenCalled();
  });
  it('uses the verified web identity without accepting cookie identities, a selector as authority, or a malformed subject', async () => {
    const id = randomUUID(),
      web = vi.fn(async (): Promise<string> => id),
      mobile = vi.fn(async () => null);
    const auth = createFitCircleUserAuth(
      { app_id: 'fitcircle', environment: 'test' },
      { web, mobile },
    );
    expect(
      (
        await auth(
          new Request('https://app.test', {
            headers: {
              authorization: 'Bearer web-token',
              'x-user-id': randomUUID(),
              'x-app-id': 'foreign',
            },
          }),
        )
      )?.user_id,
    ).toBe(id);
    for (const headers of [
      { cookie: 'user=forged' },
      { authorization: 'Bearer token', 'x-engage-auth': 'unknown' },
    ] as Record<string, string>[])
      expect(
        await auth(new Request('https://app.test', { headers })),
      ).toBeNull();
    web.mockResolvedValue('bad-id');
    expect(
      await auth(
        new Request('https://app.test', {
          headers: { authorization: 'Bearer web-token' },
        }),
      ),
    ).toBeNull();
    expect(mobile).not.toHaveBeenCalled();
  });
});
