#!/usr/bin/env node
/**
 * Load the GENERIC USDA foods layer (migration 098) from a FoodData Central CSV bundle:
 *
 *   1. Upsert FNDDS survey foods, SR Legacy and Foundation foods into `foods`
 *      (source='usda', source_id=fdc_id) with data_type, category, sodium and per-100 g macros.
 *      Foundation foods have no "Energy" (1008) row — their kcal comes from the Atwater
 *      nutrients (2048 specific, else 2047 general), which is why the original loader dropped
 *      300 of them.
 *   2. Upsert `food_portions` (USDA food_portion.csv household measures) for those rows, with a
 *      normalised unit label parsed from the FNDDS portion_description / SR modifier.
 *
 * Idempotent (upserts on (source, source_id) and (food_id, source_portion_id)); re-run freely.
 * Uses the Supabase REST API with the service role (the direct Postgres host is IPv6-only).
 *
 * Usage:
 *   node scripts/load-generic-foods.mjs <FoodData_Central_csv_dir> [--env=<file>] [--portions-only] [--dry-run]
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (from --env file or the process env).
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const envFile = args.find((a) => a.startsWith('--env='))?.slice(6);
const portionsOnly = args.includes('--portions-only');
const dryRun = args.includes('--dry-run');
if (!dir) {
  console.error('Usage: node scripts/load-generic-foods.mjs <FoodData_Central_csv_dir> [--env=<file>] [--portions-only] [--dry-run]');
  process.exit(2);
}
if (envFile && existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] != null) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (!/^\[.*\]$/.test(v)) process.env[m[1]] = v;
  }
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(2);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

// ---- CSV streaming (USDA fields are quoted, comma-separated, may contain newlines in quotes) --
function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
async function forEachCsv(file, fn) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    if (!line) continue;
    const cells = parseCsvLine(line);
    if (!header) { header = Object.fromEntries(cells.map((n, i) => [n.replace(/^﻿/, ''), i])); continue; }
    fn(header, cells);
  }
}
const num = (v) => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? null : n; };
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

// ---- 1. which fdc_ids are generic, and their categories ----------------------------------
const dataType = new Map(); // fdc_id -> 'fndds' | 'sr_legacy' | 'foundation'
const fnddsCat = new Map(); // fdc_id -> wweia category code
await forEachCsv(path.join(dir, 'survey_fndds_food.csv'), (h, c) => { dataType.set(c[h.fdc_id], 'fndds'); fnddsCat.set(c[h.fdc_id], c[h.wweia_category_code]); });
await forEachCsv(path.join(dir, 'sr_legacy_food.csv'), (h, c) => dataType.set(c[h.fdc_id], 'sr_legacy'));
await forEachCsv(path.join(dir, 'foundation_food.csv'), (h, c) => dataType.set(c[h.fdc_id], 'foundation'));
const wweia = new Map();
await forEachCsv(path.join(dir, 'wweia_food_category.csv'), (h, c) => wweia.set(c[h.wweia_food_category], c[h.wweia_food_category_description]));
const srCat = new Map();
await forEachCsv(path.join(dir, 'food_category.csv'), (h, c) => srCat.set(c[h.id], c[h.description]));

const foods = new Map(); // fdc_id -> row
await forEachCsv(path.join(dir, 'food.csv'), (h, c) => {
  const id = c[h.fdc_id];
  const t = dataType.get(id);
  if (!t) return;
  const category = t === 'fndds' ? wweia.get(fnddsCat.get(id)) ?? null : srCat.get(c[h.food_category_id]) ?? null;
  foods.set(id, { fdcId: id, name: c[h.description].trim(), dataType: t, category });
});
console.log(`[load-generic-foods] generic foods in bundle: ${foods.size}`);

// ---- 2. nutrients (per 100 g) ---------------------------------------------------------------
// 1008 Energy kcal; 2048/2047 Atwater specific/general kcal (Foundation); 1093 sodium mg.
const NUTR = { 1008: 'kcal', 2048: 'atwaterSpecific', 2047: 'atwaterGeneral', 1003: 'protein', 1005: 'carbs', 1004: 'fat', 1079: 'fiber', 2000: 'sugar', 1093: 'sodium' };
const nutrients = new Map();
if (!portionsOnly) {
  await forEachCsv(path.join(dir, 'food_nutrient.csv'), (h, c) => {
    const id = c[h.fdc_id];
    if (!foods.has(id)) return;
    const k = NUTR[c[h.nutrient_id]];
    if (!k) return;
    const m = nutrients.get(id) || {};
    m[k] = num(c[h.amount]);
    nutrients.set(id, m);
  });
}

// ---- 3. portions ------------------------------------------------------------------------------
// FNDDS rows: amount '', portion_description "1 cup" / "1 large" / "Quantity not specified".
// SR rows: amount "1.0", modifier "cup" / "cup, sliced" / "medium (7" to 7-7/8" long)".
const UNIT_ALIASES = {
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', tbs: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp',
  cup: 'cup', cups: 'cup', 'fl oz': 'fl oz', 'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz',
  oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', pound: 'lb',
  slice: 'slice', slices: 'slice', piece: 'piece', pieces: 'piece', each: 'piece', item: 'piece',
  serving: 'serving', small: 'small', medium: 'medium', large: 'large', 'extra small': 'extra small', 'extra large': 'extra large',
  ml: 'ml', milliliter: 'ml', liter: 'liter', g: 'g', gram: 'g',
};
function parsePortion(amountRaw, description, modifier) {
  let amount = num(amountRaw);
  let text = (description || '').trim();
  // FNDDS rows carry their portion CODE (e.g. "10205", "90000") in `modifier`; only SR rows put
  // the unit text there.
  const mod = /^\d+$/.test((modifier || '').trim()) ? '' : (modifier || '').trim();
  if (!text || text === 'Quantity not specified') {
    if (!mod) return { amount: amount ?? 1, unit: 'serving', description: text || null };
    text = mod;
  }
  // Leading quantity: "1 cup", "0.5 cup", "1/2 cup", "2 slices"
  const qm = text.match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?\s+(.*)$/);
  let rest = text;
  if (qm) {
    amount = amount ?? (qm[2] ? Number(qm[1]) / Number(qm[2]) : Number(qm[1]));
    rest = qm[3];
  }
  // Unit = first phrase before a comma / parenthesis, normalised; keep the full text as description.
  const head = rest.split(/[,(]/)[0].trim().toLowerCase().replace(/\s+/g, ' ');
  const twoWords = head.split(' ').slice(0, 2).join(' ');
  const unit = UNIT_ALIASES[head] ?? UNIT_ALIASES[twoWords] ?? UNIT_ALIASES[head.split(' ')[0]] ?? head.split(' ')[0] ?? 'serving';
  return { amount: amount ?? 1, unit: unit.slice(0, 40), description: text };
}
const portions = []; // {fdcId, sourcePortionId, seq, amount, unit, description, gramWeight}
await forEachCsv(path.join(dir, 'measure_unit.csv'), () => {}); // presence check only
await forEachCsv(path.join(dir, 'food_portion.csv'), (h, c) => {
  const id = c[h.fdc_id];
  if (!foods.has(id)) return;
  const grams = num(c[h.gram_weight]);
  if (!grams || grams <= 0) return;
  const p = parsePortion(c[h.amount], c[h.portion_description], c[h.modifier]);
  portions.push({ fdcId: id, sourcePortionId: c[h.id], seq: num(c[h.seq_num]), gramWeight: grams, ...p });
});
console.log(`[load-generic-foods] portions for generic foods: ${portions.length}`);

if (dryRun) {
  const sample = [...foods.values()].slice(0, 3).map((f) => ({ ...f, n: nutrients.get(f.fdcId) }));
  console.log(JSON.stringify(sample, null, 1));
  console.log(JSON.stringify(portions.slice(0, 6), null, 1));
  process.exit(0);
}

// ---- 4. upsert foods ---------------------------------------------------------------------------
const BATCH = 500;
let upserted = 0;
if (!portionsOnly) {
  const rows = [];
  for (const f of foods.values()) {
    const n = nutrients.get(f.fdcId) || {};
    const kcal = n.kcal ?? n.atwaterSpecific ?? n.atwaterGeneral ?? null;
    if (kcal == null) continue; // nothing to ground against
    rows.push({
      source: 'usda', source_id: f.fdcId, owner_id: null, name: f.name, brand: null, barcode: null,
      serving_size_g: null, serving_unit: null, locale: 'en-US', image_url: null,
      calories_per_100g: r2(kcal), protein_per_100g: r2(n.protein), carbs_per_100g: r2(n.carbs), fat_per_100g: r2(n.fat),
      fiber_per_100g: r2(n.fiber), sugar_per_100g: r2(n.sugar), sodium_per_100g: r2(n.sodium),
      data_type: f.dataType, category: f.category,
    });
  }
  console.log(`[load-generic-foods] upserting ${rows.length} foods …`);
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await sb.from('foods').upsert(rows.slice(i, i + BATCH), { onConflict: 'source,source_id' });
    if (error) { console.error('foods upsert failed at', i, error.message); process.exit(1); }
    upserted += Math.min(BATCH, rows.length - i);
    if (upserted % 5000 === 0) console.log(`  ${upserted}`);
  }
  console.log(`[load-generic-foods] foods upserted: ${upserted}`);
}

// ---- 5. map fdc_id -> foods.id, upsert portions ----------------------------------------------
const idByFdc = new Map();
const fdcIds = [...foods.keys()];
for (let i = 0; i < fdcIds.length; i += 400) {
  const { data, error } = await sb.from('foods').select('id, source_id').eq('source', 'usda').in('source_id', fdcIds.slice(i, i + 400));
  if (error) { console.error('foods lookup failed', error.message); process.exit(1); }
  for (const r of data) idByFdc.set(r.source_id, r.id);
}
const prows = portions.filter((p) => idByFdc.has(p.fdcId)).map((p) => ({
  food_id: idByFdc.get(p.fdcId), source_portion_id: p.sourcePortionId, seq_num: p.seq,
  amount: p.amount, unit: p.unit, description: p.description, gram_weight: p.gramWeight,
}));
console.log(`[load-generic-foods] upserting ${prows.length} portions …`);
let pn = 0;
for (let i = 0; i < prows.length; i += BATCH) {
  const { error } = await sb.from('food_portions').upsert(prows.slice(i, i + BATCH), { onConflict: 'food_id,source_portion_id' });
  if (error) { console.error('portions upsert failed at', i, error.message); process.exit(1); }
  pn += Math.min(BATCH, prows.length - i);
  if (pn % 10000 === 0) console.log(`  ${pn}`);
}
console.log(`[load-generic-foods] DONE — foods ${upserted}, portions ${pn}`);
