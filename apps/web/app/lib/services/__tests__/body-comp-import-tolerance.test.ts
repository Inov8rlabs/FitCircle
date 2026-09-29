import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BodyCompositionService, isSampleRejection, isTombstoned } from '../body-composition-service';

import { createFakeSupabase, type FakeRule } from './helpers/fake-supabase';

let fake = createFakeSupabase();
vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => fake.client }));

const USER = 'user-1';
const LOGS = 'body_composition_logs';
const TOMBSTONES = 'body_comp_import_tombstones';
const UNIQUE = {
  [LOGS]: [['user_id', 'source', 'source_external_id']],
  [TOMBSTONES]: [['user_id', 'source', 'source_external_id']],
};

const setup = (
  initial: Record<string, Record<string, any>[]> = {},
  options: { rules?: FakeRule[]; missingTables?: string[] } = {}
) => {
  fake = createFakeSupabase(initial, { uniqueKeys: UNIQUE, ...options });
};

describe('isSampleRejection', () => {
  it('treats constraint / range errors as a property of the sample', () => {
    expect(isSampleRejection({ code: '23514', message: 'check constraint' })).toBe(true);
    expect(isSampleRejection({ code: '22003', message: 'numeric field overflow' })).toBe(true);
  });

  it('treats everything else as an infrastructure failure', () => {
    expect(isSampleRejection({ code: '57014', message: 'statement timeout' })).toBe(false);
    expect(isSampleRejection({ code: 'PGRST301', message: 'JWT expired' })).toBe(false);
    expect(isSampleRejection({ message: 'fetch failed' })).toBe(false);
    expect(isSampleRejection(null)).toBe(false);
  });
});

describe('isTombstoned', () => {
  const stone = { externalId: 'w1', measuredAtMs: Date.parse('2026-09-01T07:00:00Z') };

  it('matches the deleted sample by external id, whatever its time', () => {
    expect(isTombstoned({ externalId: 'w1', measuredAt: '2026-09-05T07:00:00Z' }, [stone])).toBe(true);
  });

  it('matches sibling samples of the deleted measurement by time window', () => {
    expect(isTombstoned({ externalId: 'bf1', measuredAt: '2026-09-01T07:09:59Z' }, [stone])).toBe(true);
    expect(isTombstoned({ externalId: 'bf1', measuredAt: '2026-09-01T06:50:00Z' }, [stone])).toBe(true);
  });

  it('does not match other measurements', () => {
    expect(isTombstoned({ externalId: 'w2', measuredAt: '2026-09-01T07:10:01Z' }, [stone])).toBe(false);
    expect(isTombstoned({ externalId: 'w2', measuredAt: '2026-09-02T07:00:00Z' }, [stone])).toBe(false);
    expect(isTombstoned({ externalId: 'w2', measuredAt: '2026-09-01T07:00:00Z' }, [])).toBe(false);
  });
});

describe('BodyCompositionService.importBatch — per-sample tolerance', () => {
  beforeEach(() => {
    setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('imports a clean batch exactly as before (counts unchanged)', async () => {
    const result = await BodyCompositionService.importBatch(USER, {
      platform: 'healthkit',
      items: [
        { externalId: 'w1', measuredAt: '2026-09-01T07:00:00Z', weightKg: 93.5 },
        { externalId: 'bf1', measuredAt: '2026-09-01T07:00:05Z', bodyFatPct: 26.6 },
      ],
    });
    expect(result).toMatchObject({ received: 2, imported: 2, skipped: 0 });
    expect(result.outcomes).toEqual([
      { externalId: 'w1', imported: true },
      { externalId: 'bf1', imported: true },
    ]);
    const rows = fake.rows(LOGS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'healthkit', source_external_id: 'w1', weight_kg: 93.5, body_fat_pct: 26.6 });
  });

  it('skips a cluster with no counted metric and still imports the rest', async () => {
    const result = await BodyCompositionService.importBatch(USER, {
      platform: 'health_connect',
      items: [
        { externalId: 'lean-only', measuredAt: '2026-09-01T07:00:00Z', leanBodyMassKg: 68 },
        { externalId: 'bmr-only', measuredAt: '2026-09-01T07:01:00Z', bmrKcal: 1800 },
        { externalId: 'w2', measuredAt: '2026-09-02T07:00:00Z', weightKg: 93.2 },
      ],
    });
    expect(result).toMatchObject({ received: 3, imported: 1, skipped: 2 });
    expect(result.outcomes).toEqual([
      { externalId: 'lean-only', imported: false, reason: 'no_counted_metric' },
      { externalId: 'bmr-only', imported: false, reason: 'no_counted_metric' },
      { externalId: 'w2', imported: true },
    ]);
    expect(fake.rows(LOGS)).toHaveLength(1);
  });

  it('reports an item that carries no metric at all', async () => {
    const result = await BodyCompositionService.importBatch(USER, {
      platform: 'healthkit',
      items: [
        { externalId: 'empty', measuredAt: '2026-09-01T07:00:00Z' },
        { externalId: 'w1', measuredAt: '2026-09-03T07:00:00Z', weightKg: 90 },
      ],
    });
    expect(result).toMatchObject({ received: 2, imported: 1, skipped: 1 });
    expect(result.outcomes?.[0]).toEqual({ externalId: 'empty', imported: false, reason: 'no_valid_metric' });
  });

  it('skips only the cluster the database rejects (CHECK violation) — never throws', async () => {
    setup(
      {},
      {
        rules: [
          {
            table: LOGS,
            op: 'upsert',
            fail: (payload: any) =>
              payload?.source_external_id === 'bad'
                ? { code: '23514', message: 'violates check constraint "body_comp_weight_range"' }
                : undefined,
          },
        ],
      }
    );
    const result = await BodyCompositionService.importBatch(USER, {
      platform: 'healthkit',
      items: [
        { externalId: 'good-1', measuredAt: '2026-09-01T07:00:00Z', weightKg: 93.5 },
        { externalId: 'bad', measuredAt: '2026-09-02T07:00:00Z', weightKg: 93.4 },
        { externalId: 'good-2', measuredAt: '2026-09-03T07:00:00Z', weightKg: 93.3 },
      ],
    });
    expect(result).toMatchObject({ received: 3, imported: 2, skipped: 1 });
    expect(result.outcomes?.[1]).toEqual({ externalId: 'bad', imported: false, reason: 'rejected_by_storage' });
    expect(fake.rows(LOGS).map((r) => r.source_external_id)).toEqual(['good-1', 'good-2']);
  });

  it('still fails the request on an infrastructure error, so the client retries', async () => {
    setup(
      {},
      { rules: [{ table: LOGS, op: 'upsert', fail: () => ({ code: '57014', message: 'statement timeout' }) }] }
    );
    await expect(
      BodyCompositionService.importBatch(USER, {
        platform: 'healthkit',
        items: [{ externalId: 'w1', measuredAt: '2026-09-01T07:00:00Z', weightKg: 93.5 }],
      })
    ).rejects.toThrow(/body-comp import failed/);
  });

  it('reports already-imported and unchanged samples on a re-sync', async () => {
    const batch = {
      platform: 'healthkit' as const,
      items: [
        { externalId: 'w1', measuredAt: '2026-09-01T07:00:00Z', weightKg: 93.5 },
        { externalId: 'bf1', measuredAt: '2026-09-01T07:00:05Z', bodyFatPct: 26.6 },
      ],
    };
    await BodyCompositionService.importBatch(USER, batch);
    const again = await BodyCompositionService.importBatch(USER, batch);
    expect(again).toMatchObject({ received: 2, imported: 0, skipped: 2 });
    expect(again.outcomes).toEqual([
      { externalId: 'w1', imported: false, reason: 'already_imported' },
      { externalId: 'bf1', imported: false, reason: 'unchanged' },
    ]);
    expect(fake.rows(LOGS)).toHaveLength(1);
  });

  it('looks up existing external ids in chunks (a 250-sample batch does not build one huge filter)', async () => {
    const items = Array.from({ length: 250 }, (_, i) => ({
      externalId: `sample-${i}`,
      // one per day, so every sample is its own cluster
      measuredAt: new Date(Date.UTC(2025, 0, 1 + i, 7)).toISOString(),
      weightKg: 90,
    }));
    const result = await BodyCompositionService.importBatch(USER, { platform: 'healthkit', items });
    expect(result).toMatchObject({ received: 250, imported: 250, skipped: 0 });
    const tombstoneReads = fake.calls.filter((c) => c.table === TOMBSTONES && c.op === 'select');
    expect(tombstoneReads).toHaveLength(1);
  });
});

describe('Body-comp import tombstones', () => {
  beforeEach(() => {
    setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const batch = {
    platform: 'healthkit' as const,
    items: [
      { externalId: 'w1', measuredAt: '2026-09-01T07:00:00Z', weightKg: 93.5 },
      { externalId: 'bf1', measuredAt: '2026-09-01T07:00:05Z', bodyFatPct: 26.6 },
      { externalId: 'w2', measuredAt: '2026-09-08T07:00:00Z', weightKg: 93.0 },
    ],
  };

  it('a deleted imported entry is not re-imported (same id and its sibling samples)', async () => {
    await BodyCompositionService.importBatch(USER, batch);
    const deleted = fake.rows(LOGS).find((r) => r.source_external_id === 'w1')!;

    await expect(BodyCompositionService.deleteLog(USER, deleted.id)).resolves.toEqual({ deleted: true });
    expect(fake.rows(TOMBSTONES)).toHaveLength(1);
    expect(fake.rows(TOMBSTONES)[0]).toMatchObject({
      user_id: USER,
      source: 'healthkit',
      source_external_id: 'w1',
      measured_at: '2026-09-01T07:00:00Z',
    });

    // Reinstall / second device: the whole window is sent again.
    const again = await BodyCompositionService.importBatch(USER, batch);
    expect(again).toMatchObject({ received: 3, imported: 0, skipped: 3 });
    expect(again.outcomes).toEqual([
      { externalId: 'w1', imported: false, reason: 'deleted_by_user' },
      { externalId: 'bf1', imported: false, reason: 'deleted_by_user' },
      { externalId: 'w2', imported: false, reason: 'already_imported' },
    ]);
    expect(fake.rows(LOGS).map((r) => r.source_external_id)).toEqual(['w2']);
  });

  it('a tombstone is per platform source', async () => {
    await BodyCompositionService.importBatch(USER, batch);
    const deleted = fake.rows(LOGS).find((r) => r.source_external_id === 'w1')!;
    await BodyCompositionService.deleteLog(USER, deleted.id);

    const other = await BodyCompositionService.importBatch(USER, {
      platform: 'health_connect',
      items: [{ externalId: 'hc-1', measuredAt: '2026-09-01T07:00:00Z', weightKg: 93.5 }],
    });
    expect(other).toMatchObject({ imported: 1, skipped: 0 });
  });

  it('does not tombstone a manual entry', async () => {
    setup({
      [LOGS]: [
        {
          id: 'manual-1',
          user_id: USER,
          source: 'manual',
          source_external_id: null,
          measured_at: '2026-09-01T07:00:00Z',
          weight_kg: 93.5,
        },
      ],
    });
    await BodyCompositionService.deleteLog(USER, 'manual-1');
    expect(fake.rows(LOGS)).toHaveLength(0);
    expect(fake.calls.some((c) => c.table === TOMBSTONES)).toBe(false);
  });

  it('keys a platform row without an external id by its timestamp', async () => {
    setup({
      [LOGS]: [
        {
          id: 'hk-1',
          user_id: USER,
          source: 'healthkit',
          source_external_id: null,
          measured_at: '2026-09-01T07:00:00+00:00',
          weight_kg: 93.5,
        },
      ],
    });
    await BodyCompositionService.deleteLog(USER, 'hk-1');
    expect(fake.rows(TOMBSTONES)[0].source_external_id).toBe('at:2026-09-01T07:00:00.000Z');

    const again = await BodyCompositionService.importBatch(USER, {
      platform: 'healthkit',
      items: [{ externalId: 'w1', measuredAt: '2026-09-01T07:02:00Z', weightKg: 93.5 }],
    });
    expect(again.outcomes).toEqual([{ externalId: 'w1', imported: false, reason: 'deleted_by_user' }]);
  });

  it('still throws NOT_FOUND for a log that is not the user\'s', async () => {
    setup({ [LOGS]: [{ id: 'x', user_id: 'someone-else', source: 'healthkit', measured_at: '2026-09-01T07:00:00Z' }] });
    await expect(BodyCompositionService.deleteLog(USER, 'x')).rejects.toThrow('NOT_FOUND');
    expect(fake.rows(LOGS)).toHaveLength(1);
  });

  describe('when migration 093 is not applied', () => {
    it('delete still succeeds', async () => {
      setup(
        {
          [LOGS]: [
            { id: 'hk-1', user_id: USER, source: 'healthkit', source_external_id: 'w1', measured_at: '2026-09-01T07:00:00Z', weight_kg: 93.5 },
          ],
        },
        { missingTables: [TOMBSTONES] }
      );
      await expect(BodyCompositionService.deleteLog(USER, 'hk-1')).resolves.toEqual({ deleted: true });
      expect(fake.rows(LOGS)).toHaveLength(0);
    });

    it('import still works (no tombstones consulted)', async () => {
      setup({}, { missingTables: [TOMBSTONES] });
      const result = await BodyCompositionService.importBatch(USER, batch);
      expect(result).toMatchObject({ received: 3, imported: 3, skipped: 0 });
    });
  });
});
