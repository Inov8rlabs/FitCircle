# Food-photo AI: accuracy plan (2026-10-13)

Goal: materially better food identification, portion (grams) and calorie/macro precision from
`POST /api/mobile/food/photo-parse`, at equal or lower cost per parse. Nothing is off the table
(model, provider, open weights, post-training), but every change must be proven on an eval
before it ships.

## 1. Where we are

**Pipeline** (`apps/web/app/lib/services/nutrition-intelligence-service.ts`): one vision call
(`anthropic/claude-haiku-4.5`, fallback `google/gemini-3-flash`) returns items + grams + all
macros in one JSON object; each item is then "grounded" by name against the `foods` table
(lexical FTS/trigram; semantic KNN exists in code but pgvector/`name_embedding` are not in
prod), and the matched row's per-100 g panel replaces the model's macros.

**Measured accuracy.** The only recorded eval (docs/NUTRITION_DB_STRATEGY.md, ~Jun 2026,
20 Nutrition5k dishes): identTop1 **0.45**, kcal within ±40% **0.50**, dbMatchCoverage 0.64,
south-asian dbMatch **0**. No report has been saved since; the eval is not in CI.

**External evidence (2026).** A benchmark of ten VLMs on 3,229 Nutrition5k plates
(bioRxiv 2026.07.26.740845):

| Model | kcal CCC | kcal MAE | ingredient Jaccard | $/1k images |
|---|---|---|---|---|
| Gemini 3.0 Flash | **0.767** | **80.7** | – | – |
| GPT-5 Mini | 0.760 | – | – (6.6% unparseable) | – |
| Gemini 3.1 Flash-Lite | 0.754 | 82.5 | **0.655** | $0.59 |
| GPT-4o | 0.752 | – | – | $2.00 |
| Gemini 2.0 Flash | 0.742 | – | 0.621 | $0.10 |
| **Claude Haiku 4.5 (ours)** | – | – | **0.386 (lowest VLM)** | – |

Other findings we should design around: (a) the "estimate the portion actually visible, not a
standard serving" prompt gave +36% relative on within-±25% (we already do this); (b) two-pass
self-critique helped nothing; (c) the dominant failure modes are portion anchoring to canonical
servings, visually similar foods (yam/sweet potato), hidden fats/dressings, and partial
visibility; (d) weight MAE is 54–98 g and kcal MAPE 40–120% for *every* zero-shot model — the
ceiling for "ask a VLM for a number" is low, so grounding + priors + feedback data are where the
remaining gains are. Separately, a frozen-MLLM + small geometry head (DINOv2) cut per-food
portion error 33–41% (arXiv 2607.16514), and fine-tuned food VLMs reach ~28–43 kcal MAE on
Nutrition5k vs ~80 zero-shot.

**Structural problems found in our stack (bigger than the model):**

1. `foods` is 1.875M rows, ~97% USDA *Branded* plus lab sample/sub-sample rows. The generic
   foods a photo actually shows (FNDDS 5.4k, SR Legacy 7.8k, Foundation 469 — of which only
   135 loaded because Foundation reports energy as nutrient 2047/2048, not 1008) are drowned.
   Grounding "chicken tikka" lands on a branded frozen entrée; a wrong grounding is *worse*
   than the model's own number and is invisible to the user.
2. No portion weights. `food_portion.csv` (47k rows, 15k foods: "1 cup cooked rice = 158 g")
   is never loaded; `resolveItemPortion` treats a cup as 240 g for every food (water density).
3. Grounding acceptance is a token-Dice ≥ 0.6 floor — "sour cream or yogurt" → "sour cream".
4. No production accuracy signal. `POST /api/mobile/food-log`'s Zod schema drops
   `input_method`, `nutrition_source`, `llm_confidence`, `food_id` (nothing in prod has
   `input_method='photo'`); the draft-vs-final capture (`nutrition_training_samples`,
   `NUTRITION_TRAINING_CAPTURE`) exists but is off on server, iOS and Android.
5. Eval gaps: Stage 3 scores calories only (macros ignored), Stage 4 uses lexical search not
   the real `groundItems`, golden set is 20 western cafeteria plates + 67 packaged items, no
   South-Asian/home-cooked set, nothing persisted or gated in CI.

**Volume and cost today:** 95 parses ever, 35 in the last 30 days (2 users). Cost is irrelevant
now; it matters at launch scale. Estimated per parse (≈1.5k image + 0.9k prompt tokens in,
1.2k out): Haiku 4.5 **$0.0084**.

## 2. Decision

Do it in three phases, each gated by the eval. Phase 1 is model-agnostic engineering that lifts
accuracy whichever model wins; Phase 2 is the data flywheel that makes Phase 3 (post-training)
possible and cheap.

### Phase 0 — Measure (≈1 week)

1. **Golden set v2.** 300 Nutrition5k overhead dishes (stratified by ingredient count and
   kcal; streamed over HTTPS, no bulk download) + **~80 home-cooked plates we weigh
   ourselves** (South-Asian, Canadian/Western, mixed bowls, restaurant takeout; kitchen scale,
   phone camera at a natural angle — Nutrition5k is a controlled overhead rig and is *not*
   what our users shoot). This set needs Ani; it is the single highest-value input.
2. **Eval harness upgrades** (`nutrition-eval.ts`, `nutrition-eval-runner.ts`):
   - score protein/carbs/fat MAPE, not only kcal; add per-item grams MAE and plate kcal MAE;
   - Stage 4 runs the real `groundItems`/`pickBest` path and scores *grounding correctness*
     (matched row's kcal/100 g within ±20% of truth density), not just "found a row";
   - bake-off mode: `NUTRITION_VISION_MODEL` override, bypass cache/quota, record model,
     latency p50/p95, tokens, $ and schema-failure rate; persist reports to
     `scripts/golden/reports/<date>-<model>.json`;
   - prompt-variant flag so prompts are evaluated the same way as models.
3. **Bake-off** on the Vercel AI Gateway (all available today, no new vendor contracts):
   `google/gemini-3-flash`, `google/gemini-3.1-flash-lite`, `google/gemini-3.8-flash`,
   `google/gemini-3.5-flash`, `anthropic/claude-haiku-5.5`, `openai/gpt-5.4-mini`,
   `alibaba/qwen3-vl-instruct`, `google/gemma-4-31b-it`, plus `claude-haiku-4.5` (baseline)
   and `claude-sonnet-5.5` (quality ceiling). ~380 images × 10 models ≈ 3.8k calls ≈ $20.
4. **Turn on the production signal** (ships with Phase 0): persist provenance on create, enable
   `NUTRITION_TRAINING_CAPTURE` + the two app flags, and add `draft_edited`,
   `items_added/removed/renamed`, `kcal_delta_pct`, `parse_latency_ms`, `model` to
   `Meal Photo Analyzed` / `Meal Logged`. From then on we have a real edit-rate KPI
   (PRD target: < 20% photo edits, 80% accepted without edits).

### Phase 1 — Pipeline (≈2 weeks, model-agnostic)

1. **Swap the primary** to the bake-off winner; keep a *different vendor* as fallback. Expected
   winner on the evidence: Gemini 3-Flash or 3.1 Flash-Lite (best kcal and best ingredient
   recall at $0.0024–0.0048/parse). Haiku 5.5 ($0.0009) is the wildcard — strong on
   Roboflow identification (83–87%) but unbenchmarked on food.
2. **Split the job: vision estimates *what and how much*; the DB supplies *nutrient density*.**
   The model is asked for items, grams, preparation (fried/ghee/dressed), a one-line
   `visibleCues` per item (plate fraction, container, scale reference) and a
   `hiddenAdditions[]` (oil, butter, dressing — stated, low-confidence, user-deletable). The
   model's own macros become the fallback only.
3. **Curated generic food layer.** Add `foods_generic` (FNDDS + SR Legacy + Foundation,
   ~13.7k rows; fix the Foundation energy nutrient) with `food_portions` (47k unit weights)
   and household-measure densities. Grounding searches generic first; branded only when the
   user names a brand or scans a barcode. Add IFCT (Indian Food Composition Tables) for the
   South-Asian slice.
4. **Candidate-constrained grounding.** Replace the Dice floor with: retrieve top-8 (FTS +
   trigram + pgvector once migration 068 is restored), then a cheap text call
   (Haiku 5.5 / Flash-Lite, ~$0.0003) picks the row *or says "none"* given the item's name,
   preparation and cues. Eliminates silent wrong-row grounding.
5. **Portion priors.** Use `food_portions` to clamp `gramsPerUnit` per food (a "cup" of rice is
   158 g, of raw spinach 30 g); plate-level sanity (total grams vs plate size cue); keep the
   validated "visible portion, round down" rule.
6. **Conditional second opinion.** For `overallConfidence < 0.6` or `items ≥ 5`, run the
   fallback model in parallel and take per-item median grams (both results agree on the
   item set via the grounding step). Adds ~$0.002 on ~25% of plates. Self-critique passes
   are *not* used (shown to be useless).
7. **Personal memory.** The user's confirmed foods/recipes and recent corrections become
   priority candidates and few-shot examples ("Ani's dal = 180 g bowl, tempered in ghee").

Expected per-parse cost after Phase 1: **≈$0.004–0.006 blended** (vs $0.0084 today) with
p95 well under the current 28 s primary timeout.

### Phase 2 — Data flywheel → post-training (month 2+, gated on data)

- Every confirmed photo log produces a (image, draft, final) sample. At **≥1.5–2k confirmed
  samples** (plus the 3.5k Nutrition5k overhead dishes and our weighed set), run
  **Vertex AI supervised tuning on Gemini Flash-Lite / 3.5 Flash** (image inputs are
  supported; the tuned model serves at base-model price; no GPUs to run). Call it directly via
  `@ai-sdk/google-vertex` (the gateway can't route tuned models); the gateway model stays as
  fallback. Train on *what + grams* only — nutrient density stays in the DB.
- **Open-weight LoRA (Qwen3-VL / Gemma 4)** is the right call only if volume justifies a
  dedicated GPU: serverless LoRA serving isn't offered, so it costs $3–8/GPU-hour regardless
  of traffic. Revisit above ~50k parses/month; OpenRouter does not host custom weights.
- **Geometry head** (frozen DINOv2 + small portion net on top of the frozen VLM) is the most
  promising research path for grams (−33–41%) and would run on CPU/Vercel; it needs the
  weighed set and ~2 weeks of R&D. Park until Phase 1 numbers are in.

## 3. Targets (eval gates, replacing the "aspirational" §8.3 ones)

| Metric | Baseline (Jun) | Phase 1 gate | Phase 2 goal |
|---|---|---|---|
| identTop1 | 0.45 | ≥ 0.80 | ≥ 0.90 |
| multiItemRecall | – | ≥ 0.80 | ≥ 0.90 |
| hallucinationRate | – | ≤ 0.05 | ≤ 0.03 |
| portion MAPE (grams) | – | ≤ 0.35 | ≤ 0.25 |
| plate kcal within ±25% | – | ≥ 0.55 | ≥ 0.70 |
| plate kcal within ±40% | 0.50 | ≥ 0.85 | ≥ 0.92 |
| grounding correctness | – | ≥ 0.90 of grounded items | ≥ 0.95 |
| south_asian slice identTop1 | 0 dbMatch | ≥ 0.75 | ≥ 0.85 |
| production photo edit rate | unknown | measured | < 20% |
| cost / parse | $0.0084 | ≤ $0.006 | ≤ $0.005 |
| p95 latency | ~? (28 s timeout) | ≤ 8 s | ≤ 6 s |

## 3a. Phase 0 results (2026-10-14)

Eval harness v2 (macros, grams MAE, grounding correctness, semantic name matching, bake-off
mode, persisted reports in `scripts/golden/reports/`) run over two golden sets through the
real pipeline (model → DB grounding), with client-parity 1568 px images:

- **nutrition5k-v2**: 299 kitchen-weighed cafeteria plates, overhead rig, ~8.5 ingredients each.
- **snapme-v1**: 200 free-living smartphone meal photos (USDA SNAPMe) with ASA24 food records;
  includes a 20-plate South-Asian slice. Truth = consumed amount, so a small downward bias.

| model | N5k ident | N5k kcal ±40% | N5k kcal MAPE | SNAPMe ident | SNAPMe recall | SNAPMe kcal ±40% | SNAPMe kcal MAPE | S-Asian kcal ±40% | fail | p50 | $/parse |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **google/gemini-3.8-flash** | **86%** | **64%** | **47%** | 74% | 64% | 61% | 61% | 75% | 0–1% | 4.5–5.3 s | $0.0031–0.0037 |
| anthropic/claude-sonnet-5.5 | 89% | 60% | 57% | **79%** | **70%** | **62%** | **51%** | **85%** | 1–3% | 4.6–5.1 s | $0.0119 |
| google/gemini-3.1-flash-lite | 87% | 58% | 67% | 74% | 63% | 55% | 67% | 65% | 0–1% | **2.1–2.4 s** | $0.0010–0.0012 |
| anthropic/claude-haiku-5.5 | 86% | 47% | 85% | 75% | 63% | 55% | 56% | 50% | 0–1% | 2.7–2.9 s | **$0.0006** |
| openai/gpt-5.4-mini | 79% | 55% | 72% | 72% | 56% | 53% | 76% | 58% | 2–6% | 4.3–4.8 s (p95 15 s) | $0.0027 |
| google/gemini-3-flash (prod fallback) | 66% | 43% | 71% | 58% | 51% | 44% | 71% | 45% | 4–5% | 2.7–3.9 s | $0.0021–0.0026 |
| **anthropic/claude-haiku-4.5 (prod primary)** | 61% | 42% | 102% | 59% | 46% | 50% | 90% | 55% | 2–4% | 3.0–4.1 s | $0.0050–0.0052 |
| google/gemma-4-31b-it | 80% | 27% | 80% | 71% | 56% | 24% | 105% | 25% | 0–1% | 3.3–3.9 s | $0.0002 |
| alibaba/qwen3-vl-instruct | – | – | – | – | – | – | – | – | 100% (gateway timeouts) | – | – |
| google/gemini-3.5-flash | – | – | – | – | – | – | – | – | 58% (runaway decimals, 14 s) | – | $0.02 |

**Findings**
1. The production primary (Haiku 4.5) is last or second-last on every quality metric and the
   second most expensive. Gemini 3.8 Flash roughly halves the calorie error at 30% less cost.
2. Sonnet 5.5 is the quality ceiling on real phone photos and the South-Asian slice but costs 3×;
   it is the right *escalation* model for low-confidence plates, not the default.
3. Three bugs that silently cost parses in production today, all fixed in this change:
   Gemini (our fallback) emits runaway decimal expansions in native structured-output mode
   until the token cap — 5–60% of calls depending on model; OpenAI models 400 on our schema in
   strict mode; near-miss JSON (bare arrays, `foodName`) was discarded instead of repaired.
   Gemini 3.5+ also rejects `thinkingLevel: minimal`.
4. DB grounding is net-negative as built: of grounded items that match a truth item, only
   37–50% land within ±20% of the true nutrient density, across every model. Phase 1's
   generic-foods layer + candidate-constrained matching is the biggest remaining lever.
5. Calorie error is plate-size dependent: on Gemini 3.8 Flash, <150 kcal plates read +7%,
   400–700 kcal plates −31% and 700+ kcal plates −47%. The "when torn, choose the smaller
   portion" prompt rule over-corrects on big plates; Phase 1 replaces it with scale cues.
6. Nutrition5k "recall" is mostly a granularity artefact (salt, olive oil, garlic, vinegar,
   lemon juice are the most-missed "items"); SNAPMe recall (56–70%) is the honest number.

**Decision**: promote `google/gemini-3.8-flash` to primary and `anthropic/claude-haiku-5.5`
to fallback (different vendor, 0–1% failures, 2.7 s, $0.0006) via `NUTRITION_VISION_MODEL`
/ `NUTRITION_FALLBACK_MODEL` once this change is deployed; keep Sonnet 5.5 for Phase 1's
conditional second opinion. Expected: kcal within ±40% from ~45% → ~62%, cost −30%.

## 3b. Second screen — Qwen, Kimi, GLM, DeepSeek, StepFun (2026-10-14)

Asked after §3a: the first bake-off had no Kimi or GLM and only the oldest Qwen slug
(`qwen3-vl-instruct`, 100% timeouts). Nine current vision models from those vendors were run on
the **first 100 plates of nutrition5k-v2** (same pipeline, grounding and scorer); the §3a
reference models were re-scored on the same subset for a fair bar.

| model | fail | ident | recall | kcal ±40% | kcal MAPE | kcal bias | p50 / p95 | $/parse |
|---|---|---|---|---|---|---|---|---|
| **google/gemini-3.8-flash** (reference) | 3% | 88% | 42% | **68%** | **44%** | +1% | 5.7 / 8.8 s | $0.0039 |
| anthropic/claude-sonnet-5.5 (reference) | 1% | 91% | 45% | 62% | 54% | +29% | 5.6 / 7.6 s | $0.0126 |
| deepseek/deepseek-v4.1-flash | 0% | 78% | 35% | 56% | 65% | +22% | 3.0 / 9.2 s | $0.0008 |
| google/gemini-3.1-flash-lite (reference) | 1% | 84% | 43% | 53% | 67% | +28% | 2.5 / 3.4 s | $0.0012 |
| moonshotai/kimi-k2.5 | 0% | 86% | 43% | 53% | 77% | +46% | 4.6 / 9.6 s | $0.0021 |
| moonshotai/kimi-k2.6 | 7% | 83% | 43% | 53% | 58% | +20% | 17.3 / 25.3 s | $0.0028 |
| alibaba/qwen3.7-flash | 0% | 86% | 40% | 52% | 72% | +49% | 8.4 / 12.7 s | $0.0001 |
| zai/glm-5.3-flash | 39% | 82% | 40% | 51% | 89% | +63% | 8.7 / 12.9 s | $0.0008 |
| alibaba/qwen3.8-flash | 2% | 84% | 40% | 51% | 70% | +34% | 10.4 / 15.2 s | $0.0004 |
| anthropic/claude-haiku-5.5 (reference) | 1% | 88% | 43% | 49% | 89% | +64% | 3.2 / 4.8 s | $0.0006 |
| alibaba/qwen3.8-27b | 43% | 70% | 31% | 49% | 104% | +81% | 10.9 / 26.5 s | $0.0023 |
| zai/glm-5v-turbo | 16% | 83% | 41% | 48% | 73% | +33% | 11.6 / 16.8 s | $0.0039 |
| stepfun/step-3.7-flash | 99% | – | – | – | – | – | – | – |

Not screened: Kimi K3 ($3/$15 per 1M tokens) and Qwen 3.8 Max ($2/$6) cost as much as or more
than Sonnet 5.5, so they cannot be a default model; Qwen 3.5/3.6 are superseded.

**Findings**
1. **Nothing beats Gemini 3.8 Flash.** The best challenger (DeepSeek V4.1 Flash, 56%) is 12
   points behind on calories and 10 points behind on identification. Every open-weight model
   over-estimates calories (bias +20% to +81%) where Gemini is unbiased on this subset. The §3a
   decision stands; **no full-set runs were spent on these models**.
2. The open-weight vendors cannot win on price either once latency is counted: Qwen 3.7 Flash is
   $0.0001/parse but 8.4 s median (3× Gemini 3.1 Flash-Lite at the same accuracy); Kimi K2.6,
   GLM and Qwen 27B exceed the 28 s abort on 7–43% of plates.
3. **These models reason by default**, which is why the §3a Qwen run "timed out": 2–3k thinking
   tokens per plate at 20–40 s, and Kimi spends the entire output budget thinking and returns
   nothing. Each vendor honours only its own switch through the gateway `providerOptions`:
   `alibaba`/`stepfun` → `enableThinking: false`; `moonshotai`/`zai`/`deepseek` →
   `thinking: { type: 'disabled' }`. GLM 5.3 Flash and StepFun ignore theirs under our prompt
   (GLM still spends ~1.4k reasoning tokens; StepFun emits 2 000 tokens of nothing), which is
   their failure rate above. `modelCallOptions` now sets the switch per vendor plus +4k headroom.
4. **Native `json_schema` breaks Qwen**: with our schema sent as `response_format`, Qwen 3.8
   Flash answered a bare `[]` (2 output tokens) on 33/100 plates. These vendors are now called in
   plain JSON mode (`PHOTO_OUTPUT_JSON_MODE`) with the exact response shape appended to the system
   prompt (`RESPONSE_SHAPE_PROMPT`); failures fell to 2/100. Gemini/OpenAI/Anthropic keep the
   native schema and the §3a numbers. Reports: `scripts/golden/reports/*-{alibaba,moonshotai,zai,deepseek,stepfun}_*.report.json`.

## 3c. Phase 1 results — grounding, portion prior, prompt (2026-10-14)

**Shipped data (prod):** migration 098 + `scripts/load-generic-foods.mjs`: 13,547 generic USDA
foods tagged (`data_type` fndds/sr_legacy/foundation, `category`, `sodium_per_100g`; Foundation
energy from the Atwater nutrients) and 36,611 household-measure weights in `food_portions`.

**Root cause of §3a finding 4.** The legacy grounding accepted any row sharing ≥60% of name
tokens from a table that is 99% branded products: "fresh banana" → *FRESH BANANA NUT MUFFIN*
(416 kcal/100 g), "cherry tomatoes" → a dried-tomato snack (346), "mixed salad greens" → a
branded salad kit (103). `NutritionGroundingService` replaces it: generic-only retrieval
(stemmed prefix FTS, state-word down-weighting, plain-row boost, the model's own `dbName` lookup
key), a Haiku 5.5 picker that chooses the row *or none* for the whole plate in one call
(lexical Dice ≥0.75 fallback), then the row's density / sodium / unit weights.

**Paired ablation** (same Gemini 3.8 Flash outputs, grounding re-applied offline; `rawItems` in
every eval case now makes this a standard report field `ablation.modelOnly`):

| variant | SNAPMe kcal ±40% | SNAPMe MAPE | SNAPMe bias | N5k kcal ±40% | N5k MAPE | N5k bias |
|---|---|---|---|---|---|---|
| model only (no grounding) | 62% | 41% | −7% | **69%** | **35%** | −5% |
| legacy grounding (§3a, separate run) | 61% | 61% | +22% | 64% | 55% | +15% |
| generic: DB density always | 61% | 41% | −3% | 63% | 38% | −4% |
| generic + USDA portion prior | 61% | 42% | −1% | 61% | 56% | +16% |
| **generic, density clamp ×2 (shipped)** | **63%** | **40%** | −3% | 68% | 37% | −4% |

Findings:
1. Generic grounding fixes *density*: 79–83% of grounded items now land within ±20% of the true
   kcal/100 g (legacy 37–50%); median item density error 5% vs the model's 7% (mean 18% vs 38%).
2. It does **not** fix *totals*, because the remaining error is portion size, and FNDDS "as
   eaten" rows carry fat the plate may not have (N5k is lean cafeteria food): replacing the
   density unconditionally costs 1–6 pts. **Decision: clamp mode** — keep the model's macros
   unless its density is >2× off the matched row (catches hallucinations: unmatched items had
   144% mean density error); the row still supplies provenance, sodium and unit weights.
3. The **USDA portion prior is off** (`NUTRITION_PORTION_PRIOR=true` to enable): USDA "cup" /
   "slice" weights are too ambiguous for mixed dishes (toast → 15 g, chopped-salad cup → 260 g)
   and cost 6 pts on N5k. Unit weights are still offered in the picker.
4. Model-only accuracy with Gemini 3.8 Flash is already far better than §3a's production
   figures suggested, because §3a numbers *included* the legacy grounding damage.

**Prompt** (same grounding, fresh runs): the `shrink` rules ("choose the SMALLER", "revise DOWN")
replaced by plate-coverage anchors and a symmetric sanity check — **promoted to production**.

| prompt | SNAPMe kcal ±40% | SNAPMe MAPE | SNAPMe bias | SNAPMe ±25% | N5k kcal ±40% | N5k MAPE | N5k bias | N5k ±25% |
|---|---|---|---|---|---|---|---|---|
| shrink (old production) | 61–63% | 41–42% | −2…−7% | 36–48% | 67% | 43% | +5% | 44% |
| **scale (new production)** | **66%** | **40%** | −2% | 47% | **69%** | **35%** | −3% | **48%** |
| shrink + hidden-fat rules | 65% | 39% | −4% | 47% | – | – | – | – |
| scale + hidden-fat rules | **68%** | **39%** | −1% | **50%** | 69% | 37% | +5% | 49% |

The hidden-fat rules help on real phone photos (SNAPMe +2 pts, bias −1%) but add fat that lean
cafeteria food does not have (N5k fat MAPE 82% → 94%, bias −3% → +5%, MAPE 35% → 37%), and did
not move SNAPMe fat MAPE (78% either way; that truth is self-reported). **Not promoted**: it
stays the `scale_fat` variant until the weighed home set or the production draft-vs-saved signal
says which population our users' plates resemble. Ensembling model totals (Gemini + Sonnet,
median of three, mean of four) was tested offline on the §3a runs and gives ≤2 pts: not pursued.

### Competitive position vs Cal AI (researched 2026-10-14)

What Cal AI does, from public sources: vision models from Anthropic and OpenAI routed by food
type, retrieval against a food database (MyFitnessPal's 20M-item branded/restaurant DB since the
acquisition), the iPhone depth sensor for portion volume, describe/barcode/label fallbacks and an
"AI edit" fix, results in <15 s, and a self-reported "90% on visible foods".

Independent accuracy evidence: the NIH/NIDDK metabolic-kitchen test (NUTRITION 2026, 102 weighed
meals, photos through MyFitnessPal, LoseIt!, Cal AI, Appediet) found **every app ~33% low on
calories (250–345 kcal/meal) and ~30 g/meal low on fat**; a competitor-run 60-meal test put Cal AI
at 14% calorie MAPE / 76% within ±20% / 18% MAPE on South-Asian food. App-store complaints centre
on sodium/fiber and occasional absurd values.

Where FitCircle stands on the closest protocol (weighed plates, Nutrition5k): **bias −3%, MAPE
35%**, versus the −33% bias measured for Cal AI's class. Depth sensing has not rescued them from
portion error, which is the dominant error for everyone.

**Head-to-head, identical photos (2026-10-14).** 30 SNAPMe plates (`scripts/golden/calai-headtohead-v1.json`;
photos 01–30) were logged in Cal AI from the camera roll (first answer, no fix/retake; numbers
transcribed from screenshots into `scripts/golden/calai-headtohead-v1-calai.csv`) and parsed by
FitCircle production (Gemini 3.8 Flash, scale prompt, clamp grounding). 26 plates had a Cal AI
result; both apps are scored on those 26 (`scripts/score-calai-headtohead.mjs --paired`):

| app | kcal ±25% | kcal ±40% | kcal MAPE | kcal bias | protein MAPE | carbs MAPE | fat MAPE |
|---|---|---|---|---|---|---|---|
| Cal AI | 31% | 54% | 41% | −4% | 39% | 43% | 51% |
| **FitCircle** | **46%** | **58%** | **32%** | −12% | **37%** | **33%** | **45%** |

By cuisine (kcal ±40%, Cal AI → FitCircle): South Asian 80% → 80%, western 60% → 50%,
Mediterranean 50% → 50%, East Asian 50% → 75%, Latin 0% → 33%. FitCircle is ahead on every
accuracy metric; Cal AI's smaller *signed* bias comes from larger errors that cancel (its MAPE is
9 pts worse). Both apps miss the same big plates (seafood spaghetti 924 kcal: 303 vs 391;
grilled chicken platter 848 kcal: 276 vs 312), so portion size on dense, piled plates remains the
shared frontier. 26 plates resolve a ~10-pt gap, not a 3-pt one; the four plates without a Cal AI
result (18, 23, 25, 30) can be added to the sheet later. Gaps to close on features: nutrition-label
scanning and a one-tap "fix" flow.

Reports: `scripts/golden/reports/*-ground_{generic,off,legacy}*.report.json`,
`*-scale-*.report.json`, `*-fat-*.report.json`.

## 4. Not doing

- Switching providers blindly without the bake-off (Haiku 4.5 → Gemini is likely right, but
  the prompt/schema interplay and the 6.6% parse-failure rate seen on GPT-5 Mini show why
  it must be measured with *our* schema).
- Self-critique / two-pass refinement (no measured gain).
- Hosting our own GPU inference at today's volume.
- Asking the model for nutrient density when a DB row is confidently known.

## 5. Sources

- VLM dietary-assessment benchmark, 10 models, Nutrition5k: https://www.biorxiv.org/content/10.64898/2026.07.26.740845v1
- Geometry-enhanced portion estimation for MLLMs: https://arxiv.org/abs/2607.16514
- Food-R1 (fine-tuned food VLM, CalorieBench-80K): https://arxiv.org/abs/2606.04986
- NutriBench (text meal descriptions; GPT-4o CoT 66.8%, fine-tuned Gemma2-27B 61.7%): https://arxiv.org/abs/2407.12843
- Nutrition5k (CC-BY-4.0): https://github.com/google-research-datasets/Nutrition5k
- Vertex AI supervised tuning for Gemini (image inputs): https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini-supervised-tuning
- Roboflow Vision Evals (Haiku 5.5 identification 83–87%): https://playground.roboflow.com/models/anthropic/claude-haiku-5-5
- Vercel AI Gateway model/price list as of 2026-10-13 (`/v1/models`).
