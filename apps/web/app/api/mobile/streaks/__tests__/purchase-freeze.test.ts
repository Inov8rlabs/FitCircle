/**
 * Shield purchase: the XP charge in the service and the route around it.
 * Real handler, real services, in-memory database.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { StreakShieldService } from '@/lib/services/streak-shield-service';
import { SHIELD_RULES, shieldXpPrice } from '@/lib/streaks/streak-config';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { makeStreakDb, type FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { POST as purchaseFreeze } from '../engagement/purchase-freeze/route';

vi.mock('@/lib/supabase-admin');

const USER = 'user-1';
let authedUser: { id: string } | null = { id: USER };
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authedUser) throw new Error('Unauthorized');
    return authedUser;
  }),
}));

let db: FakeSupabase;

function seedUser(opts: { tier?: string; shields?: number; earned?: number; spent?: number | null } = {}) {
  db.seed('profiles', [{ id: USER, subscription_tier: opts.tier ?? 'free' }]);
  db.seed('streak_shields', [
    { user_id: USER, shield_type: 'freeze', available_count: opts.shields ?? 0 },
    { user_id: USER, shield_type: 'milestone_shield', available_count: 0 },
    { user_id: USER, shield_type: 'purchased', available_count: 0 },
  ]);
  const ledger: Record<string, unknown> = {
    user_id: USER,
    current_streak: 4,
    longest_streak: 9,
    streak_freezes_available: opts.shields ?? 0,
    paused: false,
    total_points: opts.earned ?? 0,
  };
  // `spent: null` models a database without migration 095: the column is absent.
  if (opts.spent !== null) ledger.points_spent = opts.spent ?? 0;
  db.seed('engagement_streaks', [ledger]);
}

const shieldTotal = () =>
  db.getRows('streak_shields').reduce((sum, row) => sum + row.available_count, 0);
const ledgerRow = () => db.getRows('engagement_streaks')[0];

function request(body?: unknown, rawBody?: string): NextRequest {
  const hasBody = body !== undefined || rawBody !== undefined;
  return new NextRequest('http://localhost/api/mobile/streaks/engagement/purchase-freeze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: hasBody ? rawBody ?? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authedUser = { id: USER };
  db = makeStreakDb();
  (createAdminSupabase as any).mockReturnValue(db);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('shieldXpPrice', () => {
  it('is the price from the spec when nothing overrides it', () => {
    expect(shieldXpPrice()).toBe(100);
    expect(SHIELD_RULES.PURCHASE_PRICE_XP).toBe(100);
  });

  it('follows STREAK_SHIELD_XP_PRICE and switches off for anything that is not a price', () => {
    vi.stubEnv('STREAK_SHIELD_XP_PRICE', '250');
    expect(shieldXpPrice()).toBe(250);
    for (const off of ['0', 'off', '-5', '12.5', 'abc']) {
      vi.stubEnv('STREAK_SHIELD_XP_PRICE', off);
      expect(shieldXpPrice()).toBeNull();
    }
    vi.stubEnv('STREAK_SHIELD_XP_PRICE', '');
    expect(shieldXpPrice()).toBe(100);
  });
});

describe('StreakShieldService.purchaseWithXp', () => {
  it('charges the price and grants exactly one shield', async () => {
    seedUser({ earned: 250, shields: 1 });

    const result = await StreakShieldService.purchaseWithXp(USER);

    expect(result).toEqual({
      payment_method: 'xp',
      xp_spent: 100,
      xp_remaining: 150,
      new_freeze_count: 2,
    });
    expect(ledgerRow().points_spent).toBe(100);
    expect(ledgerRow().total_points).toBe(250); // earned XP is never lowered
    expect(shieldTotal()).toBe(2);
    expect(db.getRows('streak_shields').find(r => r.shield_type === 'purchased')!.available_count).toBe(1);
    expect(ledgerRow().streak_freezes_available).toBe(2); // legacy mirror
  });

  it('refuses when the balance is too low and changes nothing', async () => {
    seedUser({ earned: 180, spent: 100 });

    await expect(StreakShieldService.purchaseWithXp(USER)).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
      status: 400,
      details: { price: 100, xp_balance: 80, xp_missing: 20 },
    });
    expect(ledgerRow().points_spent).toBe(100);
    expect(shieldTotal()).toBe(0);
  });

  it('refuses at the shield cap before charging', async () => {
    seedUser({ earned: 500, shields: SHIELD_RULES.MAX_SHIELD_BALANCE });

    await expect(StreakShieldService.purchaseWithXp(USER)).rejects.toMatchObject({
      code: 'MAX_SHIELDS_REACHED',
      status: 400,
    });
    expect(ledgerRow().points_spent).toBe(0);
    expect(shieldTotal()).toBe(SHIELD_RULES.MAX_SHIELD_BALANCE);
  });

  it('refuses Pro users, who already have unlimited shields', async () => {
    seedUser({ earned: 500, tier: 'premium' });

    await expect(StreakShieldService.purchaseWithXp(USER)).rejects.toMatchObject({
      code: 'SHIELDS_UNLIMITED',
    });
    expect(ledgerRow().points_spent).toBe(0);
  });

  it('refuses when no price is configured', async () => {
    vi.stubEnv('STREAK_SHIELD_XP_PRICE', 'off');
    seedUser({ earned: 500 });

    await expect(StreakShieldService.purchaseWithXp(USER)).rejects.toMatchObject({
      code: 'PRICE_NOT_CONFIGURED',
      status: 503,
    });
    expect(ledgerRow().points_spent).toBe(0);
    expect(shieldTotal()).toBe(0);
  });

  it('a double tap grants one shield for one payment', async () => {
    seedUser({ earned: 1000 });

    const results = await Promise.allSettled([
      StreakShieldService.purchaseWithXp(USER),
      StreakShieldService.purchaseWithXp(USER),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'PURCHASE_IN_PROGRESS', status: 409 });

    expect(ledgerRow().points_spent).toBe(100);
    expect(shieldTotal()).toBe(1);
  });

  it('two purchases one after the other are two payments and two shields', async () => {
    seedUser({ earned: 1000 });

    await StreakShieldService.purchaseWithXp(USER);
    const second = await StreakShieldService.purchaseWithXp(USER);

    expect(second.new_freeze_count).toBe(2);
    expect(second.xp_remaining).toBe(800);
    expect(ledgerRow().points_spent).toBe(200);
    expect(shieldTotal()).toBe(2);
  });

  it('refunds the XP when the shield cannot be banked', async () => {
    seedUser({ earned: 300 });
    // The bank fills up between the first inventory check and the grant.
    const realGetInventory = StreakShieldService.getInventory.bind(StreakShieldService);
    let calls = 0;
    const spy = vi.spyOn(StreakShieldService, 'getInventory').mockImplementation(async (id: string) => {
      const inventory = await realGetInventory(id);
      calls++;
      return calls === 1
        ? inventory
        : { ...inventory, available: SHIELD_RULES.MAX_SHIELD_BALANCE };
    });

    await expect(StreakShieldService.purchaseWithXp(USER)).rejects.toMatchObject({
      code: 'MAX_SHIELDS_REACHED',
    });
    spy.mockRestore();

    expect(ledgerRow().points_spent).toBe(0);
    expect(shieldTotal()).toBe(0);
  });

  it('refuses while the spent ledger (migration 095) is missing', async () => {
    seedUser({ earned: 500, spent: null });
    // PostgREST answers a select of an unknown column with 42703.
    const missingColumn = {
      from: (table: string) => {
        const query = db.from(table);
        if (table !== 'engagement_streaks') return query;
        const select = query.select.bind(query);
        (query as any).select = (columns?: string, opts?: any) => {
          if (typeof columns === 'string' && columns.includes('points_spent')) {
            const failing: any = {
              eq: () => failing,
              maybeSingle: async () => ({
                data: null,
                error: { code: '42703', message: 'column engagement_streaks.points_spent does not exist' },
              }),
            };
            return failing;
          }
          return select(columns, opts);
        };
        return query;
      },
    };
    (createAdminSupabase as any).mockReturnValue(missingColumn);

    await expect(StreakShieldService.purchaseWithXp(USER)).rejects.toMatchObject({
      code: 'XP_LEDGER_UNAVAILABLE',
      status: 503,
    });
    expect(shieldTotal()).toBe(0);
  });
});

describe('POST /api/mobile/streaks/engagement/purchase-freeze', () => {
  it('buys with XP and keeps the existing response keys', async () => {
    seedUser({ earned: 120 });

    const res = await purchaseFreeze(request({ payment_method: 'xp' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Freeze purchased successfully');
    expect(body.payment_method).toBe('xp');
    expect(body.data).toEqual({
      success: true,
      payment_method: 'xp',
      new_freeze_count: 1,
      xp_spent: 100,
      xp_remaining: 20,
    });
    expect(ledgerRow().points_spent).toBe(100);
  });

  it('treats an absent, empty or null payment method as XP, as before', async () => {
    for (const make of [() => request(), () => request(undefined, ''), () => request({}), () => request({ payment_method: null })]) {
      db = makeStreakDb();
      (createAdminSupabase as any).mockReturnValue(db);
      seedUser({ earned: 100 });

      const res = await purchaseFreeze(make());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.payment_method).toBe('xp');
      expect(shieldTotal()).toBe(1);
      expect(ledgerRow().points_spent).toBe(100);
    }
  });

  it('never grants a shield for a payment it cannot verify', async () => {
    for (const method of ['iap', 'in_app_purchase', 'money', 'stripe', 'apple_pay', 'google_pay', 'IAP']) {
      db = makeStreakDb();
      (createAdminSupabase as any).mockReturnValue(db);
      seedUser({ earned: 5000 });

      const res = await purchaseFreeze(request({ payment_method: method }));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.code).toBe('PAYMENT_NOT_SUPPORTED');
      expect(typeof body.error).toBe('string');
      expect(body.message).toBe(body.error);
      expect(shieldTotal()).toBe(0);
      expect(ledgerRow().points_spent).toBe(0);
    }
  });

  it('does not grant a free shield to a user without XP', async () => {
    seedUser({ earned: 0 });

    const res = await purchaseFreeze(request({ payment_method: 'xp' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('INSUFFICIENT_BALANCE');
    expect(body.details).toMatchObject({ price: 100, xp_balance: 0 });
    expect(shieldTotal()).toBe(0);
  });

  it('keeps the "maximum" wording and status at the cap', async () => {
    seedUser({ earned: 500, shields: SHIELD_RULES.MAX_SHIELD_BALANCE });

    const res = await purchaseFreeze(request({ payment_method: 'xp' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('maximum');
    expect(body.data).toBeNull();
  });

  it('refuses with a clear error when no price is configured', async () => {
    vi.stubEnv('STREAK_SHIELD_XP_PRICE', '0');
    seedUser({ earned: 500 });

    const res = await purchaseFreeze(request({ payment_method: 'xp' }));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.code).toBe('PRICE_NOT_CONFIGURED');
    expect(shieldTotal()).toBe(0);
  });

  it('returns 401 without a valid token', async () => {
    authedUser = null;
    const res = await purchaseFreeze(request({ payment_method: 'xp' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized', data: null });
  });
});
