import { describe, expect, it } from 'vitest';

import { platformStepsSourceSchema, stepsSourceSchema } from '../steps-source';

describe('step source aliases', () => {
  it('still accepts the stored values unchanged', () => {
    expect(stepsSourceSchema.parse('manual')).toBe('manual');
    expect(stepsSourceSchema.parse('healthkit')).toBe('healthkit');
    expect(stepsSourceSchema.parse('google_fit')).toBe('google_fit');
  });

  it('accepts apple_health as healthkit', () => {
    expect(stepsSourceSchema.parse('apple_health')).toBe('healthkit');
    expect(platformStepsSourceSchema.parse('apple_health')).toBe('healthkit');
  });

  it('accepts health_connect as google_fit', () => {
    expect(stepsSourceSchema.parse('health_connect')).toBe('google_fit');
    expect(platformStepsSourceSchema.parse('health_connect')).toBe('google_fit');
  });

  it('still rejects unknown sources, and manual for bulk sync', () => {
    expect(stepsSourceSchema.safeParse('fitbit').success).toBe(false);
    expect(platformStepsSourceSchema.safeParse('manual').success).toBe(false);
    expect(stepsSourceSchema.safeParse(null).success).toBe(false);
  });
});
