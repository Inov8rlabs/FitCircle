// Foods reference + search/barcode/custom — shared contract (FROZEN).
// PRD v4 §6.1 (search, barcode, custom foods & recipes) / §7.4 (schema). Mirrors migration 055.
// Single-source-of-truth (§7.2.1): macro math, serving scaling, ranking all live server-side.

import { z } from 'zod';

export type FoodSource = 'off' | 'usda' | 'custom' | 'recipe';

// ============================================================================
// DB row shape (snake_case, macros per 100g — the OFF/USDA convention)
// ============================================================================
export interface FoodRow {
  id: string;
  source: FoodSource;
  source_id: string | null;
  owner_id: string | null;
  name: string;
  brand: string | null;
  barcode: string | null;
  serving_size_g: number | null;
  serving_unit: string | null;
  calories_per_100g: number | null;
  protein_per_100g: number | null;
  carbs_per_100g: number | null;
  fat_per_100g: number | null;
  fiber_per_100g: number | null;
  sugar_per_100g: number | null;
  locale: string | null;
  recipe_ingredients: Array<{ name: string; grams: number; food_id?: string }> | null;
  recipe_servings: number | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// API DTO (camelCase) — what search/barcode/custom endpoints return.
// ============================================================================
export interface FoodDTO {
  id: string;
  source: FoodSource;
  name: string;
  brand: string | null;
  barcode: string | null;
  servingSizeG: number | null;
  servingUnit: string | null;
  per100g: {
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fiberG: number | null;
    sugarG: number | null;
  };
  locale: string | null;
  isCustom: boolean; // source is 'custom' or 'recipe'
}

// ============================================================================
// Service inputs
// ============================================================================
export interface FoodSearchParams {
  query: string;
  limit?: number;   // default 20, max 50
  locale?: string;  // bias ranking toward this locale (e.g. 'en-CA')
}

// Create-custom-food / recipe input (validated at the route).
export const createCustomFoodSchema = z.object({
  name: z.string().min(1).max(200),
  brand: z.string().max(200).optional(),
  servingSizeG: z.number().positive().optional(),
  servingUnit: z.string().max(60).optional(),
  per100g: z.object({
    calories: z.number().nonnegative(),
    proteinG: z.number().nonnegative(),
    carbsG: z.number().nonnegative(),
    fatG: z.number().nonnegative(),
    fiberG: z.number().nonnegative().optional(),
    sugarG: z.number().nonnegative().optional(),
  }),
  // recipe-only: providing ingredients makes this a source='recipe' multi-ingredient food
  recipeIngredients: z
    .array(z.object({ name: z.string().min(1), grams: z.number().positive(), foodId: z.string().uuid().optional() }))
    .optional(),
  recipeServings: z.number().positive().optional(),
});
export type CreateCustomFoodInput = z.infer<typeof createCustomFoodSchema>;

export const FOOD_SEARCH_DEFAULT_LIMIT = 20;
export const FOOD_SEARCH_MAX_LIMIT = 50;

// ============================================================================
// FoodsService API surface (FROZEN signatures)
// ----------------------------------------------------------------------------
// class FoodsService {
//   // Full-text + trigram search over global ref rows (off/usda) AND the user's own
//   // custom foods/recipes, ranked (exact/prefix > FTS rank, locale-boosted, user customs first).
//   static async search(userId: string, params: FoodSearchParams): Promise<FoodDTO[]>
//
//   // Barcode lookup — exact match against global ref rows. Returns null if not found
//   // (the client then offers manual search / OFF contribution per §6.1).
//   static async lookupBarcode(barcode: string): Promise<FoodDTO | null>
//
//   // Save a custom food (or recipe when recipeIngredients present) owned by the user.
//   static async createCustomFood(userId: string, input: CreateCustomFoodInput): Promise<FoodDTO>
//
//   // List the user's saved custom foods/recipes (for the "your foods" picker).
//   static async listCustomFoods(userId: string): Promise<FoodDTO[]>
// }
//
// Uses createAdminSupabase() and authorizes explicitly (search filters owner_id IS NULL OR
// owner_id = userId; custom writes set owner_id = userId).
// ============================================================================
