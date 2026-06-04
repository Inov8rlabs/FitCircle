import { createAdminSupabase } from '../supabase-admin';

/**
 * FoodsLoaderService — populates the `foods` reference table from Open Food Facts (and, later,
 * USDA). PRD §7.3 (bulk-load OFF + USDA to Postgres) / §6.11 (cultural-cuisine wedge).
 *
 * Design notes:
 * - The FULL OFF dataset (~3M) is a multi-GB bulk import done out-of-band (the OFF JSONL/Parquet
 *   dump → COPY), not via this HTTP path. This service does the INCREMENTAL/targeted load the app
 *   can run itself: pull products by category/search (e.g. South-Asian + Canadian SKUs, the §6.11
 *   slices), transform to our per-100g schema, and batch-upsert idempotently on (source, source_id).
 * - Macros are stored PER 100g (OFF's *_100g fields), matching migration 055.
 * - All writes use the admin client; foods reference rows have owner_id NULL (global, visible to all).
 */

// The OFF nutriment field names we map (verified against the live API).
interface OffNutriments {
  'energy-kcal_100g'?: number;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
  fiber_100g?: number;
  sugars_100g?: number;
}
interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  serving_size?: string;
  countries_tags?: string[];
  nutriments?: OffNutriments;
  image_url?: string;
  image_front_url?: string;
}

// Our `foods` row shape for a global reference insert (owner_id NULL).
export interface FoodRefUpsert {
  source: 'off' | 'usda';
  source_id: string;
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
  image_url: string | null;
}

const UPSERT_BATCH = 500;

export class FoodsLoaderService {
  /** Map a raw OFF product to our reference row. Returns null if it lacks the minimum (name + a barcode + calories). */
  static transformOffProduct(p: OffProduct): FoodRefUpsert | null {
    const name = (p.product_name ?? '').trim();
    const code = (p.code ?? '').trim();
    const n = p.nutriments ?? {};
    if (!name || !code || n['energy-kcal_100g'] == null) return null;

    return {
      source: 'off',
      source_id: code,
      name,
      brand: (p.brands ?? '').split(',')[0]?.trim() || null,
      barcode: code,
      serving_size_g: this.parseServingGrams(p.serving_size),
      serving_unit: p.serving_size?.trim() || null,
      calories_per_100g: num(n['energy-kcal_100g']),
      protein_per_100g: num(n.proteins_100g),
      carbs_per_100g: num(n.carbohydrates_100g),
      fat_per_100g: num(n.fat_100g),
      fiber_per_100g: num(n.fiber_100g),
      sugar_per_100g: num(n.sugars_100g),
      locale: this.localeFromCountries(p.countries_tags),
      image_url: p.image_url || p.image_front_url || null,
    };
  }

  /**
   * Pull OFF products matching a search term (one page) and upsert them. Used by the cron to
   * incrementally enrich coverage for the §6.11 cuisine wedge (e.g. "biryani", "dal", "roti").
   * Returns {fetched, upserted}.
   */
  static async loadOffBySearch(term: string, pageSize = 100): Promise<{ fetched: number; upserted: number }> {
    const url =
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(term)}` +
      `&search_simple=1&action=process&json=1&page_size=${pageSize}` +
      `&fields=code,product_name,brands,serving_size,countries_tags,nutriments,image_url,image_front_url`;

    const res = await fetch(url, { headers: { 'User-Agent': 'FitCircle/1.0 (nutrition loader)' } });
    if (!res.ok) throw new Error(`OFF search failed: ${res.status}`);
    const body = (await res.json()) as { products?: OffProduct[] };
    const products = body.products ?? [];

    const rows = products.map((p) => this.transformOffProduct(p)).filter((r): r is FoodRefUpsert => r !== null);
    const upserted = await this.upsertRefRows(rows);
    return { fetched: products.length, upserted };
  }

  /** Batch-upsert reference rows idempotently on (source, source_id). Returns count upserted. */
  static async upsertRefRows(rows: FoodRefUpsert[]): Promise<number> {
    if (rows.length === 0) return 0;
    const supabase = createAdminSupabase();
    let total = 0;
    for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
      const batch = rows.slice(i, i + UPSERT_BATCH).map((r) => ({ ...r, owner_id: null }));
      const { error, count } = await supabase
        .from('foods')
        .upsert(batch, { onConflict: 'source,source_id', count: 'exact' });
      if (error) throw new Error(`foods upsert failed: ${error.message}`);
      total += count ?? batch.length;
    }
    return total;
  }

  // ---- helpers ---------------------------------------------------------------

  /** Extract grams from an OFF serving_size string like "0.333 PACKAGE (52 g)" or "30g". */
  private static parseServingGrams(serving?: string): number | null {
    if (!serving) return null;
    const m = serving.match(/(\d+(?:\.\d+)?)\s*g\b/i);
    return m ? Number(m[1]) : null;
  }

  /** Bias locale from OFF country tags toward our user base (Canada / UK / India), else null. */
  private static localeFromCountries(tags?: string[]): string | null {
    if (!tags?.length) return null;
    if (tags.includes('en:canada')) return 'en-CA';
    if (tags.includes('en:india')) return 'en-IN';
    if (tags.includes('en:united-kingdom')) return 'en-GB';
    if (tags.includes('en:united-states')) return 'en-US';
    return null;
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null;
}
