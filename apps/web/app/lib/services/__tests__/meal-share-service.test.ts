/**
 * 1.1.5 meal sharing (docs/ENGAGEMENT_115_SPEC.md §4): default toggles, per-meal circle lists,
 * post / retract per circle before the response, push rules, the image-proxy rule.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getReferralDb().client() }));
const chat = vi.hoisted(() => ({ pushes: [] as any[][] }));
vi.mock('../circle-chat-service', () => ({
  CircleChatService: {
    emitSystemPost: async (p: any) => {
      const row = {
        id: `msg-${getReferralDb().rows('circle_messages').length + 1}`,
        fitcircle_id: p.fitcircleId,
        system_event_type: p.eventType,
        system_event_ref: p.refId,
        system_payload: p.systemPayload,
        body: p.body,
        deleted_at: null,
        created_at: new Date().toISOString(),
      };
      getReferralDb().rows('circle_messages').push(row);
      return row;
    },
  },
}));
vi.mock('../chat-notification-service', () => ({
  ChatNotificationService: {
    notifySystemEvent: async (intents: any[]) => {
      chat.pushes.push(intents);
      return [];
    },
  },
}));

import { resetRemoteConfigCache } from '../../remote-config/service';
import { CircleMealPostService } from '../circle-meal-post-service';
import { defaultOnFor, mealVisibleInCircle, sharingDefaultState, type DefaultOnInput } from '../food-entry-privacy';
import { MealShareError, MealShareService } from '../meal-share-service';

import { ReferralFakeDb, getReferralDb, setReferralDb } from './referral-fake-db';

const ME = '11111111-1111-4111-8111-111111111111';
const FRIEND = '22222222-2222-4222-8222-222222222222';
const STRANGER = '33333333-3333-4333-8333-333333333333';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ENTRY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

let db: ReferralFakeDb;
const member = (circle: string, user: string, status = 'active') => db.rows('fitcircle_members').push({ fitcircle_id: circle, user_id: user, status });
const circle = (id: string, over: Record<string, unknown> = {}) =>
  db.rows('fitcircles').push({ id, name: `Circle ${id.slice(0, 1)}`, visibility: 'private', is_official: false, status: 'active', ...over });
const liveCards = () => db.rows('circle_messages').filter((m) => m.system_event_type === 'meal_logged' && m.deleted_at === null);

beforeEach(() => {
  db = new ReferralFakeDb();
  setReferralDb(db);
  resetRemoteConfigCache();
  chat.pushes.length = 0;
  db.addProfile({ id: ME, display_name: 'Ani', preferences: {} });
  db.addProfile({ id: FRIEND, display_name: 'Sam', avatar_url: 'https://cdn.example/sam.png' });
  db.addProfile({ id: STRANGER, display_name: 'Lee' });
  circle(A, { name: 'Morning Movers' });
  circle(B, { name: 'Book Club' });
  member(A, ME);
  member(A, FRIEND);
  member(B, ME);
  member(B, STRANGER);
  db.rows('food_log_entries').push({
    id: ENTRY, user_id: ME, entry_type: 'food', meal_type: 'lunch', title: 'Salad', logged_at: new Date().toISOString(),
    is_private: true, visibility: 'private', has_images: false, deleted_at: null, share_circle_ids: null,
  });
});

describe('defaultOnFor (§4.3, first rule wins)', () => {
  const base: DefaultOnInput = {
    remembered: null, explicitTier: null, sharingDefaultOff: false, madePrivate: false,
    isOfficial: false, circleVisibility: 'private', memberCount: 6, largeCircleThreshold: 20,
  };
  it.each<[string, Partial<DefaultOnInput>, boolean, string]>([
    ['1 remembered on beats everything', { remembered: true, sharingDefaultOff: true, isOfficial: true }, true, 'remembered'],
    ['1 remembered off', { remembered: false }, false, 'remembered'],
    ['2 explicit tier summary', { explicitTier: 'summary' }, false, 'circle_privacy'],
    ['2 explicit tier private', { explicitTier: 'private' }, false, 'circle_privacy'],
    ['2 an explicit full row is not a privacy choice', { explicitTier: 'full' }, true, 'friend_circle'],
    ['3 stored sharing default false', { sharingDefaultOff: true }, false, 'sharing_default_off'],
    ['4 bulk made private', { madePrivate: true }, false, 'made_private'],
    ['5 official circle', { isOfficial: true }, false, 'public_circle'],
    ['5 public circle', { circleVisibility: 'public' }, false, 'public_circle'],
    ['6 large circle', { memberCount: 21 }, false, 'large_circle'],
    ['6 exactly the threshold is still a friend circle', { memberCount: 20 }, true, 'friend_circle'],
    ['7 friend circle', {}, true, 'friend_circle'],
  ])('%s', (_name, over, on, reason) => {
    expect(defaultOnFor({ ...base, ...over })).toEqual({ default_on: on, reason });
  });

  it('sharing_default reflects only the STORED key', () => {
    expect(sharingDefaultState({ privacy: { share_meals_with_circles: true } })).toBe('on');
    expect(sharingDefaultState({ privacy: { share_meals_with_circles: false } })).toBe('off');
    expect(sharingDefaultState({ privacy: {} })).toBe('unset');
    expect(sharingDefaultState(null)).toBe('unset');
  });

  it('mealVisibleInCircle: an explicit list beats the tier; null list = tier full (legacy)', () => {
    expect(mealVisibleInCircle({ share_circle_ids: [A] }, A, 'summary')).toBe(true);
    expect(mealVisibleInCircle({ share_circle_ids: [A] }, B, 'full')).toBe(false);
    expect(mealVisibleInCircle({ share_circle_ids: null }, B, 'full')).toBe(true);
    expect(mealVisibleInCircle({}, B, 'summary')).toBe(false);
  });
});

describe('GET share-targets', () => {
  it('friend circles default on, public / official / large off, remembered and tier rows respected', async () => {
    const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const E = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const DONE = '99999999-9999-4999-8999-999999999999';
    circle(C, { name: 'Official', is_official: true });
    circle(D, { name: 'Big One' });
    circle(E, { name: 'Remembered Off' });
    circle(DONE, { name: 'Finished', status: 'completed' });
    for (const c of [C, D, E, DONE]) member(c, ME);
    for (let i = 0; i < 21; i++) member(D, `0000000${i}-0000-4000-8000-000000000000`);
    db.rows('meal_share_circle_prefs').push({ user_id: ME, fitcircle_id: E, share: false });
    db.rows('circle_food_privacy').push({ user_id: ME, fitcircle_id: B, tier: 'summary' });

    const t = await MealShareService.getShareTargets(ME);
    expect(t.sharing_default).toBe('unset');
    const by = Object.fromEntries(t.circles.map((c) => [c.name, c]));
    expect(Object.keys(by).sort()).toEqual(['Big One', 'Book Club', 'Morning Movers', 'Official', 'Remembered Off']); // completed excluded
    expect(by['Morning Movers']).toEqual({
      circle_id: A, name: 'Morning Movers', member_count: 2, avatar_urls: ['https://cdn.example/sam.png'], default_on: true, reason: 'friend_circle',
    });
    expect(by['Book Club']).toMatchObject({ default_on: false, reason: 'circle_privacy' });
    expect(by['Official']).toMatchObject({ default_on: false, reason: 'public_circle' });
    expect(by['Big One']).toMatchObject({ default_on: false, reason: 'large_circle', member_count: 22 });
    expect(by['Remembered Off']).toMatchObject({ default_on: false, reason: 'remembered' });
  });

  it('an explicit "private by default" turns every toggle off; ordering is recent chat activity, then name', async () => {
    db.profile(ME)!.preferences = { privacy: { share_meals_with_circles: false } };
    db.rows('circle_messages').push({ fitcircle_id: B, sender_id: ME, created_at: '2026-11-12T10:00:00Z', system_event_type: null, deleted_at: null });
    const t = await MealShareService.getShareTargets(ME);
    expect(t.sharing_default).toBe('off');
    expect(t.circles.map((c) => c.name)).toEqual(['Book Club', 'Morning Movers']);
    expect(t.circles.every((c) => !c.default_on && c.reason === 'sharing_default_off')).toBe(true);
  });

  it('bulk made-private users start with every toggle off', async () => {
    db.profile(ME)!.preferences = { privacy: { meals_made_private_at: '2026-11-05T00:00:00Z' } };
    const t = await MealShareService.getShareTargets(ME);
    expect(t.circles.every((c) => c.reason === 'made_private')).toBe(true);
  });

  it('no circles → empty list', async () => {
    db.rows('fitcircle_members').length = 0;
    expect(await MealShareService.getShareTargets(ME)).toEqual({ sharing_default: 'unset', circles: [] });
  });
});

describe('POST /food-log/{id}/share {circles}', () => {
  const share = (circles: Array<[string, boolean]>, remember = true) =>
    MealShareService.shareToCircles(ME, ENTRY, { circles: circles.map(([circle_id, s]) => ({ circle_id, share: s })), remember });

  it('posts only to the chosen circle, stores the list, pushes once for a recent meal, remembers every row', async () => {
    const r = await share([[A, true], [B, false]]);
    expect(r).toEqual({ entry_id: ENTRY, is_private: false, visibility: 'circle', shared_circle_ids: [A], posted: 1, retracted: 0 });
    expect(liveCards().map((m) => m.fitcircle_id)).toEqual([A]);
    expect(db.rows('food_log_entries')[0]).toMatchObject({ is_private: false, visibility: 'circle', share_circle_ids: [A] });
    expect(chat.pushes).toHaveLength(1);
    expect(db.rows('meal_share_circle_prefs')).toEqual([
      expect.objectContaining({ user_id: ME, fitcircle_id: A, share: true }),
      expect.objectContaining({ user_id: ME, fitcircle_id: B, share: false }),
    ]);
  });

  it('is idempotent: the same tap again posts nothing and pushes nothing', async () => {
    await share([[A, true], [B, false]]);
    const again = await share([[A, true], [B, false]]);
    expect(again).toMatchObject({ posted: 0, retracted: 0 });
    expect(liveCards()).toHaveLength(1);
    expect(chat.pushes).toHaveLength(1);
  });

  it('moving to another circle retracts the old card BEFORE answering and never re-pushes', async () => {
    await share([[A, true], [B, false]]);
    const moved = await share([[A, false], [B, true]]);
    expect(moved).toMatchObject({ shared_circle_ids: [B], posted: 1, retracted: 1 });
    expect(liveCards().map((m) => m.fitcircle_id)).toEqual([B]);
    const tomb = db.rows('circle_messages').find((m) => m.fitcircle_id === A)!;
    expect(tomb.deleted_at).not.toBeNull();
    expect(tomb.system_payload).not.toHaveProperty('title'); // scrubbed
    expect(chat.pushes).toHaveLength(1); // never posted before → only the first share pushed
  });

  it('all off → private, every card retracted (same as PATCH share_with_circles:false)', async () => {
    await share([[A, true], [B, true]]);
    const off = await share([[A, false], [B, false]]);
    expect(off).toEqual({ entry_id: ENTRY, is_private: true, visibility: 'private', shared_circle_ids: [], posted: 0, retracted: 2 });
    expect(liveCards()).toEqual([]);
    expect(db.rows('food_log_entries')[0]).toMatchObject({ is_private: true, share_circle_ids: null });
  });

  it('an old meal (> 2 h ago) posts silently', async () => {
    db.rows('food_log_entries')[0].logged_at = new Date(Date.now() - 3 * 3600_000).toISOString();
    await share([[A, true]]);
    expect(liveCards()).toHaveLength(1);
    expect(chat.pushes).toEqual([]);
  });

  it('circles the user is not an active member of are ignored', async () => {
    const r = await share([['cccccccc-cccc-4ccc-8ccc-cccccccccccc', true]]);
    expect(r).toMatchObject({ is_private: true, shared_circle_ids: [] });
  });

  it('remember:false writes no memory', async () => {
    await share([[A, true]], false);
    expect(db.rows('meal_share_circle_prefs')).toEqual([]);
  });

  it("another user's entry → NOT_FOUND; water / supplements → UNSHAREABLE", async () => {
    await expect(MealShareService.shareToCircles(FRIEND, ENTRY, { circles: [{ circle_id: A, share: true }], remember: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    db.rows('food_log_entries')[0].entry_type = 'water';
    const err = await share([[A, true]]).catch((e) => e);
    expect(err).toBeInstanceOf(MealShareError);
    expect(err.code).toBe('UNSHAREABLE');
  });
});

describe('who may see the meal (image proxy rule)', () => {
  it('a member of a non-target circle is denied; a member of the target circle is allowed', async () => {
    await MealShareService.shareToCircles(ME, ENTRY, { circles: [{ circle_id: B, share: true }], remember: false });
    const entry = db.rows('food_log_entries')[0] as any;
    expect(await CircleMealPostService.viewerCanSeeEntry(FRIEND, entry)).toBe(false); // only in A
    expect(await CircleMealPostService.viewerCanSeeEntry(STRANGER, entry)).toBe(true); // in B
    expect(await CircleMealPostService.viewerCanSeeEntry(ME, entry)).toBe(true);
  });

  it('null list (shipped clients, old rows) → the legacy tier rule, unchanged', async () => {
    const entry = { ...db.rows('food_log_entries')[0], is_private: false, visibility: 'circle', share_circle_ids: null } as any;
    expect(await CircleMealPostService.viewerCanSeeEntry(FRIEND, entry)).toBe(true); // no tier row = full
    db.rows('circle_food_privacy').push({ user_id: ME, fitcircle_id: A, tier: 'summary' });
    expect(await CircleMealPostService.viewerCanSeeEntry(FRIEND, entry)).toBe(false);
  });

  it('legacy create hook (null list) posts to every full-tier circle, as before', async () => {
    db.rows('circle_food_privacy').push({ user_id: ME, fitcircle_id: B, tier: 'private' });
    await CircleMealPostService.onMealLogged({ ...db.rows('food_log_entries')[0], is_private: false, visibility: 'circle' } as any);
    expect(liveCards().map((m) => m.fitcircle_id)).toEqual([A]);
  });

  it('meal card payload carries the primary image size', async () => {
    db.rows('food_log_images').push({ id: 'img-1', food_log_entry_id: ENTRY, width: 1080, height: 1440, display_order: 0, deleted_at: null });
    const e = { ...db.rows('food_log_entries')[0], is_private: false, visibility: 'circle', has_images: true, share_circle_ids: [A] } as any;
    await CircleMealPostService.onMealLogged(e);
    expect(liveCards()[0].system_payload).toMatchObject({ image_id: 'img-1', image_width: 1080, image_height: 1440 });
  });
});

describe('bulk "Make all past meals private" records the explicit choice (§4.6)', () => {
  it('makeAllPrivate writes meals_made_private_at (keeping other preferences); the backfill never overwrites', async () => {
    const { FoodEntryPrivacyService } = await import('../food-entry-privacy-service');
    db.profile(ME)!.preferences = { privacy: { share_meals_with_circles: true }, units: 'metric' };
    db.rows('food_log_entries')[0].is_private = false;
    db.rows('food_log_entries')[0].visibility = 'circle';
    const r = await FoodEntryPrivacyService.makeAllPrivate(ME);
    expect(r.entries_made_private).toBe(1);
    const prefs = db.profile(ME)!.preferences;
    expect(prefs).toMatchObject({ units: 'metric', privacy: { share_meals_with_circles: true, meals_made_private_at: expect.any(String) } });
    const first = prefs.privacy.meals_made_private_at;
    expect(await FoodEntryPrivacyService.markMealsMadePrivate(ME, { at: '2026-11-05T00:00:00.000Z', onlyIfAbsent: true })).toBe(false);
    expect(db.profile(ME)!.preferences.privacy.meals_made_private_at).toBe(first);
    const t = await MealShareService.getShareTargets(ME);
    expect(t.circles.every((c) => c.default_on === false)).toBe(true);
  });
});

describe('offline-outbox shares inside create / PATCH remember the seen rows (share_seen_circle_ids)', () => {
  it('every seen circle is remembered: chosen → true, the rest → false; no seen list → nothing', async () => {
    await MealShareService.rememberFromEntryBody(ME, { share_with_circles: true, share_circle_ids: [A] });
    expect(db.rows('meal_share_circle_prefs')).toEqual([]);
    await MealShareService.rememberFromEntryBody(ME, { share_with_circles: true, share_circle_ids: [A], share_seen_circle_ids: [A, B] });
    expect(db.rows('meal_share_circle_prefs')).toEqual([
      expect.objectContaining({ fitcircle_id: A, share: true }),
      expect.objectContaining({ fitcircle_id: B, share: false }),
    ]);
    // [] = share to none: every seen row is remembered off.
    await MealShareService.rememberFromEntryBody(ME, { share_with_circles: true, share_circle_ids: [], share_seen_circle_ids: [A, B] });
    expect(db.rows('meal_share_circle_prefs').map((r) => r.share)).toEqual([false, false]);
    const t = await MealShareService.getShareTargets(ME);
    expect(t.circles.every((c) => c.reason === 'remembered' && !c.default_on)).toBe(true);
  });
});
