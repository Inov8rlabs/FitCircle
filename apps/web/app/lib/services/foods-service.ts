import { createAdminSupabase } from '../supabase-admin';
import {
  type CreateCustomFoodInput,
  type FoodDTO,
  type FoodRow,
  type FoodSearchParams,
  FOOD_SEARCH_DEFAULT_LIMIT,
  FOOD_SEARCH_MAX_LIMIT,
} from '../types/foods';

/**
 * FoodsService — search / barcode / custom foods over the `foods` reference table (PRD §6.1).
 * All ranking + macro shaping is server-side (§7.2.1); clients render FoodDTO, never re-derive.
 *
 * Authorization is explicit in-code (the service uses the admin client): search and reads are
 * scoped to global reference rows (owner_id IS NULL) OR the requesting user's own custom rows.
 */
export class FoodsService {
  /**
   * Full-text + trigram search over global reference foods AND the user's custom foods/recipes.
   * Ranking: the user's own custom foods first, then FTS rank, with a small locale-match boost.
   */
  static async search(userId: string, params: FoodSearchParams): Promise<FoodDTO[]> {
    const supabase = createAdminSupabase();
    const q = params.query.trim();
    if (!q) return [];

    const limit = Math.min(Math.max(params.limit ?? FOOD_SEARCH_DEFAULT_LIMIT, 1), FOOD_SEARCH_MAX_LIMIT);

    // Candidate set: visible rows (global OR mine) matching FTS or trigram-similar name.
    // websearch_to_tsquery handles user phrasing ("greek yogurt", quoted terms) safely.
    // We over-fetch, then rank in JS for locale + custom-first ordering the SQL can't express cleanly.
    const overFetch = Math.min(limit * 4, 200);
    const { data, error } = await supabase
      .from('foods')
      .select('*')
      .or(`owner_id.is.null,owner_id.eq.${userId}`)
      .textSearch('search_vector', q, { type: 'websearch', config: 'simple' })
      .limit(overFetch);

    let rows = (data ?? []) as FoodRow[];

    // Fallback to trigram name match if FTS found nothing (typos / partial words).
    if (!error && rows.length === 0) {
      const { data: fuzzy } = await supabase
        .from('foods')
        .select('*')
        .or(`owner_id.is.null,owner_id.eq.${userId}`)
        .ilike('name', `%${q}%`)
        .limit(overFetch);
      rows = (fuzzy ?? []) as FoodRow[];
    }

    const lowerQ = q.toLowerCase();
    const ranked = rows
      .map((r) => ({ row: r, score: this.rankScore(r, lowerQ, userId, params.locale) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => this.toDTO(x.row));

    return ranked;
  }

  /** Exact barcode lookup against global reference rows. null when not found. */
  static async lookupBarcode(barcode: string): Promise<FoodDTO | null> {
    const supabase = createAdminSupabase();
    const code = barcode.trim();
    if (!code) return null;
    const { data } = await supabase
      .from('foods')
      .select('*')
      .eq('barcode', code)
      .is('owner_id', null)
      .limit(1)
      .maybeSingle();
    return data ? this.toDTO(data as FoodRow) : null;
  }

  /** Save a custom food (or recipe when recipeIngredients present) owned by the user. */
  static async createCustomFood(userId: string, input: CreateCustomFoodInput): Promise<FoodDTO> {
    const supabase = createAdminSupabase();
    const isRecipe = !!input.recipeIngredients && input.recipeIngredients.length > 0;
    const { data, error } = await supabase
      .from('foods')
      .insert({
        source: isRecipe ? 'recipe' : 'custom',
        owner_id: userId,
        name: input.name,
        brand: input.brand ?? null,
        serving_size_g: input.servingSizeG ?? null,
        serving_unit: input.servingUnit ?? null,
        calories_per_100g: input.per100g.calories,
        protein_per_100g: input.per100g.proteinG,
        carbs_per_100g: input.per100g.carbsG,
        fat_per_100g: input.per100g.fatG,
        fiber_per_100g: input.per100g.fiberG ?? null,
        sugar_per_100g: input.per100g.sugarG ?? null,
        recipe_ingredients: isRecipe
          ? input.recipeIngredients!.map((i) => ({ name: i.name, grams: i.grams, food_id: i.foodId }))
          : null,
        recipe_servings: isRecipe ? (input.recipeServings ?? 1) : null,
      })
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'create_failed');
    return this.toDTO(data as FoodRow);
  }

  /** The user's saved custom foods + recipes, newest first. */
  static async listCustomFoods(userId: string): Promise<FoodDTO[]> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('foods')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });
    return ((data ?? []) as FoodRow[]).map((r) => this.toDTO(r));
  }

  // ---- private --------------------------------------------------------------

  /** Relevance score: custom-first, exact/prefix boost, locale boost. Higher = better. */
  private static rankScore(r: FoodRow, lowerQ: string, userId: string, locale?: string): number {
    let s = 0;
    const name = (r.name ?? '').toLowerCase();
    if (name === lowerQ) s += 100; // exact name
    else if (name.startsWith(lowerQ)) s += 50; // prefix
    else if (name.includes(lowerQ)) s += 20; // substring
    if (r.owner_id === userId) s += 40; // the user's own foods rank above global ref
    if (locale && r.locale && r.locale === locale) s += 15; // region-biased ranking (§6.1)
    if (r.barcode) s += 2; // packaged items with a barcode are slightly more "real"
    return s;
  }

  private static toDTO(r: FoodRow): FoodDTO {
    return {
      id: r.id,
      source: r.source,
      name: r.name,
      brand: r.brand,
      barcode: r.barcode,
      servingSizeG: r.serving_size_g,
      servingUnit: r.serving_unit,
      per100g: {
        calories: r.calories_per_100g,
        proteinG: r.protein_per_100g,
        carbsG: r.carbs_per_100g,
        fatG: r.fat_per_100g,
        fiberG: r.fiber_per_100g,
        sugarG: r.sugar_per_100g,
      },
      locale: r.locale,
      isCustom: r.source === 'custom' || r.source === 'recipe',
    };
  }
}
