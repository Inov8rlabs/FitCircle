import { describe, expect, it } from 'vitest';

import { SocialAuthError, findOrCreateSocialUser } from '../social-auth-service';

/**
 * Minimal in-memory stand-in for the two Supabase surfaces the service touches:
 * `from('profiles')` query chains and `auth.admin.{createUser,listUsers}`.
 */
function fakeSupabase(opts: {
  profiles?: Array<Record<string, any>>;
  authUsers?: Array<{ id: string; email: string }>;
  createUserError?: { message: string; code?: string };
  upsertError?: { message: string };
}) {
  const profiles = [...(opts.profiles ?? [])];
  const authUsers = [...(opts.authUsers ?? [])];
  const calls: string[] = [];

  function query() {
    const filters: Array<(row: Record<string, any>) => boolean> = [];
    let pendingUpsert: Record<string, any> | null = null;
    let pendingUpdate: Record<string, any> | null = null;
    const chain: any = {
      select() { return chain; },
      limit() { return chain; },
      ilike(col: string, value: string) {
        filters.push((r) => String(r[col] ?? '').toLowerCase() === value.toLowerCase());
        return chain;
      },
      eq(col: string, value: unknown) {
        filters.push((r) => r[col] === value);
        if (pendingUpdate) {
          for (const row of profiles.filter((r) => filters.every((f) => f(r)))) Object.assign(row, pendingUpdate);
          pendingUpdate = null;
        }
        return chain;
      },
      update(values: Record<string, any>) { pendingUpdate = values; calls.push('update'); return chain; },
      upsert(values: Record<string, any>) { pendingUpsert = values; calls.push('upsert'); return chain; },
      single() {
        if (pendingUpsert) {
          if (opts.upsertError) return Promise.resolve({ data: null, error: opts.upsertError });
          profiles.push(pendingUpsert);
          return Promise.resolve({ data: pendingUpsert, error: null });
        }
        return chain.maybeSingle();
      },
      maybeSingle() {
        const hit = profiles.find((r) => filters.every((f) => f(r))) ?? null;
        return Promise.resolve({ data: hit, error: null });
      },
      then(resolve: (v: unknown) => void) { resolve({ data: null, error: null }); },
    };
    return chain;
  }

  const supabase = {
    from: (table: string) => { calls.push(`from:${table}`); return query(); },
    auth: {
      admin: {
        createUser: async ({ email }: { email: string }) => {
          calls.push('createUser');
          if (opts.createUserError) return { data: { user: null }, error: opts.createUserError };
          const user = { id: `auth-${authUsers.length + 1}`, email };
          authUsers.push(user);
          return { data: { user }, error: null };
        },
        listUsers: async ({ page }: { page: number }) => {
          calls.push(`listUsers:${page}`);
          return { data: { users: page === 1 ? authUsers : [] }, error: null };
        },
      },
    },
  };
  return { supabase: supabase as any, profiles, calls };
}

const input = { firstName: 'Ani', lastName: 'B', provider: 'apple' as const, providerUserId: '001.abc' };

describe('findOrCreateSocialUser', () => {
  it('returns the existing account when a profile carries the email (case-insensitive) and is not new', async () => {
    const { supabase, calls } = fakeSupabase({
      profiles: [{ id: 'u1', email: 'Ani@Bajirao.me', username: 'ani' }],
    });
    const result = await findOrCreateSocialUser(supabase, { ...input, email: 'ani@bajirao.me' });
    expect(result).toMatchObject({ userId: 'u1', isNewUser: false });
    expect(calls).not.toContain('createUser');
  });

  it('creates auth user + profile with a valid unique username and reports new', async () => {
    const { supabase, profiles } = fakeSupabase({
      profiles: [{ id: 'other', email: 'x@y.com', username: 'fitcircle.user' }],
    });
    const result = await findOrCreateSocialUser(supabase, { ...input, email: 'fitcircle.user@gmail.com' });
    expect(result.isNewUser).toBe(true);
    expect(result.userId).toBe('auth-1');
    const created = profiles.find((p) => p.id === 'auth-1')!;
    expect(created.username).toBe('fitcircle.user2'); // base taken → suffix
    expect(created.display_name).toBe('Ani B');
    expect(created.onboarding_completed).toBe(false);
    expect(created.email).toBe('fitcircle.user@gmail.com');
  });

  it('falls back to the display name = username when Apple sends no name (Hide My Email)', async () => {
    const { supabase, profiles } = fakeSupabase({});
    await findOrCreateSocialUser(supabase, {
      email: 'k2j9x@privaterelay.appleid.com',
      provider: 'apple',
      providerUserId: '001.abc',
    });
    expect(profiles[0].display_name).toBe('k2j9x');
  });

  it('recovers an auth user that exists without a profile email and does not call them new', async () => {
    const { supabase, calls, profiles } = fakeSupabase({
      authUsers: [{ id: 'legacy', email: 'old@user.com' }],
      createUserError: { message: 'A user with this email address has already been registered', code: 'email_exists' },
    });
    const result = await findOrCreateSocialUser(supabase, { ...input, email: 'old@user.com' });
    expect(result).toMatchObject({ userId: 'legacy', isNewUser: false });
    expect(calls).toContain('listUsers:1');
    // No profile row existed for the legacy account → one is created so the app can load.
    expect(profiles.find((p) => p.id === 'legacy')).toBeTruthy();
  });

  it('surfaces createUser failures as USER_CREATION_FAILED', async () => {
    const { supabase } = fakeSupabase({ createUserError: { message: 'Database error' } });
    await expect(findOrCreateSocialUser(supabase, { ...input, email: 'new@user.com' })).rejects.toMatchObject({
      code: 'USER_CREATION_FAILED',
    });
  });

  it('surfaces profile upsert failures instead of silently returning a profile-less account', async () => {
    const { supabase } = fakeSupabase({ upsertError: { message: 'duplicate key value violates unique constraint' } });
    const err = await findOrCreateSocialUser(supabase, { ...input, email: 'new@user.com' }).catch((e) => e);
    expect(err).toBeInstanceOf(SocialAuthError);
    expect(err.code).toBe('PROFILE_CREATION_FAILED');
  });
});
