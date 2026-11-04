/**
 * Food entry privacy end to end (docs/FOOD_ENTRY_PRIVACY_SPEC.md).
 *
 * Real route handlers + the real FoodLogService, CircleMealPostService,
 * CircleChatService, CircleFoodFeedService, NutritionChallengeService and image
 * proxy over the in-memory Supabase fake. Only side services unrelated to
 * privacy (streak claim, milestones, feature flag, training, push delivery) are
 * stubbed — push delivery is RECORDED so the push rules can be asserted.
 *
 * Part 1 — the API contract: create default, shipped-client bodies, explicit
 *          share, edit toggles both ways, bulk, the default preference.
 * Part 2 — one audit test per circle surface: a private entry is invisible to
 *          another member.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleChatService } from '@/lib/services/circle-chat-service';
import { CircleFoodFeedService } from '@/lib/services/circle-food-feed-service';
import { NutritionChallengeService } from '@/lib/services/nutrition-challenge-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { GET as GET_DETAIL, PATCH } from '../[id]/route';
import { GET as GET_IMAGE } from '../images/[imageId]/route';
import { POST } from '../route';
import { POST as POST_BULK } from '../sharing/bulk/route';
import { GET as GET_SHARING, PUT as PUT_SHARING } from '../sharing/route';

const deferred: Array<() => unknown> = [];
vi.mock('next/server', async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return { ...original, after: (cb: () => unknown) => void deferred.push(cb) };
});
async function flushAfter() {
  while (deferred.length) await deferred.shift()!();
  // fire-and-forget pushes resolve on the microtask queue
  await new Promise((r) => setTimeout(r, 0));
}

vi.mock('@/lib/supabase-admin');
let authedUser: Record<string, any> | null = null;
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authedUser) throw new Error('Unauthorized');
    return authedUser;
  }),
}));
vi.mock('@/lib/services/feature-flag-service', () => ({
  FeatureFlagService: { isFeatureEnabled: vi.fn(async () => ({ enabled: true })) },
}));
vi.mock('@/lib/services/streak-claiming-service', () => ({
  StreakClaimingService: { autoClaimForManualLog: vi.fn(async () => null) },
}));
vi.mock('@/lib/services/conversion-milestone-service', () => ({
  ConversionMilestoneService: { forFoodLogCreate: vi.fn(async () => []) },
}));
vi.mock('@/lib/services/nutrition-training-service', () => ({
  NutritionTrainingService: { enabled: false, reconcileEntry: vi.fn() },
}));
vi.mock('@/lib/promos/config', () => ({ promosConfig: () => ({ enabled: false }) }));
vi.mock('@/lib/services/chat-safety-service', () => ({
  ChatSafetyService: { getBlockedIdsFor: vi.fn(async () => []) },
}));
const pushes = vi.hoisted(() => ({ sent: [] as any[] }));
vi.mock('@/lib/services/chat-notification-service', () => ({
  ChatNotificationService: {
    notifySystemEvent: vi.fn(async (intents: any[]) => void pushes.sent.push(...intents)),
  },
}));

const NOW = new Date('2026-11-03T18:00:00Z');
const TZ = 'America/Toronto';
const OWNER = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';
const CIRCLE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWNER_PROFILE = {
  id: OWNER,
  email: 'owner@example.com',
  display_name: 'Owner',
  subscription_tier: 'free',
  timezone: TZ,
  created_at: '2026-01-01T00:00:00Z',
  preferences: {},
};
const MEMBER_PROFILE = { ...OWNER_PROFILE, id: MEMBER, email: 'm@example.com', display_name: 'Member' };

let db: FakeSupabase;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  process.env.NEXT_PUBLIC_APP_URL = 'https://api.test';
  deferred.length = 0;
  pushes.sent = [];
  db = new FakeSupabase({ profiles: { uniqueKey: ['id'] }, food_log_entries: { uniqueKey: ['id'] } });
  (db as any).storage = {
    from: () => ({
      download: async () => ({ data: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }, error: null }),
      createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://signed/${p}` }, error: null }),
    }),
  };
  (createAdminSupabase as any).mockReturnValue(db);
  db.seed('profiles', [OWNER_PROFILE, MEMBER_PROFILE]);
  db.seed('fitcircles', [{ id: CIRCLE, name: 'Lunch Club', start_date: '2026-11-01', end_date: '2026-11-30' }]);
  db.seed('fitcircle_members', [
    { fitcircle_id: CIRCLE, user_id: OWNER, status: 'active' },
    { fitcircle_id: CIRCLE, user_id: MEMBER, status: 'active' },
  ]);
  authedUser = { ...OWNER_PROFILE };
});

afterEach(async () => {
  await flushAfter();
  vi.useRealTimers();
  delete process.env.NEXT_PUBLIC_APP_URL;
});

// ---------------------------------------------------------------------------
const HEADERS = { 'content-type': 'application/json', 'x-client-timezone': TZ, authorization: 'Bearer t' };
const req = (path: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    headers: HEADERS,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function create(body: Record<string, unknown>) {
  const res = await POST(req('/api/mobile/food-log', 'POST', body));
  return { status: res.status, body: await res.json() };
}
async function patch(id: string, body: Record<string, unknown>) {
  const res = await PATCH(req(`/api/mobile/food-log/${id}`, 'PATCH', body), params({ id }));
  return { status: res.status, body: await res.json() };
}
const meal = (over: Record<string, unknown> = {}) => ({
  entry_type: 'food',
  meal_type: 'lunch',
  title: 'Chicken bowl',
  logged_at: '2026-11-03T17:30:00Z',
  nutrition_data: { calories: 640, protein_g: 45, carbs_g: 60, fat_g: 20 },
  ...over,
});
const entry = (id: string) => db.getRows('food_log_entries').find((r) => r.id === id)!;
const livePosts = (id?: string) =>
  db
    .getRows('circle_messages')
    .filter((m) => m.system_event_type === 'meal_logged' && !m.deleted_at && (!id || m.system_event_ref === id));
const allPosts = (id: string) =>
  db.getRows('circle_messages').filter((m) => m.system_event_type === 'meal_logged' && m.system_event_ref === id);

/** Seed an entry directly (and optionally its live meal card). */
function seedEntry(id: string, privacy: { is_private: boolean | null; visibility: string | null }, opts: { posted?: boolean; loggedAt?: string; protein?: number } = {}) {
  db.seed('food_log_entries', [
    {
      id,
      user_id: OWNER,
      entry_type: 'food',
      meal_type: 'dinner',
      title: `Secret ${id}`,
      logged_at: opts.loggedAt ?? '2026-11-03T17:00:00Z',
      entry_date: '2026-11-03',
      calories: 700,
      protein_g: opts.protein ?? 50,
      carbs_g: 50,
      fat_g: 30,
      has_images: true,
      deleted_at: null,
      ...privacy,
    },
  ]);
  db.seed('food_log_images', [
    {
      id: `img-${id}`,
      food_log_entry_id: id,
      user_id: OWNER,
      storage_path: `${OWNER}/${id}_original.jpg`,
      storage_bucket: 'food-logs',
      thumbnail_path: null,
      display_order: 0,
      deleted_at: null,
    },
  ]);
  if (opts.posted) {
    db.seed('circle_messages', [
      {
        id: `msg-${id}`,
        fitcircle_id: CIRCLE,
        sender_id: null,
        kind: 'system_event',
        body: `Owner logged dinner: Secret ${id}`,
        system_event_type: 'meal_logged',
        system_event_ref: id,
        system_payload: {
          render_hint: 'meal_card',
          actors: [{ id: OWNER }],
          entry_id: id,
          title: `Secret ${id}`,
          calories: 700,
          image_id: `img-${id}`,
          photo_path: `/api/mobile/food-log/images/img-${id}?size=medium`,
        },
        priority: 'p1',
        deleted_at: null,
        created_at: '2026-11-03T17:00:01Z',
        updated_at: '2026-11-03T17:00:01Z',
      },
    ]);
  }
}
const SHARED = { is_private: false, visibility: 'circle' };
const PRIVATE = { is_private: true, visibility: 'private' };

// ===========================================================================
// Part 1 — API contract
// ===========================================================================

describe('POST /api/mobile/food-log — the private default', () => {
  it('omitted privacy fields → private, no meal card, no push', async () => {
    const r = await create(meal());
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ is_private: true, visibility: 'private' });
    await flushAfter();
    expect(livePosts()).toHaveLength(0);
    expect(pushes.sent).toHaveLength(0);
  });

  it("shipped iOS 1.1.1 body (hard-coded is_private:false) → private", async () => {
    const r = await create({ ...meal(), id: 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D', is_private: false, timezone: TZ });
    expect(r.body.data).toMatchObject({ is_private: true, visibility: 'private' });
    await flushAfter();
    expect(livePosts()).toHaveLength(0);
  });

  it("shipped Android 1.1.1 body (encodeDefaults is_private:false + visibility:'circle') → private", async () => {
    const r = await create({
      ...meal(),
      id: 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f',
      user_id: OWNER,
      image_urls: [],
      is_private: false,
      visibility: 'circle',
      sync_status: 'synced',
      created_at: '2026-11-03T17:30:00.000Z',
    });
    expect(r.body.data).toMatchObject({ is_private: true, visibility: 'private' });
    await flushAfter();
    expect(livePosts()).toHaveLength(0);
  });

  it('a shipped client asking for private still gets private, even with the default on', async () => {
    authedUser = { ...OWNER_PROFILE, preferences: { privacy: { share_meals_with_circles: true } } };
    const r = await create({ ...meal(), is_private: true });
    expect(r.body.data).toMatchObject({ is_private: true, visibility: 'private' });
  });

  it('default ON → omitted / shipped-client bodies are shared and posted', async () => {
    authedUser = { ...OWNER_PROFILE, preferences: { privacy: { share_meals_with_circles: true } } };
    const r = await create({ ...meal(), is_private: false });
    expect(r.body.data).toMatchObject({ is_private: false, visibility: 'circle' });
    await flushAfter();
    expect(livePosts(r.body.data.id)).toHaveLength(1);
  });

  it('explicit share_with_circles:true (new clients) → shared, meal card + push', async () => {
    const r = await create(meal({ share_with_circles: true }));
    expect(r.body.data).toMatchObject({ is_private: false, visibility: 'circle' });
    await flushAfter();
    expect(livePosts(r.body.data.id)).toHaveLength(1);
    expect(pushes.sent).toHaveLength(1);
  });

  it('explicit share of a back-dated meal posts the card WITHOUT a push', async () => {
    const r = await create(meal({ share_with_circles: true, logged_at: '2026-11-03T12:00:00Z' }));
    await flushAfter();
    expect(livePosts(r.body.data.id)).toHaveLength(1);
    expect(pushes.sent).toHaveLength(0);
  });

  it('explicit share_with_circles:false wins over the default', async () => {
    authedUser = { ...OWNER_PROFILE, preferences: { privacy: { share_meals_with_circles: true } } };
    const r = await create(meal({ share_with_circles: false }));
    expect(r.body.data).toMatchObject({ is_private: true, visibility: 'private' });
  });

  it('water is never shared', async () => {
    const r = await create({ entry_type: 'water', water_ml: 250, share_with_circles: true });
    expect(r.body.data).toMatchObject({ is_private: true, visibility: 'private' });
  });

  it('reads the default from the profile when the auth object has no preferences', async () => {
    db.getRows('profiles')[0].preferences = { privacy: { share_meals_with_circles: true } };
    authedUser = { id: OWNER, email: 'owner@example.com' };
    const r = await create(meal());
    expect(r.body.data).toMatchObject({ is_private: false, visibility: 'circle' });
  });
});

describe('PATCH /api/mobile/food-log/[id] — changing the flag', () => {
  it('shared → private: cards retracted and scrubbed BEFORE the response', async () => {
    seedEntry('e-shared', SHARED, { posted: true });
    const r = await patch('e-shared', { share_with_circles: false });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ is_private: true, visibility: 'private' });
    // No flushAfter(): the retraction is not deferred.
    expect(livePosts('e-shared')).toHaveLength(0);
    const [post] = allPosts('e-shared');
    expect(post.body).toBeNull();
    expect(post.system_payload).toEqual({ render_hint: 'meal_card', actors: [{ id: OWNER }], entry_id: 'e-shared' });
  });

  it('private → shared (recent, never posted): card + push', async () => {
    seedEntry('e-priv', PRIVATE);
    const r = await patch('e-priv', { share_with_circles: true });
    expect(r.body.data).toMatchObject({ is_private: false, visibility: 'circle' });
    await flushAfter();
    expect(livePosts('e-priv')).toHaveLength(1);
    expect(pushes.sent).toHaveLength(1);
  });

  it('re-sharing an old meal posts silently', async () => {
    seedEntry('e-old', PRIVATE, { loggedAt: '2026-11-01T12:00:00Z' });
    await patch('e-old', { share_with_circles: true });
    await flushAfter();
    expect(livePosts('e-old')).toHaveLength(1);
    expect(pushes.sent).toHaveLength(0);
  });

  it('private → shared → private → shared within the window pushes only once', async () => {
    seedEntry('e-flip', PRIVATE);
    await patch('e-flip', { share_with_circles: true });
    await flushAfter();
    await patch('e-flip', { share_with_circles: false });
    await patch('e-flip', { share_with_circles: true });
    await flushAfter();
    expect(livePosts('e-flip')).toHaveLength(1);
    expect(pushes.sent).toHaveLength(1);
  });

  it('a shipped Android whole-entry PATCH (is_private:false, visibility:circle) never re-shares', async () => {
    seedEntry('e-a', PRIVATE);
    const r = await patch('e-a', {
      id: 'e-a',
      user_id: OWNER,
      entry_type: 'food',
      notes: 'Edited',
      meal_type: 'dinner',
      is_private: false,
      visibility: 'circle',
      image_urls: [],
      logged_at: '2026-11-03T17:00:00.000Z',
      created_at: '2026-11-03T17:00:00.000Z',
      sync_status: 'synced',
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ is_private: true, visibility: 'private', notes: 'Edited' });
    await flushAfter();
    expect(livePosts('e-a')).toHaveLength(0);
  });

  it('a shipped iOS PATCH with is_private:true makes a shared entry private', async () => {
    seedEntry('e-i', SHARED, { posted: true });
    const r = await patch('e-i', { entry_type: 'food', meal_type: 'dinner', is_private: true, logged_at: '2026-11-03T17:00:00Z' });
    expect(r.body.data).toMatchObject({ is_private: true, visibility: 'private' });
    expect(livePosts('e-i')).toHaveLength(0);
  });

  it('a shipped iOS PATCH with is_private:false leaves a shared entry shared (cards refreshed)', async () => {
    seedEntry('e-j', SHARED, { posted: true });
    const r = await patch('e-j', { entry_type: 'food', meal_type: 'dinner', notes: 'more rice', is_private: false });
    expect(r.body.data).toMatchObject({ is_private: false, visibility: 'circle' });
    await flushAfter();
    expect(livePosts('e-j')).toHaveLength(1);
  });

  it("another user's entry → 403, nothing changes", async () => {
    seedEntry('e-x', SHARED, { posted: true });
    authedUser = { ...MEMBER_PROFILE };
    const r = await patch('e-x', { share_with_circles: false });
    expect(r.status).toBe(403);
    expect(entry('e-x').is_private).toBe(false);
  });
});

describe('POST /api/mobile/food-log/sharing/bulk', () => {
  it('makes every past entry private, retracts every card, and is idempotent', async () => {
    seedEntry('b1', SHARED, { posted: true });
    seedEntry('b2', SHARED, { posted: true });
    seedEntry('b3', PRIVATE);
    // a half-private row whose card was never retracted
    seedEntry('b4', { is_private: true, visibility: 'circle' }, { posted: true });

    const res = await POST_BULK(req('/api/mobile/food-log/sharing/bulk', 'POST', { share_with_circles: false }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ entries_made_private: 3, posts_removed: 3 });
    for (const id of ['b1', 'b2', 'b3', 'b4']) expect(entry(id)).toMatchObject(PRIVATE);
    expect(livePosts()).toHaveLength(0);

    const again = await (await POST_BULK(req('/x', 'POST', { share_with_circles: false }))).json();
    expect(again.data).toEqual({ entries_made_private: 0, posts_removed: 0 });
  });

  it('does not offer "share all past meals"', async () => {
    seedEntry('b5', PRIVATE);
    const res = await POST_BULK(req('/x', 'POST', { share_with_circles: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('UNSUPPORTED');
    expect(entry('b5')).toMatchObject(PRIVATE);
  });

  it('400 without a body field', async () => {
    expect((await POST_BULK(req('/x', 'POST', {}))).status).toBe(400);
  });
});

describe('GET/PUT /api/mobile/food-log/sharing — the default', () => {
  it('defaults to off, saves server-side, keeps other preferences, never touches entries', async () => {
    db.getRows('profiles')[0].preferences = { privacy: { show_weight: false }, hydration: { daily_water_ml_target: 2000 } };
    seedEntry('d1', PRIVATE);

    const get1 = await (await GET_SHARING(req('/x', 'GET'))).json();
    expect(get1).toMatchObject({ success: true, data: { share_meals_with_circles: false } });

    const put = await PUT_SHARING(req('/x', 'PUT', { share_meals_with_circles: true }));
    expect((await put.json()).data).toEqual({ share_meals_with_circles: true });
    expect(db.getRows('profiles')[0].preferences).toEqual({
      privacy: { show_weight: false, share_meals_with_circles: true },
      hydration: { daily_water_ml_target: 2000 },
    });
    expect(entry('d1')).toMatchObject(PRIVATE);

    const get2 = await (await GET_SHARING(req('/x', 'GET'))).json();
    expect(get2.data.share_meals_with_circles).toBe(true);
  });

  it('400 on a non-boolean', async () => {
    expect((await PUT_SHARING(req('/x', 'PUT', { share_meals_with_circles: 'yes' }))).status).toBe(400);
  });
});

// ===========================================================================
// Part 2 — every circle surface: a private entry is invisible to other members
// ===========================================================================

describe('circle surfaces — private entries are invisible to other members', () => {
  it('circle chat: a retracted meal card carries nothing about the meal (incl. pre-fix tombstones)', async () => {
    seedEntry('c1', SHARED, { posted: true });
    await patch('c1', { share_with_circles: false });
    // An OLD tombstone written before this change still holds the payload in the row.
    seedEntry('c2', PRIVATE, { posted: true });
    db.getRows('circle_messages').find((m) => m.id === 'msg-c2')!.deleted_at = '2026-11-03T17:10:00Z';

    const { messages } = await CircleChatService.listMessages(CIRCLE, MEMBER, {});
    const cards = messages.filter((m) => m.system?.eventType === 'meal_logged');
    expect(cards).toHaveLength(2);
    for (const m of cards) {
      expect(m.deletedAt).not.toBeNull();
      expect(m.body).toBeNull();
      expect(JSON.stringify(m.system?.payload)).not.toMatch(/Secret|calories|photo_path|image_id/);
    }
  });

  it('meal photo via the image proxy: 403 for a member once private; owner still 200; never `public` cache', async () => {
    seedEntry('p1', SHARED, { posted: true });
    const get = (who: Record<string, any>) => {
      authedUser = who;
      return GET_IMAGE(req('/api/mobile/food-log/images/img-p1?size=medium', 'GET'), params({ imageId: 'img-p1' }));
    };
    const shared = await get({ ...MEMBER_PROFILE });
    expect(shared.status).toBe(200);
    expect(shared.headers.get('cache-control')).toBe('private, max-age=300');

    authedUser = { ...OWNER_PROFILE };
    await patch('p1', { share_with_circles: false });

    expect((await get({ ...MEMBER_PROFILE })).status).toBe(403);
    const own = await get({ ...OWNER_PROFILE });
    expect(own.status).toBe(200);
    expect(own.headers.get('cache-control')).not.toMatch(/public/);
  });

  it('circle food feed: private and half-private entries never appear', async () => {
    seedEntry('f-shared', SHARED);
    seedEntry('f-private', PRIVATE);
    seedEntry('f-half', { is_private: true, visibility: 'circle' });
    const { cards } = await CircleFoodFeedService.getFeed(CIRCLE, MEMBER, {});
    expect(cards.map((c: any) => c.id)).toEqual(['f-shared']);
  });

  it('food-log reactions: a member cannot react to a private entry', async () => {
    seedEntry('r1', PRIVATE);
    await expect(CircleFoodFeedService.addReaction('r1', MEMBER, 'flame' as any)).rejects.toThrow('NotFound');
    // The owner can still react to their own.
    await expect(CircleFoodFeedService.addReaction('r1', OWNER, 'flame' as any)).resolves.toBeDefined();
  });

  it('entry detail: an old per-user share row never outlives "private"', async () => {
    seedEntry('s1', PRIVATE);
    db.seed('food_log_shares', [{ food_log_entry_id: 's1', owner_id: OWNER, shared_with_user_id: MEMBER, expires_at: null }]);
    authedUser = { ...MEMBER_PROFILE };
    const res = await GET_DETAIL(req('/api/mobile/food-log/s1', 'GET'), params({ id: 's1' }));
    expect(res.status).toBe(404);
  });

  it("nutrition challenge: private meals count toward the owner's score, but their intake average is hidden from others", async () => {
    db.seed('nutrition_challenge_config', [
      { id: 'cfg', fitcircle_id: CIRCLE, metric_type: 'protein_target', target_value: 40, created_at: NOW.toISOString(), updated_at: NOW.toISOString() },
    ]);
    seedEntry('n1', PRIVATE, { protein: 60 });

    const asMember = await NutritionChallengeService.computeProgress(CIRCLE, MEMBER);
    const ownerRow = asMember.rows.find((r: any) => r.member.id === OWNER)!;
    expect(ownerRow.successDays).toBe(1); // the score counts it (documented decision)
    expect(ownerRow.averageValue).toBeNull(); // the food number is not shown

    const asOwner = await NutritionChallengeService.computeProgress(CIRCLE, OWNER);
    expect(asOwner.rows.find((r: any) => r.member.id === OWNER)!.averageValue).toBe(60);
  });

  it('nutrition leaderboard / streak-style participation: a private meal still counts as a logged day (no food data exposed)', async () => {
    seedEntry('l1', PRIVATE);
    const { rows } = await CircleFoodFeedService.nutritionLeaderboard(CIRCLE, MEMBER);
    const ownerRow = rows.find((r: any) => r.user.id === OWNER)!;
    expect(ownerRow.daysLogged).toBe(1);
    expect(JSON.stringify(ownerRow)).not.toMatch(/Secret|calories|protein/);
  });

  it('push: making a meal private sends nothing', async () => {
    seedEntry('q1', SHARED, { posted: true });
    await patch('q1', { share_with_circles: false });
    await flushAfter();
    expect(pushes.sent).toHaveLength(0);
  });
});
