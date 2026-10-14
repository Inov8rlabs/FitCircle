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

// `metaArg` may be a comma-separated list (e.g. both cafe CSVs) — rows are pooled.
const metaArg = positional[0];
const outPath = positional[1] || 'scripts/golden/nutrition5k.json';
const limit = positional[2] ? parseInt(positional[2], 10) : Infinity;
const verifyImages = flags.includes('--verify-images');
const keepDeprecated = flags.includes('--keep-deprecated');
const imageryDirFlag = flags.find((f) => f.startsWith('--imagery-dir='));
const imageryDir = imageryDirFlag ? imageryDirFlag.split('=').slice(1).join('=') : null;
// --sample=N: instead of "first N rows", draw a seeded, STRATIFIED sample of N dishes across
// difficulty × cuisine so the golden set isn't dominated by whatever the CSV lists first
// (the first rows are the earliest scans — mostly single-ingredient incremental plates).
const sampleFlag = flags.find((f) => f.startsWith('--sample='));
const sampleSize = sampleFlag ? parseInt(sampleFlag.split('=')[1], 10) : null;
const seedFlag = flags.find((f) => f.startsWith('--seed='));
const seed = seedFlag ? parseInt(seedFlag.split('=')[1], 10) : 20261013;
// --min-ingredients=N: drop incremental plates with fewer distinct ingredients (default 1).
const minIngrFlag = flags.find((f) => f.startsWith('--min-ingredients='));
const minIngredients = minIngrFlag ? parseInt(minIngrFlag.split('=')[1], 10) : 1;
const versionFlag = flags.find((f) => f.startsWith('--version='));
const DATASET_VERSION_OUT = versionFlag ? versionFlag.split('=')[1] : DATASET_VERSION;

// Deterministic PRNG (mulberry32) so a sample is reproducible from its seed.
function rng(s) {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Coarse cuisine tag from ingredient names. Nutrition5k is Google-cafeteria food, so this is a
// weak signal — but the cafeterias do serve curries, dal, naan, stir-fries, etc., and slicing on it
// is the only way to see whether South-Asian-style plates lag until we have a weighed set.
const CUISINE_KEYWORDS = [
  ['south_asian', /\b(curry|dal|daal|lentil|naan|paneer|tikka|masala|biryani|chana|chickpea curry|samosa|raita|korma|saag|tandoori|basmati)\b/i],
  ['east_asian', /\b(tofu|kimchi|edamame|teriyaki|soy|sesame|bok choy|miso|sushi|ramen|noodle|stir[- ]?fry|fried rice|dumpling|pho|curry paste)\b/i],
  ['latin', /\b(tortilla|salsa|guacamole|taco|burrito|black beans|pico|jalape|enchilada|carnitas|quesadilla|plantain)\b/i],
  // `olives` not `olive oil` — oil is a garnish on half the cafeteria plates.
  ['mediterranean', /\b(hummus|falafel|feta|tzatziki|pita|olives|kalamata|couscous|tabbouleh|shawarma)\b/i],
];
function cuisineFor(items) {
  const names = items.map((i) => i.name).join(' | ');
  for (const [tag, re] of CUISINE_KEYWORDS) if (re.test(names)) return tag;
  return 'western';
}

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
        // Honest slicing: Nutrition5k is US cafeteria food on a controlled overhead rig; the
        // cuisine tag is a coarse keyword guess from the ingredient list (see CUISINE_KEYWORDS).
        cuisine: cuisineFor(keptItems),
        mealType: 'lunch',
        difficulty: difficultyFor(keptItems.length),
        lighting: 'good',
      },
      datasetVersion: DATASET_VERSION_OUT,
    },
    dishId,
  };
}

async function main() {
  const sources = metaArg.split(',').map((s) => s.trim()).filter(Boolean);
  const lines = [];
  for (const src of sources) {
    console.log(`[generate-nutrition5k-golden] loading metadata: ${src}`);
    const text = await loadCsvText(src);
    const srcLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    console.log(`  ${srcLines.length} dish rows in metadata`);
    lines.push(...srcLines);
  }
  if (imageryDir) console.log(`  imageUri mode: LOCAL file paths under ${path.resolve(imageryDir)}`);
  else console.log(`  imageUri mode: public HTTPS overhead rgb.png${verifyImages ? ' (HEAD-verified)' : ''}`);

  let skippedNoIngr = 0, skippedZero = 0, skippedNoImage = 0, skippedFewIngr = 0, parsedOk = 0;

  // Parse everything first (cheap, local) so sampling sees the whole pool.
  const pool = [];
  const seenIds = new Set();
  for (const line of lines) {
    const fields = line.split(',').map((f) => f.trim());
    const out = parseRow(fields);
    if (!out) continue;
    if (out.skip === 'no_ingredients') { skippedNoIngr++; continue; }
    if (out.skip === 'zero_total') { skippedZero++; continue; }
    if (seenIds.has(out.dishId)) continue;
    seenIds.add(out.dishId);
    if (out.record.groundTruth.items.length < minIngredients) { skippedFewIngr++; continue; }
    pool.push(out.record);
  }
  console.log(`  ${pool.length} parseable dishes in the pool`);

  // Order the candidates: stratified seeded sample, or CSV order (legacy "first N").
  let candidates;
  if (sampleSize) {
    const rand = rng(seed);
    const shuffle = (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    };
    // Strata = difficulty × cuisine. Allocate proportionally, but guarantee every non-western
    // cuisine stratum at least min(its size, 8) so the slices have something to report on.
    const strata = new Map();
    for (const r of pool) {
      const k = `${r.slices.difficulty}|${r.slices.cuisine}`;
      if (!strata.has(k)) strata.set(k, []);
      strata.get(k).push(r);
    }
    const quotas = new Map();
    let allocated = 0;
    for (const [k, rs] of strata) {
      const share = Math.round((rs.length / pool.length) * sampleSize);
      const floor = k.endsWith('|western') ? 0 : Math.min(rs.length, 8);
      const q = Math.min(rs.length, Math.max(share, floor));
      quotas.set(k, q);
      allocated += q;
    }
    // Rebalance to hit sampleSize exactly (trim or top up the largest strata).
    const byLargest = [...strata.entries()].sort((a, b) => b[1].length - a[1].length);
    let diff = sampleSize - allocated;
    for (const [k, rs] of byLargest) {
      if (diff === 0) break;
      const q = quotas.get(k);
      const nq = Math.min(rs.length, Math.max(0, q + diff));
      diff -= nq - q;
      quotas.set(k, nq);
    }
    // Build the candidate list: the quota from each stratum first (shuffled), then the remainder
    // of each stratum as spares so a 404'd image can be replaced from the SAME stratum.
    candidates = [];
    const spares = [];
    for (const [k, rs] of strata) {
      const sh = shuffle(rs);
      const q = quotas.get(k);
      candidates.push(...sh.slice(0, q).map((r) => ({ r, k })));
      spares.push(...sh.slice(q).map((r) => ({ r, k })));
    }
    candidates = shuffle(candidates);
    candidates.spares = spares;
    console.log(`  stratified sample: ${candidates.length} dishes across ${strata.size} strata (seed ${seed})`);
  } else {
    candidates = pool.map((r) => ({ r, k: null }));
  }

  const records = [];
  const target = sampleSize ?? limit;
  const spareQueue = new Map(); // stratum -> spares
  for (const s of candidates.spares ?? []) {
    if (!spareQueue.has(s.k)) spareQueue.set(s.k, []);
    spareQueue.get(s.k).push(s.r);
  }
  const queue = [...candidates];
  while (queue.length && records.length < target) {
    const { r, k } = queue.shift();
    // Optionally verify the overhead image is actually reachable (HTTPS mode only).
    if (verifyImages && !imageryDir) {
      const ok = await imageExists(r.imageUri);
      if (!ok) {
        skippedNoImage++;
        const spare = k != null ? spareQueue.get(k)?.shift() : null;
        if (spare) queue.push({ r: spare, k });
        continue;
      }
    }
    parsedOk++;
    records.push(r);
    if (records.length % 50 === 0) console.log(`  ${records.length}/${target} verified`);
  }

  if (records.length === 0) {
    console.error('No GoldenRecords produced. Check the metadata path/URL and the CSV format.');
    process.exit(1);
  }

  mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  writeFileSync(path.resolve(outPath), JSON.stringify(records, null, 2));

  const byDifficulty = records.reduce((a, r) => ((a[r.slices.difficulty] = (a[r.slices.difficulty] || 0) + 1), a), {});
  const byCuisine = records.reduce((a, r) => ((a[r.slices.cuisine] = (a[r.slices.cuisine] || 0) + 1), a), {});
  const avgItems = round(records.reduce((s, r) => s + r.groundTruth.items.length, 0) / records.length);
  console.log(`\n[generate-nutrition5k-golden] wrote ${records.length} records to ${outPath}`);
  console.log(`  dataset_version=${DATASET_VERSION_OUT}  avg_ingredients_per_dish=${avgItems}`);
  console.log(`  by difficulty:`, byDifficulty);
  console.log(`  by cuisine:`, byCuisine);
  console.log(`  skipped: no_ingredients=${skippedNoIngr}  zero_total=${skippedZero}  few_ingredients=${skippedFewIngr}  image_404=${skippedNoImage}`);
  if (!verifyImages && !imageryDir) {
    console.log('  NOTE: ~25-30% of dishes have no overhead rgb.png (side-angle only). Re-run with');
    console.log('  --verify-images to HEAD-check and drop dead imageUris before running the eval.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
