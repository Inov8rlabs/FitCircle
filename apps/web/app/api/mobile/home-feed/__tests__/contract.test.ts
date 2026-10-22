/**
 * Contract tests for GET /api/mobile/home-feed + POST /events
 * (docs/HOME_FEED_SPEC.md §2, §5, §7): the exact iOS / Android 1.0.8 requests
 * (fixtures/) with response snapshots, schema/cards validation, kill switch,
 * DB rules, decisions + events persistence, and additivity.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  tasks: [] as Array<() => unknown>,
  campaign: null as null | { slug: string; phase: string },
  referrals: true,
  subs: true,
  waterMl: 0,
}));

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
  CampaignService: { listForViewer: async () => ({ campaigns: h.campaign ? [h.campaign] : [], homeSlug: h.campaign?.slug ?? null }) },
}));
vi.mock('@/lib/services/referral-service', () => ({ ReferralService: { isProgramEnabled: async () => h.referrals } }));
vi.mock('@/lib/services/entitlement-service', () => ({
  EntitlementService: { areSubscriptionsEnabled: async () => h.subs },
  normalizeTier: (raw: string | null | undefined) => (raw === 'premium' || raw === 'enterprise' ? 'premium' : 'free'),
}));
vi.mock('@/lib/services/vitals-service', () => ({
  VitalsService: { getHydrationToday: async () => ({ todayMl: h.waterMl, goalMl: 2000, date: '2026-10-22' }) },
}));

import { HomeFeedFakeDb, setHomeFeedDb } from '@/lib/home-feed/__tests__/fake-db';
import { violations } from '@/lib/home-feed/guardrails';
import { bucketOf } from '@/lib/home-feed/rules';
import { HomeFeedService } from '@/lib/services/home-feed-service';

import { POST as postEvents } from '../events/route';
import { GET } from '../route';

const IOS_USER = '11111111-1111-4111-8111-111111111111';
const ANDROID_USER = '22222222-2222-4222-8222-222222222222';
// 02:30 UTC Fri 23 Oct = 19:30 Thu in Los Angeles (iOS) / 08:00 Fri in Kolkata (Android).
const NOW = new Date('2026-10-23T02:30:00Z');

type Fixture = { path: string; query: Record<string, string>; headers: Record<string, string> };
const fixture = (name: string): Fixture => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
const IOS = fixture('ios-1.0.8.request.json');
const ANDROID = fixture('android-1.0.8.request.json');

function fromFixture(f: Fixture, as: string, edit: { headers?: Record<string, string | null>; query?: Record<string, string | null> } = {}) {
  const url = new URL(`https://www.fitcircle.ai${f.path}`);
  const query = { ...f.query, ...(edit.query ?? {}) };
  for (const [k, v] of Object.entries(query)) if (v !== null) url.searchParams.set(k, v);
  const headers = new Headers({ authorization: `Bearer user:${as}` });
  for (const [k, v] of Object.entries({ ...f.headers, ...(edit.headers ?? {}) })) if (v !== null) headers.set(k, v);
  return new NextRequest(url, { headers });
}

const eventsReq = (as: string | null, body: unknown) =>
  new NextRequest('https://www.fitcircle.ai/api/mobile/home-feed/events', {
    method: 'POST',
    headers: { ...(as ? { authorization: `Bearer user:${as}` } : {}), 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const flushAfter = async () => {
  const tasks = h.tasks.splice(0);
  for (const t of tasks) await t();
};

/** Stable snapshot: decision_id is random. */
const normalized = (body: any) => {
  expect(body.decision_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  return { ...body, decision_id: '<uuid>' };
};

const WATER_FIRST_ROW = {
  key: 'water_first',
  enabled: true,
  priority: 100,
  definition: {
    description: '50/50: hydration card directly under the header vs default order.',
    platforms: ['ios', 'android'],
    minAppVersion: '1.0.8',
    experiment: {
      key: 'water_first',
      arms: [
        { name: 'treatment', percent: 50, actions: [{ op: 'move', card: 'hydration', after: 'header' }, { op: 'move', card: 'referral', after: 'hydration' }] },
        { name: 'control', percent: 50, actions: [] },
      ],
    },
  },
};

let db: HomeFeedFakeDb;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = new HomeFeedFakeDb();
  setHomeFeedDb(db);
  HomeFeedService.clearRulesCache();
  h.tasks.length = 0;
  h.campaign = null;
  h.referrals = true;
  h.subs = true;
  h.waterMl = 0;
  db.rows('profiles').push(
    { id: IOS_USER, timezone: 'America/Los_Angeles', created_at: '2026-10-01T00:00:00Z', subscription_tier: 'free', preferences: {} },
    { id: ANDROID_USER, timezone: 'Asia/Kolkata', created_at: '2026-10-20T00:00:00Z', subscription_tier: 'free', preferences: {} }
  );
  db.rows('fitcircle_members').push({ user_id: IOS_USER, fitcircle_id: 'c1', status: 'active' });
  delete process.env.HOME_FEED_ENABLED;
  delete process.env.HOME_FEED_PLATFORMS;
  delete process.env.HOME_FEED_RULES_ENABLED;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.HOME_FEED_ENABLED;
  delete process.env.HOME_FEED_PLATFORMS;
  delete process.env.HOME_FEED_RULES_ENABLED;
});

describe('GET /api/mobile/home-feed — 1.0.8 client fixtures', () => {
  it('iOS 1.0.8 (no campaign, free, evening, not checked in)', async () => {
    const res = await GET(fromFixture(IOS, IOS_USER));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(normalized(await res.json())).toMatchSnapshot();
  });

  it('iOS 1.0.8 with the featured campaign live', async () => {
    h.campaign = { slug: 'hold_the_line', phase: 'live' };
    const res = await GET(fromFixture(IOS, IOS_USER));
    expect(normalized(await res.json())).toMatchSnapshot();
  });

  it('Android 1.0.8 (no circle, morning)', async () => {
    const res = await GET(fromFixture(ANDROID, ANDROID_USER));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(normalized(await res.json())).toMatchSnapshot();
  });

  it('Android 1.0.8 with the featured campaign in teaser', async () => {
    h.campaign = { slug: 'advent_2026', phase: 'teaser' };
    const res = await GET(fromFixture(ANDROID, ANDROID_USER));
    expect(normalized(await res.json())).toMatchSnapshot();
  });

  it('every fixture response satisfies the client contract', async () => {
    for (const [f, user] of [[IOS, IOS_USER], [ANDROID, ANDROID_USER]] as const) {
      for (const campaign of [null, { slug: 'hold_the_line', phase: 'live' }]) {
        h.campaign = campaign;
        const body = await (await GET(fromFixture(f, user))).json();
        const declared = new Set(f.query.cards.split(',').map((c) => c.split('@')[0]));
        expect(body.schema).toBe(1);
        expect(typeof body.ttl_seconds).toBe('number');
        expect(typeof body.layout_key).toBe('string');
        expect(new Set(body.cards.map((c: any) => c.id)).size).toBe(body.cards.length);
        for (const card of body.cards) {
          expect(declared.has(card.type)).toBe(true);
          expect(card.version).toBe(1);
          expect(typeof card.id).toBe('string');
        }
        expect(body.cards[0].type).toBe('offline_banner');
        expect(body.cards[1].type).toBe('header');
        expect(violations(body.cards.slice(1))).toEqual([]);
      }
    }
  });

  it('the server never returns a card type the client did not list', async () => {
    db.rows('home_feed_rules').push({
      id: db.nextId(),
      key: 'future_card_launch',
      enabled: true,
      priority: 10,
      definition: { actions: [{ op: 'show', card: 'streak_party', version: 1 }, { op: 'move', card: 'streak_party', toTop: true }] },
    });
    const body = await (await GET(fromFixture(IOS, IOS_USER))).json();
    expect(body.cards.map((c: any) => c.type)).not.toContain('streak_party');
    // Same rule, a (future) client that declares the new card gets it.
    HomeFeedService.clearRulesCache();
    const future = await (await GET(fromFixture(IOS, IOS_USER, { query: { cards: `${IOS.query.cards},streak_party@1` } }))).json();
    expect(future.cards.map((c: any) => c.type)).toContain('streak_party');
  });

  it('a client listing fewer cards gets only those', async () => {
    const body = await (await GET(fromFixture(IOS, IOS_USER, { query: { cards: 'header@1,hydration@1,charts@1' } }))).json();
    expect(body.cards.map((c: any) => c.type)).toEqual(['header', 'hydration', 'charts']);
  });
});

describe('GET /api/mobile/home-feed — validation', () => {
  it('401 without auth', async () => {
    const res = await GET(fromFixture(IOS, 'nobody'));
    expect(res.status).toBe(401);
  });

  it('400 when X-Feed-Schema is missing', async () => {
    const res = await GET(fromFixture(IOS, IOS_USER, { headers: { 'X-Feed-Schema': null } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('FEED_SCHEMA_REQUIRED');
  });

  it.each(['2', '0', 'abc', '1.5', '01x'])('400 for unsupported X-Feed-Schema %s with a clear error', async (schema) => {
    const res = await GET(fromFixture(IOS, IOS_USER, { headers: { 'X-Feed-Schema': schema } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('UNSUPPORTED_FEED_SCHEMA');
    expect(body.error.message).toContain('supported: 1');
    expect(body.data).toEqual({ supported: [1] });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('400 when cards is missing or has nothing valid', async () => {
    for (const cards of [null, '', 'BAD,@@']) {
      const res = await GET(fromFixture(IOS, IOS_USER, { query: { cards } }));
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('CARDS_REQUIRED');
    }
  });
});

describe('GET /api/mobile/home-feed — rules, kill switches, decisions', () => {
  const treatedUser = () => Array.from({ length: 400 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).find((u) => bucketOf(u, 'water_first') < 50)!;

  it('records the decision after responding', async () => {
    const body = await (await GET(fromFixture(IOS, IOS_USER))).json();
    expect(db.rows('home_feed_decisions')).toHaveLength(0);
    await flushAfter();
    const [row] = db.rows('home_feed_decisions');
    expect(row).toMatchObject({
      id: body.decision_id,
      user_id: IOS_USER,
      layout_key: 'default-v1',
      experiment_key: null,
      experiment_arm: null,
      applied_rules: [],
      platform: 'ios',
      app_version: '1.0.8',
      created_at: body.generated_at,
    });
    expect(row.cards.map((c: any) => c.id)).toEqual(body.cards.map((c: any) => c.id));
    expect(row.context).toMatchObject({ local_hour: 19, has_circle: true, checked_in_today: false, streak_at_risk: true, is_pro: false, app_build: 63 });
  });

  it('applies the water_first experiment from the DB (treatment)', async () => {
    const user = treatedUser();
    db.rows('profiles').push({ id: user, timezone: 'UTC', created_at: '2026-10-01T00:00:00Z', subscription_tier: 'free' });
    db.rows('home_feed_rules').push({ id: db.nextId(), ...WATER_FIRST_ROW });
    h.campaign = { slug: 'hold_the_line', phase: 'live' };
    const body = await (await GET(fromFixture(IOS, user))).json();
    expect(body.experiment).toEqual({ key: 'water_first', arm: 'treatment' });
    expect(body.layout_key).toBe('default-v1+water_first.treatment');
    expect(body.cards.slice(0, 4).map((c: any) => c.type)).toEqual(['offline_banner', 'header', 'hydration', 'referral']);
    await flushAfter();
    expect(db.rows('home_feed_decisions')[0]).toMatchObject({ experiment_key: 'water_first', experiment_arm: 'treatment', applied_rules: ['water_first'] });
  });

  it('a disabled or invalid rule row is ignored', async () => {
    db.rows('home_feed_rules').push(
      { id: db.nextId(), ...WATER_FIRST_ROW, enabled: false },
      { id: db.nextId(), key: 'broken', enabled: true, priority: 0, definition: { actions: [{ op: 'teleport', card: 'charts' }] } }
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const body = await (await GET(fromFixture(IOS, IOS_USER))).json();
    expect(body.layout_key).toBe('default-v1');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('rule "broken" skipped'));
    warn.mockRestore();
  });

  it('rules table outage → still 200 with the context-aware default', async () => {
    db.failing.add('home_feed_rules');
    const res = await GET(fromFixture(IOS, IOS_USER));
    expect(res.status).toBe(200);
    expect((await res.json()).layout_key).toBe('default-v1');
  });

  it('every context loader failing → still 200', async () => {
    db.failing.add('fitcircle_members');
    db.failing.add('streak_claims');
    const res = await GET(fromFixture(IOS, IOS_USER));
    expect(res.status).toBe(200);
  });

  it('HOME_FEED_ENABLED=false → static default (200), rules ignored, no decision recorded', async () => {
    process.env.HOME_FEED_ENABLED = 'false';
    db.rows('home_feed_rules').push({ id: db.nextId(), ...WATER_FIRST_ROW });
    const user = treatedUser();
    db.rows('profiles').push({ id: user, timezone: 'UTC', subscription_tier: 'free' });
    const res = await GET(fromFixture(IOS, user));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ schema: 1, layout_key: 'default-v1', experiment: null });
    expect(body.cards[1].type).toBe('header');
    await flushAfter();
    expect(db.rows('home_feed_decisions')).toHaveLength(0);
  });

  it('HOME_FEED_PLATFORMS=ios → Android gets the static default', async () => {
    process.env.HOME_FEED_PLATFORMS = 'ios';
    db.rows('home_feed_rules').push({ id: db.nextId(), ...WATER_FIRST_ROW });
    const android = await (await GET(fromFixture(ANDROID, ANDROID_USER))).json();
    expect(android.layout_key).toBe('default-v1');
    expect(android.experiment).toBeNull();
  });

  it('HOME_FEED_RULES_ENABLED=false → no rules, context still used', async () => {
    process.env.HOME_FEED_RULES_ENABLED = 'false';
    db.rows('home_feed_rules').push({ id: db.nextId(), ...WATER_FIRST_ROW });
    const body = await (await GET(fromFixture(IOS, IOS_USER))).json();
    expect(body.experiment).toBeNull();
    h.referrals = false;
    const noRef = await (await GET(fromFixture(IOS, IOS_USER))).json();
    expect(noRef.cards.map((c: any) => c.type)).not.toContain('referral');
  });
});

describe('POST /api/mobile/home-feed/events', () => {
  const DECISION = '33333333-3333-4333-8333-333333333333';
  const ev = (o: Record<string, unknown> = {}) => ({ card_id: 'hydration', card_type: 'hydration', position: 2, event: 'impression', at: '2026-10-23T02:29:00Z', ...o });

  it('204 and inserts after responding', async () => {
    const res = await postEvents(eventsReq(IOS_USER, { decision_id: DECISION, events: [ev(), ev({ event: 'tap', at: undefined }), ev({ event: 'dismiss', at: '1999-01-01T00:00:00Z' })] }));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(db.rows('home_feed_events')).toHaveLength(0);
    await flushAfter();
    expect(db.rows('home_feed_events').map(({ id: _id, created_at: _c, ...r }) => r)).toEqual([
      { decision_id: DECISION, user_id: IOS_USER, card_id: 'hydration', card_type: 'hydration', position: 2, event: 'impression', occurred_at: '2026-10-23T02:29:00.000Z' },
      { decision_id: DECISION, user_id: IOS_USER, card_id: 'hydration', card_type: 'hydration', position: 2, event: 'tap', occurred_at: null },
      { decision_id: DECISION, user_id: IOS_USER, card_id: 'hydration', card_type: 'hydration', position: 2, event: 'dismiss', occurred_at: null },
    ]);
  });

  it('accepts exactly 50, rejects 51', async () => {
    expect((await postEvents(eventsReq(IOS_USER, { decision_id: DECISION, events: Array.from({ length: 50 }, () => ev()) }))).status).toBe(204);
    const res = await postEvents(eventsReq(IOS_USER, { decision_id: DECISION, events: Array.from({ length: 51 }, () => ev()) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    [{ decision_id: 'nope', events: [ev()] }],
    [{ decision_id: DECISION, events: [] }],
    [{ decision_id: DECISION, events: [ev({ event: 'swipe' })] }],
    [{ decision_id: DECISION, events: [ev({ position: -1 })] }],
    [{ decision_id: DECISION, events: [ev({ position: 1.5 })] }],
    [{ decision_id: DECISION, events: [ev({ card_id: '' })] }],
    [{ events: [ev()] }],
    ['not json'],
  ])('400 for %o', async (body) => {
    expect((await postEvents(eventsReq(IOS_USER, body))).status).toBe(400);
  });

  it('ignores unknown extra fields (forward compatible)', async () => {
    expect((await postEvents(eventsReq(IOS_USER, { decision_id: DECISION, extra: 1, events: [ev({ variant: 'compact' })] }))).status).toBe(204);
  });

  it('401 without auth', async () => {
    expect((await postEvents(eventsReq(null, { decision_id: DECISION, events: [ev()] }))).status).toBe(401);
  });

  it('an insert failure never surfaces to the client', async () => {
    db.failing.add('home_feed_events');
    expect((await postEvents(eventsReq(IOS_USER, { decision_id: DECISION, events: [ev()] }))).status).toBe(204);
    await expect(flushAfter()).rejects.toBeTruthy(); // logged by runAfterResponse in production
  });
});

describe('additivity (spec §7: new endpoint only, no existing route changes)', () => {
  const apiRoot = join(__dirname, '..', '..', '..');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });

  it('home-feed code is only imported by home-feed routes', () => {
    const offenders = walk(apiRoot)
      .filter((p) => /\.(ts|tsx)$/.test(p) && !p.includes('__tests__'))
      .filter((p) => !/[\\/]home-feed[\\/]/.test(relative(apiRoot, p)))
      .filter((p) => /lib\/home-feed|home-feed-service/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(apiRoot, p));
    expect(offenders).toEqual([]);
  });

  it('the home-feed route set is exactly the spec endpoints', () => {
    const routes = walk(apiRoot)
      .map((p) => relative(apiRoot, p).split('\\').join('/'))
      .filter((p) => p.includes('home-feed/') && p.endsWith('route.ts'))
      .sort();
    expect(routes).toEqual(['admin/home-feed/preview/route.ts', 'admin/home-feed/rules/route.ts', 'mobile/home-feed/events/route.ts', 'mobile/home-feed/route.ts']);
  });
});
