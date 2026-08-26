import { describe, it, expect } from 'vitest';
import { computeBmi, bmiCategory, healthyWeightRangeKg, bmiScalePosition, BMI_BANDS } from '@/lib/utils/bmi';

describe('bmi', () => {
  it('computes to one decimal from kg and cm', () => {
    expect(computeBmi(78.5, 180)).toBe(24.2);
    expect(computeBmi(91.8, 178)).toBe(29.0);
  });
  it('returns null for missing or nonsense inputs', () => {
    expect(computeBmi(null, 180)).toBeNull();
    expect(computeBmi(80, 0)).toBeNull();
    expect(computeBmi(undefined, undefined)).toBeNull();
  });
  it('uses WHO cut-offs', () => {
    expect(bmiCategory(18.4)).toBe('underweight');
    expect(bmiCategory(18.5)).toBe('normal');
    expect(bmiCategory(24.9)).toBe('normal');
    expect(bmiCategory(25)).toBe('overweight');
    expect(bmiCategory(30)).toBe('obese');
  });
  it('healthy range for 180cm is 59.9–80.7 kg', () => {
    expect(healthyWeightRangeKg(180)).toEqual({ min: 59.9, max: 80.7 });
  });
  it('scale position clamps to the visual range and bands are contiguous', () => {
    expect(bmiScalePosition(10)).toBe(0);
    expect(bmiScalePosition(40)).toBe(1);
    expect(bmiScalePosition(27)).toBeCloseTo(0.5, 2);
    for (let i = 1; i < BMI_BANDS.length; i++) expect(BMI_BANDS[i].from).toBe(BMI_BANDS[i - 1].to);
  });
});
