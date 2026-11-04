/**
 * Shared scenario for promo-style-contract.test.ts AND for regenerating its legacy baseline
 * (fixtures/promo-style-legacy-baseline.json) from the pre-style code: uses only APIs that existed
 * before promo_style@1, so the same seed + requests run on origin/main.
 *
 * Users (Sun Nov 8 2026, 10:00 CST):
 *   EXPIRING  free referral Pro ending in 27 h (Pro lifecycle hero card)
 *   EXPIRED   referral Pro ended 5 h ago (Pro lifecycle hero card)
 *   NEWBIE    free, no meals yet (first_meal hero)
 *   FREE      free, meals logged, 5 days in (pro_value banner + log_meal_now / meet_fitzy)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextRequest } from 'next/server';

import type { HomeFeedFakeDb } from '@/lib/home-feed/__tests__/fake-db';

export const EXPIRING = '55555555-5555-4555-8555-555555555555';
export const EXPIRED = '66666666-6666-4666-8666-666666666666';
export const NEWBIE = '77777777-7777-4777-8777-777777777777';
export const FREE = '88888888-8888-4888-8888-888888888888';
export const NOW = new Date('2026-11-08T16:00:00Z');
const H = 3_600_000;
const D = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

export type Fixture = { path: string; query: Record<string, string>; headers: Record<string, string> };
export const IOS: Fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'ios-1.0.8.request.json'), 'utf8'));
export const ANDROID: Fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'android-1.0.8.request.json'), 'utf8'));

/** What iOS / Android 1.1.0–1.1.2 send: 1.0.8 cards + promo@1 + circle_chat@1, actions, layouts (no features). */
export const V110 = (f: Fixture) => ({
  cards: `${f.query.cards},promo@1,circle_chat@1`,
  actions: 'open_screen@1,paywall@1,invite@1,start_circle@1,enable_notifications@1,open_url@1,dismiss@1',
  promoLayouts: 'hero,banner,compact',
});

export function feedRequest(as: string, f: Fixture, opts: { query?: Record<string, string>; version?: string; headers?: Record<string, string> } = {}) {
  const url = new URL(`https://www.fitcircle.ai${f.path}`);
  for (const [k, v] of Object.entries(opts.query ?? V110(f))) url.searchParams.set(k, v);
  const headers = new Headers({ ...f.headers, authorization: `Bearer user:${as}`, 'x-client-timezone': 'America/Chicago', 'x-app-version': opts.version ?? '1.1.2', ...(opts.headers ?? {}) });
  return new NextRequest(url, { headers });
}

/** The legacy requests whose responses must not change (1.1.0–1.1.2, with and without icon_keys). */
export function legacyCases(): Array<{ name: string; as: string; f: Fixture; headers?: Record<string, string> }> {
  const out: Array<{ name: string; as: string; f: Fixture; headers?: Record<string, string> }> = [];
  for (const [user, name] of [
    [EXPIRING, 'expiring'],
    [EXPIRED, 'expired'],
    [NEWBIE, 'newbie'],
    [FREE, 'free'],
  ] as const) {
    for (const [f, p] of [
      [IOS, 'ios'],
      [ANDROID, 'android'],
    ] as const) {
      out.push({ name: `${name}-${p}`, as: user, f });
      out.push({ name: `${name}-${p}-icon_keys`, as: user, f, headers: { 'x-client-features': 'icon_keys' } });
    }
  }
  return out;
}

/** Response minus the per-request random/time fields. */
export function stableBody(body: any) {
  const { decision_id: _d, generated_at: _g, ...rest } = body;
  return rest;
}

export function seed(db: HomeFeedFakeDb) {
  db.rows('feature_flags').push({ name: 'referrals', is_enabled: true }, { name: 'subscriptions', is_enabled: true });
  db.rows('feature_gates').push({ feature_key: 'food_ai_unlimited', required_tier: 'premium' });
  const base = { preferences: {}, fitzy_opened_at: null, created_at: '2026-10-20T00:00:00Z' };
  db.rows('profiles').push(
    {
      ...base,
      id: EXPIRING,
      email: 'asael@gmail.com',
      display_name: 'Asael Vargas',
      timezone: 'America/Chicago',
      subscription_tier: 'premium',
      subscription_status: 'active',
      subscription_platform: 'promotional',
      subscription_product_id: 'referral',
      subscription_expires_at: at(27 * H),
    },
    {
      ...base,
      id: EXPIRED,
      email: 'kalpana@gmail.com',
      display_name: 'Kalpana C',
      timezone: 'America/Toronto',
      subscription_tier: 'free',
      subscription_status: 'cancelled',
      subscription_platform: 'promotional',
      subscription_product_id: 'referral',
      subscription_expires_at: at(-5 * H),
    },
    { ...base, id: NEWBIE, email: 'new@gmail.com', display_name: 'Nia New', timezone: 'America/Chicago', subscription_tier: 'free', created_at: at(-2 * D) },
    { ...base, id: FREE, email: 'free@gmail.com', display_name: 'Fred Free', timezone: 'America/Chicago', subscription_tier: 'free', created_at: at(-5 * D) }
  );
  db.rows('complimentary_grants').push(
    { id: 'g1', user_id: EXPIRING, granted_by: 'referral-program', created_at: at(-7 * D + 27 * H), expires_at: at(27 * H), revoked_at: null },
    { id: 'g2', user_id: EXPIRED, granted_by: 'referral-program', created_at: at(-7 * D - 5 * H), expires_at: at(-5 * H), revoked_at: null }
  );
  for (const [i, user] of [EXPIRING, EXPIRED, FREE].entries()) {
    db.rows('food_log_entries').push(
      ...[0, 1, 2, 3, 4].map((k) => ({ id: `m${i}${k}`, user_id: user, entry_type: 'food', entry_date: '2026-11-05', meal_type: 'lunch', logged_at: at(-3 * D + k * H), created_at: at(-3 * D + k * H), title: 'Salad', nutrition_source: 'llm_vision', deleted_at: null }))
    );
  }
}
