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
 * Validate weight value with realistic bounds
 */
export function isValidWeight(
  value: number,
  unitSystem: UnitSystem = 'metric'
): boolean {
  const maxWeight = unitSystem === 'imperial' ? 650 : 300; // More realistic max
  const minWeight = unitSystem === 'imperial' ? 66 : 30;   // More realistic min
  return value >= minWeight && value <= maxWeight;
}

/**
 * Get a human-readable error message for invalid weights
 */
export function getWeightValidationMessage(
  value: number,
  unitSystem: UnitSystem = 'metric'
): string {
  const maxWeight = unitSystem === 'imperial' ? 650 : 300;
  const minWeight = unitSystem === 'imperial' ? 66 : 30;
  const unit = getWeightUnit(unitSystem);

  if (value < minWeight) {
    return `Weight must be at least ${minWeight} ${unit}`;
  }
  if (value > maxWeight) {
    return `Weight must be less than ${maxWeight} ${unit}`;
  }
  return '';
}

/**
 * Check if weight might be entered in wrong units
 * Returns suggested correction if detected
 */
export function detectWrongUnit(
  weightKg: number,
  expectedUnit: UnitSystem
): { isWrong: boolean; suggestedValue?: number; message?: string } {
  // If expecting imperial but got kg value that looks like lbs
  if (expectedUnit === 'imperial' && weightKg > 150 && weightKg < 400) {
    const asLbs = kgToLbs(weightKg);
    return {
      isWrong: true,
      suggestedValue: lbsToKg(weightKg),
      message: `Did you mean ${weightKg} lbs? That would be ${lbsToKg(weightKg).toFixed(1)} kg.`
    };
  }

  // If expecting metric but got lbs value that looks like kg
  if (expectedUnit === 'metric' && weightKg > 150 && weightKg < 400) {
    return {
      isWrong: true,
      suggestedValue: kgToLbs(weightKg),
      message: `Did you mean ${weightKg} kg? (${kgToLbs(weightKg).toFixed(1)} lbs)`
    };
  }

  return { isWrong: false };
}