// Dietary preferences / allergens + units — shared contract (FROZEN).
// PRD v4 §6.15. Mirrors migration 063 (table `dietary_preferences`).
//
// Users declare a dietary pattern + allergens so SEARCH, SUGGESTIONS, and the COACH respect
// them. Units (metric|imperial) are a DISPLAY concern only: the API always stores/returns
// canonical grams/kcal; the client formats per the unit pref. There is no backend conversion.

import { z } from 'zod';

// ============================================================================
// Enums
// ============================================================================

/** Declared dietary pattern. 'none' is the in-code default when no row / NULL diet. */
export type DietType =
  | 'none'
  | 'vegetarian'
  | 'vegan'
  | 'pescatarian'
  | 'halal'
  | 'kosher'
  | 'gluten_free';

export const DIET_TYPES: readonly DietType[] = [
  'none',
  'vegetarian',
  'vegan',
  'pescatarian',
  'halal',
  'kosher',
  'gluten_free',
] as const;

/** Unit display preference. */
export type UnitSystem = 'metric' | 'imperial';

export const UNIT_SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial'] as const;

// ============================================================================
// DB row shape (snake_case) — mirrors migration 063.
// ============================================================================
export interface DietaryPreferencesRow {
  user_id: string;
  diet: DietType | null;
  allergens: string[];
  units: UnitSystem | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// API DTO (camelCase) — what GET/POST endpoints return.
// Always fully resolved: `diet` and `units` are never null here (defaults applied
// by the service), so clients can render without re-deriving anything.
// ============================================================================
export interface DietaryPreferencesDTO {
  /** Resolved dietary pattern; 'none' when the user has not declared one. */
  diet: DietType;
  /** Lowercase allergen tokens, e.g. ['peanuts','shellfish']. Empty when none. */
  allergens: string[];
  /** Resolved unit preference; inferred from locale when not explicitly set. */
  units: UnitSystem;
}

// ============================================================================
// Service input (validated at the route)
// ============================================================================
export const setDietaryPreferencesSchema = z
  .object({
    diet: z.enum([
      'none',
      'vegetarian',
      'vegan',
      'pescatarian',
      'halal',
      'kosher',
      'gluten_free',
    ]).optional(),
    allergens: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
    units: z.enum(['metric', 'imperial']).optional(),
  })
  .strict();

export type SetDietaryPreferencesInput = z.infer<typeof setDietaryPreferencesSchema>;

// ============================================================================
// DietaryPreferencesService API surface (FROZEN signatures)
// ----------------------------------------------------------------------------
// class DietaryPreferencesService {
//   // Resolved prefs for a user. Returns defaults when no row exists: diet='none',
//   // allergens=[], units inferred from profiles.country_code (CA→metric, US→imperial,
//   // else 'metric'). Never throws on a missing row.
//   static async getPrefs(userId: string): Promise<DietaryPreferencesDTO>
//
//   // Upsert the user's prefs. Only provided fields are changed (partial update);
//   // omitted fields are preserved. Returns the fully resolved DTO.
//   static async setPrefs(userId: string, input: SetDietaryPreferencesInput): Promise<DietaryPreferencesDTO>
// }
//
// Uses createAdminSupabase() and authorizes explicitly (all reads/writes scoped to userId).
// ============================================================================
