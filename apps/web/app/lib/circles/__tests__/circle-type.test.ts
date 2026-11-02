import { describe, expect, it } from 'vitest';

import { circleTypeForChallenge } from '../circle-type';

describe('circleTypeForChallenge', () => {
  it('derives the circle type from the challenge', () => {
    expect(circleTypeForChallenge({ unit: 'steps', category: 'cardio' })).toBe('step_count');
    expect(circleTypeForChallenge({ unit: 'lbs', category: 'custom' })).toBe('weight_loss');
    expect(circleTypeForChallenge({ unit: 'minutes', category: 'cardio' })).toBe('workout_minutes');
    expect(circleTypeForChallenge({ unit: 'minutes', category: 'flexibility' })).toBe('custom');
    expect(circleTypeForChallenge({ unit: 'reps', category: 'strength' })).toBe('custom');
    expect(circleTypeForChallenge(null)).toBeNull();
  });
});
