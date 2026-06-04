import { type FoodDTO } from '../types/foods';

/**
 * RestaurantFoodsService — restaurant/chain item lookup via Nutritionix (PRD §6.12).
 *
 * Dining-Out mode prefers a 3rd-party restaurant DB (branded/common items) where available,
 * falling back to photo estimation (already built) when nothing matches.
 *
 * ENV-GATED + FAILURE-ISOLATED: this only returns data when BOTH NUTRITIONIX_APP_ID and
 * NUTRITIONIX_API_KEY are set. Without keys (the default in dev/CI) it returns [] so the
 * caller transparently falls back to photo estimation. ANY error (network, non-200, parse,
 * rate limit) is swallowed and returns [] — a restaurant lookup must never break a request.
 *
 * NOTE: to actually return data you MUST provision Nutritionix credentials:
 *   NUTRITIONIX_APP_ID=...   NUTRITIONIX_API_KEY=...
 * (https://www.nutritionix.com/business/api). Results are shaped into the shared FoodDTO so
 * clients render them identically to foods-db / custom results.
 */
export class RestaurantFoodsService {
  private static readonly INSTANT_ENDPOINT =
    'https://trackapi.nutritionix.com/v2/search/instant';

  /**
   * Search Nutritionix's "instant" endpoint for branded + common restaurant items.
   * Returns [] when keys are absent or on any failure (the caller falls back to photo estimation).
   */
  static async searchRestaurantItem(query: string): Promise<FoodDTO[]> {
    const q = query.trim();
    if (!q) return [];

    const appId = process.env.NUTRITIONIX_APP_ID;
    const apiKey = process.env.NUTRITIONIX_API_KEY;
    // Env-gated: no keys → no external call, no data. Callers fall back to photo estimation.
    if (!appId || !apiKey) return [];

    try {
      const url = `${this.INSTANT_ENDPOINT}?query=${encodeURIComponent(q)}&branded=true&common=true`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'x-app-id': appId,
          'x-app-key': apiKey,
          'x-remote-user-id': '0',
        },
        // Don't let a slow 3rd party hang the request; short hard timeout.
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return [];

      const json: unknown = await res.json();
      const branded = this.asArray((json as any)?.branded);
      const common = this.asArray((json as any)?.common);

      return [...branded, ...common]
        .map((item) => this.toDTO(item))
        .filter((dto): dto is FoodDTO => dto !== null);
    } catch {
      // Failure-isolated: network error, timeout, non-JSON, rate limit — all → [].
      return [];
    }
  }

  // ---- private --------------------------------------------------------------

  private static asArray(v: unknown): any[] {
    return Array.isArray(v) ? v : [];
  }

  /**
   * Shape a Nutritionix instant-search item into a FoodDTO. The instant endpoint returns
   * name + brand + serving qty/unit but NOT per-100g macros (protein/carb/fat need the
   * /natural/nutrients detail call). We surface name/brand/serving; macros are null, so the
   * client can fetch detail by name or fall back to photo estimation.
   */
  private static toDTO(item: any): FoodDTO | null {
    const name: string | undefined = item?.food_name;
    if (!name || typeof name !== 'string') return null;

    const servingQty = this.num(item?.serving_qty);
    const servingUnit: string | null =
      typeof item?.serving_unit === 'string' ? item.serving_unit : null;

    return {
      // Synthetic, stable-ish id so clients can key the row; not a foods-table id.
      id: `nutritionix:${item?.nix_item_id ?? item?.tag_id ?? name}`,
      source: 'usda', // closest FoodSource value; restaurant items are external reference data
      name: item?.brand_name ? `${item.brand_name} ${name}` : name,
      brand: typeof item?.brand_name === 'string' ? item.brand_name : null,
      barcode: null,
      servingSizeG: null,
      servingUnit: servingUnit && servingQty != null ? `${servingQty} ${servingUnit}` : servingUnit,
      per100g: {
        calories: null,
        proteinG: null,
        carbsG: null,
        fatG: null,
        fiberG: null,
        sugarG: null,
      },
      locale: null,
      isCustom: false,
    };
  }

  private static num(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
}
