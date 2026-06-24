import { getPgPool } from '../db';
import { embedTexts, toVectorLiteral } from '../embeddings';

/**
 * Populates `foods.name_embedding`. Used by the incremental cron (/api/cron/embed-foods) and
 * the one-off bulk backfill (scripts/backfill-food-embeddings.ts). Embeds in batches and
 * writes via pg (the Supabase JS client can't write a vector column cleanly).
 */
export class FoodsEmbeddingService {
  /**
   * Embed the next `limit` un-embedded foods.
   * @returns embedded = rows embedded this call; remaining = un-embedded rows left
   *          (-1 when DATABASE_URL is unset / pg unavailable).
   */
  static async embedPendingBatch(limit = 256): Promise<{ embedded: number; remaining: number }> {
    const pool = getPgPool();
    if (!pool) return { embedded: 0, remaining: -1 };

    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `select id, name, coalesce(brand, '') as brand
           from public.foods
          where name_embedding is null
          limit $1`,
        [limit],
      );
      if (rows.length === 0) {
        return { embedded: 0, remaining: 0 };
      }

      // Embed "name brand" (brand is secondary signal, matching the FTS weighting).
      const texts = rows.map((r) => (r.brand ? `${r.name} ${r.brand}` : String(r.name)));
      const vectors = await embedTexts(texts);

      for (let i = 0; i < rows.length; i++) {
        await client.query(`update public.foods set name_embedding = $1::vector where id = $2`, [
          toVectorLiteral(vectors[i]),
          rows[i].id,
        ]);
      }

      const { rows: cnt } = await client.query(
        `select count(*)::int as c from public.foods where name_embedding is null`,
      );
      return { embedded: rows.length, remaining: cnt[0]?.c ?? 0 };
    } finally {
      client.release();
    }
  }
}
