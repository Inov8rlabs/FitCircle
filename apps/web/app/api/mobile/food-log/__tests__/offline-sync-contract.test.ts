/**
 * Food-log contract for the mobile offline outbox (local-first sync):
 *  - DELETE is idempotent (200 deleted:true / deleted:false), 404 for another
 *    user's entry, 500 + code for database errors.
 *  - PATCH status codes: 400 validation, 404 missing, 403 another user's, 500 DB.
 *  - Photo uploads are idempotent per entry + key (client image_key or content
 *    hash): a retried batch adds no duplicate images.
 *  - Create / PATCH responses carry the entry's photo URLs (list shape).
 *  - Create honours the log-time `timezone` for the entry's day and streak claim.
 *
 * Real route handlers and services over the in-memory Supabase fake (storage
 * stubbed); only auth and the circle-chat / referral / momentum side effects
 * are mocked.
 */
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { POST as POST_BATCH } from '../[id]/images/batch/route';
import { POST as POST_IMAGE } from '../[id]/images/route';
import { DELETE, PATCH } from '../[id]/route';
import { POST } from '../route';

const deferred: Array<() => unknown> = [];
vi.mock('next/server', async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return { ...original, after: (cb: () => unknown) => void deferred.push(cb) };
});
async function flushAfter() {
  while (deferred.length) await deferred.shift()!();
}

vi.mock('@/lib/supabase-admin');
let authedUser: Record<string, any> | null = null;
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authedUser) throw new Error('Unauthorized');
    return authedUser;
  }),
}));
vi.mock('@/lib/services/momentum-service', () => ({
  MomentumService: { checkIn: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/lib/services/referral-service', () => ({ ReferralService: { onActivity: vi.fn() } }));
vi.mock('@/lib/services/circle-streak-service', () => ({
  CircleStreakService: { onMemberActivity: vi.fn() },
}));
const mealPosts = vi.hoisted(() => ({ deleted: [] as string[] }));
vi.mock('@/lib/services/circle-meal-post-service', () => ({
  CircleMealPostService: {
    isShareableMeal: (e: any) => e.entry_type === 'food' && !e.is_private,
    onMealLogged: vi.fn(async () => undefined),
    onMealUpdated: vi.fn(async () => undefined),
    onMealPhotoAttached: vi.fn(async () => undefined),
    onMealDeleted: vi.fn(async (id: string) => void mealPosts.deleted.push(id)),
  },
}));
vi.mock('@/lib/services/nutrition-training-service', () => ({
  NutritionTrainingService: { enabled: false, reconcileEntry: vi.fn() },
}));

// 03:30 UTC Oct 20 = 23:30 Oct 19 in Toronto = 12:30 Oct 20 in Tokyo.
const NOW = new Date('2026-10-20T03:30:00Z');
const TZ = 'America/Toronto';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const MEAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHERS_MEAL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MISSING = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const API = 'https://api.test';

const PROFILE = {
  id: USER,
  email: 'a@example.com',
  subscription_tier: 'free',
  timezone: TZ,
  created_at: '2026-01-01T00:00:00Z',
  preferences: {},
};

let db: FakeSupabase;
let storageWrites: { path: string; upsert: boolean }[];
let storageRemoves: string[];
/** Make the next food_log_entries call of `op` fail with this error. */
let failNext: { op: 'select' | 'update'; error: { code: string; message: string } } | null;

function makeDb() {
  const fake = new FakeSupabase({
    profiles: { uniqueKey: ['id'] },
    food_log_entries: { uniqueKey: ['id'] },
    food_log_images: { uniqueKey: ['id'] },
    streak_claims: { uniqueKey: ['user_id', 'claim_date'] },
    streak_shields: { uniqueKey: ['user_id', 'shield_type'] },
    engagement_streaks: { uniqueKey: ['user_id'] },
    engagement_activities: { uniqueKey: ['user_id', 'activity_date', 'activity_type', 'reference_id'] },
  });
  const from = fake.from.bind(fake);
  (fake as any).from = (table: string) => {
    const q: any = from(table);
    if (table !== 'food_log_entries') return q;
    let op = 'select';
    for (const m of ['insert', 'update', 'upsert']) {
      const orig = q[m].bind(q);
      q[m] = (...args: any[]) => ((op = m), orig(...args));
    }
    const failing = () => {
      if (failNext && failNext.op === op) {
        const error = failNext.error;
        failNext = null;
        return error;
      }
      return null;
    };
    for (const m of ['single', 'maybeSingle']) {
      const orig = q[m].bind(q);
      q[m] = (...args: any[]) => {
        const error = failing();
        return error ? Promise.resolve({ data: null, error }) : orig(...args);
      };
    }
    const then = q.then.bind(q);
    q.then = (res: any, rej: any) => {
      const error = failing();
      return error ? Promise.resolve({ data: null, error }).then(res, rej) : then(res, rej);
    };
    return q;
  };
  (fake as any).storage = {
    from: () => ({
      upload: async (path: string, _body: unknown, opts: { upsert?: boolean }) => {
        storageWrites.push({ path, upsert: !!opts?.upsert });
        return { data: { path }, error: null };
      },
      remove: async (paths: string[]) => {
        storageRemoves.push(...paths);
        return { data: null, error: null };
      },
    }),
  };
  return fake;
}

function seed() {
  db.seed('profiles', [PROFILE]);
  db.seed('feature_flags', [
    { name: 'food_logging', is_enabled: true, allowed_tiers: ['free', 'premium'], rollout_percentage: 0 },
  ]);
  db.seed('food_log_entries', [
    { id: MEAL, user_id: USER, entry_type: 'food', meal_type: 'lunch', entry_date: '2026-10-19', deleted_at: null, image_count: 0, has_images: false },
    { id: OTHERS_MEAL, user_id: OTHER, entry_type: 'food', meal_type: 'lunch', entry_date: '2026-10-19', deleted_at: null },
  ]);
  db.seed('streak_shields', [
    { user_id: USER, shield_type: 'freeze', available_count: 0 },
    { user_id: USER, shield_type: 'milestone_shield', available_count: 0, metadata: {} },
    { user_id: USER, shield_type: 'purchased', available_count: 0 },
  ]);
  db.seed('engagement_streaks', [{ user_id: USER, current_streak: 0, longest_streak: 0, paused: false, total_points: 0 }]);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  process.env.NEXT_PUBLIC_APP_URL = API;
  deferred.length = 0;
  mealPosts.deleted = [];
  storageWrites = [];
  storageRemoves = [];
  failNext = null;
  db = makeDb();
  (createAdminSupabase as any).mockReturnValue(db);
  authedUser = { ...PROFILE };
  seed();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.NEXT_PUBLIC_APP_URL;
});

const rows = (table: string) => db.getRows(table);
const entry = (id: string) => rows('food_log_entries').find((r) => r.id === id) as Record<string, any> & { id: string };
const liveImages = (entryId: string) =>
  rows('food_log_images').filter((r) => r.food_log_entry_id === entryId && !r.deleted_at);

const jsonReq = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const del = (id: string) => DELETE(jsonReq(`http://localhost/api/mobile/food-log/${id}`, 'DELETE', undefined, { 'x-client-timezone': TZ }), params(id));
const patch = (id: string, body: unknown) => PATCH(jsonReq(`http://localhost/api/mobile/food-log/${id}`, 'PATCH', body), params(id));
const create = (body: unknown, headers: Record<string, string> = {}) =>
  POST(jsonReq('http://localhost/api/mobile/food-log', 'POST', body, headers));

// --- images -----------------------------------------------------------------------
async function jpeg(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: color } }).jpeg().toBuffer();
}
let RED: Buffer;
let BLUE: Buffer;
let GREEN: Buffer;
beforeEach(async () => {
  [RED, BLUE, GREEN] = await Promise.all([
    jpeg({ r: 255, g: 0, b: 0 }),
    jpeg({ r: 0, g: 0, b: 255 }),
    jpeg({ r: 0, g: 255, b: 0 }),
  ]);
});
/** A File as the route sees it (jsdom's File has no arrayBuffer(), so supply one). */
function file(buf: Buffer, name: string): File {
  const f = new File([new Uint8Array(buf)], name, { type: 'image/jpeg' });
  const bytes = new Uint8Array(buf).slice().buffer;
  Object.defineProperty(f, 'arrayBuffer', { value: async () => bytes });
  return f;
}

/** A multipart request (jsdom's FormData can't be serialised by undici, so hand it over parsed). */
function multipart(url: string, form: FormData): NextRequest {
  const req = new NextRequest(url, { method: 'POST' });
  Object.defineProperty(req, 'formData', { value: async () => form });
  return req;
}

function batch(entryId: string, files: File[], keys?: string[] | string) {
  const form = new FormData();
  for (const f of files) form.append('images', f);
  if (typeof keys === 'string') form.append('image_keys', keys);
  else for (const k of keys ?? []) form.append('image_keys', k);
  return POST_BATCH(
    multipart(`http://localhost/api/mobile/food-log/${entryId}/images/batch`, form),
    params(entryId)
  );
}
function single(entryId: string, f: File, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append('image', f);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return POST_IMAGE(
    multipart(`http://localhost/api/mobile/food-log/${entryId}/images`, form),
    params(entryId)
  );
}

// ===================================================================================

describe('DELETE /api/mobile/food-log/[id] — idempotent', () => {
  it('deletes once (deleted: true), then a replay is 200 deleted: false with no repeated side effects', async () => {
    const first = await del(MEAL);
    expect(first.status).toBe(200);
    expect((await first.json()).data).toEqual({ deleted: true, entryId: MEAL });
    const deletedAt = entry(MEAL).deleted_at;
    expect(deletedAt).toBeTruthy();
    await flushAfter();

    const second = await del(MEAL);
    const body = await second.json();
    expect(second.status).toBe(200);
    expect(body).toMatchObject({ success: true, data: { deleted: false, entryId: MEAL }, error: null });
    await flushAfter();

    expect(entry(MEAL).deleted_at).toBe(deletedAt); // not re-stamped
    expect(rows('food_log_audit').filter((a) => a.action === 'delete')).toHaveLength(1);
    expect(mealPosts.deleted).toEqual([MEAL]); // chat card tombstoned once
  });

  it('a never-synced / unknown id is 200 deleted: false', async () => {
    const res = await del(MISSING);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ deleted: false, entryId: MISSING });
  });

  it('a malformed id (Postgres 22P02) is treated as missing, not a server error', async () => {
    failNext = { op: 'select', error: { code: '22P02', message: 'invalid input syntax for type uuid' } };
    const res = await del('local-123');
    expect(res.status).toBe(200);
    expect((await res.json()).data.deleted).toBe(false);
  });

  it("another user's entry → 404 NOT_FOUND, untouched", async () => {
    const res = await del(OTHERS_MEAL);
    const body = await res.json();
    expect(res.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Entry not found');
    expect(entry(OTHERS_MEAL).deleted_at).toBeNull();
    await flushAfter();
    expect(mealPosts.deleted).toEqual([]);
  });

  it('a database error on the read → 500 DATABASE_ERROR (retryable), not "Not authorized"', async () => {
    failNext = { op: 'select', error: { code: '57014', message: 'canceling statement due to statement timeout' } };
    const res = await del(MEAL);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error.code).toBe('DATABASE_ERROR');
    expect(entry(MEAL).deleted_at).toBeNull();
  });

  it('a database error on the soft-delete → 500 DATABASE_ERROR', async () => {
    failNext = { op: 'update', error: { code: '08006', message: 'connection failure' } };
    const res = await del(MEAL);
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('DATABASE_ERROR');
  });
});

describe('PATCH /api/mobile/food-log/[id] — status codes', () => {
  it('200 for the owner, with image_urls (list shape) in the response', async () => {
    const res = await patch(MEAL, { notes: 'Grilled chicken' });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ id: MEAL, notes: 'Grilled chicken', image_urls: [] });
    expect(body.data).not.toHaveProperty('photo_url');
  });

  it('400 VALIDATION_ERROR for an invalid field', async () => {
    const res = await patch(MEAL, { meal_type: 'brunch' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('400 INVALID_JSON for a body that is not JSON', async () => {
    const res = await patch(MEAL, '{not json');
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_JSON');
  });

  it('400 VALIDATION_ERROR when the database rejects a value (check constraint)', async () => {
    failNext = { op: 'update', error: { code: '23514', message: 'violates check constraint' } };
    const res = await patch(MEAL, { notes: 'x' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('404 NOT_FOUND for a missing id', async () => {
    const res = await patch(MISSING, { notes: 'x' });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('404 NOT_FOUND for a deleted entry', async () => {
    await del(MEAL);
    const res = await patch(MEAL, { notes: 'x' });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it("403 FORBIDDEN for another user's entry, untouched", async () => {
    const res = await patch(OTHERS_MEAL, { notes: 'hijack' });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
    expect(entry(OTHERS_MEAL).notes).toBeUndefined();
  });

  it('500 DATABASE_ERROR for a database failure', async () => {
    failNext = { op: 'select', error: { code: '08006', message: 'connection failure' } };
    const res = await patch(MEAL, { notes: 'x' });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('DATABASE_ERROR');
  });
});

describe('Photo uploads — idempotent per entry + key', () => {
  it('OLD client (no keys): a retried batch adds no duplicates (content hash)', async () => {
    const first = await batch(MEAL, [file(RED, 'a.jpg'), file(BLUE, 'b.jpg')]);
    const firstBody = await first.json();
    expect(first.status).toBe(201);
    expect(firstBody.success).toBe(true);
    expect(firstBody.data.counts).toEqual({ uploaded: 2, failed: 0, duplicates: 0 });
    expect(liveImages(MEAL)).toHaveLength(2);
    expect(entry(MEAL).image_count).toBe(2);

    // Response lost → the client re-sends the same batch.
    const retry = await batch(MEAL, [file(RED, 'a.jpg'), file(BLUE, 'b.jpg')]);
    const retryBody = await retry.json();
    expect(retry.status).toBe(200);
    expect(retryBody.success).toBe(true);
    expect(retryBody.data.counts).toEqual({ uploaded: 2, failed: 0, duplicates: 2 });
    expect(retryBody.data.uploaded.map((i: any) => i.id)).toEqual(firstBody.data.uploaded.map((i: any) => i.id));
    expect(retryBody.data.uploaded.every((i: any) => i.duplicate === true)).toBe(true);
    expect(retryBody.data.uploaded[0].url).toBe(`${API}/api/mobile/food-log/images/${firstBody.data.uploaded[0].id}?size=medium`);

    expect(liveImages(MEAL)).toHaveLength(2);
    expect(entry(MEAL).image_count).toBe(2);
    expect(rows('food_log_audit').filter((a) => a.action === 'image_upload')).toHaveLength(2);
    expect(storageWrites).toHaveLength(6); // 3 renditions × 2 files, none re-written
  });

  it('client image_keys: same keys dedupe (even if re-encoded bytes differ); positions stay contiguous', async () => {
    await batch(MEAL, [file(RED, 'a.jpg')], ['k-1']);
    // Retry of a batch that had partly failed: k-1 landed, k-2 did not.
    const retry = await batch(MEAL, [file(GREEN, 'a-reencoded.jpg'), file(BLUE, 'b.jpg')], ['k-1', 'k-2']);
    const body = await retry.json();
    expect(retry.status).toBe(201);
    expect(body.data.counts).toEqual({ uploaded: 2, failed: 0, duplicates: 1 });
    expect(body.data.uploaded.map((i: any) => [i.image_key, !!i.duplicate])).toEqual([
      ['k-1', true],
      ['k-2', false],
    ]);
    expect(liveImages(MEAL).map((i) => i.display_order).sort()).toEqual([0, 1]);
    expect(entry(MEAL).image_count).toBe(2);
  });

  it('accepts image_keys as one JSON array; different keys are different photos', async () => {
    const res = await batch(MEAL, [file(RED, 'a.jpg'), file(RED, 'a-again.jpg')], JSON.stringify(['k-a', 'k-b']));
    expect(res.status).toBe(201);
    expect((await res.json()).data.counts.duplicates).toBe(0);
    expect(liveImages(MEAL)).toHaveLength(2);
  });

  it('rejects image_keys that do not line up with the files, storing nothing', async () => {
    const res = await batch(MEAL, [file(RED, 'a.jpg'), file(BLUE, 'b.jpg')], ['only-one']);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_IMAGE_KEYS');
    const bad = await batch(MEAL, [file(RED, 'a.jpg')], ['has spaces']);
    expect(bad.status).toBe(400);
    expect(liveImages(MEAL)).toHaveLength(0);
  });

  it('a photo removed earlier and attached again is a new image, not a duplicate', async () => {
    await batch(MEAL, [file(RED, 'a.jpg')]);
    const [img] = liveImages(MEAL);
    img.deleted_at = '2026-10-20T03:00:00Z';
    const res = await batch(MEAL, [file(RED, 'a.jpg')]);
    expect(res.status).toBe(201);
    const live = liveImages(MEAL);
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe(img.id);
  });

  it("another user's entry: nothing stored", async () => {
    const res = await batch(OTHERS_MEAL, [file(RED, 'a.jpg')]);
    expect(res.status).toBe(400);
    expect((await res.json()).data.failed).toHaveLength(1);
    expect(rows('food_log_images')).toHaveLength(0);
  });

  it('single-file endpoint: a re-upload returns the stored image with 200 + meta.duplicate', async () => {
    const first = await single(MEAL, file(RED, 'a.jpg'), { image_key: 'cam-1' });
    expect(first.status).toBe(201);
    const again = await single(MEAL, file(RED, 'a.jpg'), { image_key: 'cam-1' });
    const body = await again.json();
    expect(again.status).toBe(200);
    expect(body.meta.duplicate).toBe(true);
    expect(body.data.id).toBe((await first.json()).data.id);
    expect(liveImages(MEAL)).toHaveLength(1);
  });

  it('single-file endpoint without a key (old clients) still uploads with 201', async () => {
    const res = await single(MEAL, file(BLUE, 'b.jpg'), { display_order: '0' });
    expect(res.status).toBe(201);
    expect((await res.json()).meta).not.toHaveProperty('duplicate');
  });
});

describe('Create / PATCH responses carry photo URLs (list shape)', () => {
  it('a new entry reports image_urls: [] without reading images', async () => {
    const res = await create({ entry_type: 'food', meal_type: 'dinner', notes: 'Soup' }, { 'x-client-timezone': TZ });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.image_urls).toEqual([]);
    expect(body.data).not.toHaveProperty('photo_url');
  });

  it('a retried create after the photos landed returns photo_url + ordered image_urls, matching GET', async () => {
    const ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await create({ id: ID, entry_type: 'food', meal_type: 'dinner' }, { 'x-client-timezone': TZ });
    await batch(ID, [file(RED, 'a.jpg'), file(BLUE, 'b.jpg')]);
    const ids = liveImages(ID).sort((a, b) => a.display_order - b.display_order).map((i) => i.id);

    const retry = await create({ id: ID, entry_type: 'food', meal_type: 'dinner' }, { 'x-client-timezone': TZ });
    const body = await retry.json();
    expect(retry.status).toBe(200);
    expect(body.meta.duplicate).toBe(true);
    const urls = ids.map((i) => `${API}/api/mobile/food-log/images/${i}?size=medium`);
    expect(body.data.image_urls).toEqual(urls);
    expect(body.data.photo_url).toBe(urls[0]);

    const patched = await (await patch(ID, { notes: 'Ramen' })).json();
    expect(patched.data.image_urls).toEqual(urls);
    expect(patched.data.photo_url).toBe(urls[0]);

    // GET /food-log builds its photo fields with the same helper (it uses
    // range/count queries the fake doesn't model, so call the helper directly).
    const { FoodLogImageService } = await import('@/lib/services/food-log-image-service');
    const [listed] = await FoodLogImageService.withPhotoUrls([entry(ID)], db as any, API);
    expect({ photo_url: listed.photo_url, image_urls: listed.image_urls }).toEqual({
      photo_url: body.data.photo_url,
      image_urls: body.data.image_urls,
    });
  });
});

describe('GET list photo fields (shared helper) — unchanged for old clients', () => {
  it('entries without images get no photo fields; entries with images get photo_url + image_urls', async () => {
    await batch(MEAL, [file(RED, 'a.jpg')]);
    const { FoodLogImageService } = await import('@/lib/services/food-log-image-service');
    const [withPhoto, without] = await FoodLogImageService.withPhotoUrls([entry(MEAL), entry(OTHERS_MEAL)], db as any, API);
    const [img] = liveImages(MEAL);
    expect(withPhoto.image_urls).toEqual([`${API}/api/mobile/food-log/images/${img.id}?size=medium`]);
    expect(withPhoto.photo_url).toBe(withPhoto.image_urls![0]);
    expect(without).not.toHaveProperty('image_urls');
    expect(without).not.toHaveProperty('photo_url');
  });
});

describe('Create — log-time timezone', () => {
  // Logged at 08:00 Oct 20 in Tokyo (= 23:00 Oct 19 UTC = 19:00 Oct 19 in Toronto),
  // synced from Toronto later.
  const LOGGED_AT = '2026-10-19T23:00:00Z';

  it('body timezone dates the entry and its streak claim, over the device header', async () => {
    const res = await create(
      { entry_type: 'food', meal_type: 'breakfast', logged_at: LOGGED_AT, timezone: 'Asia/Tokyo' },
      { 'x-client-timezone': TZ }
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.entry_date).toBe('2026-10-20');
    expect(body.meta.entryTimezone).toEqual({ timezone: 'Asia/Tokyo', source: 'body' });
    expect(body.meta.streak.day).toBe('2026-10-20');
    expect(rows('streak_claims').map((c) => c.claim_date)).toEqual(['2026-10-20']);
  });

  it('OLD client (no body timezone): the header zone is used, as before', async () => {
    const body = await (
      await create({ entry_type: 'food', meal_type: 'dinner', logged_at: LOGGED_AT }, { 'x-client-timezone': TZ })
    ).json();
    expect(body.data.entry_date).toBe('2026-10-19');
    expect(body.meta.entryTimezone).toEqual({ timezone: TZ, source: 'header' });
    expect(body.meta.streak.day).toBe('2026-10-19');
    expect(body.meta).not.toHaveProperty('ignoredTimezone');
  });

  it('an invalid timezone is ignored (reported), never fails the sync', async () => {
    const res = await create(
      { entry_type: 'food', meal_type: 'dinner', logged_at: LOGGED_AT, timezone: 'Mars/Olympus_Mons' },
      { 'x-client-timezone': TZ }
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.entry_date).toBe('2026-10-19');
    expect(body.meta.entryTimezone.source).toBe('header');
    expect(body.meta.ignoredTimezone).toBe('Mars/Olympus_Mons');
  });

  it('no body timezone and no header: the profile zone dates the entry and the claim', async () => {
    authedUser = { ...PROFILE, timezone: 'Asia/Tokyo' };
    const body = await (await create({ entry_type: 'food', meal_type: 'breakfast', logged_at: LOGGED_AT })).json();
    expect(body.data.entry_date).toBe('2026-10-20');
    expect(body.meta.entryTimezone).toEqual({ timezone: 'Asia/Tokyo', source: 'profile' });
    expect(body.meta.streak.day).toBe('2026-10-20');
  });

  it('an explicit entry_date still wins', async () => {
    const body = await (
      await create({ entry_type: 'food', meal_type: 'lunch', logged_at: LOGGED_AT, entry_date: '2026-10-18', timezone: 'Asia/Tokyo' })
    ).json();
    expect(body.data.entry_date).toBe('2026-10-18');
  });

  it("water: the entry counts toward the log-time day's hydration total", async () => {
    // No header (background sync): "today" for the hydration total is the body zone too.
    const body = await (
      await create({ entry_type: 'water', water_ml: 300, logged_at: '2026-10-20T03:00:00Z', timezone: 'Asia/Tokyo' })
    ).json();
    expect(body.data.entry_date).toBe('2026-10-20');
    expect(body.data.hydration).toMatchObject({ todayMl: 300, date: '2026-10-20' });
  });
});
