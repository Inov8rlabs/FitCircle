import { describe, expect, it } from 'vitest';

import { fromIosResponses } from '../ios-responses';

describe('fromIosResponses', () => {
  it('maps the iOS answers onto the flat schema', () => {
    expect(
      fromIosResponses({
        responses: [
          { question_key: 'frequency', selected_values: ['3_4_week'] },
          { question_key: 'goals', selected_values: ['build_muscle'] },
          { question_key: 'activity_types', selected_values: ['running', 'cycling', 'yoga'] },
          { question_key: 'time_available', selected_values: ['60_plus'] },
          { question_key: 'fitness_level', selected_values: ['intermediate'] },
        ],
      })
    ).toEqual({
      exercise_frequency: '3-4x_week',
      primary_goal: 'gain_muscle',
      preferred_workouts: ['cardio', 'yoga'],
      daily_time: '60min',
      fitness_self_assessment: 'some_experience',
    });
  });

  it('leaves the flat (Android / web) body alone', () => {
    const body = { exercise_frequency: 'daily' };
    expect(fromIosResponses(body)).toBe(body);
  });
});
