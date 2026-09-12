/**
 * Water quick-add amounts. Storage is always millilitres (VITALS_CLIENT_CONTRACT.md);
 * these match the Food Log glass / oz presets so a "Glass" here is the same
 * 240 ml as a Glass on that form.
 */

export const HALF_GLASS_ML = 120;
export const GLASS_ML = 240;
/** 8 fl oz using the same 0.033814 factor as vitals display (8 / 0.033814 ≈ 237). */
export const EIGHT_OZ_ML = 237;
export const ML_TO_FL_OZ = 0.033814;
export const MIN_WATER_ML = 1;
export const MAX_WATER_ML = 10_000;

export type WaterQuickUnit = 'glasses' | 'oz' | 'L';

export const WATER_QUICK_PRESETS: { label: string; ml: number }[] = [
  { label: 'Half', ml: HALF_GLASS_ML },
  { label: 'Glass', ml: GLASS_ML },
  { label: '8 oz', ml: EIGHT_OZ_ML },
];

export function defaultAmountForUnit(unit: WaterQuickUnit): number {
  switch (unit) {
    case 'glasses':
      return 1;
    case 'oz':
      return 8;
    case 'L':
      return 0.5;
  }
}

export function stepForUnit(unit: WaterQuickUnit): number {
  switch (unit) {
    case 'glasses':
      return 0.5;
    case 'oz':
      return 1;
    case 'L':
      return 0.25;
  }
}

/** Convert a display amount in `unit` to millilitres, clamped to the API range. */
export function waterAmountToMl(unit: WaterQuickUnit, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  let ml = 0;
  if (unit === 'glasses') ml = amount * GLASS_ML;
  else if (unit === 'oz') ml = amount / ML_TO_FL_OZ;
  else ml = amount * 1000;
  const rounded = Math.round(ml);
  if (rounded < MIN_WATER_ML) return 0;
  return Math.min(MAX_WATER_ML, rounded);
}

export function roundWaterAmount(unit: WaterQuickUnit, value: number): number {
  const step = stepForUnit(unit);
  const rounded = Math.round(value / step) * step;
  return Math.max(step, Number(rounded.toFixed(2)));
}
