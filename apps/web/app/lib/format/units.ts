/**
 * Nutrition unit display helpers (§6.15).
 *
 * The nutrition API ALWAYS stores/returns canonical grams / kcal / ml. Unit
 * formatting is a pure DISPLAY concern done on the client per the user's
 * `units` preference — this is the ONLY client-side computation the nutrition
 * clients are allowed to do (the contract forbids re-deriving macros/scores).
 *
 *   - mass:   grams ↔ ounces  (1 oz = 28.349523125 g)
 *   - volume: millilitres ↔ US fluid ounces (1 fl oz = 29.5735295625 ml)
 *   - energy: kcal stays kcal in both systems (no conversion)
 */

export type DietaryUnits = 'metric' | 'imperial';

const G_PER_OZ = 28.349523125;
const ML_PER_FLOZ = 29.5735295625;

function trim(n: number): string {
  // Round to 1 decimal, then drop a trailing ".0" for clean display.
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Format a canonical gram value for display.
 *   formatGrams(150, 'metric')   → "150g"
 *   formatGrams(150, 'imperial') → "5.3oz"
 */
export function formatGrams(
  grams: number | null | undefined,
  units: DietaryUnits = 'metric'
): string {
  if (grams == null || Number.isNaN(grams)) return '—';
  if (units === 'imperial') return `${trim(grams / G_PER_OZ)}oz`;
  return `${trim(grams)}g`;
}

/**
 * Format a canonical millilitre value for display.
 *   formatVolume(500, 'metric')   → "500ml"
 *   formatVolume(500, 'imperial') → "16.9fl oz"
 */
export function formatVolume(
  ml: number | null | undefined,
  units: DietaryUnits = 'metric'
): string {
  if (ml == null || Number.isNaN(ml)) return '—';
  if (units === 'imperial') return `${trim(ml / ML_PER_FLOZ)}fl oz`;
  return `${trim(ml)}ml`;
}

/** Canonical kcal — identical in both systems; kept for call-site symmetry. */
export function formatCalories(kcal: number | null | undefined): string {
  if (kcal == null || Number.isNaN(kcal)) return '—';
  return `${Math.round(kcal)} cal`;
}
