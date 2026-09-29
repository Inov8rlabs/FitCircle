import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExerciseService } from '../exercise-service';

import { createFakeSupabase } from './helpers/fake-supabase';

vi.mock('../streak-claiming-service', () => ({
  StreakClaimingService: { autoClaimForManualLog: vi.fn() },
}));

const USER = 'user-1';
// 5 minutes: below the check-in threshold, so the sync touches nothing but exercise_logs.
const workout = (overrides: Record<string, unknown> = {}) => ({
  exercise_type: 'walking',
  category: 'cardio' as const,
  duration_minutes: 5,
  date: '2026-09-28',
  healthkit_workout_id: 'record-1',
  ...overrides,
});

describe('ExerciseService.bulkSyncExercises — source_platform', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('a plain healthkit sync sends exactly the insert it always did (no new column)', async () => {
    const fake = createFakeSupabase();
    const result = await ExerciseService.bulkSyncExercises(USER, { exercises: [workout()] }, fake.client);
    expect(result.data).toMatchObject({ synced: 1, skipped: 0, failed: 0 });
    const insert = fake.calls.find((c) => c.op === 'insert')!;
    expect(insert.payload).not.toHaveProperty('source_platform');
    expect(fake.rows('exercise_logs')[0]).toMatchObject({ source: 'healthkit' });
  });

  it('a declared Health Connect origin is stored in source_platform, source stays healthkit', async () => {
    const fake = createFakeSupabase();
    const result = await ExerciseService.bulkSyncExercises(
      USER,
      { exercises: [workout({ source_platform: 'health_connect' })] },
      fake.client
    );
    expect(result.data).toMatchObject({ synced: 1 });
    expect(fake.rows('exercise_logs')[0]).toMatchObject({ source: 'healthkit', source_platform: 'health_connect' });
  });

  it('migration 092 not applied: retries without the column and still saves the workout', async () => {
    const fake = createFakeSupabase(
      {},
      {
        rules: [
          {
            table: 'exercise_logs',
            op: 'insert',
            fail: (payload: any) =>
              'source_platform' in payload
                ? {
                    code: 'PGRST204',
                    message: "Could not find the 'source_platform' column of 'exercise_logs' in the schema cache",
                  }
                : undefined,
          },
        ],
      }
    );
    const result = await ExerciseService.bulkSyncExercises(
      USER,
      { exercises: [workout({ source_platform: 'health_connect' })] },
      fake.client
    );
    expect(result.data).toMatchObject({ synced: 1, failed: 0 });
    expect(fake.calls.filter((c) => c.op === 'insert')).toHaveLength(2);
    const row = fake.rows('exercise_logs')[0];
    expect(row.source).toBe('healthkit');
    expect(row).not.toHaveProperty('source_platform');
  });

  it('any other insert error is reported, not retried', async () => {
    const fake = createFakeSupabase(
      {},
      {
        rules: [
          { table: 'exercise_logs', op: 'insert', fail: () => ({ code: '23514', message: 'violates check constraint' }) },
        ],
      }
    );
    const result = await ExerciseService.bulkSyncExercises(
      USER,
      { exercises: [workout({ source_platform: 'health_connect' })] },
      fake.client
    );
    expect(result.data).toMatchObject({ synced: 0, failed: 1 });
    expect(fake.calls.filter((c) => c.op === 'insert')).toHaveLength(1);
  });
});
