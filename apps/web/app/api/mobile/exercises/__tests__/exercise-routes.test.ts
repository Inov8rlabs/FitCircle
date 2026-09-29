import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireMobileAuth = vi.fn();
const createExercise = vi.fn();
const bulkSyncExercises = vi.fn();
const updateExercise = vi.fn();
const createCustomExercise = vi.fn();
const autoClaimForManualLog = vi.fn();
const quickLog = vi.fn();

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...a: unknown[]) => requireMobileAuth(...a),
}));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => ({}) }));
vi.mock('@/lib/services/exercise-service', () => ({
  ExerciseService: {
    createExercise: (...a: unknown[]) => createExercise(...a),
    bulkSyncExercises: (...a: unknown[]) => bulkSyncExercises(...a),
    updateExercise: (...a: unknown[]) => updateExercise(...a),
    createCustomExercise: (...a: unknown[]) => createCustomExercise(...a),
  },
}));
vi.mock('@/lib/services/streak-claiming-service', () => ({
  StreakClaimingService: { autoClaimForManualLog: (...a: unknown[]) => autoClaimForManualLog(...a) },
}));
vi.mock('@/lib/services/workout-logging-service', () => ({
  WorkoutLoggingService: { quickLog: (...a: unknown[]) => quickLog(...a) },
}));

import { PUT as updateRoute } from '../[id]/route';
import { POST as catalogRoute } from '../catalog/route';
import { POST as quickLogRoute } from '../quick-log/route';
import { POST as createRoute } from '../route';
import { POST as syncRoute } from '../sync/route';

const post = (path: string, body: unknown, method = 'POST') =>
  new Request(`http://localhost/api/mobile/exercises${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;

const STORED_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'user-1',
  exercise_type: 'running',
  category: 'cardio',
  duration_minutes: 30,
  source: 'healthkit',
  exercise_date: '2026-09-28',
  created_at: '2026-09-28T10:00:00Z',
  updated_at: '2026-09-28T10:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  requireMobileAuth.mockResolvedValue({ id: 'user-1' });
  createExercise.mockResolvedValue({
    data: { exercise: STORED_ROW, new_milestones: [], new_personal_records: [] },
    error: null,
  });
  bulkSyncExercises.mockResolvedValue({
    data: { synced: 1, skipped: 0, failed: 0, results: [] },
    error: null,
    streak: null,
  });
  updateExercise.mockResolvedValue({ data: STORED_ROW, error: null, newPersonalRecords: [] });
  createCustomExercise.mockResolvedValue({ data: { id: 'c1', name: 'Sled push' }, error: null });
  autoClaimForManualLog.mockResolvedValue({ claimed: true, alreadyClaimed: false, source: 'exercise_log' });
  quickLog.mockResolvedValue({
    exercise: { ...STORED_ROW, source: 'manual', brand: 'peloton', notes: null },
    momentum: { new_momentum: 4 },
  });
});

describe('POST /api/mobile/exercises — source', () => {
  const base = { exerciseType: 'running', category: 'cardio', durationMinutes: 30 };

  it('OLD SHAPE: manual is stored as manual, no platform tag', async () => {
    const res = await createRoute(post('', { ...base, source: 'manual' }));
    expect(res.status).toBe(200);
    expect(createExercise.mock.calls[0][1]).toMatchObject({ source: 'manual', source_platform: null });
  });

  it('OLD SHAPE: healthkit (what iOS and Android send today) is stored as healthkit, no platform tag', async () => {
    const res = await createRoute(post('', { ...base, source: 'healthkit', healthkitWorkoutId: 'hk-1' }));
    expect(res.status).toBe(200);
    expect(createExercise.mock.calls[0][1]).toMatchObject({ source: 'healthkit', source_platform: null });
  });

  it('OLD SHAPE: no source defaults to manual', async () => {
    await createRoute(post('', base));
    expect(createExercise.mock.calls[0][1]).toMatchObject({ source: 'manual', source_platform: null });
  });

  it.each(['health_connect', 'google_fit'])('accepts %s, stored as healthkit + source_platform', async (source) => {
    const res = await createRoute(post('', { ...base, source }));
    expect(res.status).toBe(200);
    expect(createExercise.mock.calls[0][1]).toMatchObject({ source: 'healthkit', source_platform: source });
  });

  it('a Health Connect workout follows the synced-workout streak rule (>= 10 min), not the manual one', async () => {
    await createRoute(post('', { ...base, durationMinutes: 5, source: 'health_connect' }));
    expect(autoClaimForManualLog).not.toHaveBeenCalled();
    await createRoute(post('', { ...base, durationMinutes: 10, source: 'health_connect' }));
    expect(autoClaimForManualLog).toHaveBeenCalledTimes(1);
  });

  it('never returns a source value other than what is stored', async () => {
    const res = await createRoute(post('', { ...base, source: 'health_connect' }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(['manual', 'healthkit']).toContain(body.data.source);
  });

  it('still rejects an unknown source', async () => {
    const res = await createRoute(post('', { ...base, source: 'strava' }));
    expect(res.status).toBe(400);
    expect(createExercise).not.toHaveBeenCalled();
  });
});

describe('POST /api/mobile/exercises — null tolerance and messages', () => {
  it('treats explicit nulls on optional fields as absent', async () => {
    const res = await createRoute(
      post('', {
        exerciseType: 'running',
        category: 'cardio',
        durationMinutes: 30,
        caloriesBurned: null,
        distanceMeters: null,
        avgHeartRate: null,
        effortLevel: null,
        locationType: null,
        workoutCompanion: null,
        isIndoor: null,
        notes: null,
        date: null,
        startedAt: null,
        healthkitWorkoutId: null,
        sourceDeviceName: null,
        source: null,
        autoClaimStreak: null,
        exercises: null,
      })
    );
    expect(res.status).toBe(200);
    const input = createExercise.mock.calls[0][1];
    expect(input).toMatchObject({ exercise_type: 'running', source: 'manual' });
    expect(input.calories_burned).toBeUndefined();
    expect(input.notes).toBeUndefined();
    expect(input.exercises).toBeUndefined();
  });

  it('tolerates nulls inside nested exercises', async () => {
    const res = await createRoute(
      post('', {
        exerciseType: 'strengthTraining',
        category: 'strength',
        durationMinutes: 45,
        exercises: [
          {
            exerciseId: null,
            customName: 'Sled push',
            trackingType: null,
            position: 0,
            sets: [{ setNumber: 1, setType: null, weightKg: 60, reps: 8, isCompleted: null }],
          },
        ],
      })
    );
    expect(res.status).toBe(200);
  });

  it('a validation error keeps code + details and adds a readable message', async () => {
    const res = await createRoute(post('', { exerciseType: 'running', category: 'cardio', durationMinutes: 0 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveProperty('durationMinutes');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message).toContain('durationMinutes');
  });

  it('a required field that is null is still an error', async () => {
    const res = await createRoute(post('', { exerciseType: null, category: 'cardio', durationMinutes: 30 }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/mobile/exercises/sync', () => {
  const item = {
    exerciseType: 'running',
    category: 'cardio',
    durationMinutes: 30,
    healthkitWorkoutId: 'hc-record-1',
    startedAt: '2026-09-28T10:00:00Z',
  };

  it('OLD SHAPE: a healthkit batch syncs with no platform tag', async () => {
    const res = await syncRoute(post('/sync', { exercises: [{ ...item, source: 'healthkit' }], autoClaimStreak: false }));
    expect(res.status).toBe(200);
    const input = bulkSyncExercises.mock.calls[0][1];
    expect(input.exercises[0]).toMatchObject({ source: 'healthkit', source_platform: null });
  });

  it('accepts health_connect per item and tags the platform', async () => {
    const res = await syncRoute(
      post('/sync', { exercises: [{ ...item, source: 'health_connect' }, { ...item, healthkitWorkoutId: 'b' }] })
    );
    expect(res.status).toBe(200);
    const input = bulkSyncExercises.mock.calls[0][1];
    expect(input.exercises[0]).toMatchObject({ source: 'healthkit', source_platform: 'health_connect' });
    expect(input.exercises[1]).toMatchObject({ source: 'healthkit', source_platform: null });
  });

  it('tolerates explicit nulls on optional item fields', async () => {
    const res = await syncRoute(
      post('/sync', {
        exercises: [{ ...item, caloriesBurned: null, distanceMeters: null, notes: null, sourceDeviceName: null, isIndoor: null }],
        autoClaimStreak: null,
      })
    );
    expect(res.status).toBe(200);
  });

  it('a validation error carries message, code and details', async () => {
    const res = await syncRoute(post('/sync', { exercises: [{ ...item, healthkitWorkoutId: undefined }] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveProperty('exercises.0.healthkitWorkoutId');
    expect(body.error.message).toContain('exercises.0.healthkitWorkoutId');
  });
});

describe('PUT /api/mobile/exercises/:id and POST /catalog', () => {
  const params = { params: Promise.resolve({ id: STORED_ROW.id }) };

  it('OLD SHAPE: a partial update still works', async () => {
    const res = await updateRoute(post(`/${STORED_ROW.id}`, { notes: 'felt good', effortLevel: 7 }, 'PUT'), params);
    expect(res.status).toBe(200);
    expect(updateExercise.mock.calls[0][2]).toEqual({ notes: 'felt good', effort_level: 7 });
  });

  it('a null on a merely-optional field means "not sent"', async () => {
    const res = await updateRoute(
      post(`/${STORED_ROW.id}`, { effortLevel: null, caloriesBurned: null, durationMinutes: 40 }, 'PUT'),
      params
    );
    expect(res.status).toBe(200);
    expect(updateExercise.mock.calls[0][2]).toEqual({ duration_minutes: 40 });
  });

  it('update validation errors carry a message', async () => {
    const res = await updateRoute(post(`/${STORED_ROW.id}`, { effortLevel: 11 }, 'PUT'), params);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveProperty('effortLevel');
    expect(body.error.message).toContain('effortLevel');
  });

  it('custom exercise: null trackingType is tolerated, errors carry a message', async () => {
    const ok = await catalogRoute(post('/catalog', { name: 'Sled push', trackingType: null, equipment: null }));
    expect(ok.status).toBe(200);
    const bad = await catalogRoute(post('/catalog', { name: '' }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toContain('name');
  });
});

describe('POST /api/mobile/exercises/quick-log', () => {
  it('OLD SHAPE: a canonical category is passed through', async () => {
    const res = await quickLogRoute(post('/quick-log', { brand: 'peloton', category: 'cardio', duration_minutes: 30 }));
    expect(res.status).toBe(200);
    expect(quickLog.mock.calls[0][1]).toMatchObject({ brand: 'peloton', category: 'cardio', duration_minutes: 30 });
    const body = await res.json();
    expect(body.data.exercise.id).toBe(STORED_ROW.id);
    expect(body.data.counts_as_checkin).toBe(true);
    expect(body.data.momentum).toEqual({ new_momentum: 4 });
  });

  it.each([
    ['hiit', 'cardio'],
    ['cycling', 'cardio'],
    ['general', 'other'],
    ['something_new', 'other'],
  ])('maps category %s to %s', async (sent, stored) => {
    const res = await quickLogRoute(post('/quick-log', { brand: 'home', category: sent, duration_minutes: 20, notes: null }));
    expect(res.status).toBe(200);
    expect(quickLog.mock.calls[0][1].category).toBe(stored);
  });

  it('adds the keys the iOS response model decodes, without removing the existing ones', async () => {
    const res = await quickLogRoute(post('/quick-log', { brand: 'peloton', category: 'cycling', duration_minutes: 30 }));
    const { data } = await res.json();
    expect(data.exercise).toBeDefined();
    expect(data.exercise_log).toMatchObject({
      id: STORED_ROW.id,
      user_id: 'user-1',
      brand: 'peloton',
      category: 'cardio',
      duration_minutes: 30,
      source: 'manual',
      logged_at: STORED_ROW.created_at,
    });
    expect(data.momentum_updated).toBe(true);
    expect(data.new_momentum_day).toBe(4);
  });

  it('validation errors carry a message', async () => {
    const res = await quickLogRoute(post('/quick-log', { brand: 'peloton', category: 'cardio', duration_minutes: 0 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('duration_minutes');
  });
});
