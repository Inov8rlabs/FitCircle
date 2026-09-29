import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  parseError: new Error('ParseFailed') as Error | null,
  owned: new Set<string>(),
  saveCalls: [] as string[],
  ownsCalls: [] as string[],
};

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
    parseVoice: async () => {
      if (state.parseError) throw state.parseError;
      return { items: [], totals: {}, overallConfidence: 0.9 };
    },
    saveUnparsedVoice: async (_userId: string, transcript: string) => {
      state.saveCalls.push(transcript);
      return { entryId: NEW_ENTRY };
    },
    ownsFoodLogEntry: async (_userId: string, entryId: string) => {
      state.ownsCalls.push(entryId);
      return state.owned.has(entryId);
    },
  },
}));

import { POST } from '../route';

const NEW_ENTRY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EXISTING = '3f2b8c1e-9a4d-4c6b-8e21-5d7f0a9b1c23';
const SOMEONE_ELSES = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/mobile/food/voice-parse', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }) as any
  );

describe('POST /api/mobile/food/voice-parse — Option-B fallback', () => {
  beforeEach(() => {
    state.parseError = new Error('ParseFailed');
    state.owned = new Set([EXISTING]);
    state.saveCalls = [];
    state.ownsCalls = [];
  });

  it('OLD request ({ transcript } only): a failed parse still saves the note as a new entry', async () => {
    const res = await post({ transcript: 'two eggs and toast' });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(state.saveCalls).toEqual(['two eggs and toast']);
    expect(body).toMatchObject({ success: false, data: null });
    expect(body.error.code).toBe('PARSE_FAILED');
    expect(body.error.message).toBe(
      "Couldn't understand that — we saved your note so you can add the details."
    );
    expect(body.error.details).toEqual({ savedEntryId: NEW_ENTRY });
  });

  it('skip_fallback_save: true — a failure creates nothing and returns no savedEntryId', async () => {
    const res = await post({ transcript: 'two eggs', skip_fallback_save: true });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(state.saveCalls).toEqual([]);
    expect(body.error.code).toBe('PARSE_FAILED');
    expect(body.error.details).toEqual({ fallbackSaved: false });
    expect(body.error.message).not.toMatch(/saved/i);
  });

  it('existing_entry_id of the caller: nothing created, savedEntryId is the existing id', async () => {
    const res = await post({ transcript: 'two eggs', existing_entry_id: EXISTING });
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(state.saveCalls).toEqual([]);
    expect(state.ownsCalls).toEqual([EXISTING]);
    expect(body.error.details).toEqual({ savedEntryId: EXISTING, fallbackSaved: false });
  });

  it("someone else's entry id: nothing created and the id is NOT echoed", async () => {
    const res = await post({ transcript: 'two eggs', existingEntryId: SOMEONE_ELSES });
    const body = await res.json();
    expect(state.saveCalls).toEqual([]);
    expect(body.error.details).toEqual({ fallbackSaved: false });
  });

  it('explicit nulls for the new fields behave like the old request', async () => {
    const res = await post({
      transcript: 'two eggs',
      existing_entry_id: null,
      skip_fallback_save: null,
    });
    expect(state.saveCalls).toEqual(['two eggs']);
    expect((await res.json()).error.details).toEqual({ savedEntryId: NEW_ENTRY });
  });

  it('rate limit keeps 429 + RATE_LIMITED when the fallback is skipped', async () => {
    state.parseError = new Error('RateLimited');
    const res = await post({ transcript: 'two eggs', skip_fallback_save: true });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(state.saveCalls).toEqual([]);
  });

  it('a successful parse is unaffected by the new fields', async () => {
    state.parseError = null;
    const res = await post({ transcript: 'two eggs', existing_entry_id: EXISTING });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(state.ownsCalls).toEqual([]);
  });

  it('validation is unchanged: an empty transcript is a 400 with its own message', async () => {
    const res = await post({ transcript: '   ' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Transcript is empty');
    expect(body.error.details.issues).toBeInstanceOf(Array);
  });
});
