/**
 * promo@1 wire contract (PROMO_CARD_SPEC §6, ACTIVATION_JOURNEY_SPEC §3) on
 * the real routes: promo@1 clients vs legacy (1.0.8 fixtures), the
 * PROMOS_ENABLED kill switch, events → promo_user_state (dismiss holds
 * across devices), and the 250 ms context round.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ tasks: [] as Array<() => unknown> }));

vi.mock('@/lib/supabase-admin', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return { createAdminSupabase: () => getHomeFeedDb().client() };
});
vi.mock('@/lib/middleware/mobile-auth', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return {
    requireMobileAuth: async (request: Request) => {
      const auth = request.headers.get('authorization') ?? '';
      const id = auth.startsWith('Bearer user:') ? auth.slice('Bearer user:'.length) : null;
      const profile = id ? getHomeFeedDb().rows('profiles').find((p) => p.id === id) : null;
      if (!profile) throw new Error('Unauthorized');
      return { ...profile };
    },
  };
});
vi.mock('@/lib/middleware/mobile-auto-refresh', () => ({ addAutoRefreshHeaders: async (_req: unknown, res: unknown) => res }));
vi.mock('@/lib/utils/after-response', () => ({ runAfterResponse: (task: () => unknown) => void h.tasks.push(task) }));
vi.mock('@/lib/services/campaign-service', () => ({
  CampaignService: { fetchActiveRows: async () => [] },
  featuredCampaign: () => null,
  viewerToday: () => '2026-10-26',
}));
vi.mock('@/lib/services/feature-flag-service', () => ({
  FeatureFlagService: { evaluate: (flag: { name: string } | undefined) => ({ enabled: !!flag }) },
}));
vi.mock('@/lib/services/entitlement-service', () => ({
  normalizeTier: (raw: string | null | undefined) => (raw === 'premium' || raw === 'enterprise' ? 'premium' : 'free'),
}));
vi.mock('@/lib/services/vitals-service', () => ({
  VitalsService: { getHydrationToday: async () => ({ todayMl: 0, goalMl: 2000, date: '2026-10-26' }) },
}));

import { HomeFeedFakeDb, setHomeFeedDb } from '@/lib/home-feed/__tests__/fake-db';
import { violations } from '@/lib/home-feed/guardrails';
import { HomeFeedService } from '@/lib/services/home-feed-service';

import { POST as postEvents } from '../events/route';
import { GET } from '../route';

const NEW_USER = '33333333-3333-4333-8333-333333333333';
const ACTIVE_USER = '44444444-4444-4444-8444-444444444444';
// 19:40 UTC = 12:40 in Los Angeles (lunch window).
const NOW = new Date('2026-10-26T19:40:00Z');

type Fixture = { path: string; query: Record<string, string>; headers: Record<string, string> };
const IOS: Fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'ios-1.0.8.request.json'), 'utf8'));
const PROMO_QUERY = {
  cards: `${IOS.query.cards},promo@1`,
  actions: 'open_screen@1,paywall@1,invite@1,start_circle@1,enable_notifications@1,open_url@1,dismiss@1',
  promoLayouts: 'hero,banner,compact',
};

function req(as: string, query: Record<string, string> = IOS.query) {
  const url = new URL(`https://www.fitcircle.ai${IOS.path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers = new Headers({ ...IOS.headers, authorization: `Bearer user:${as}`, 'x-client-timezone': 'America/Los_Angeles', 'x-app-version': '1.1.0' });
  return new NextRequest(url, { headers });
}
const eventsReq = (as: string, body: unknown) =>
  new NextRequest('https://www.fitcircle.ai/api/mobile/home-feed/events', {
    method: 'POST',
    headers: { authorization: `Bearer user:${as}`, 'content-type': 'application/json', 'x-client-timezone': 'America/Los_Angeles' },
    body: JSON.stringify(body),
  });
const flushAfter = async () => {
  for (const t of h.tasks.splice(0)) await t();
};
const ids = (body: any) => body.cards.map((c: any) => c.id);

let db: HomeFeedFakeDb;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = new HomeFeedFakeDb();
  setHomeFeedDb(db);
  HomeFeedService.clearCaches();
  h.tasks.length = 0;
  process.env.PROMOS_ENABLED = 'true';
  delete process.env.PROMOS_DISABLED_KEYS;
  db.rows('feature_flags').push({ name: 'referrals', is_enabled: true }, { name: 'subscriptions', is_enabled: true });
  db.rows('feature_gates').push({ feature_key: 'food_ai_unlimited', required_tier: 'premium' }, { feature_key: 'history_extended', required_tier: 'free' });
  db.rows('profiles').push(
    { id: NEW_USER, timezone: 'America/Los_Angeles', created_at: '2026-10-26T15:00:00Z', subscription_tier: 'free', preferences: {}, fitzy_opened_at: null },
    { id: ACTIVE_USER, timezone: 'America/Los_Angeles', created_at: '2026-10-10T00:00:00Z', subscription_tier: 'free', preferences: {}, fitzy_opened_at: null }
  );
  db.rows('food_log_entries').push({ id: 'f1', user_id: ACTIVE_USER, entry_type: 'food', entry_date: '2026-10-26', meal_type: 'breakfast', logged_at: '2026-10-26T15:30:00Z', title: 'Oatmeal', deleted_at: null });
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.PROMOS_ENABLED;
  delete process.env.PROMOS_DISABLED_KEYS;
});

describe('GET /api/mobile/home-feed — promo@1', () => {
  it('new user (no meal): first_meal hero right under the header; no pro_upsell', async () => {
    const body = await (await GET(req(NEW_USER, PROMO_QUERY))).json();
    expect(ids(body).slice(0, 3)).toEqual(['offline_banner', 'header', 'promo:first_meal']);
    const card = body.cards[2];
    expect(card).toMatchObject({ id: 'promo:first_meal', type: 'promo', version: 1 });
    expect(card.props).toMatchObject({
      promoId: 'first_meal',
      creativeId: 'first_meal_v1',
      layout: 'hero',
      emoji: '📸',
      title: 'Snap your first meal',
      primary: { label: 'Snap a meal', action: { type: 'open_screen', params: { screen: 'log_meal' } } },
      dismissible: true,
    });
    expect(ids(body)).not.toContain('pro_upsell');
    expect(ids(body).filter((id: string) => id.startsWith('promo:'))).toEqual(['promo:first_meal']);
    expect(violations(body.cards.slice(1), { promoV1: true })).toEqual([]);
  });

  it('activated user at lunch: log_meal_now (lunch) + pro_value; every card declared; guardrails hold', async () => {
    const body = await (await GET(req(ACTIVE_USER, PROMO_QUERY))).json();
    const promos = body.cards.filter((c: any) => c.type === 'promo');
    expect(promos.map((c: any) => c.id)).toEqual(['promo:log_meal_now', 'promo:pro_value']);
    expect(promos[0].props).toMatchObject({ creativeId: 'log_meal_now_lunch', title: 'Log your lunch', primary: { action: { type: 'open_screen', params: { screen: 'log_meal', meal: 'lunch' } } } });
    expect(promos[1].props.primary.action).toEqual({ type: 'paywall', params: { placement: 'feed_pro_value' } });
    expect(['pro_value_scans', 'pro_value_coach']).toContain(promos[1].props.creativeId); // history gate is dark here
    const declared = new Set(PROMO_QUERY.cards.split(',').map((c) => c.split('@')[0]));
    for (const c of body.cards) expect(declared.has(c.type)).toBe(true);
    expect(violations(body.cards.slice(1), { promoV1: true })).toEqual([]);
  });

  it('a lunch already logged (by time, even as "snack") hides log_meal_now; meet_fitzy can take the slot', async () => {
    db.rows('food_log_entries').push({ id: 'f2', user_id: ACTIVE_USER, entry_type: 'food', entry_date: '2026-10-26', meal_type: 'snack', logged_at: '2026-10-26T19:10:00Z', title: 'Wrap', deleted_at: null });
    const body = await (await GET(req(ACTIVE_USER, PROMO_QUERY))).json();
    expect(ids(body)).not.toContain('promo:log_meal_now');
    expect(ids(body)).toContain('promo:pro_value');
    const fitzy = body.cards.find((c: any) => c.id === 'promo:meet_fitzy');
    if (fitzy) expect(fitzy.props.primary.action.params).toEqual({ screen: 'fitzy', prompt: 'What do you think of my snack: Wrap?' });
  });

  it('legacy 1.0.8 request (no promo@1): unchanged — pro_upsell, no promo cards, no promo reads', async () => {
    const body = await (await GET(req(ACTIVE_USER))).json();
    expect(ids(body)).toContain('pro_upsell');
    expect(ids(body).some((id: string) => id.startsWith('promo:'))).toBe(false);
    expect(db.queries.food_log_entries ?? 0).toBe(0);
    expect(db.queries.promo_user_state ?? 0).toBe(0);
  });

  it('PROMOS_ENABLED off: promo@1 clients get the legacy feed (pro_upsell back) and no promo reads', async () => {
    delete process.env.PROMOS_ENABLED;
    const body = await (await GET(req(ACTIVE_USER, PROMO_QUERY))).json();
    expect(ids(body)).toContain('pro_upsell');
    expect(ids(body).some((id: string) => id.startsWith('promo:'))).toBe(false);
    expect(db.queries.food_log_entries ?? 0).toBe(0);
  });

  it('PROMOS_DISABLED_KEYS=pro_value pauses it and returns pro_upsell', async () => {
    process.env.PROMOS_DISABLED_KEYS = 'pro_value';
    // Lunch logged → no log_meal_now, so the 2-promo cap (G7) has room for referral + pro_upsell.
    db.rows('food_log_entries').push({ id: 'f3', user_id: ACTIVE_USER, entry_type: 'food', entry_date: '2026-10-26', meal_type: 'lunch', logged_at: '2026-10-26T19:00:00Z', title: 'Soup', deleted_at: null });
    const body = await (await GET(req(ACTIVE_USER, PROMO_QUERY))).json();
    expect(ids(body)).not.toContain('promo:pro_value');
    expect(ids(body)).toContain('pro_upsell');
  });

  it('missing actions= → only dismiss → no promo with a primary button', async () => {
    const body = await (await GET(req(NEW_USER, { ...PROMO_QUERY, actions: '' }))).json();
    expect(ids(body).some((id: string) => id.startsWith('promo:'))).toBe(false);
  });

  it('promo reads failing degrade softly: first_meal still shows when only the state read fails', async () => {
    db.failing.add('promo_user_state');
    const body = await (await GET(req(NEW_USER, PROMO_QUERY))).json();
    expect(ids(body)).toContain('promo:first_meal');
    db.failing.add('food_log_entries');
    const body2 = await (await GET(req(NEW_USER, PROMO_QUERY))).json();
    expect(ids(body2).some((id: string) => id.startsWith('promo:'))).toBe(false);
    expect(body2.cards[1].type).toBe('header');
  });
});

describe('POST /api/mobile/home-feed/events — promo fields → promo_user_state', () => {
  it('impression + tap + dismiss update the state; the dismiss hides the promo on the next request (any device)', async () => {
    const decision = '9b2f7f0e-6a0f-4d1e-9f53-3f1bb0a7c111';
    const res = await postEvents(
      eventsReq(NEW_USER, {
        decision_id: decision,
        events: [
          { card_id: 'promo:first_meal', card_type: 'promo', position: 2, event: 'impression', promo_id: 'first_meal', creative_id: 'first_meal_v1' },
          { card_id: 'promo:first_meal', card_type: 'promo', position: 2, event: 'dismiss', promo_id: 'first_meal', creative_id: 'first_meal_v1' },
        ],
      })
    );
    expect(res.status).toBe(204);
    await flushAfter();
    const ev = db.rows('home_feed_events');
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ card_id: 'promo:first_meal', promo_key: 'first_meal', creative_id: 'first_meal_v1' });
    const [state] = db.rows('promo_user_state');
    expect(state).toMatchObject({ user_id: NEW_USER, promo_key: 'first_meal', creative_id: 'first_meal_v1', impressions_total: 1, impressions_day: 1, day: '2026-10-26', seen_days: ['2026-10-26'] });
    expect(state.dismissed_at).toBeTruthy();

    const body = await (await GET(req(NEW_USER, PROMO_QUERY))).json();
    expect(ids(body)).not.toContain('promo:first_meal');
    // 24 h later the cooldown is over.
    vi.setSystemTime(new Date(NOW.getTime() + 25 * 3_600_000));
    const later = await (await GET(req(NEW_USER, PROMO_QUERY))).json();
    expect(ids(later)).toContain('promo:first_meal');
  });

  it('rejects malformed promo fields; non-promo batches are stored exactly as before', async () => {
    const bad = await postEvents(eventsReq(NEW_USER, { decision_id: '9b2f7f0e-6a0f-4d1e-9f53-3f1bb0a7c111', events: [{ card_id: 'promo:x', card_type: 'promo', position: 1, event: 'tap', button: 'tertiary' }] }));
    expect(bad.status).toBe(400);
    await postEvents(eventsReq(NEW_USER, { decision_id: '9b2f7f0e-6a0f-4d1e-9f53-3f1bb0a7c111', events: [{ card_id: 'hydration', card_type: 'hydration', position: 3, event: 'tap' }] }));
    await flushAfter();
    const [row] = db.rows('home_feed_events');
    expect(Object.keys(row)).not.toContain('promo_key');
    expect(db.rows('promo_user_state')).toHaveLength(0);
  });
});
