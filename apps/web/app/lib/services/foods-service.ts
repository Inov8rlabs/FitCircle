import { createAdminSupabase } from '../supabase-admin';
import type { DietType } from '../types/dietary-prefs';
import {
  type CreateCustomFoodInput,
  type FoodDTO,
  type FoodRow,
  type FoodSearchParams,
  FOOD_SEARCH_DEFAULT_LIMIT,
  FOOD_SEARCH_MAX_LIMIT,
} from '../types/foods';

import { DietaryPreferencesService } from './dietary-preferences-service';

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

    // Pref-aware ranking nudge (PRD §6.15). Fetch the user's diet/allergens and DEPRIORITIZE
    // (never hard-remove — a user may still want to log anything) foods whose name suggests a
    // conflict. Failure-isolated: if prefs can't be read, search behaves exactly as before.
    let prefPenalty: ((r: FoodRow) => number) | null = null;
    try {
      const prefs = await DietaryPreferencesService.getPrefs(userId);
      if (prefs.diet !== 'none' || prefs.allergens.length > 0) {
        prefPenalty = (r: FoodRow) => this.dietaryPenalty(r, prefs.diet, prefs.allergens);
      }
    } catch {
      prefPenalty = null;
    }

    const lowerQ = q.toLowerCase();
    const ranked = rows
      .map((r) => ({
        row: r,
        score: this.rankScore(r, lowerQ, userId, params.locale) - (prefPenalty ? prefPenalty(r) : 0),
      }))
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

  /**
   * Dietary-preference ranking NUDGE (PRD §6.15). Returns a non-negative penalty subtracted from
   * a row's relevance score so foods that conflict with the user's declared diet/allergens sink
   * toward the bottom of the results — but are NEVER removed (the user can still log anything).
   *
   * This is a deliberately lightweight NAME-token heuristic, not a nutrition-grade classifier:
   * it pushes down items whose name contains tokens that strongly suggest a conflict (e.g.
   * "chicken", "bacon", "fish" for vegetarian/vegan; the allergen word itself for an allergy).
   * Both diet conflicts and allergen matches contribute, so a doubly-conflicting item sinks more.
   */
  private static dietaryPenalty(r: FoodRow, diet: DietType, allergens: string[]): number {
    // Pad with spaces so single-word tokens match on word boundaries (avoids "ham" in "graham").
    const name = ` ${(r.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
    let penalty = 0;

    const hasAny = (tokens: readonly string[]) => tokens.some((t) => name.includes(` ${t} `));

    // Diet-conflict tokens. Each tier subsumes the broader animal-protein tokens it forbids.
    const MEAT = FoodsService.MEAT_TOKENS;
    const FISH = FoodsService.FISH_TOKENS;
    const ANIMAL = FoodsService.ANIMAL_PRODUCT_TOKENS; // dairy/egg/honey etc.
    const PORK = FoodsService.PORK_TOKENS;
    const GLUTEN = FoodsService.GLUTEN_TOKENS;

    switch (diet) {
      case 'vegetarian':
        if (hasAny(MEAT) || hasAny(FISH)) penalty += 60;
        break;
      case 'vegan':
        if (hasAny(MEAT) || hasAny(FISH) || hasAny(ANIMAL)) penalty += 60;
        break;
      case 'pescatarian':
        // Fish is fine; other meat is not.
        if (hasAny(MEAT)) penalty += 60;
        break;
      case 'halal':
      case 'kosher':
        // Pork/derived products are excluded under both (kosher also excludes shellfish).
        if (hasAny(PORK)) penalty += 60;
        if (diet === 'kosher' && hasAny(FoodsService.SHELLFISH_TOKENS)) penalty += 40;
        break;
      case 'gluten_free':
        if (hasAny(GLUTEN)) penalty += 60;
        break;
      case 'none':
        break;
    }

    // Allergen matches: push down any item whose name contains a declared allergen token
    // (word-boundary match against the normalized name).
    for (const a of allergens) {
      const tok = a.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (tok && name.includes(` ${tok} `)) penalty += 50;
    }

    return penalty;
  }

  // Name-token vocabularies for the §6.15 ranking nudge. Lowercase, matched as words within the
  // food name. Intentionally small/high-signal to minimize false positives.
  private static readonly MEAT_TOKENS = [
    'beef', 'pork', 'chicken', 'turkey', 'lamb', 'veal', 'bacon', 'ham', 'sausage', 'steak',
    'meat', 'meatball', 'pepperoni', 'salami', 'prosciutto', 'duck', 'venison', 'bison', 'goat',
    'hot dog', 'hotdog', 'chorizo', 'mutton', 'ribs', 'brisket', 'gelatin',
  ] as const;
  private static readonly FISH_TOKENS = [
    'fish', 'salmon', 'tuna', 'cod', 'shrimp', 'prawn', 'crab', 'lobster', 'anchovy', 'anchovies',
    'sardine', 'sardines', 'tilapia', 'halibut', 'mackerel', 'oyster', 'oysters', 'mussel',
    'mussels', 'clam', 'clams', 'scallop', 'scallops', 'squid', 'calamari', 'herring', 'trout',
    'seafood', 'shellfish',
  ] as const;
  private static readonly SHELLFISH_TOKENS = [
    'shrimp', 'prawn', 'crab', 'lobster', 'oyster', 'oysters', 'mussel', 'mussels', 'clam',
    'clams', 'scallop', 'scallops', 'shellfish',
  ] as const;
  private static readonly ANIMAL_PRODUCT_TOKENS = [
    'milk', 'cheese', 'butter', 'cream', 'yogurt', 'yoghurt', 'egg', 'eggs', 'honey', 'whey',
    'casein', 'ghee', 'gelatin',
  ] as const;
  private static readonly PORK_TOKENS = [
    'pork', 'bacon', 'ham', 'prosciutto', 'pepperoni', 'lard', 'chorizo', 'pancetta',
  ] as const;
  private static readonly GLUTEN_TOKENS = [
    'wheat', 'bread', 'pasta', 'flour', 'barley', 'rye', 'gluten', 'cracker', 'crackers',
    'cereal', 'noodle', 'noodles', 'bagel', 'croissant', 'tortilla', 'couscous', 'bulgur',
    'malt', 'breaded', 'biscuit', 'pastry', 'muffin',
  ] as const;

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
