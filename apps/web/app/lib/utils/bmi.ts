/**
 * BMI — Body Mass Index. Pure functions, canonical units (kg, cm).
 *
 * Categories follow WHO adult cut-offs. Height is stored as an integer in
 * profiles.height_cm, which limits BMI precision to about ±0.3 — display one
 * decimal, never two.
 */

export type BmiCategory = 'underweight' | 'normal' | 'overweight' | 'obese';

/** WHO adult thresholds (kg/m²). */
export const BMI_THRESHOLDS = {
  underweightBelow: 18.5,
  overweightFrom: 25,
  obeseFrom: 30,
} as const;

/** Range the visual scale spans; values outside are clamped to the ends. */
export const BMI_SCALE = { min: 14, max: 40 } as const;

export interface BmiBand {
  key: BmiCategory;
  label: string;
  from: number;
  to: number;
}

export const BMI_BANDS: BmiBand[] = [
  { key: 'underweight', label: 'Underweight', from: BMI_SCALE.min, to: BMI_THRESHOLDS.underweightBelow },
  { key: 'normal', label: 'Normal', from: BMI_THRESHOLDS.underweightBelow, to: BMI_THRESHOLDS.overweightFrom },
  { key: 'overweight', label: 'Overweight', from: BMI_THRESHOLDS.overweightFrom, to: BMI_THRESHOLDS.obeseFrom },
  { key: 'obese', label: 'Obese', from: BMI_THRESHOLDS.obeseFrom, to: BMI_SCALE.max },
];

/** BMI rounded to one decimal, or null when inputs can't produce one. */
export function computeBmi(weightKg: number | null | undefined, heightCm: number | null | undefined): number | null {
  if (!weightKg || !heightCm || weightKg <= 0 || heightCm <= 0) return null;
  const metres = heightCm / 100;
  return Math.round((weightKg / (metres * metres)) * 10) / 10;
}

export function bmiCategory(bmi: number): BmiCategory {
  if (bmi < BMI_THRESHOLDS.underweightBelow) return 'underweight';
  if (bmi < BMI_THRESHOLDS.overweightFrom) return 'normal';
  if (bmi < BMI_THRESHOLDS.obeseFrom) return 'overweight';
  return 'obese';
}

/** Weight range (kg) that maps to the "normal" band for this height. */
export function healthyWeightRangeKg(heightCm: number): { min: number; max: number } {
  const m2 = (heightCm / 100) ** 2;
  return {
    min: Math.round(BMI_THRESHOLDS.underweightBelow * m2 * 10) / 10,
    max: Math.round((BMI_THRESHOLDS.overweightFrom - 0.1) * m2 * 10) / 10,
  };
}

/** Position of a BMI value along the scale as 0..1 (for the marker). */
export function bmiScalePosition(bmi: number): number {
  const clamped = Math.min(BMI_SCALE.max, Math.max(BMI_SCALE.min, bmi));
  return (clamped - BMI_SCALE.min) / (BMI_SCALE.max - BMI_SCALE.min);
}
