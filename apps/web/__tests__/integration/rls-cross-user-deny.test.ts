/**
 * RLS cross-user deny test (migration 069_security_rls_hardening_crossuser.sql)
 *
 * This suite hits a REAL Supabase project (no mocks) using the public anon key,
 * exactly the way the browser client does, and proves that after migration 069:
 *   - User B cannot SELECT user A's rows on profiles / fitcircle_members / daily_tracking
 *   - User B CAN still SELECT their own rows on those tables (own-row floor intact)
 *   - User B CAN read user A's public_profiles row, and it exposes ONLY
 *     id/username/display_name/avatar_url (no email/weight/etc.)
 *
 * It is intentionally NOT run in normal unit-test CI: it requires a live Supabase
 * project with migration 069 applied and two pre-seeded, confirmed test users.
 * The whole suite no-ops (describe.skip) unless all required env vars are set.
 *
 * ── Required env vars to run this against staging ──────────────────────────
 *   RLS_TEST_SUPABASE_URL           - staging Supabase project URL
 *   RLS_TEST_SUPABASE_ANON_KEY      - staging anon (publishable) key
 *   RLS_TEST_USER_A_EMAIL           - seeded test user A email
 *   RLS_TEST_USER_A_PASSWORD        - seeded test user A password
 *   RLS_TEST_USER_B_EMAIL           - seeded test user B email
 *   RLS_TEST_USER_B_PASSWORD        - seeded test user B password
 *
 * Seed requirements for users A and B on that project:
 *   - Both have a row in `profiles` (username/display_name/email/avatar_url set).
 *   - Both belong to at least one row each in `fitcircle_members`
 *     (start/current/goal weight populated) and `daily_tracking`.
 *   - A and B must NOT share a fitcircle_members row / daily_tracking row.
 *
 * Run with, e.g.:
 *   RLS_TEST_SUPABASE_URL=https://xyz.supabase.co \
 *   RLS_TEST_SUPABASE_ANON_KEY=eyJ... \
 *   RLS_TEST_USER_A_EMAIL=rls-test-a@example.com RLS_TEST_USER_A_PASSWORD=... \
 *   RLS_TEST_USER_B_EMAIL=rls-test-b@example.com RLS_TEST_USER_B_PASSWORD=... \
 *   npx vitest run __tests__/integration/rls-cross-user-deny.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.RLS_TEST_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.RLS_TEST_SUPABASE_ANON_KEY;
const USER_A_EMAIL = process.env.RLS_TEST_USER_A_EMAIL;
const USER_A_PASSWORD = process.env.RLS_TEST_USER_A_PASSWORD;
const USER_B_EMAIL = process.env.RLS_TEST_USER_B_EMAIL;
const USER_B_PASSWORD = process.env.RLS_TEST_USER_B_PASSWORD;

const HAS_RLS_TEST_ENV = Boolean(
  SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    USER_A_EMAIL &&
    USER_A_PASSWORD &&
    USER_B_EMAIL &&
    USER_B_PASSWORD
);

// Real client factory (never mocked) — mirrors how the browser creates a client.
function makeAnonClient(): SupabaseClient {
  return createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describe.skipIf(!HAS_RLS_TEST_ENV)(
  'RLS cross-user deny (migration 069) — live Supabase',
  () => {
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;
    let userAId: string;
    let userBId: string;

    beforeAll(async () => {
      clientA = makeAnonClient();
      clientB = makeAnonClient();

      const { data: signInA, error: errA } = await clientA.auth.signInWithPassword({
        email: USER_A_EMAIL as string,
        password: USER_A_PASSWORD as string,
      });
      if (errA || !signInA.user) {
        throw new Error(`Failed to sign in RLS test user A: ${errA?.message}`);
      }
      userAId = signInA.user.id;

      const { data: signInB, error: errB } = await clientB.auth.signInWithPassword({
        email: USER_B_EMAIL as string,
        password: USER_B_PASSWORD as string,
      });
      if (errB || !signInB.user) {
        throw new Error(`Failed to sign in RLS test user B: ${errB?.message}`);
      }
      userBId = signInB.user.id;
    });

    afterAll(async () => {
      await clientA?.auth.signOut();
      await clientB?.auth.signOut();
    });

    describe('negative controls — B cannot read A sensitive rows', () => {
      it('cannot SELECT user A profile row (no email leak)', async () => {
        const { data, error } = await clientB
          .from('profiles')
          .select('*')
          .eq('id', userAId);

        // RLS silently filters rows rather than erroring.
        expect(error).toBeNull();
        expect(data ?? []).toHaveLength(0);
      });

      it('cannot SELECT user A fitcircle_members row (goal/weight data)', async () => {
        const { data, error } = await clientB
          .from('fitcircle_members')
          .select('*')
          .eq('user_id', userAId);

        expect(error).toBeNull();
        expect(data ?? []).toHaveLength(0);
      });

      it('cannot SELECT user A daily_tracking row (weight/steps/mood)', async () => {
        const { data, error } = await clientB
          .from('daily_tracking')
          .select('*')
          .eq('user_id', userAId);

        expect(error).toBeNull();
        expect(data ?? []).toHaveLength(0);
      });
    });

    describe('positive controls — own-row floor still works', () => {
      it('CAN SELECT own profile row', async () => {
        const { data, error } = await clientB
          .from('profiles')
          .select('*')
          .eq('id', userBId);

        expect(error).toBeNull();
        expect(data?.length).toBeGreaterThan(0);
        expect(data?.[0]?.id).toBe(userBId);
      });

      it('CAN SELECT own fitcircle_members row(s)', async () => {
        const { data, error } = await clientB
          .from('fitcircle_members')
          .select('*')
          .eq('user_id', userBId);

        expect(error).toBeNull();
        expect(data?.length).toBeGreaterThan(0);
        for (const row of data ?? []) {
          expect(row.user_id).toBe(userBId);
        }
      });

      it('CAN SELECT own daily_tracking row(s)', async () => {
        const { data, error } = await clientB
          .from('daily_tracking')
          .select('*')
          .eq('user_id', userBId);

        expect(error).toBeNull();
        expect(data?.length).toBeGreaterThan(0);
        for (const row of data ?? []) {
          expect(row.user_id).toBe(userBId);
        }
      });
    });

    describe('public_profiles view — column-limited cross-user read', () => {
      it('B CAN read A via public_profiles, and only non-sensitive columns are exposed', async () => {
        const { data, error } = await clientB
          .from('public_profiles')
          .select('*')
          .eq('id', userAId);

        expect(error).toBeNull();
        expect(data?.length).toBeGreaterThan(0);

        const row = data?.[0] as Record<string, unknown>;
        const columns = Object.keys(row).sort();

        expect(columns).toEqual(['avatar_url', 'display_name', 'id', 'username'].sort());

        // Explicitly assert sensitive columns never appear on this view's rows.
        expect(row).not.toHaveProperty('email');
        expect(row).not.toHaveProperty('weight_kg');
        expect(row).not.toHaveProperty('phone_number');
        expect(row).not.toHaveProperty('stripe_customer_id');
        expect(row).not.toHaveProperty('date_of_birth');
      });
    });
  }
);

// Always-on guard so this file registers at least one visible result in normal
// unit-test CI runs, making it obvious the live suite was intentionally skipped
// rather than silently absent.
describe('RLS cross-user deny suite gating', () => {
  it('documents whether the live RLS suite ran', () => {
    if (!HAS_RLS_TEST_ENV) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rls-cross-user-deny] Skipped live RLS deny test: set RLS_TEST_SUPABASE_URL, ' +
          'RLS_TEST_SUPABASE_ANON_KEY, RLS_TEST_USER_A_EMAIL, RLS_TEST_USER_A_PASSWORD, ' +
          'RLS_TEST_USER_B_EMAIL, RLS_TEST_USER_B_PASSWORD to run it against staging.'
      );
    }
    expect(typeof HAS_RLS_TEST_ENV).toBe('boolean');
  });
});
