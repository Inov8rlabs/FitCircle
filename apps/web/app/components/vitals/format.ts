import type { BmiCategory } from '@/lib/utils/bmi';
import { getWeightUnit, type UnitSystem } from '@/lib/utils/units';

// ---------------------------------------------------------------------------
// Display helpers for the vitals cards. The server sends canonical units
// (kg, ml, cm); these only convert for display per VITALS_CLIENT_CONTRACT.md
// "Units": kg × 2.20462 → lb (1 dp), ml × 0.033814 → fl oz (0 dp).
// ---------------------------------------------------------------------------

const KG_TO_LB = 2.20462;
const ML_TO_FL_OZ = 0.033814;

export function kgToDisplay(kg: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? kg * KG_TO_LB : kg;
}

export function displayToKg(value: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? value / KG_TO_LB : value;
}

/** `78.5 kg` / `173.1 lbs`. */
export function formatKg(kg: number, unitSystem: UnitSystem, decimals = 1): string {
  return `${kgToDisplay(kg, unitSystem).toFixed(decimals)} ${getWeightUnit(unitSystem)}`;
}

export function mlToDisplay(ml: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? ml * ML_TO_FL_OZ : ml;
}

export function displayToMl(value: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? value / ML_TO_FL_OZ : value;
}

/** Unit label for the water goal input: `ml` or `fl oz`. */
export function waterInputUnit(unitSystem: UnitSystem): string {
  return unitSystem === 'imperial' ? 'fl oz' : 'ml';
}

/** Axis/legend unit for volumes: `L` (metric) or `oz` (imperial). */
export function volumeUnit(unitSystem: UnitSystem): string {
  return unitSystem === 'imperial' ? 'oz' : 'L';
}

/** Volume in chart units: litres (metric) or fl oz (imperial). */
export function mlToVolume(ml: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? ml * ML_TO_FL_OZ : ml / 1000;
}

/** `17.4 L` / `588 oz`. */
export function formatVolume(ml: number, unitSystem: UnitSystem): string {
  const v = mlToVolume(ml, unitSystem);
  return unitSystem === 'imperial' ? `${Math.round(v)} oz` : `${v.toFixed(1)} L`;
}

/** `180 cm` / `5'11"`. */
export function formatHeight(heightCm: number, unitSystem: UnitSystem): string {
  if (unitSystem !== 'imperial') return `${Math.round(heightCm)} cm`;
  const totalInches = Math.round(heightCm / 2.54);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}'${inches}"`;
}

/** Parse a `YYYY-MM-DD` day string as a local date (avoids the UTC shift of `new Date(str)`). */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function weekdayInitial(day: string): string {
  return WEEKDAY_INITIALS[parseDay(day).getDay()] ?? '';
}

/** Brand tokens per BMI band (VITALS_CLIENT_CONTRACT.md "Design tokens"). */
export const BMI_BAND_STYLE: Record<
  BmiCategory,
  { bar: string; dot: string; chip: string; hex: string }
> = {
  underweight: { bar: 'bg-cyan-500', dot: 'bg-cyan-500', chip: 'bg-cyan-500/15 text-cyan-400', hex: '#06b6d4' },
  normal: { bar: 'bg-emerald-500', dot: 'bg-emerald-500', chip: 'bg-emerald-500/15 text-emerald-400', hex: '#10b981' },
  overweight: { bar: 'bg-orange-500', dot: 'bg-orange-500', chip: 'bg-orange-500/15 text-orange-400', hex: '#f97316' },
  obese: { bar: 'bg-red-500', dot: 'bg-red-500', chip: 'bg-red-500/15 text-red-400', hex: '#ef4444' },
};

export const BMI_CATEGORY_LABEL: Record<BmiCategory, string> = {
  underweight: 'Underweight',
  normal: 'Normal',
  overweight: 'Overweight',
  obese: 'Obese',
};
