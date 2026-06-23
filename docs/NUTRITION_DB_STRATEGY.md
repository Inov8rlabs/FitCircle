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

## Lever 1 — MATCHING (highest ROI, pure code, no new data)

Replace/augment lexical matching with **semantic retrieval**:
1. Enable `pgvector`; add an `embedding` column to `foods`; embed every row's name(+brand)
   once (batch). Embeddings via the AI Gateway (`text-embedding-3-small`‑class) or a small
   local model.
2. At grounding time, embed each parsed item name and retrieve by **cosine similarity**,
   then **re‑rank** with a blend of: semantic score + lexical (current Dice) + locale +
   brand/restaurant signal + source priority (custom > restaurant > branded > generic).
3. **Brand/restaurant awareness:** if the photo or the user's note mentions a brand or
   restaurant, bias retrieval to that source.

Impact: directly lifts `dbMatchCoverage` and kills the wrong‑match calorie blowups.
Effort: **medium** (one‑time embed of ~1.9M rows + 1 embedding call per query item).

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
