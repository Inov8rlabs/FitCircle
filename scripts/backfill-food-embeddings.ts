/**
 * One-off bulk backfill of foods.name_embedding for semantic food matching.
 *
 * Run (from FitCircleBE/):
 *   AI_GATEWAY_API_KEY=<vck_…> DATABASE_URL=<pooled supabase connstr> \
 *     npx tsx scripts/backfill-food-embeddings.ts
 *
 * Embeds every un-embedded row in batches until done. Idempotent + resumable (only rows
 * with name_embedding IS NULL are processed), so it's safe to stop and re-run. For ~1.9M
 * rows budget a while; the AI Gateway rate limit is the bottleneck, not Postgres.
 *
 * TIP for a faster build: DROP idx_foods_name_embedding_hnsw before the backfill, run this,
 * then recreate the index (bulk HNSW build with a high maintenance_work_mem is much faster
 * than incremental inserts).
 */
import { FoodsEmbeddingService } from '../apps/web/app/lib/services/foods-embedding-service';

const BATCH = Number(process.env.EMBED_BATCH ?? 512);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required (use the pooled Supabase connection string).');
    process.exit(1);
  }

  let total = 0;
  for (;;) {
    const { embedded, remaining } = await FoodsEmbeddingService.embedPendingBatch(BATCH);
    if (remaining === -1) {
      console.error('pg pool unavailable — check DATABASE_URL.');
      process.exit(1);
    }
    total += embedded;
    console.log(`embedded +${embedded} (total ${total}) — remaining ${remaining}`);
    if (embedded === 0 || remaining === 0) break;
  }

  console.log(`Done. Embedded ${total} foods.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
