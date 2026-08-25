-- Semantic food matching (pgvector).
--
-- Lexical grounding (FTS + pg_trgm + token-Dice) misses when the AI's wording differs from
-- the DB row: "baingan" ↔ "eggplant", "chana masala" ↔ "chickpea curry", "sour cream or
-- yogurt" wrongly → "sour cream". We embed each food's name (+brand) into a vector and match
-- query items by COSINE nearest-neighbour, then re-rank (semantic + lexical + source) before
-- grounding macros. This directly lifts dbMatchCoverage and kills wrong-match calorie errors.
--
-- Embedding model: OpenAI text-embedding-3-small via the AI Gateway → 1536 dims (see
-- lib/embeddings.ts). Backfill is an out-of-band job (scripts/backfill-food-embeddings.ts);
-- new foods are embedded incrementally by the /api/cron/embed-foods cron. Until backfilled
-- AND NUTRITION_SEMANTIC_MATCH=true, grounding falls back to the existing lexical path.

create extension if not exists vector;

alter table public.foods add column if not exists name_embedding vector(1536);

-- HNSW index for fast approximate nearest-neighbour by cosine distance. It builds against
-- whatever is embedded so far and updates incrementally as the backfill fills rows in.
-- (For the big initial backfill you can DROP this first, backfill, then recreate for a
--  faster bulk build with a higher maintenance_work_mem.)
create index if not exists idx_foods_name_embedding_hnsw
  on public.foods using hnsw (name_embedding vector_cosine_ops);

-- Lets the backfill/cron find un-embedded rows cheaply.
create index if not exists idx_foods_embedding_pending
  on public.foods (id) where name_embedding is null;
