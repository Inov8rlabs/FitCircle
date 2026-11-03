/**
 * profile_completion@1 on the real home-feed routes
 * (docs/PROFILE_COMPLETION_CARD_SPEC.md): only for clients that declare it,
 * eligibility from the real stores, dismiss = 7-day snooze through the events
 * API, and the shipped 1.0.8 requests never trigger the extra reads.
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
  viewerToday: () => '2026-11-03',
}));
vi.mock('@/lib/services/feature-flag-service', () => ({
  FeatureFlagService: { evaluate: (flag: { name: string } | undefined) => ({ enabled: !!flag }) },
}));
vi.mock('@/lib/services/entitlement-service', () => ({
  normalizeTier: (raw: string | null | undefined) => (raw === 'premium' || raw === 'enterprise' ? 'premium' : 'free'),
}));
vi.mock('@/lib/services/vitals-service', () => ({
  VitalsService: { getHydrationToday: async () => ({ todayMl: 0, goalMl: 2000, date: '2026-11-03' }) },
}));

import { HomeFeedFakeDb, setHomeFeedDb } from '@/lib/home-feed/__tests__/fake-db';
import { violations } from '@/lib/home-feed/guardrails';
import { HomeFeedService } from '@/lib/services/home-feed-service';

import { POST as postEvents } from '../events/route';
import { GET } from '../route';

const USER = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-11-03T17:00:00Z');

type Fixture = { path: string; query: Record<string, string>; headers: Record<string, string> };
const IOS: Fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'ios-1.0.8.request.json'), 'utf8'));
const ANDROID: Fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'android-1.0.8.request.json'), 'utf8'));

function req(f: Fixture, opts: { declare?: boolean; version?: string } = {}) {
  const url = new URL(`https://www.fitcircle.ai${f.path}`);
  url.searchParams.set('cards', opts.declare ? `${f.query.cards},profile_completion@1` : f.query.cards);
  const headers = new Headers({ authorization: `Bearer user:${USER}` });
  for (const [k, v] of Object.entries(f.headers)) headers.set(k, v);
  if (opts.version) headers.set('X-App-Version', opts.version);
  return new NextRequest(url, { headers });
}
const cardsOf = async (r: NextRequest) => {
  const res = await GET(r);
  expect(res.status).toBe(200);
  return (await res.json()).cards as Array<{ id: string; type: string; version: number; props?: any }>;
};
const flushAfter = async () => {
  for (const t of h.tasks.splice(0)) await t();
};

let db: HomeFeedFakeDb;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = new HomeFeedFakeDb();
  setHomeFeedDb(db);
  HomeFeedService.clearCaches();
  h.tasks.length = 0;
  // A v3 user who skipped About you (iOS blob shape), imperial.
  db.rows('profiles').push({
    id: USER,
    timezone: 'America/New_York',
    created_at: '2026-11-01T00:00:00Z',
    subscription_tier: 'free',
    onboarding_completed: true,
    preferences: { unitSystem: 'imperial' },
    goals: [],
    height_cm: null,
    weight_kg: null,
    gender: null,
    date_of_birth: null,
  });
  db.rows('onboarding_progress').push({ user_id: USER, data: { v3: { goal: 'lose_weight', activity: 'light' } } });
});

afterEach(() => vi.useRealTimers());

describe('profile_completion@1 — GET /api/mobile/home-feed', () => {
  it('shipped 1.0.8 requests: no card and no extra reads (responses unchanged)', async () => {
    for (const f of [IOS, ANDROID]) {
      const cards = await cardsOf(req(f));
      expect(cards.map((c) => c.type)).not.toContain('profile_completion');
    }
    expect(db.queries.onboarding_progress).toBeUndefined();
    expect(db.queries.daily_tracking).toBeUndefined();
  });

  it('declared: the card right after vitals with the status props', async () => {
    for (const f of [IOS, ANDROID]) {
      const cards = await cardsOf(req(f, { declare: true, version: '1.2.0' }));
      const types = cards.map((c) => c.type);
      expect(types.indexOf('profile_completion')).toBe(types.indexOf('vitals') + 1);
      expect(violations(cards.slice(1))).toEqual([]);
      expect(cards.find((c) => c.type === 'profile_completion')).toEqual({
        id: 'profile_completion',
        type: 'profile_completion',
        version: 1,
        dismissible: true,
        props: {
          percent: 29,
          answered: 2,
          total: 7,
          remaining: ['height', 'weight', 'goal_weight', 'birth_year', 'sex'],
          units: 'imperial',
          hints: {},
          goal: 'lose_weight',
        },
      });
    }
  });

  it('reads the real stores: height → goal-weight hint; weigh-in counts; "rather not say" counts', async () => {
    Object.assign(db.rows('profiles')[0], { height_cm: 170, gender: 'prefer_not_to_say' });
    db.rows('daily_tracking').push({ user_id: USER, tracking_date: '2026-11-02', weight_kg: 88 });
    const card = (await cardsOf(req(IOS, { declare: true }))).find((c) => c.type === 'profile_completion')!;
    expect(card.props).toEqual({
      percent: 71,
      answered: 5,
      total: 7,
      remaining: ['goal_weight', 'birth_year'],
      units: 'imperial',
      hints: { goal_weight: { healthy_min_kg: 53.5, healthy_max_kg: 72 } },
      goal: 'lose_weight',
    });
  });

  it('not before onboarding is complete, and gone at 100 %', async () => {
    db.rows('profiles')[0].onboarding_completed = false;
    expect((await cardsOf(req(IOS, { declare: true }))).map((c) => c.type)).not.toContain('profile_completion');
    Object.assign(db.rows('profiles')[0], {
      onboarding_completed: true,
      height_cm: 170,
      weight_kg: 88,
      gender: 'female',
      date_of_birth: '1990-07-01',
      goals: [{ type: 'weight', target_weight_kg: 70, starting_weight_kg: 88 }],
    });
    expect((await cardsOf(req(IOS, { declare: true }))).map((c) => c.type)).not.toContain('profile_completion');
  });

  it('dismiss (events API) snoozes it for 7 days', async () => {
    const res = await GET(req(IOS, { declare: true }));
    const body = await res.json();
    await flushAfter(); // decision row
    const position = body.cards.findIndex((c: any) => c.type === 'profile_completion');
    const ev = await postEvents(
      new NextRequest('https://www.fitcircle.ai/api/mobile/home-feed/events', {
        method: 'POST',
        headers: { authorization: `Bearer user:${USER}`, 'content-type': 'application/json' },
        body: JSON.stringify({ decision_id: body.decision_id, events: [{ card_id: 'profile_completion', card_type: 'profile_completion', position, event: 'dismiss' }] }),
      })
    );
    expect(ev.status).toBe(204);
    await flushAfter(); // events insert
    expect((await cardsOf(req(IOS, { declare: true }))).map((c) => c.type)).not.toContain('profile_completion');

    vi.setSystemTime(new Date(NOW.getTime() + 6 * 86_400_000));
    expect((await cardsOf(req(IOS, { declare: true }))).map((c) => c.type)).not.toContain('profile_completion');
    vi.setSystemTime(new Date(NOW.getTime() + 7 * 86_400_000 + 60_000));
    expect((await cardsOf(req(IOS, { declare: true }))).map((c) => c.type)).toContain('profile_completion');
  });

  it('a store outage drops only this card (fail closed), the feed still answers', async () => {
    db.failing.add('onboarding_progress');
    const cards = await cardsOf(req(IOS, { declare: true }));
    expect(cards.map((c) => c.type)).not.toContain('profile_completion');
    expect(cards.map((c) => c.type)).toContain('vitals');
  });
});
