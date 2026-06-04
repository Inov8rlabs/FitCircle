#!/usr/bin/env node
/**
 * Generate a STARTER golden eval dataset (PRD §8.3) from loaded Open Food Facts rows.
 *
 * This is the cheapest §8.3 ground-truth source — "packaged foods + their labels": the OFF row's
 * stored macros ARE the label truth, and image_url is the photo. It is NOT a substitute for the
 * self-collected, kitchen-weighed South-Asian/Canadian meals (the high-value set a human must
 * collect) — it exists so the eval RUNNER can run end-to-end against real images + real truth NOW,
 * and to cover the "packaged / barcode" slice.
 *
 * Picks OFF rows that have an image_url AND full macros, balanced across cuisine-ish slices by
 * locale + name heuristics, and writes a GoldenRecord[] JSON.
 *
 * Usage:
 *   node scripts/generate-golden-set.mjs [outPath] [perSlice]
 *   # default: scripts/golden/off-starter.json , 25 per slice
 * Env: DATABASE_URL (default local stack)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const outPath = process.argv[2] || 'scripts/golden/off-starter.json';
const perSlice = parseInt(process.argv[3] || '25', 10);
const DATASET_VERSION = 'off-starter-v1';

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

// Slice buckets. South-Asian + Canadian are first-class (§6.11); name-token heuristics tag cuisine
// since OFF has no cuisine field. Everything else falls to 'western'.
const SOUTH_ASIAN = ['biryani','dal','dahl','roti','naan','paneer','dosa','samosa','masala','curry','chana','tikka','idli','paratha'];
const CANADIAN = ['poutine','maple','butter tart','nanaimo','ketchup chip'];

function cuisineOf(name) {
  const n = (name || '').toLowerCase();
  if (SOUTH_ASIAN.some((t) => n.includes(t))) return 'south_asian';
  if (CANADIAN.some((t) => n.includes(t))) return 'canadian';
  return 'western';
}

// Macros stored per-100g; the golden truth uses a 100g reference serving so grams=100 and the
// per-100g macros ARE the totals. (parsePhoto estimates whole-item macros; for packaged label
// truth a 100g basis is the honest, unambiguous reference.)
function toGolden(row) {
  const grams = 100;
  const item = {
    name: row.name,
    canonicalId: row.id,                 // expected DB match (Stage 4) — it's literally this row
    grams,
    calories: Number(row.calories_per_100g) || 0,
    protein: Number(row.protein_per_100g) || 0,
    carbs: Number(row.carbs_per_100g) || 0,
    fat: Number(row.fat_per_100g) || 0,
  };
  return {
    id: `off:${row.source_id}`,
    imageUri: row.image_url,
    provenance: 'label',
    groundTruth: {
      items: [item],
      total: { calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat },
    },
    slices: {
      cuisine: cuisineOf(row.name),
      mealType: 'snack',       // packaged single items default to snack; unknown is fine for slicing
      difficulty: 'easy',      // single packaged item = easiest tier
      lighting: 'good',        // product photos are well-lit
    },
    datasetVersion: DATASET_VERSION,
  };
}

async function pickForCuisineTerms(terms, n) {
  // OFF rows with an image + full macros whose name matches any of the cuisine terms.
  const ilikes = terms.map((_, i) => `name ILIKE $${i + 1}`).join(' OR ');
  const params = terms.map((t) => `%${t}%`);
  const { rows } = await pool.query(
    `SELECT id, source_id, name, image_url, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g
     FROM foods
     WHERE source='off' AND image_url IS NOT NULL
       AND calories_per_100g IS NOT NULL AND protein_per_100g IS NOT NULL
       AND carbs_per_100g IS NOT NULL AND fat_per_100g IS NOT NULL
       AND (${ilikes})
     ORDER BY random() LIMIT $${terms.length + 1}`,
    [...params, n]
  );
  return rows;
}

async function pickGeneral(n) {
  const { rows } = await pool.query(
    `SELECT id, source_id, name, image_url, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g
     FROM foods
     WHERE source='off' AND image_url IS NOT NULL
       AND calories_per_100g IS NOT NULL AND protein_per_100g IS NOT NULL
       AND carbs_per_100g IS NOT NULL AND fat_per_100g IS NOT NULL
     ORDER BY random() LIMIT $1`,
    [n]
  );
  return rows;
}

async function main() {
  const seen = new Set();
  const records = [];
  const add = (rows) => { for (const r of rows) { if (!seen.has(r.id)) { seen.add(r.id); records.push(toGolden(r)); } } };

  add(await pickForCuisineTerms(SOUTH_ASIAN, perSlice));
  add(await pickForCuisineTerms(CANADIAN, perSlice));
  add(await pickGeneral(perSlice));

  if (records.length === 0) {
    console.error('No eligible OFF rows (need image_url + full macros). Run the loader/bulk import first.');
    process.exit(1);
  }

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(records, null, 2));
  const bySlice = records.reduce((a, r) => ((a[r.slices.cuisine] = (a[r.slices.cuisine] || 0) + 1), a), {});
  console.log(`[generate-golden-set] wrote ${records.length} records to ${outPath}`);
  console.log(`  by cuisine:`, bySlice, `| dataset_version=${DATASET_VERSION}`);
  console.log('  NOTE: this is the packaged-label starter slice. The high-value weighed South-Asian/');
  console.log('  Canadian meal set (§8.3) is human kitchen-scale collection — add those records to this file.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => pool.end());
