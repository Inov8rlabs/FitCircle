/**
 * Shipped-client compatibility for the food-log API.
 *
 * Replays the exact requests the RELEASED apps make and checks each response
 * against the decoders those apps ship with:
 *  - iOS 1.0.4 / 1.0.5 (FitCircle-iOS 3af7f80): Codable, no key strategy,
 *    uppercase UUIDs in body ids and URL paths, `X-Client-Timezone` on JSON calls
 *    only (multipart uploads send just Authorization). Any 2xx counts as success.
 *  - Android 1.0.4 (Fitcircle-Android fd9e8c1): kotlinx Json { ignoreUnknownKeys,
 *    coerceInputValues, encodeDefaults }, lowercase UUIDs, whole-entry bodies.
 *
 * The fake models the Postgres behaviour the clients depend on: uuid columns
 * compare case-insensitively and read back lowercase, rows get column defaults,
 * and food_log_images has the partial unique index (entry, display_order).
 *
 * The file runs unchanged against the previous backend; set COMPAT_OUT to dump
 * every request's status and response shape for an old-vs-new comparison.
 */
import { writeFileSync } from 'fs';

import { NextRequest } from 'next/server';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { POST as POST_BATCH } from '../[id]/images/batch/route';
import { POST as POST_IMAGE } from '../[id]/images/route';
import { DELETE, GET as GET_DETAIL, PATCH } from '../[id]/route';
import { GET as GET_LIST, POST } from '../route';

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
vi.mock('@/lib/services/circle-meal-post-service', () => ({
  CircleMealPostService: {
    isShareableMeal: (e: any) => e.entry_type === 'food' && !e.is_private,
    onMealLogged: vi.fn(async () => undefined),
    onMealUpdated: vi.fn(async () => undefined),
    onMealPhotoAttached: vi.fn(async () => undefined),
    onMealDeleted: vi.fn(async () => undefined),
  },
}));
vi.mock('@/lib/services/nutrition-training-service', () => ({
  NutritionTrainingService: { enabled: false, reconcileEntry: vi.fn() },
}));

const NOW = new Date('2026-10-20T15:30:00Z');
const TZ = 'America/Toronto';
const USER = '11111111-1111-4111-8111-111111111111';
const API = 'https://api.test';
const PROFILE = {
  id: USER,
  email: 'a@example.com',
  subscription_tier: 'free',
  timezone: TZ,
  created_at: '2026-01-01T00:00:00Z',
  preferences: {},
};

// ---------------------------------------------------------------------------
// Postgres-faithful fake
// ---------------------------------------------------------------------------
const UUID_ANY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** uuid columns: compared case-insensitively, always read back lowercase. */
const norm = (v: any) => (typeof v === 'string' && UUID_ANY.test(v) ? v.toLowerCase() : v);
const normRow = (r: Record<string, any>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, norm(v)]));
const nowIso = () => new Date().toISOString();

const DEFAULTS: Record<string, () => Record<string, any>> = {
  food_log_entries: () => ({
    created_at: nowIso(),
    updated_at: nowIso(),
    deleted_at: null,
    image_count: 0,
    has_images: false,
  }),
  food_log_images: () => ({
    created_at: nowIso(),
    updated_at: nowIso(),
    deleted_at: null,
    display_order: 0,
    metadata: {},
  }),
};

let db: FakeSupabase;
let storageWrites: { path: string; upsert: boolean }[];
let storageRemoves: string[];

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
    let forced: { code: string; message: string } | null = null;
    for (const m of ['eq', 'neq']) {
      const orig = q[m].bind(q);
      q[m] = (col: string, v: any) => orig(col, norm(v));
    }
    const origIn = q.in.bind(q);
    q.in = (col: string, vs: any[]) => origIn(col, vs.map(norm));
    q.range = () => q; // pagination: the seeded sets are small
    q.overlaps = () => q;
    const origUpdate = q.update.bind(q);
    q.update = (patch: Record<string, any>) => origUpdate(normRow(patch));
    const origInsert = q.insert.bind(q);
    q.insert = (payload: any) => {
      const list = (Array.isArray(payload) ? payload : [payload]).map((r: any) => ({
        ...(DEFAULTS[table]?.() ?? {}),
        ...normRow(r),
      }));
      if (table === 'food_log_images') {
        // idx_food_log_images_entry_order_unique (food_log_entry_id, display_order) WHERE deleted_at IS NULL
        const live = db.getRows('food_log_images').filter((r) => !r.deleted_at);
        if (list.some((r: any) => live.some((l) => l.food_log_entry_id === r.food_log_entry_id && l.display_order === r.display_order))) {
          forced = { code: '23505', message: 'duplicate key value violates unique constraint "idx_food_log_images_entry_order_unique"' };
        }
      }
      return origInsert(Array.isArray(payload) ? list : list[0]);
    };
    for (const m of ['single', 'maybeSingle']) {
      const orig = q[m].bind(q);
      q[m] = (...a: any[]) => (forced ? Promise.resolve({ data: null, error: forced }) : orig(...a));
    }
    const then = q.then.bind(q);
    q.then = (res: any, rej: any) =>
      forced ? Promise.resolve({ data: null, error: forced }).then(res, rej) : then(res, rej);
    return q;
  };
  (fake as any).storage = {
    from: () => ({
      upload: async (path: string, _b: unknown, opts: { upsert?: boolean }) => {
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  process.env.NEXT_PUBLIC_APP_URL = API;
  deferred.length = 0;
  storageWrites = [];
  storageRemoves = [];
  db = makeDb();
  (createAdminSupabase as any).mockReturnValue(db);
  authedUser = { ...PROFILE };
  db.seed('profiles', [PROFILE]);
  db.seed('feature_flags', [
    { name: 'food_logging', is_enabled: true, allowed_tiers: ['free', 'premium'], rollout_percentage: 0 },
  ]);
  db.seed('streak_shields', [
    { user_id: USER, shield_type: 'freeze', available_count: 0 },
    { user_id: USER, shield_type: 'milestone_shield', available_count: 0, metadata: {} },
    { user_id: USER, shield_type: 'purchased', available_count: 0 },
  ]);
  db.seed('engagement_streaks', [{ user_id: USER, current_streak: 0, longest_streak: 0, paused: false, total_points: 0 }]);
});

afterEach(async () => {
  await flushAfter();
  vi.useRealTimers();
  delete process.env.NEXT_PUBLIC_APP_URL;
});

const liveImages = (entryId: string) =>
  db.getRows('food_log_images').filter((r) => r.food_log_entry_id === entryId.toLowerCase() && !r.deleted_at);
const entryRow = (id: string) => db.getRows('food_log_entries').find((r) => r.id === id.toLowerCase())!;

// ---------------------------------------------------------------------------
// Recording (for the old-vs-new table)
// ---------------------------------------------------------------------------
type Rec = { case: string; status: number; code?: string; data?: string; meta?: string };
const records: Rec[] = [];
const shape = (v: any): string =>
  v === null ? 'null' : Array.isArray(v) ? `array(${v.length})` : typeof v === 'object' ? `{${Object.keys(v).sort().join(',')}}` : typeof v;
async function call(name: string, p: Promise<Response>): Promise<{ status: number; body: any }> {
  const res = await p;
  const body = await res.json();
  records.push({
    case: name,
    status: res.status,
    code: body?.error?.code,
    data: shape(body?.data),
    meta: body?.meta ? Object.keys(body.meta).sort().join(',') : undefined,
  });
  return { status: res.status, body };
}
afterAll(() => {
  if (process.env.COMPAT_OUT) writeFileSync(process.env.COMPAT_OUT, JSON.stringify(records, null, 2));
});
const is2xx = (s: number) => s >= 200 && s < 300;

// ---------------------------------------------------------------------------
// Request builders, exactly as the shipped clients send them
// ---------------------------------------------------------------------------
const IOS_JSON = { 'content-type': 'application/json', 'x-client-timezone': TZ, authorization: 'Bearer t' };
const ANDROID_JSON = { 'content-type': 'application/json; charset=utf-8', 'x-client-timezone': TZ, authorization: 'Bearer t' };
const jsonReq = (path: string, method: string, headers: Record<string, string>, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const create = (h: Record<string, string>, body: unknown) => POST(jsonReq('/api/mobile/food-log', 'POST', h, body));
const patch = (h: Record<string, string>, id: string, body: unknown) =>
  PATCH(jsonReq(`/api/mobile/food-log/${id}`, 'PATCH', h, body), params(id));
const del = (h: Record<string, string>, id: string) =>
  DELETE(jsonReq(`/api/mobile/food-log/${id}`, 'DELETE', h), params(id));
const detail = (h: Record<string, string>, id: string) =>
  GET_DETAIL(jsonReq(`/api/mobile/food-log/${id}`, 'GET', h), params(id));
const list = (h: Record<string, string>, qs: string) => GET_LIST(jsonReq(`/api/mobile/food-log?${qs}`, 'GET', h));

async function jpeg(color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: color } }).jpeg().toBuffer();
}
let RED: Buffer;
let BLUE: Buffer;
beforeEach(async () => {
  [RED, BLUE] = await Promise.all([jpeg({ r: 255, g: 0, b: 0 }), jpeg({ r: 0, g: 0, b: 255 })]);
});
function file(buf: Buffer, name: string): File {
  const f = new File([new Uint8Array(buf)], name, { type: 'image/jpeg' });
  const bytes = new Uint8Array(buf).slice().buffer;
  Object.defineProperty(f, 'arrayBuffer', { value: async () => bytes });
  return f;
}
function multipart(path: string, form: FormData): NextRequest {
  // Multipart calls carry only Authorization (iOS raw URLRequest) — no timezone header.
  const req = new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { authorization: 'Bearer t' } });
  Object.defineProperty(req, 'formData', { value: async () => form });
  return req;
}
/** iOS uploadFoodPhoto: one `image` part, filename food_<epoch double>.jpg, no other fields. */
const iosSingle = (id: string, buf: Buffer) => {
  const form = new FormData();
  form.append('image', file(buf, `food_${NOW.getTime() / 1000}.123456.jpg`));
  return POST_IMAGE(multipart(`/api/mobile/food-log/${id}/images`, form), params(id));
};
/** Batch: repeated `images` parts (iOS food_<epoch>_<i>.jpg / Android food_<millis>_<i>.jpg), nothing else. */
const batchUpload = (id: string, bufs: Buffer[], prefix: string) => {
  const form = new FormData();
  bufs.forEach((b, i) => form.append('images', file(b, `${prefix}_${i}.jpg`)));
  return POST_BATCH(multipart(`/api/mobile/food-log/${id}/images/batch`, form), params(id));
};
/** Android androidTest-only single upload: `image` part, no display_order. */
const androidSingle = (id: string, buf: Buffer) => {
  const form = new FormData();
  form.append('image', file(buf, 'qa-fixture.jpg'));
  return POST_IMAGE(multipart(`/api/mobile/food-log/${id}/images`, form), params(id));
};

// iOS FoodLogMetadata (synthesized encoder: nil optionals omitted; dates ISO8601 second precision).
const IOS_MEAL_ID = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D';
const iosMeal = (over: Record<string, unknown> = {}) => ({
  id: IOS_MEAL_ID,
  entry_type: 'food',
  notes: 'Chicken salad',
  meal_type: 'lunch',
  is_private: true,
  logged_at: '2026-10-20T15:00:00Z',
  nutrition_data: {
    calories: 520,
    protein_g: 42,
    carbs_g: 30,
    fat_g: 22,
    items: [{ name: 'Chicken breast', quantity: 1, serving_unit: 'piece', grams: 150, calories: 250 }],
  },
  ...over,
});
// iOS WaterLogCreateRequest
const IOS_WATER_ID = 'B2C3D4E5-F6A7-4B8C-9D0E-1F2A3B4C5D6E';
const iosWater = { id: IOS_WATER_ID, water_ml: 250, logged_at: '2026-10-20T15:10:00Z', entry_type: 'water', is_private: false };

// Android FoodLogEntry (encodeDefaults: every defaulted field is sent).
const ANDROID_MEAL_ID = 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f';
const androidMeal = (over: Record<string, unknown> = {}) => ({
  id: ANDROID_MEAL_ID,
  user_id: USER,
  entry_type: 'food',
  image_urls: [],
  notes: 'Oatmeal',
  nutrition_data: {
    calories: 300,
    items: [{ name: 'Oats', quantity: 1, serving_unit: 'cup', grams: 80, calories: 300, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null, sodium_mg: null }],
  },
  meal_type: 'breakfast',
  is_private: false,
  visibility: 'circle',
  logged_at: '2026-10-20T13:00:00.123Z',
  created_at: '2026-10-20T13:00:00.123Z',
  sync_status: 'synced',
  ...over,
});
const ANDROID_WATER_ID = 'd4e5f6a7-b8c9-4d0e-8f1a-2b3c4d5e6f70';
const androidWater = (loggedAt: string) => ({
  id: ANDROID_WATER_ID,
  user_id: USER,
  entry_type: 'water',
  image_urls: [],
  water_ml: 250,
  is_private: false,
  logged_at: loggedAt,
  created_at: loggedAt,
  sync_status: 'synced',
});

// ---------------------------------------------------------------------------
// Decoders: what each shipped model requires (returns a list of problems)
// ---------------------------------------------------------------------------
const ISO_TZ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const ENTRY_TYPES = ['food', 'snack', 'water', 'supplement'];
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];
const isInt = (v: any) => typeof v === 'number' && Number.isInteger(v);

/** iOS APIResponse<T> envelope + ResponseMeta. */
function iosEnvelope(b: any): string[] {
  const p: string[] = [];
  if (typeof b?.success !== 'boolean') p.push('success not Bool');
  if (b?.error != null && (typeof b.error.code !== 'string' || typeof b.error.message !== 'string')) p.push('error.code/message');
  const m = b?.meta;
  if (m != null) {
    for (const k of ['page', 'limit', 'total']) if (m[k] != null && !isInt(m[k])) p.push(`meta.${k} not Int`);
    if (m.has_more != null && typeof m.has_more !== 'boolean') p.push('meta.has_more');
    if (m.synced != null && typeof m.synced !== 'boolean') p.push('meta.synced');
    const s = m.streak;
    if (s != null) {
      if (typeof s.claimed !== 'boolean' || typeof s.alreadyClaimed !== 'boolean' || typeof s.source !== 'string') p.push('meta.streak required keys');
      if (s.day != null && typeof s.day !== 'string') p.push('meta.streak.day');
      if (s.streakCount != null && !isInt(s.streakCount)) p.push('meta.streak.streakCount');
      if (s.milestone != null && !isInt(s.milestone.days) && !isInt(s.milestone.milestone)) p.push('meta.streak.milestone');
    }
  }
  return p;
}
/** iOS FoodLogEntry custom init(from:). */
function iosEntry(e: any, at = 'entry'): string[] {
  const p: string[] = [];
  if (!e || typeof e !== 'object') return [`${at} missing`];
  if (!UUID_ANY.test(e.id ?? '')) p.push(`${at}.id not UUID`);
  if (!UUID_ANY.test(e.user_id ?? '')) p.push(`${at}.user_id not UUID`);
  if (!ENTRY_TYPES.includes(e.entry_type)) p.push(`${at}.entry_type ${e.entry_type}`);
  if (e.photo_url != null && typeof e.photo_url !== 'string') p.push(`${at}.photo_url`);
  if (e.notes != null && typeof e.notes !== 'string') p.push(`${at}.notes`);
  if (e.meal_type != null && !MEAL_TYPES.includes(e.meal_type)) p.push(`${at}.meal_type ${e.meal_type}`);
  if (e.water_ml != null && !isInt(e.water_ml)) p.push(`${at}.water_ml not Int`);
  if (typeof e.is_private !== 'boolean') p.push(`${at}.is_private not Bool`);
  if (!ISO_TZ.test(e.logged_at ?? '')) p.push(`${at}.logged_at not a tz date`);
  if (!ISO_TZ.test(e.created_at ?? '')) p.push(`${at}.created_at not a tz date`);
  if (e.sync_status != null && !['pending', 'syncing', 'synced', 'failed'].includes(e.sync_status)) p.push(`${at}.sync_status`);
  const n = e.nutrition_data;
  if (n != null) {
    for (const k of ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g', 'sodium_mg', 'health_score'])
      if (n[k] != null && typeof n[k] !== 'number') p.push(`${at}.nutrition_data.${k}`);
    if (n.items != null) for (const it of n.items) if (typeof it?.name !== 'string') p.push(`${at}.nutrition_data.items[].name`);
  }
  return p;
}
/** iOS FoodLogDetailResponse (not APIResponse). */
function iosDetail(b: any): string[] {
  const p: string[] = [];
  if (typeof b?.success !== 'boolean') p.push('success');
  const d = b?.data;
  if (!d) return [...p, 'data missing'];
  p.push(...iosEntry(d.entry, 'data.entry'));
  if (!Array.isArray(d.images)) p.push('data.images not array');
  if (typeof d.canEdit !== 'boolean' || typeof d.canShare !== 'boolean') p.push('canEdit/canShare');
  for (const i of d.images ?? []) {
    if (!UUID_ANY.test(i.id ?? '') || !UUID_ANY.test(i.food_log_entry_id ?? '')) p.push('image id/food_log_entry_id');
    if (typeof i.storage_path !== 'string' || !isInt(i.display_order) || !ISO_TZ.test(i.created_at ?? '')) p.push('image storage_path/display_order/created_at');
  }
  return p;
}
/** iOS FoodLogListResponse (not APIResponse): top-level pagination with camelCase hasMore. */
function iosList(b: any): string[] {
  const p: string[] = [];
  if (typeof b?.success !== 'boolean') p.push('success');
  if (!Array.isArray(b?.data)) return [...p, 'data not array'];
  b.data.forEach((e: any, i: number) => p.push(...iosEntry(e, `data[${i}]`)));
  const g = b.pagination;
  if (!g || !isInt(g.page) || !isInt(g.limit) || !isInt(g.total) || typeof g.hasMore !== 'boolean') p.push('pagination');
  return p;
}
/** iOS EmptyResponse: data absent, null or an object. */
const iosEmpty = (b: any) => [...iosEnvelope(b), ...(b?.data != null && (typeof b.data !== 'object' || Array.isArray(b.data)) ? ['data not object'] : [])];
/** iOS WaterLogCreateResponse: only data.id (UUID). */
const iosWaterCreate = (b: any) => [...iosEnvelope(b), ...(UUID_ANY.test(b?.data?.id ?? '') ? [] : ['data.id'])];

/** Android ApiResponse<T>: error, when present, needs code + message. */
function androidEnvelope(b: any): string[] {
  const p: string[] = [];
  if (b?.success != null && typeof b.success !== 'boolean') p.push('success');
  if (b?.error != null && (typeof b.error.code !== 'string' || typeof b.error.message !== 'string')) p.push('error.code/message');
  const s = b?.meta?.streak;
  if (s != null && typeof s !== 'object') p.push('meta.streak');
  return p;
}
/** Android FoodLogEntry: id, user_id, entry_type (enum), logged_at, created_at are required. */
function androidEntry(e: any, at = 'entry'): string[] {
  const p: string[] = [];
  if (!e || typeof e !== 'object') return [`${at} missing`];
  if (typeof e.id !== 'string') p.push(`${at}.id`);
  if (typeof e.user_id !== 'string') p.push(`${at}.user_id`);
  if (!ENTRY_TYPES.includes(e.entry_type)) p.push(`${at}.entry_type`);
  if (!ISO_TZ.test(e.logged_at ?? '')) p.push(`${at}.logged_at`);
  if (!ISO_TZ.test(e.created_at ?? '')) p.push(`${at}.created_at`);
  if (e.image_urls != null && !(Array.isArray(e.image_urls) && e.image_urls.every((u: any) => typeof u === 'string'))) p.push(`${at}.image_urls`);
  if (e.photo_url != null && typeof e.photo_url !== 'string') p.push(`${at}.photo_url`);
  if (e.water_ml != null && !isInt(e.water_ml)) p.push(`${at}.water_ml`);
  return p;
}
/** Android success rule: success == true && data != null. */
const androidOk = (b: any) => (b?.success === true && b?.data != null ? [] : ['success && data']);
function androidBatch(b: any): string[] {
  const p = androidEnvelope(b);
  const d = b?.data;
  if (d == null) return p;
  for (const u of d.uploaded ?? []) if (typeof u.id !== 'string') p.push('uploaded[].id');
  for (const f of d.failed ?? []) if ((f.file_name != null && typeof f.file_name !== 'string') || (f.error != null && typeof f.error !== 'string')) p.push('failed[]');
  if (d.counts != null && ((d.counts.uploaded != null && !isInt(d.counts.uploaded)) || (d.counts.failed != null && !isInt(d.counts.failed)))) p.push('counts');
  return p;
}
function androidDeleted(b: any): string[] {
  const p = androidEnvelope(b);
  const d = b?.data;
  if (d != null) {
    if (d.deleted != null && typeof d.deleted !== 'boolean') p.push('deleted');
    if (d.entryId != null && typeof d.entryId !== 'string') p.push('entryId');
    if (d.hydration != null && typeof d.hydration !== 'object') p.push('hydration');
  }
  if (b?.success !== true) p.push('success != true');
  return p;
}

// ===========================================================================
// iOS 1.0.4 / 1.0.5
// ===========================================================================
describe('iOS 3af7f80 (1.0.4 live, 1.0.5 build 61 in review)', () => {
  it('create meal (uppercase client id) → 2xx full FoodLogEntry; a retry with the same id → 2xx, same entry', async () => {
    const first = await call('ios.create.meal', create(IOS_JSON, iosMeal()));
    expect(is2xx(first.status)).toBe(true);
    expect([...iosEnvelope(first.body), ...iosEntry(first.body.data)]).toEqual([]);
    expect(first.body.data.id.toLowerCase()).toBe(IOS_MEAL_ID.toLowerCase());

    const retry = await call('ios.create.meal.retry-same-id', create(IOS_JSON, iosMeal()));
    expect(is2xx(retry.status)).toBe(true);
    expect([...iosEnvelope(retry.body), ...iosEntry(retry.body.data)]).toEqual([]);
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(db.getRows('food_log_entries')).toHaveLength(1);
  });

  it('create snack (entry_type "snack") and supplement → 2xx FoodLogEntry', async () => {
    const snack = await call('ios.create.snack', create(IOS_JSON, iosMeal({ id: 'E5F6A7B8-C9D0-4E1F-8A2B-3C4D5E6F7A8B', entry_type: 'snack', meal_type: undefined })));
    expect(is2xx(snack.status)).toBe(true);
    expect([...iosEnvelope(snack.body), ...iosEntry(snack.body.data)]).toEqual([]);
    const supp = await call(
      'ios.create.supplement',
      create(IOS_JSON, { id: 'F6A7B8C9-D0E1-4F2A-8B3C-4D5E6F7A8B9C', entry_type: 'supplement', supplement_name: 'Vitamin D', supplement_dosage: '1000 IU', is_private: true, logged_at: '2026-10-20T14:00:00Z' })
    );
    expect(is2xx(supp.status)).toBe(true);
    expect([...iosEnvelope(supp.body), ...iosEntry(supp.body.data)]).toEqual([]);
  });

  it('water quick-add → 2xx data.id; retry with the same id → 2xx; Undo → 2xx; repeated Undo → 2xx', async () => {
    const w = await call('ios.water.create', create(IOS_JSON, iosWater));
    expect(is2xx(w.status)).toBe(true);
    expect(iosWaterCreate(w.body)).toEqual([]);
    const again = await call('ios.water.create.retry-same-id', create(IOS_JSON, iosWater));
    expect(is2xx(again.status)).toBe(true);
    expect(iosWaterCreate(again.body)).toEqual([]);
    expect(again.body.data.id).toBe(w.body.data.id);

    // Undo deletes by the server id (response.id) → APIResponse<WaterLogDeleteResponse>.
    const serverId = w.body.data.id.toUpperCase(); // Swift UUID.uuidString
    const undo = await call('ios.water.undo', del(IOS_JSON, serverId));
    expect(is2xx(undo.status)).toBe(true);
    expect(iosEmpty(undo.body)).toEqual([]);
    const undo2 = await call('ios.water.undo.repeat', del(IOS_JSON, serverId));
    expect(is2xx(undo2.status)).toBe(true);
    expect(iosEmpty(undo2.body)).toEqual([]);
  });

  it('PATCH full current state (uppercase path, no id) → 2xx FoodLogEntry', async () => {
    await create(IOS_JSON, iosMeal());
    const { id: _id, ...body } = iosMeal({ notes: 'Edited', meal_type: 'dinner' });
    const r = await call('ios.patch', patch(IOS_JSON, IOS_MEAL_ID, body));
    expect(is2xx(r.status)).toBe(true);
    expect([...iosEnvelope(r.body), ...iosEntry(r.body.data)]).toEqual([]);
    expect(r.body.data.notes).toBe('Edited');
  });

  it('PATCH a missing entry → non-2xx with a decodable APIError (client marks the row failed either way)', async () => {
    const { id: _id, ...body } = iosMeal();
    const r = await call('ios.patch.missing', patch(IOS_JSON, '0F0F0F0F-0F0F-4F0F-8F0F-0F0F0F0F0F0F', body));
    expect(is2xx(r.status)).toBe(false);
    expect(iosEnvelope(r.body)).toEqual([]);
  });

  it('single photo upload (uppercase path) → 2xx, then GET detail decodes FoodLogDetailResponse', async () => {
    await create(IOS_JSON, iosMeal());
    const up = await call('ios.photo.single', iosSingle(IOS_MEAL_ID, RED));
    expect(is2xx(up.status)).toBe(true);
    const d = await call('ios.detail', detail(IOS_JSON, IOS_MEAL_ID));
    expect(is2xx(d.status)).toBe(true);
    expect(iosDetail(d.body)).toEqual([]);
    expect(d.body.data.images).toHaveLength(1);
  });

  it('the same photo bytes uploaded again (sync retry / every later edit re-POSTs photoLocalPath) never destroys the stored photo', async () => {
    await create(IOS_JSON, iosMeal());
    await iosSingle(IOS_MEAL_ID, RED);
    const [stored] = liveImages(IOS_MEAL_ID);
    const storedPaths = [stored.storage_path, stored.storage_path.replace('_original', '_medium'), stored.thumbnail_path];

    const again = await call('ios.photo.single.same-bytes', iosSingle(IOS_MEAL_ID, RED));
    // The stored photo and its files survive whatever the status.
    expect(storageRemoves.filter((p) => storedPaths.includes(p))).toEqual([]);
    expect(liveImages(IOS_MEAL_ID).map((i) => i.id)).toContain(stored.id);

    const d = await call('ios.detail.after-reupload', detail(IOS_JSON, IOS_MEAL_ID));
    expect(iosDetail(d.body)).toEqual([]);
    expect(d.body.data.images.length).toBeGreaterThanOrEqual(1);
    // Record what happened (the old backend answers 400 here: display_order 0 collides).
    expect(typeof again.status).toBe('number');
  });

  it('create retried after the photo landed → 2xx entry (photo_url, if any, is a String)', async () => {
    await create(IOS_JSON, iosMeal());
    await iosSingle(IOS_MEAL_ID, RED);
    const retry = await call('ios.create.retry-after-photo', create(IOS_JSON, iosMeal()));
    expect(is2xx(retry.status)).toBe(true);
    expect([...iosEnvelope(retry.body), ...iosEntry(retry.body.data)]).toEqual([]);
  });

  it('batch upload of extra photos (uppercase path) → 2xx; the same batch again → 2xx', async () => {
    await create(IOS_JSON, iosMeal());
    const b = await call('ios.photo.batch', batchUpload(IOS_MEAL_ID, [RED, BLUE], 'food_1761000000'));
    expect(is2xx(b.status)).toBe(true);
    const b2 = await call('ios.photo.batch.same-bytes', batchUpload(IOS_MEAL_ID, [RED, BLUE], 'food_1761000005'));
    expect(is2xx(b2.status)).toBe(true);
    const d = await detail(IOS_JSON, IOS_MEAL_ID);
    expect(iosDetail(await d.json())).toEqual([]);
  });

  it('GET list ?page=1&limit=100&entry_type=all → FoodLogListResponse (with and without photos)', async () => {
    await create(IOS_JSON, iosMeal());
    await create(IOS_JSON, iosWater);
    await batchUpload(IOS_MEAL_ID, [RED], 'food_1761000000');
    const l = await call('ios.list', list(IOS_JSON, 'page=1&limit=100&entry_type=all'));
    expect(is2xx(l.status)).toBe(true);
    expect(iosList(l.body)).toEqual([]);
    expect(l.body.data).toHaveLength(2);
  });

  it('DELETE food (uppercase) → 2xx EmptyResponse; again → 2xx; never-synced id → recorded (errors are swallowed)', async () => {
    await create(IOS_JSON, iosMeal());
    const d1 = await call('ios.delete', del(IOS_JSON, IOS_MEAL_ID));
    expect(is2xx(d1.status)).toBe(true);
    expect(iosEmpty(d1.body)).toEqual([]);
    const d2 = await call('ios.delete.already-deleted', del(IOS_JSON, IOS_MEAL_ID));
    expect(is2xx(d2.status)).toBe(true);
    expect(iosEmpty(d2.body)).toEqual([]);
    const d3 = await call('ios.delete.missing', del(IOS_JSON, '0F0F0F0F-0F0F-4F0F-8F0F-0F0F0F0F0F0F'));
    expect(iosEnvelope(d3.body)).toEqual([]);
    if (is2xx(d3.status)) expect(iosEmpty(d3.body)).toEqual([]);
  });
});

// ===========================================================================
// Android 1.0.4
// ===========================================================================
describe('Android fd9e8c1 (1.0.4 live)', () => {
  it('create meal (whole FoodLogEntry body, encodeDefaults) → 2xx entry; same id again → 2xx', async () => {
    const r = await call('android.create.meal', create(ANDROID_JSON, androidMeal()));
    expect(is2xx(r.status)).toBe(true);
    expect([...androidEnvelope(r.body), ...androidOk(r.body), ...androidEntry(r.body.data)]).toEqual([]);
    const again = await call('android.create.meal.retry-same-id', create(ANDROID_JSON, androidMeal()));
    expect(is2xx(again.status)).toBe(true);
    expect([...androidOk(again.body), ...androidEntry(again.body.data)]).toEqual([]);
  });

  it('water quick-add → 2xx data.id; retry with the same id (new timestamps) → 2xx; Undo → 2xx; repeat → 2xx', async () => {
    const w = await call('android.water.create', create(ANDROID_JSON, androidWater('2026-10-20T15:10:00.001Z')));
    expect(is2xx(w.status)).toBe(true);
    expect([...androidOk(w.body), ...(typeof w.body.data.id === 'string' ? [] : ['id'])]).toEqual([]);
    const again = await call('android.water.create.retry-same-id', create(ANDROID_JSON, androidWater('2026-10-20T15:10:01.502Z')));
    expect(is2xx(again.status)).toBe(true);
    expect(again.body.data.id).toBe(w.body.data.id);

    const u = await call('android.water.undo', del(ANDROID_JSON, w.body.data.id));
    expect(is2xx(u.status)).toBe(true);
    expect(androidDeleted(u.body)).toEqual([]);
    const u2 = await call('android.water.undo.repeat', del(ANDROID_JSON, w.body.data.id));
    expect(is2xx(u2.status)).toBe(true);
    expect(androidDeleted(u2.body)).toEqual([]);
  });

  it('PATCH whole entry (image_urls: [], created_at = meal time) → 2xx entry; photos are not wiped', async () => {
    await create(ANDROID_JSON, androidMeal());
    await batchUpload(ANDROID_MEAL_ID, [RED], 'food_1761000000000');
    const r = await call('android.patch', patch(ANDROID_JSON, ANDROID_MEAL_ID, androidMeal({ notes: 'Edited', image_urls: [] })));
    expect(is2xx(r.status)).toBe(true);
    expect([...androidOk(r.body), ...androidEntry(r.body.data)]).toEqual([]);
    expect(liveImages(ANDROID_MEAL_ID)).toHaveLength(1);
    expect(entryRow(ANDROID_MEAL_ID).image_count).toBe(1);
  });

  it('PATCH a missing entry → non-2xx with a readable error.message', async () => {
    const r = await call('android.patch.missing', patch(ANDROID_JSON, 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', androidMeal({ id: 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0' })));
    expect(is2xx(r.status)).toBe(false);
    expect(androidEnvelope(r.body)).toEqual([]);
    expect(r.body.error.message.length).toBeGreaterThan(0);
  });

  it('batch upload → 2xx with failed: []; re-uploading ALL photos (recoverCatching path) → 2xx with failed: []', async () => {
    await create(ANDROID_JSON, androidMeal());
    const b = await call('android.photo.batch', batchUpload(ANDROID_MEAL_ID, [RED, BLUE], 'food_1761000000000'));
    expect(is2xx(b.status)).toBe(true);
    expect(androidBatch(b.body)).toEqual([]);
    expect(b.body.data.failed).toHaveLength(0);
    const b2 = await call('android.photo.batch.same-bytes', batchUpload(ANDROID_MEAL_ID, [RED, BLUE], 'food_1761000009999'));
    expect(is2xx(b2.status)).toBe(true);
    expect(androidBatch(b2.body)).toEqual([]);
    expect(b2.body.data.failed).toHaveLength(0);
  });

  it('single upload (androidTest only) → 2xx FoodLogImage with id', async () => {
    await create(ANDROID_JSON, androidMeal());
    const r = await call('android.photo.single', androidSingle(ANDROID_MEAL_ID, RED));
    expect(is2xx(r.status)).toBe(true);
    expect([...androidOk(r.body), ...(typeof r.body.data.id === 'string' ? [] : ['id'])]).toEqual([]);
  });

  it('GET list ?page=1&limit=100 and GET detail → decodable entries', async () => {
    await create(ANDROID_JSON, androidMeal());
    await create(ANDROID_JSON, androidWater('2026-10-20T15:10:00.001Z'));
    await batchUpload(ANDROID_MEAL_ID, [RED], 'food_1761000000000');
    const l = await call('android.list', list(ANDROID_JSON, 'page=1&limit=100'));
    expect(is2xx(l.status)).toBe(true);
    expect(androidOk(l.body)).toEqual([]);
    expect(l.body.data.flatMap((e: any, i: number) => androidEntry(e, `data[${i}]`))).toEqual([]);
    const withPhoto = l.body.data.find((e: any) => e.id === ANDROID_MEAL_ID);
    expect(withPhoto.image_urls).toHaveLength(1);

    const d = await call('android.detail', detail(ANDROID_JSON, ANDROID_MEAL_ID));
    expect(is2xx(d.status)).toBe(true);
    expect([...androidOk(d.body), ...androidEntry(d.body.data.entry, 'data.entry')]).toEqual([]);
    expect(d.body.data.images.every((i: any) => typeof i.id === 'string')).toBe(true);
  });

  it('DELETE → 2xx DeletedFoodLogEntry; already deleted → 2xx; never-existing id → recorded', async () => {
    await create(ANDROID_JSON, androidMeal());
    const d1 = await call('android.delete', del(ANDROID_JSON, ANDROID_MEAL_ID));
    expect(is2xx(d1.status)).toBe(true);
    expect(androidDeleted(d1.body)).toEqual([]);
    const d2 = await call('android.delete.already-deleted', del(ANDROID_JSON, ANDROID_MEAL_ID));
    expect(is2xx(d2.status)).toBe(true);
    expect(androidDeleted(d2.body)).toEqual([]);
    const d3 = await call('android.delete.missing', del(ANDROID_JSON, 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0'));
    expect(androidEnvelope(d3.body)).toEqual([]);
    if (is2xx(d3.status)) expect(androidDeleted(d3.body)).toEqual([]);
  });
});

// ===========================================================================
// Regression: photo dedupe with iOS's uppercase path ids. An earlier draft of
// the idempotent upload compared the path id case-sensitively with the stored
// (lowercase) food_log_entry_id, so an iOS re-upload of the same photo missed
// the stored row, collided on its primary key, and the error cleanup deleted
// the stored photo's files. (Skipped for the pre-dedupe baseline run.)
// ===========================================================================
describe.skipIf(!!process.env.COMPAT_BASELINE)('iOS uppercase ids — photo dedupe', () => {
  it('single: the same bytes again → 200 duplicate of the stored image, files kept', async () => {
    await create(IOS_JSON, iosMeal());
    const first = await (await iosSingle(IOS_MEAL_ID, RED)).json();
    const again = await iosSingle(IOS_MEAL_ID, RED);
    const body = await again.json();
    expect(again.status).toBe(200);
    expect(body.meta.duplicate).toBe(true);
    expect(body.data.id).toBe(first.data.id);
    expect(liveImages(IOS_MEAL_ID)).toHaveLength(1);
    expect(entryRow(IOS_MEAL_ID).image_count).toBe(1);
    expect(storageRemoves).toEqual([]);
  });

  it('batch: the same batch again → 200, all duplicates, nothing removed', async () => {
    await create(IOS_JSON, iosMeal());
    await batchUpload(IOS_MEAL_ID, [RED, BLUE], 'food_1761000000');
    const again = await batchUpload(IOS_MEAL_ID, [RED, BLUE], 'food_1761000005');
    const body = await again.json();
    expect(again.status).toBe(200);
    expect(body.data.counts).toEqual({ uploaded: 2, failed: 0, duplicates: 2 });
    expect(liveImages(IOS_MEAL_ID)).toHaveLength(2);
    expect(storageRemoves).toEqual([]);
  });

  it('upper- and lowercase forms of one entry id dedupe to the same image', async () => {
    await create(IOS_JSON, iosMeal());
    await iosSingle(IOS_MEAL_ID, RED);
    const lower = await iosSingle(IOS_MEAL_ID.toLowerCase(), RED);
    expect(lower.status).toBe(200);
    expect(liveImages(IOS_MEAL_ID)).toHaveLength(1);
  });
});
