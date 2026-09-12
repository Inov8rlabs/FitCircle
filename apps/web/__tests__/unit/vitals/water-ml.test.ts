import { describe, expect, it } from 'vitest';

import {
  EIGHT_OZ_ML,
  GLASS_ML,
  HALF_GLASS_ML,
  waterAmountToMl,
} from '@/components/vitals/waterMl';

describe('waterAmountToMl', () => {
  it('matches Food Log glass presets', () => {
    expect(waterAmountToMl('glasses', 0.5)).toBe(HALF_GLASS_ML);
    expect(waterAmountToMl('glasses', 1)).toBe(GLASS_ML);
    expect(waterAmountToMl('oz', 8)).toBe(EIGHT_OZ_ML);
  });

  it('converts litres and ounces', () => {
    expect(waterAmountToMl('L', 0.5)).toBe(500);
    expect(waterAmountToMl('L', 1)).toBe(1000);
    expect(waterAmountToMl('oz', 16)).toBe(473);
  });

  it('rejects empty or non-positive amounts', () => {
    expect(waterAmountToMl('glasses', 0)).toBe(0);
    expect(waterAmountToMl('L', -1)).toBe(0);
    expect(waterAmountToMl('oz', Number.NaN)).toBe(0);
  });

  it('clamps to the API max of 10 L', () => {
    expect(waterAmountToMl('L', 20)).toBe(10_000);
  });
});
