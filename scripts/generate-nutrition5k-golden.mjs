#!/usr/bin/env node
/**
 * Generate a golden eval dataset (PRD §8.3) from Google's **Nutrition5k** dataset.
 *
 * Why this matters: the OFF starter set (generate-golden-set.mjs) is weak packaged-label truth —
 * one item per record, label macros, product photos. Nutrition5k is REAL, kitchen-weighed,
 * multi-ingredient plated meals shot on a controlled overhead rig with USDA-derived ground truth.
 * It gives the eval honest Stage-1 (multi-item recall), Stage-2 (portion grams), and Stage-3
 * (total-calorie) signal on actual food photos.
 *
 * Source: https://github.com/google-research-datasets/Nutrition5k (License: CC-BY-4.0, commercial OK).
 * Data: public GCS bucket gs://nutrition5k_dataset/nutrition5k_dataset/, also reachable over plain
 * HTTPS at https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset/...
 *
 * --- CSV format (verified against the live metadata, NOT the README) ---
 * Each ROW of metadata/dish_metadata_cafe{1,2}.csv is ONE dish, variable length:
 *   dish_id, total_calories, total_mass, total_fat, total_carb, total_protein,
 *   then repeating groups of 7 PER INGREDIENT:
 *     ingr_id, ingr_name, ingr_grams, ingr_calories, ingr_fat, ingr_carb, ingr_protein
 * NOTE the per-ingredient macro order is fat, carb, protein (NOT protein, carbs, fat). The README
 * mentions a `num_ingrs` column and "8 repeated fields" — the actual shipped CSV has NEITHER; rows
 * are 6 fixed fields + N*7. This parser keys off the literal `ingr_...` id token to find groups,
 * so it is robust to that discrepancy.
 *
 * --- Imagery ---
 * Overhead RGB photo:
 *   https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset/imagery/realsense_overhead/<dish_id>/rgb.png
 * ~25-30% of dishes are side-angle-only and have NO overhead rgb.png (HTTP 404). Pass --verify-images
 * to HEAD-check each and skip the misses so the golden set has no dead imageUris.
 *
 * Usage:
 *   node scripts/generate-nutrition5k-golden.mjs <metadataCsvPathOrUrl> [outPath] [limit]
 *   # default out: scripts/golden/nutrition5k.json
 *
 *   # Fetch metadata straight from the public bucket and verify each image is live:
 *   node scripts/generate-nutrition5k-golden.mjs \
 *     https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset/metadata/dish_metadata_cafe1.csv \
 *     scripts/golden/nutrition5k.json 20 --verify-images
 *
 *   # Use a local CSV + local imagery dir (build local file:// paths instead of HTTPS URLs):
 *   node scripts/generate-nutrition5k-golden.mjs ./dish_metadata_cafe1.csv scripts/golden/nutrition5k.json \
 *     --imagery-dir=/data/nutrition5k/imagery/realsense_overhead
 *
 * Flags:
 *   --verify-images          HEAD each candidate overhead rgb.png; skip dishes that 404 (HTTPS mode only).
 *   --imagery-dir=<path>     Build local file paths <dir>/<dish_id>/rgb.png instead of HTTPS URLs.
 *                            (Use after downloading imagery via gsutil — see scripts/golden/NUTRITION5K.md.)
 *   --keep-deprecated        Keep ingredients literally named "deprecated" (placeholder rows Google
 *                            left in for retired ingredient IDs). Dropped by default since they add
 *                            no name signal for Stage-1 matching; their mass/macros stay in the totals.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const GCS_BASE = 'https://storage.googleapis.com/nutrition5k_dataset/nutrition5k_dataset';
const OVERHEAD_BASE = `${GCS_BASE}/imagery/realsense_overhead`;
const DATASET_VERSION = 'nutrition5k-v1';

// ---- arg parsing (positional like the OFF script, plus a couple of flags) ----
const rawArgs = process.argv.slice(2);
const flags = rawArgs.filter((a) => a.startsWith('--'));
const positional = rawArgs.filter((a) => !a.startsWith('--'));

const metaArg = positional[0];
const outPath = positional[1] || 'scripts/golden/nutrition5k.json';
const limit = positional[2] ? parseInt(positional[2], 10) : Infinity;
const verifyImages = flags.includes('--verify-images');
const keepDeprecated = flags.includes('--keep-deprecated');
const imageryDirFlag = flags.find((f) => f.startsWith('--imagery-dir='));
const imageryDir = imageryDirFlag ? imageryDirFlag.split('=').slice(1).join('=') : null;

if (!metaArg) {
  console.error('Usage: node scripts/generate-nutrition5k-golden.mjs <metadataCsvPathOrUrl> [outPath] [limit] [--verify-images] [--imagery-dir=<path>]');
  process.exit(2);
}

const round = (n) => Math.round(n * 100) / 100;

// ---- load the metadata CSV (local file or HTTPS URL) ----
async function loadCsvText(src) {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Failed to fetch metadata CSV (${res.status}) from ${src}`);
    return await res.text();
  }
  const abs = path.resolve(src);
  if (!existsSync(abs)) throw new Error(`Metadata CSV not found: ${abs}`);
  return readFileSync(abs, 'utf8');
}

// ---- HEAD check whether an overhead rgb.png exists ----
async function imageExists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

// Build the imageUri for a dish: local file path (if --imagery-dir) else public HTTPS URL.
function imageUriFor(dishId) {
  if (imageryDir) return path.join(path.resolve(imageryDir), dishId, 'rgb.png');
  return `${OVERHEAD_BASE}/${dishId}/rgb.png`;
}

// difficulty by ingredient count: 1 -> easy, 2-4 -> medium, 5+ -> hard
function difficultyFor(n) {
  if (n <= 1) return 'easy';
  if (n <= 4) return 'medium';
  return 'hard';
}

/**
 * Parse ONE CSV row (already split into trimmed fields) into a GoldenRecord, or null if unparseable.
 * Fixed head: [dish_id, total_calories, total_mass, total_fat, total_carb, total_protein]
 * Then repeating 7-tuples: [ingr_id, ingr_name, ingr_grams, ingr_calories, ingr_fat, ingr_carb, ingr_protein]
 */
function parseRow(fields) {
  if (fields.length < 6) return null;
  const dishId = fields[0];
  if (!dishId || !dishId.startsWith('dish_')) return null;

  const totalCalories = Number(fields[1]);
  const totalMass = Number(fields[2]);
  const totalFat = Number(fields[3]);
  const totalCarb = Number(fields[4]);
  const totalProtein = Number(fields[5]);

  const items = [];
  // Walk the tail in groups of 7. We anchor each group on an `ingr_...` id token so a malformed
  // tail can't silently shift every subsequent column.
  let i = 6;
  while (i + 6 < fields.length + 1 && i < fields.length) {
    const ingrId = fields[i];
    if (!ingrId || !ingrId.startsWith('ingr_')) break; // not a clean group boundary -> stop
    const name = fields[i + 1];
    const grams = Number(fields[i + 2]);
    const calories = Number(fields[i + 3]);
    const fat = Number(fields[i + 4]);
    const carbs = Number(fields[i + 5]);
    const protein = Number(fields[i + 6]);
    if ([grams, calories, fat, carbs, protein].some((v) => Number.isNaN(v))) break;
    items.push({
      name,
      canonicalId: null, // expected foods-table match unknown for Nutrition5k ingredients
      grams: round(grams),
      calories: round(calories),
      protein: round(protein),
      carbs: round(carbs),
      fat: round(fat),
    });
    i += 7;
  }

  // Drop "deprecated" placeholder ingredients from the item list (their mass/macros remain folded
  // into the dish-level totals, which we report verbatim from the fixed head fields).
  const keptItems = keepDeprecated
    ? items
    : items.filter((it) => (it.name || '').toLowerCase().trim() !== 'deprecated');

  // skip dishes with no parseable ingredients or missing/zero dish totals
  if (items.length === 0) return { skip: 'no_ingredients', dishId };
  if (keptItems.length === 0) return { skip: 'no_ingredients', dishId };
  if (!Number.isFinite(totalCalories) || totalCalories <= 0 || !Number.isFinite(totalMass) || totalMass <= 0) {
    return { skip: 'zero_total', dishId };
  }

  return {
    record: {
      id: `nutrition5k:${dishId}`,
      imageUri: imageUriFor(dishId),
      provenance: 'nutrition5k',
      groundTruth: {
        items: keptItems,
        total: {
          calories: round(totalCalories),
          protein: round(totalProtein),
          carbs: round(totalCarb),
          fat: round(totalFat),
        },
      },
      slices: {
        // Honest slicing: Nutrition5k is US cafeteria food on a controlled overhead rig.
        cuisine: 'western',
        mealType: 'lunch',
        difficulty: difficultyFor(keptItems.length),
        lighting: 'good',
      },
      datasetVersion: DATASET_VERSION,
    },
    dishId,
  };
}

async function main() {
  console.log(`[generate-nutrition5k-golden] loading metadata: ${metaArg}`);
  const text = await loadCsvText(metaArg);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  console.log(`  ${lines.length} dish rows in metadata`);
  if (imageryDir) console.log(`  imageUri mode: LOCAL file paths under ${path.resolve(imageryDir)}`);
  else console.log(`  imageUri mode: public HTTPS overhead rgb.png${verifyImages ? ' (HEAD-verified)' : ''}`);

  const records = [];
  let skippedNoIngr = 0, skippedZero = 0, skippedNoImage = 0, parsedOk = 0;

  for (const line of lines) {
    if (records.length >= limit) break;
    const fields = line.split(',').map((f) => f.trim());
    const out = parseRow(fields);
    if (!out) continue;
    if (out.skip === 'no_ingredients') { skippedNoIngr++; continue; }
    if (out.skip === 'zero_total') { skippedZero++; continue; }

    // Optionally verify the overhead image is actually reachable (HTTPS mode only).
    if (verifyImages && !imageryDir) {
      const ok = await imageExists(out.record.imageUri);
      if (!ok) { skippedNoImage++; continue; }
    }

    parsedOk++;
    records.push(out.record);
  }

  if (records.length === 0) {
    console.error('No GoldenRecords produced. Check the metadata path/URL and the CSV format.');
    process.exit(1);
  }

  mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  writeFileSync(path.resolve(outPath), JSON.stringify(records, null, 2));

  const byDifficulty = records.reduce((a, r) => ((a[r.slices.difficulty] = (a[r.slices.difficulty] || 0) + 1), a), {});
  const avgItems = round(records.reduce((s, r) => s + r.groundTruth.items.length, 0) / records.length);
  console.log(`\n[generate-nutrition5k-golden] wrote ${records.length} records to ${outPath}`);
  console.log(`  dataset_version=${DATASET_VERSION}  avg_ingredients_per_dish=${avgItems}`);
  console.log(`  by difficulty:`, byDifficulty);
  console.log(`  skipped: no_ingredients=${skippedNoIngr}  zero_total=${skippedZero}  image_404=${skippedNoImage}`);
  if (!verifyImages && !imageryDir) {
    console.log('  NOTE: ~25-30% of dishes have no overhead rgb.png (side-angle only). Re-run with');
    console.log('  --verify-images to HEAD-check and drop dead imageUris before running the eval.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
