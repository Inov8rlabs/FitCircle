import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks ---------------------------------------------------------------------
const state = {
  parseError: new Error('ParseFailed') as Error | null,
  owned: new Set<string>(),
  saveCalls: 0,
  ownsCalls: [] as string[],
  afterCalls: 0,
};

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('next/server', async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return {
    ...original,
    // `after()` needs a request scope; record the call instead of running it.
    after: () => {
      state.afterCalls += 1;
    },
  };
});
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async () => ({ id: 'user-1' }),
}));
vi.mock('@/lib/services/usage-service', () => {
  class UpgradeRequiredError extends Error {
    constructor(
      public readonly feature: string,
      public readonly used: number,
      public readonly limit: number
    ) {
      super('UPGRADE_REQUIRED');
    }
  }
  return { UpgradeRequiredError };
});
vi.mock('@/lib/services/nutrition-intelligence-service', () => ({
  NutritionIntelligenceService: {
    parsePhoto: async () => {
      if (state.parseError) throw state.parseError;
      return { items: [], totals: {}, overallConfidence: 0.9 };
    },
    saveUnparsedPhoto: async () => {
      state.saveCalls += 1;
      return { entryId: NEW_ENTRY };
    },
    attachFallbackImages: async () => undefined,
    ownsFoodLogEntry: async (_userId: string, entryId: string) => {
      state.ownsCalls.push(entryId);
      return state.owned.has(entryId);
    },
  },
}));

import { UpgradeRequiredError } from '@/lib/services/usage-service';

import { POST } from '../route';

const NEW_ENTRY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EXISTING = '3f2b8c1e-9a4d-4c6b-8e21-5d7f0a9b1c23';
const SOMEONE_ELSES = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function post(fields: Record<string, string> = {}) {
  // The handler only uses `formData()` with `getAll('image')` / `get(name)`. A minimal
  // stand-in keeps the test independent of multipart parsing and of jsdom's File
  // (which has no arrayBuffer()).
  const image = {
    name: 'meal.jpg',
    type: 'image/jpeg',
    size: 3,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  };
  const form = {
    getAll: (key: string) => (key === 'image' ? [image] : []),
    get: (key: string) => (key in fields ? fields[key] : null),
  };
  return POST({ formData: async () => form, headers: new Headers() } as any);
}

describe('POST /api/mobile/food/photo-parse — Option-B fallback', () => {
  beforeEach(() => {
    state.parseError = new Error('ParseFailed');
    state.owned = new Set([EXISTING]);
    state.saveCalls = 0;
    state.ownsCalls = [];
    state.afterCalls = 0;
  });

  it('OLD request (no new fields): a failed parse still saves the photo as a new entry', async () => {
    const res = await post({ note: 'chicken bowl' });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(state.saveCalls).toBe(1);
    expect(state.afterCalls).toBe(1);
    expect(state.ownsCalls).toEqual([]);
    expect(body).toMatchObject({ success: false, data: null });
    expect(body.error.code).toBe('PARSE_FAILED');
    expect(body.error.message).toBe(
      "Couldn't auto-detect the food — we saved your photo so you can add the details."
    );
    // Byte-for-byte the details the shipped clients get today.
    expect(body.error.details).toEqual({ savedEntryId: NEW_ENTRY, imageUrls: [] });
  });

  it('skip_fallback_save=true: a failure creates nothing and returns no savedEntryId', async () => {
    const res = await post({ skip_fallback_save: 'true' });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(state.saveCalls).toBe(0);
    expect(state.afterCalls).toBe(0);
    expect(body.error.code).toBe('PARSE_FAILED');
    expect(body.error.details).toEqual({ fallbackSaved: false });
    expect(body.error.details).not.toHaveProperty('savedEntryId');
    expect(body.error.message).not.toMatch(/saved/i);
  });

  it('existing_entry_id of the caller: nothing created, savedEntryId is the existing id', async () => {
    const res = await post({ existing_entry_id: EXISTING });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(state.saveCalls).toBe(0);
    expect(state.afterCalls).toBe(0);
    expect(state.ownsCalls).toEqual([EXISTING]);
    expect(body.error.code).toBe('PARSE_FAILED');
    expect(body.error.details).toEqual({
      savedEntryId: EXISTING,
      imageUrls: [],
      fallbackSaved: false,
    });
  });

  it('camelCase field names work too', async () => {
    const res = await post({ existingEntryId: EXISTING });
    expect((await res.json()).error.details.savedEntryId).toBe(EXISTING);
    expect(state.saveCalls).toBe(0);

    state.saveCalls = 0;
    await post({ skipFallbackSave: 'true' });
    expect(state.saveCalls).toBe(0);
  });

  it("someone else's / unknown entry id: nothing created and the id is NOT echoed", async () => {
    const res = await post({ existing_entry_id: SOMEONE_ELSES });
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(state.saveCalls).toBe(0);
    expect(state.ownsCalls).toEqual([SOMEONE_ELSES]);
    expect(body.error.details).toEqual({ fallbackSaved: false });
  });

  it('a malformed entry id never reaches the database and creates nothing', async () => {
    const res = await post({ existing_entry_id: "1' OR '1'='1" });
    const body = await res.json();
    expect(state.saveCalls).toBe(0);
    expect(state.ownsCalls).toEqual([]);
    expect(body.error.details).toEqual({ fallbackSaved: false });
  });

  it('skip_fallback_save=false behaves like the old request', async () => {
    const res = await post({ skip_fallback_save: 'false' });
    expect(state.saveCalls).toBe(1);
    expect((await res.json()).error.details).toEqual({ savedEntryId: NEW_ENTRY, imageUrls: [] });
  });

  it('rate limit / upgrade keep their status, code and quota details in both modes', async () => {
    state.parseError = new UpgradeRequiredError('ai_food_parse', 3, 3);

    const legacy = await post();
    expect(legacy.status).toBe(429);
    const legacyBody = await legacy.json();
    expect(legacyBody.error.code).toBe('UPGRADE_REQUIRED');
    expect(legacyBody.error.details).toEqual({
      savedEntryId: NEW_ENTRY,
      imageUrls: [],
      feature: 'ai_food_parse',
      used: 3,
      limit: 3,
    });

    state.saveCalls = 0;
    const skipped = await post({ existing_entry_id: EXISTING });
    expect(skipped.status).toBe(429);
    const skippedBody = await skipped.json();
    expect(state.saveCalls).toBe(0);
    expect(skippedBody.error.code).toBe('UPGRADE_REQUIRED');
    expect(skippedBody.error.details).toEqual({
      savedEntryId: EXISTING,
      imageUrls: [],
      fallbackSaved: false,
      feature: 'ai_food_parse',
      used: 3,
      limit: 3,
    });

    state.parseError = new Error('RateLimited');
    const rate = await post({ skip_fallback_save: 'true' });
    expect(rate.status).toBe(429);
    expect((await rate.json()).error.code).toBe('RATE_LIMITED');
    expect(state.saveCalls).toBe(0);
  });

  it('a successful parse is unaffected by the new fields', async () => {
    state.parseError = null;
    const res = await post({ existing_entry_id: EXISTING, skip_fallback_save: 'true' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(state.saveCalls).toBe(0);
    expect(state.ownsCalls).toEqual([]);
  });
});
