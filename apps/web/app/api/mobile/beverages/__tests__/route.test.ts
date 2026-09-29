import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Fake Supabase: records what is inserted / updated and serves stored rows ------
const db = {
  inserted: [] as any[],
  updated: [] as any[],
  rows: [] as any[],
};

function tableApi() {
  const builder: any = {
    _op: 'select' as 'select' | 'insert' | 'update',
    _payload: null as any,
    insert(row: any) {
      builder._op = 'insert';
      builder._payload = row;
      db.inserted.push(row);
      return builder;
    },
    update(row: any) {
      builder._op = 'update';
      builder._payload = row;
      db.updated.push(row);
      return builder;
    },
    select() { return builder; },
    eq() { return builder; },
    is() { return builder; },
    gte() { return builder; },
    lte() { return builder; },
    order() { return builder; },
    in() { return builder; },
    // Awaiting the builder itself (the images lookup) yields "no images".
    then(resolve: (value: { data: any[]; error: null }) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(resolve);
    },
    range() {
      return Promise.resolve({ data: db.rows, error: null, count: db.rows.length });
    },
    single() {
      if (builder._op === 'insert') {
        return Promise.resolve({
          data: {
            id: '22222222-2222-4222-8222-222222222222',
            created_at: '2026-09-28T10:00:01.000Z',
            ...builder._payload,
          },
          error: null,
        });
      }
      if (builder._op === 'update') {
        return Promise.resolve({ data: { ...db.rows[0], ...builder._payload }, error: null });
      }
      return Promise.resolve({ data: db.rows[0] ?? null, error: null });
    },
  };
  return builder;
}
const supabase = { from: () => tableApi() };

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async () => ({ id: 'user-1' }),
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => supabase }));
vi.mock('@/lib/services/streak-claiming-service', () => ({
  StreakClaimingService: { autoClaimForManualLog: async () => null },
}));
vi.mock('@/lib/services/beverage-log-image-service', () => ({ BeverageLogImageService: {} }));

import { PATCH } from '../[id]/route';
import { GET, POST } from '../route';

const json = (method: string, url: string, body?: unknown) =>
  new Request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as any;

// NextRequest-like: the GET handler only reads `url`.
const post = (body: unknown) => POST(json('POST', 'http://localhost/api/mobile/beverages', body));
const list = () => GET(json('GET', 'http://localhost/api/mobile/beverages?page=1&limit=100'));
const ID = '22222222-2222-4222-8222-222222222222';
const patch = (body: unknown) =>
  PATCH(json('PATCH', `http://localhost/api/mobile/beverages/${ID}`, body), {
    params: Promise.resolve({ id: ID }),
  });

/** Raw values of the strict Swift enums in BeverageLog.swift (BeverageCustomizations). */
const SWIFT_SIZE = ['small', 'medium', 'large', 'extraLarge'];
const SWIFT_TEMPERATURE = ['hot', 'iced', 'room'];
const SWIFT_MILK = ['none', 'whole', 'skim', 'almond', 'oat', 'soy', 'coconut', 'cream'];

const iosBody = {
  category: 'coffee',
  beverage_type: 'latte',
  customizations: {
    size: 'extraLarge',
    milk_type: 'cream',
    sweetener: 'none',
    temperature: 'room',
  },
  volume_ml: 590,
  calories: 310,
  caffeine_mg: 184,
  sugar_g: 0,
  is_favorite: false,
  is_private: true,
  logged_at: '2026-09-28T10:00:00Z',
};

describe('POST /api/mobile/beverages', () => {
  beforeEach(() => {
    db.inserted = [];
    db.updated = [];
    db.rows = [];
  });

  it('accepts XL / Room Temp / Heavy Cream as the apps send them — was a 400', async () => {
    const res = await post(iosBody);
    expect(res.status).toBe(201);
    expect(db.inserted[0].customizations).toEqual(iosBody.customizations);

    // The create response is decoded by iOS with strict enums; a failure there
    // makes the app re-post the drink.
    const { data } = await res.json();
    expect(SWIFT_SIZE).toContain(data.customizations.size);
    expect(SWIFT_TEMPERATURE).toContain(data.customizations.temperature);
    expect(SWIFT_MILK).toContain(data.customizations.milk_type);
    expect(data.customizations).toEqual(iosBody.customizations);
  });

  it('accepts the backend spellings and stores / returns the client spelling', async () => {
    const res = await post({
      ...iosBody,
      customizations: { size: 'extra_large', temperature: 'room_temp', milk_type: 'oat' },
    });
    expect(res.status).toBe(201);
    expect(db.inserted[0].customizations).toEqual({
      size: 'extraLarge',
      temperature: 'room',
      milk_type: 'oat',
    });
    const { data } = await res.json();
    expect(data.customizations).toEqual({ size: 'extraLarge', temperature: 'room', milk_type: 'oat' });
  });

  it('OLD request shape (medium / hot / whole, and no customizations) is stored unchanged', async () => {
    await post({
      ...iosBody,
      customizations: { size: 'medium', temperature: 'hot', milk_type: 'whole', shots: 1 },
    });
    expect(db.inserted[0].customizations).toEqual({
      size: 'medium',
      temperature: 'hot',
      milk_type: 'whole',
      shots: 1,
    });

    const res = await post({ category: 'water', beverage_type: 'still_water', volume_ml: 250 });
    expect(res.status).toBe(201);
    expect(db.inserted[1].customizations).toEqual({});
    expect(db.inserted[1]).toMatchObject({
      category: 'water',
      beverage_type: 'still_water',
      volume_ml: 250,
      is_favorite: false,
      is_private: true,
      source: 'manual',
    });
  });

  it('accepts explicit nulls on optional fields', async () => {
    const res = await post({
      ...iosBody,
      notes: null,
      favorite_name: null,
      customizations: { size: 'large', shots: null, brand: null },
    });
    expect(res.status).toBe(201);
    expect(db.inserted[0].customizations).toEqual({ size: 'large' });
  });

  it('validation errors keep code + details and carry a readable message', async () => {
    const res = await post({ ...iosBody, customizations: { size: 'bucket' } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveProperty('customizations.size');
    expect(body.error.message).toMatch(/^customizations\.size: /);
    expect(db.inserted).toHaveLength(0);
  });
});

describe('GET /api/mobile/beverages', () => {
  beforeEach(() => {
    db.rows = [];
  });

  it('returns rows stored with the old backend spelling in a spelling iOS decodes', async () => {
    db.rows = [
      { id: 'a', customizations: { size: 'extra_large', temperature: 'room_temp' }, volume_ml: 590 },
      { id: 'b', customizations: { size: 'extraLarge', temperature: 'room', milk_type: 'cream' }, volume_ml: 590 },
      { id: 'c', customizations: {}, volume_ml: 250 },
    ];
    const res = await list();
    expect(res.status).toBe(200);
    const { data, pagination } = await res.json();
    expect(data.map((r: any) => r.customizations)).toEqual([
      { size: 'extraLarge', temperature: 'room' },
      { size: 'extraLarge', temperature: 'room', milk_type: 'cream' },
      {},
    ]);
    expect(pagination.total).toBe(3);
    for (const row of data) {
      if (row.customizations.size) expect(SWIFT_SIZE).toContain(row.customizations.size);
    }
  });
});

describe('PATCH /api/mobile/beverages/[id]', () => {
  beforeEach(() => {
    db.inserted = [];
    db.updated = [];
    db.rows = [{ id: ID, user_id: 'user-1', customizations: { size: 'small' }, volume_ml: 240 }];
  });

  it('accepts both spellings and stores the client spelling', async () => {
    const res = await patch({ customizations: { size: 'extra_large', milk_type: 'cream' } });
    expect(res.status).toBe(200);
    expect(db.updated[0].customizations).toEqual({ size: 'extraLarge', milk_type: 'cream' });
    const { data } = await res.json();
    expect(data.customizations).toEqual({ size: 'extraLarge', milk_type: 'cream' });
  });

  it('OLD request shape: un-favorite patch is unchanged', async () => {
    const res = await patch({ is_favorite: false });
    expect(res.status).toBe(200);
    expect(db.updated[0]).toMatchObject({ is_favorite: false });
    expect(db.updated[0]).not.toHaveProperty('customizations');
  });
});
