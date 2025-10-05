/**
 * Unit conversion utilities for FitCircle
 */

export type UnitSystem = 'metric' | 'imperial';
export type WeightUnit = 'kg' | 'lbs';

// Conversion constants
const KG_TO_LBS = 2.20462;
const LBS_TO_KG = 0.453592;

/**
 * Convert kilograms to pounds
 */
export function kgToLbs(kg: number): number {
  return Math.round(kg * KG_TO_LBS * 10) / 10; // Round to 1 decimal place
}

/**
 * Convert pounds to kilograms
 */
export function lbsToKg(lbs: number): number {
  return Math.round(lbs * LBS_TO_KG * 10) / 10; // Round to 1 decimal place
}

/**
 * Convert weight based on unit system
 */
export function convertWeight(
  value: number,
  fromUnit: WeightUnit,
  toUnit: WeightUnit
): number {
  if (fromUnit === toUnit) return value;

  if (fromUnit === 'kg' && toUnit === 'lbs') {
    return kgToLbs(value);
  }

  if (fromUnit === 'lbs' && toUnit === 'kg') {
    return lbsToKg(value);
  }

  return value;
}

/**
 * Format weight with unit
 */
export function formatWeight(
  weightKg: number | null | undefined,
  unitSystem: UnitSystem = 'metric'
): string {
  if (weightKg === null || weightKg === undefined) {
    return 'No data';
  }

  if (unitSystem === 'imperial') {
    const lbs = kgToLbs(weightKg);
    return `${lbs} lbs`;
  }

  return `${weightKg} kg`;
}

/**
 * Parse weight input and convert to kg
 */
export function parseWeightToKg(
  value: string | number,
  unitSystem: UnitSystem = 'metric'
): number | null {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;

  if (isNaN(numValue) || numValue === null || numValue === undefined) {
    return null;
  }

  if (unitSystem === 'imperial') {
    return lbsToKg(numValue);
  }

  return numValue;
}

/**
 * Convert weight from kg to display value
 */
export function weightKgToDisplay(
  weightKg: number,
  unitSystem: UnitSystem = 'metric'
): number {
  if (unitSystem === 'imperial') {
    return kgToLbs(weightKg);
  }
  return weightKg;
}

/**
 * Get weight unit label
 */
export function getWeightUnit(unitSystem: UnitSystem = 'metric'): WeightUnit {
  return unitSystem === 'imperial' ? 'lbs' : 'kg';
}

/**
 * Get weight input placeholder
 */
export function getWeightPlaceholder(unitSystem: UnitSystem = 'metric'): string {
  return unitSystem === 'imperial' ? '155.4' : '70.5';
}

/**
 * Validate weight value
 */
export function isValidWeight(
  value: number,
  unitSystem: UnitSystem = 'metric'
): boolean {
  const maxWeight = unitSystem === 'imperial' ? 2200 : 1000; // Max weight in respective units
  const minWeight = unitSystem === 'imperial' ? 2.2 : 1; // Min weight in respective units

  return value > minWeight && value < maxWeight;
}