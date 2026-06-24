# Getting the nutrition DB as good as (or better than) Cal AI

**TL;DR.** Cal AI's accuracy isn't a magic vision model — every app (incl. ours) uses an
off‑the‑shelf VLM that's only ~60% at food ID and *poor* at estimating macros from pixels.
The accuracy comes from the **nutrition database + how well you match foods to it + a
correction loop that fixes the tail.** So "beat Cal AI" = win on three levers: **matching,
coverage, and the correction flywheel.** We just wired the flywheel (see
`nutrition_training_samples` / `/api/mobile/food/training-sample`); this doc is the rest.

## The accuracy model

`P(correct macros) ≈ P(identify food) × P(match to the RIGHT DB row) × P(portion right)`

- The VLM owns `identify` + `portion` (and is mediocre at both — that's industry‑wide).
- The **DB owns the middle term**, which is where most of the *calorie* error actually
  comes from (matching "sour cream or yogurt" → `sour cream` doubled the calories in our
  own bug). Fix matching + coverage and accuracy jumps without touching the model.

## Where we are today

- `foods` table: **~1.875M USDA + ~149 OFF rows.** USDA is generic/raw‑ingredient heavy;
  **weak on branded, restaurant, and regional (esp. South‑Asian)** — exactly the long tail
  Cal AI covers well.
- Grounding (`FoodsService.search` → `groundItems`): FTS + pg_trgm + token‑Dice ≥ 0.6.
  Purely **lexical** — no semantic match, so "baingan" ↔ "eggplant" or "chana masala" ↔
  "chickpea curry" miss. Matching is our weakest link.
- We have an **eval harness** (`nutrition-eval.ts`, Nutrition5k baseline: identTop1 0.45,
  cal‑within‑±40% 0.50, **dbMatchCoverage 0.64**) — use it to gate every change below.

## Lever 1 — MATCHING (highest ROI, pure code, no new data) — ✅ IMPLEMENTED

Semantic retrieval is now built (gated OFF until backfilled + enabled):
- **Migration 068**: `pgvector` + `foods.name_embedding vector(1536)` + HNSW cosine index.
- **`lib/embeddings.ts`**: embeds food names via the AI Gateway (`openai/text-embedding-3-small`).
- **`FoodsEmbeddingService`** + **`/api/cron/embed-foods`** (weekly) keep new foods embedded;
  **`scripts/backfill-food-embeddings.ts`** does the one-off ~1.9M bulk backfill.
- **`FoodsSemanticService`**: KNN by cosine (`embedding <=> $1`) via raw parameterized SQL
  (`lib/db.ts` pg pool — no stored proc), scoped to global + the user's own foods.
- **`groundItems` → `pickBest`**: unions semantic KNN + lexical (FTS/trigram) candidates and
  re-ranks by `0.55·semantic + 0.45·dice + sourceBoost`; accepts on `semantic ≥ 0.5` OR
  `dice ≥ 0.6`. Falls back to lexical-only whenever semantic is unavailable.

This makes "baingan" match "eggplant" and stops wrong lexical matches (the "sour cream"
class). Thresholds (`SEMANTIC_FLOOR`/`LEXICAL_FLOOR`) are tunable — gate on the eval.

### Enablement runbook
1. Apply **migration 068** to the prod Supabase (`pgvector` must be allowed — it is on Supabase).
2. Ensure **`DATABASE_URL`** in Vercel is the **pooled** (transaction, port 6543) connstr.
3. Backfill: `AI_GATEWAY_API_KEY=… DATABASE_URL=… npx tsx scripts/backfill-food-embeddings.ts`
   (optionally drop the HNSW index first, then recreate after — faster bulk build).
4. Set **`NUTRITION_SEMANTIC_MATCH=true`** in Vercel.
5. Re-run the eval (`scripts/run-nutrition-eval.mjs`) and confirm `dbMatchCoverage` ↑; tune
   the floors if needed. The weekly cron keeps new foods embedded.

Cost: one-time embed of ~1.9M short names ≈ a few M tokens (~single-digit dollars) +
1 embed call per logged meal.

## Lever 2 — COVERAGE (data loading; where Cal AI is strong)

- **Branded:** load the **full Open Food Facts dump** (~3M+ products, many with barcodes +
  images). We loaded 149 OFF rows — this is the biggest packaged‑food gap. Reuse the
  existing `foods-loader` upsert pattern; run as an out‑of‑band bulk job
  (`NODE_OPTIONS=--max-old-space-size=…`).
- **Restaurant:** load published **chain menus** (major chains post full macros; there are
  ready datasets). Cal AI leans heavily on restaurant coverage.
- **Regional / South‑Asian:** load **IFCT (Indian Food Composition Tables)**, FoodBD
  (Bangladeshi), and regional recipe sources — the gap we flagged in the eval (south_asian
  dbMatch = 0).

Effort: **data engineering**, idempotent upserts on `(source, source_id)`, dedupe, locale
tags. No app changes.

## Lever 3 — THE CORRECTION FLYWHEEL (the durable moat — now wired)

The capture pipeline logs every confirm‑card correction: `(image, original AI draft,
final confirmed foods + grams, was_edited)`. Mine it three ways:
1. **Find DB gaps:** foods users frequently rename/correct → missing or mis‑matched rows.
   Prioritize adding/fixing exactly those (a ranked "most‑corrected foods" report).
2. **Promote verified foods:** a food name → macros pair that's confirmed many times becomes
   a high‑confidence `foods` row (source `custom`/`verified`) — perfect for regional/
   restaurant items absent from USDA/OFF.
3. **Train a small model later:** the `(image → labels)` pairs fine‑tune an open VLM
   (Qwen2.5‑VL‑7B via LoRA) for cost/latency — see the distillation plan. Accuracy still
   comes from the DB + this loop, not the model.

This is precisely how Cal AI got good: a correction loop at scale. We now have the DB +
eval + capture loop — the full machine.

> **Consent gate:** capture stores user meal photos for training. It's OFF by default
> (server `NUTRITION_TRAINING_CAPTURE` + client `Config.Features.nutritionTrainingCapture`).
> Update the privacy policy to cover training use (and ideally an in‑app opt‑in) before
> enabling.

## Recommended order

1. **Now:** turn on capture (with consent) → start collecting corrections.
2. **Next (best ROI, code only):** semantic matching (Lever 1) — accuracy win with zero new data.
3. **Then (coverage):** full OFF branded load → restaurant chains → IFCT/SA tables (Lever 2).
4. **Ongoing:** mine corrections → patch DB gaps + promote verified foods; **gate every
   change on the eval harness.** Define a target (e.g. *calories within ±20% on a weighed
   South‑Asian/Canadian set*) and drive the levers until you hit it.

Sources on Cal AI's approach and VLM food‑estimation limits are in the chat thread that
produced this doc (MyFitnessPal/Cal AI acquisition coverage; PMC comparative study of VLMs
for food ingredient recognition & nutrient estimation).
