import { describe, expect, it } from 'vitest';

import { normalizeCreateGoalBody, normalizeUpdateGoalBody } from '../daily-goals';

describe('daily-goal key aliases', () => {
  it('leaves a snake_case body (iOS, current Android) untouched', () => {
    const body = { goal_type: 'steps', target_value: 10000, start_date: '2026-09-28', is_primary: true };
    expect(normalizeCreateGoalBody(body)).toEqual(body);
  });

  it('copies camelCase keys onto their snake_case names', () => {
    expect(
      normalizeCreateGoalBody({
        goalType: 'steps',
        targetValue: 8000,
        unit: 'steps',
        startDate: '2026-09-28',
        endDate: null,
        isPrimary: true,
        autoAdjustEnabled: false,
        challengeId: null,
      })
    ).toMatchObject({
      goal_type: 'steps',
      target_value: 8000,
      unit: 'steps',
      start_date: '2026-09-28',
      end_date: null,
      is_primary: true,
      auto_adjust_enabled: false,
      challenge_id: null,
    });
  });

  it('prefers snake_case when both spellings are present', () => {
    expect(normalizeCreateGoalBody({ target_value: 10000, targetValue: 5 })).toMatchObject({ target_value: 10000 });
  });

  it('handles the update body', () => {
    expect(normalizeUpdateGoalBody({ targetValue: 12000, isActive: false })).toMatchObject({
      target_value: 12000,
      is_active: false,
    });
  });

  it('passes non-object bodies through for the schema to reject', () => {
    expect(normalizeCreateGoalBody(null)).toBeNull();
    expect(normalizeCreateGoalBody('x')).toBe('x');
    expect(normalizeCreateGoalBody([1])).toEqual([1]);
  });
});
