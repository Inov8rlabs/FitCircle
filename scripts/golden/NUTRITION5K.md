# Nutrition5k golden set

Adapter that turns Google's **Nutrition5k** dataset into our nutrition-eval golden set
(`GoldenRecord[]`, see `apps/web/app/lib/types/nutrition-eval.ts`).

Unlike the OFF starter (`off-starter.json` — one packaged item + label macros per record),
Nutrition5k is **real, kitchen-weighed, multi-ingredient plated meals** photographed on a
controlled overhead rig, with USDA-derived per-ingredient ground truth. That gives the eval honest
signal for Stage 1 (multi-item recall), Stage 2 (portion grams), and Stage 3 (total calories).

## License

Nutrition5k is released under **CC-BY-4.0** (commercial use OK; attribute Google Research).
Source: https://github.com/google-research-datasets/Nutrition5k

## Data layout (public, no auth)

Everything lives in the public GCS bucket `gs://nutrition5k_dataset/nutrition5k_dataset/`, also
reachable over plain HTTPS at `https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset/...`.

- **Metadata (small, ~2 MB each):**
  `metadata/dish_metadata_cafe1.csv`, `metadata/dish_metadata_cafe2.csv`
  Each row is one dish, variable length:
  `dish_id, total_calories, total_mass, total_fat, total_carb, total_protein,`
  then repeating groups of 7 per ingredient:
  `ingr_id, ingr_name, ingr_grams, ingr_calories, ingr_fat, ingr_carb, ingr_protein`.
  (Per-ingredient macro order is **fat, carb, protein**. The GitHub README mentions a `num_ingrs`
  column and "8 repeated fields" — the actual shipped CSV has neither; the parser anchors on the
  `ingr_...` id token, so it's robust to that.)
- **Imagery (large):** overhead RGB photo at
  `imagery/realsense_overhead/<dish_id>/rgb.png`.
  ~25-30% of dishes are side-angle-only and have **no** overhead `rgb.png` (HTTP 404).

### Public HTTPS works — no bulk download required

Both the metadata CSV **and** the overhead `rgb.png` images are individually reachable over HTTPS
(verified: `HTTP 200`, `image/png`). So the eval can fetch each `imageUri` on demand — you do **not**
need the multi-hundred-GB `gsutil` download just to run the eval. Use `--verify-images` so the golden
set only contains dishes whose overhead image actually exists.

## Generate the golden set

```bash
# From the repo root. Fetch metadata from the bucket, verify each overhead image is live,
# and write a 20-dish sample (drop the limit arg for the full set):
node scripts/generate-nutrition5k-golden.mjs \
  https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset/metadata/dish_metadata_cafe1.csv \
  scripts/golden/nutrition5k.json 20 --verify-images
```

Args (mirrors `generate-golden-set.mjs`): `<metadataCsvPathOrUrl> [outPath] [limit] [flags]`
- `outPath` default `scripts/golden/nutrition5k.json`
- `limit` default: all dishes (cafe1 is ~4.7k rows)
- `--verify-images` HEAD-check each overhead `rgb.png` and skip 404s (HTTPS mode only)
- `--imagery-dir=<path>` build local file paths instead of HTTPS URLs (see below)
- `--keep-deprecated` keep ingredients literally named `deprecated` (placeholders for retired
  ingredient IDs; dropped by default — their mass/macros still count toward the dish totals)

The generator skips dishes with no parseable ingredients or missing/zero totals, and logs counts.

### Optional: download imagery locally (only if you want offline / faster runs)

```bash
# Requires the gcloud SDK (gsutil). This is the LARGE download — only the overhead RGBs:
gsutil -m cp -r \
  gs://nutrition5k_dataset/nutrition5k_dataset/imagery/realsense_overhead \
  /data/nutrition5k/imagery/

# Then point the generator at local files (imageUri becomes <dir>/<dish_id>/rgb.png):
node scripts/generate-nutrition5k-golden.mjs ./dish_metadata_cafe1.csv \
  scripts/golden/nutrition5k.json 20 \
  --imagery-dir=/data/nutrition5k/imagery/realsense_overhead
```

You can also just download the metadata CSVs and pass a local path; imagery can still be HTTPS.

## Run the eval against it

```bash
AI_GATEWAY_API_KEY=... \
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
DATABASE_URL=... \
npx tsx scripts/run-nutrition-eval.mjs scripts/golden/nutrition5k.json
```

The runner pushes each `imageUri` through the live `parsePhoto` pipeline (needs `AI_GATEWAY_API_KEY`)
and does Stage-4 DB matching against a populated `foods` table (needs the Supabase env vars). It
prints the staged report and exits non-zero if any tracked metric is below `EVAL_THRESHOLDS`.

## Caveats / honesty notes

- **Cuisine is `western`.** Nutrition5k is US-cafeteria food — it does **not** cover the high-value
  South-Asian / Canadian weighed-meal slice (§6.11). Use it for multi-item / portion / total-calorie
  signal, not for cuisine coverage.
- `canonicalId` is always `null` (no mapping from Nutrition5k ingredient IDs to our `foods` table).
- `mealType` is a flat `lunch` and `lighting` is `good` (controlled rig) — no per-dish heuristic.
