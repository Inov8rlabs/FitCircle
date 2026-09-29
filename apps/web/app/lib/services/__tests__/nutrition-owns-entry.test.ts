import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Minimal food_log_entries stand-in ---------------------------------------------
type Row = { id: string; user_id: string; deleted_at: string | null };
const db = { rows: [] as Row[], fail: false, throws: false, queries: 0 };

vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => {
    if (db.throws) throw new Error('no service key');
    return {
      from: (table: string) => {
        expect(table).toBe('food_log_entries');
        const filters: Array<(r: Row) => boolean> = [];
        const query: any = {
          select: () => query,
          eq: (col: keyof Row, val: string) => {
            filters.push((r) => r[col] === val);
            return query;
          },
          is: (col: keyof Row, val: null) => {
            filters.push((r) => r[col] === val);
            return query;
          },
          maybeSingle: async () => {
            db.queries += 1;
            if (db.fail) return { data: null, error: { message: 'boom' } };
            const match = db.rows.find((r) => filters.every((f) => f(r)));
            return { data: match ? { id: match.id } : null, error: null };
          },
        };
        return query;
      },
    };
  },
}));

import { NutritionIntelligenceService } from '../nutrition-intelligence-service';

const MINE = '3f2b8c1e-9a4d-4c6b-8e21-5d7f0a9b1c23';
const THEIRS = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const DELETED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('NutritionIntelligenceService.ownsFoodLogEntry', () => {
  beforeEach(() => {
    db.rows = [
      { id: MINE, user_id: 'user-1', deleted_at: null },
      { id: THEIRS, user_id: 'user-2', deleted_at: null },
      { id: DELETED, user_id: 'user-1', deleted_at: '2026-09-01T00:00:00Z' },
    ];
    db.fail = false;
    db.throws = false;
    db.queries = 0;
  });

  it("confirms the caller's own live entry", async () => {
    expect(await NutritionIntelligenceService.ownsFoodLogEntry('user-1', MINE)).toBe(true);
  });

  it("never confirms someone else's entry", async () => {
    expect(await NutritionIntelligenceService.ownsFoodLogEntry('user-1', THEIRS)).toBe(false);
    expect(await NutritionIntelligenceService.ownsFoodLogEntry('user-2', MINE)).toBe(false);
  });

  it('never confirms a deleted or unknown entry', async () => {
    expect(await NutritionIntelligenceService.ownsFoodLogEntry('user-1', DELETED)).toBe(false);
    expect(
      await NutritionIntelligenceService.ownsFoodLogEntry(
        'user-1',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      )
    ).toBe(false);
  });

  it('fails closed when the lookup errors or throws', async () => {
    db.fail = true;
    expect(await NutritionIntelligenceService.ownsFoodLogEntry('user-1', MINE)).toBe(false);
    db.fail = false;
    db.throws = true;
    expect(await NutritionIntelligenceService.ownsFoodLogEntry('user-1', MINE)).toBe(false);
  });
});
