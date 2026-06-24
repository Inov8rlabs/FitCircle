import { getPgPool } from '../db';
import { embedTexts, toVectorLiteral } from '../embeddings';
import type { FoodDTO } from '../types/foods';

export interface SemanticCandidate {
  food: FoodDTO;
  /** Cosine similarity 0..1 (1 = identical). */
  semanticScore: number;
}

/**
 * Semantic (vector) candidate retrieval for food grounding. Embeds the AI's food labels and
 * finds the nearest `foods` rows by cosine similarity (pgvector HNSW), scoped to global rows +
 * the user's own custom foods. The caller re-ranks these (semantic + lexical + source) and
 * grounds macros.
 *
 * Gracefully OFF by default: returns null on disabled / no DATABASE_URL / embedding or query
 * failure / column-not-yet-present, so the existing lexical path keeps working unchanged.
 */
export class FoodsSemanticService {
  static get enabled(): boolean {
    return process.env.NUTRITION_SEMANTIC_MATCH === 'true' && !!process.env.DATABASE_URL;
  }

  /**
   * For each query name, return semantic KNN candidates (or null for that slot on failure).
   * One embedMany call for all names; one KNN query per name. Returns null overall when
   * semantic matching is unavailable so the caller falls back to lexical search.
   */
  static async searchMany(
    userId: string,
    names: string[],
    perQuery = 8,
  ): Promise<Array<SemanticCandidate[]> | null> {
    if (!this.enabled || names.length === 0) return null;
    const pool = getPgPool();
    if (!pool) return null;

    let vectors: number[][];
    try {
      vectors = await embedTexts(names);
    } catch (err) {
      console.error('[FoodsSemanticService] embedding failed → lexical fallback:', err);
      return null;
    }
    if (vectors.length !== names.length) return null;

    let client;
    try {
      client = await pool.connect();
    } catch (err) {
      console.error('[FoodsSemanticService] pg connect failed → lexical fallback:', err);
      return null;
    }

    try {
      const results: Array<SemanticCandidate[]> = [];
      for (const vec of vectors) {
        const lit = toVectorLiteral(vec);
        const res = await client.query(
          `select id, source, name, brand, barcode, serving_size_g, serving_unit,
                  calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
                  fiber_per_100g, sugar_per_100g, locale,
                  1 - (name_embedding <=> $1::vector) as semantic_score
             from public.foods
            where name_embedding is not null
              and (owner_id is null or owner_id = $2)
            order by name_embedding <=> $1::vector
            limit $3`,
          [lit, userId, perQuery],
        );
        results.push(
          res.rows.map((r) => ({ food: rowToFoodDTO(r), semanticScore: Number(r.semantic_score) })),
        );
      }
      return results;
    } catch (err) {
      // e.g. the column/extension isn't present yet (migration not applied) → fall back.
      console.error('[FoodsSemanticService] KNN query failed → lexical fallback:', err);
      return null;
    } finally {
      client.release();
    }
  }
}

/**
 * Map a raw pg row to FoodDTO. NOTE: node-pg returns `numeric` columns as STRINGS (to avoid
 * precision loss), so every per-100g / serving value must be coerced to a number — otherwise
 * the downstream macro arithmetic would NaN.
 */
function rowToFoodDTO(r: Record<string, unknown>): FoodDTO {
  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  return {
    id: String(r.id),
    source: r.source as FoodDTO['source'],
    name: String(r.name),
    brand: (r.brand as string | null) ?? null,
    barcode: (r.barcode as string | null) ?? null,
    servingSizeG: num(r.serving_size_g),
    servingUnit: (r.serving_unit as string | null) ?? null,
    per100g: {
      calories: num(r.calories_per_100g),
      proteinG: num(r.protein_per_100g),
      carbsG: num(r.carbs_per_100g),
      fatG: num(r.fat_per_100g),
      fiberG: num(r.fiber_per_100g),
      sugarG: num(r.sugar_per_100g),
    },
    locale: (r.locale as string | null) ?? null,
    isCustom: r.source === 'custom' || r.source === 'recipe',
  };
}
