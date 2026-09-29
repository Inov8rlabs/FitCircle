import { describe, expect, it } from 'vitest';

import {
  exerciseSourceInputSchema,
  isMissingColumnError,
  resolveExerciseSource,
} from '../exercise-source';

describe('exerciseSourceInputSchema', () => {
  it('still accepts the two original values', () => {
    expect(exerciseSourceInputSchema.parse('manual')).toBe('manual');
    expect(exerciseSourceInputSchema.parse('healthkit')).toBe('healthkit');
  });

  it('accepts health_connect and google_fit', () => {
    expect(exerciseSourceInputSchema.parse('health_connect')).toBe('health_connect');
    expect(exerciseSourceInputSchema.parse('google_fit')).toBe('google_fit');
  });

  it('still rejects anything else', () => {
    expect(exerciseSourceInputSchema.safeParse('strava').success).toBe(false);
    expect(exerciseSourceInputSchema.safeParse('').success).toBe(false);
  });
});

describe('resolveExerciseSource', () => {
  it('stores manual and healthkit unchanged, with no platform tag', () => {
    expect(resolveExerciseSource('manual', 'manual')).toEqual({ source: 'manual', sourcePlatform: null });
    expect(resolveExerciseSource('healthkit', 'manual')).toEqual({ source: 'healthkit', sourcePlatform: null });
  });

  it('stores Health Connect / Google Fit as healthkit + the declared platform', () => {
    expect(resolveExerciseSource('health_connect', 'manual')).toEqual({
      source: 'healthkit',
      sourcePlatform: 'health_connect',
    });
    expect(resolveExerciseSource('google_fit', 'healthkit')).toEqual({
      source: 'healthkit',
      sourcePlatform: 'google_fit',
    });
  });

  it('never resolves to a stored value a released client cannot read', () => {
    for (const input of ['manual', 'healthkit', 'health_connect', 'google_fit', undefined] as const) {
      expect(['manual', 'healthkit']).toContain(resolveExerciseSource(input, 'manual').source);
    }
  });

  it('uses the route default when the client sent nothing', () => {
    expect(resolveExerciseSource(undefined, 'manual').source).toBe('manual');
    expect(resolveExerciseSource(undefined, 'healthkit').source).toBe('healthkit');
  });
});

describe('isMissingColumnError', () => {
  it('recognises the PostgREST schema-cache miss and the Postgres undefined column', () => {
    expect(
      isMissingColumnError(
        { code: 'PGRST204', message: "Could not find the 'source_platform' column of 'exercise_logs' in the schema cache" },
        'source_platform'
      )
    ).toBe(true);
    expect(
      isMissingColumnError(
        { code: '42703', message: 'column "source_platform" of relation "exercise_logs" does not exist' },
        'source_platform'
      )
    ).toBe(true);
  });

  it('does not swallow other errors', () => {
    expect(isMissingColumnError({ code: '23505', message: 'duplicate key value' }, 'source_platform')).toBe(false);
    expect(
      isMissingColumnError({ code: '23514', message: 'violates check constraint "exercise_logs_source_check"' }, 'source_platform')
    ).toBe(false);
    expect(isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'brand' column" }, 'source_platform')).toBe(false);
    expect(isMissingColumnError(null, 'source_platform')).toBe(false);
  });
});
