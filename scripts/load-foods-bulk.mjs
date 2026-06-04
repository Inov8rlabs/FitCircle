#!/usr/bin/env node
/**
 * Bulk-load the foods reference table from Open Food Facts and/or USDA FoodData Central.
 * PRD v4 §7.3 (load OFF + USDA to Postgres). One-time / occasional ops job — NOT a serverless
 * cron (the OFF dump is ~50GB uncompressed; this STREAMS it, never loading it into memory).
 *
 * Idempotent: upserts on (source, source_id), so it's safe to re-run / resume after an interrupt.
 *
 * Usage:
 *   # Open Food Facts (download first — see steps in the script header / your runbook):
 *   node scripts/load-foods-bulk.mjs off /path/to/openfoodfacts-products.jsonl.gz
 *   # USDA FoodData Central (unzip the CSV bundle first, pass the extracted dir):
 *   node scripts/load-foods-bulk.mjs usda /path/to/FoodData_Central_csv_YYYY-MM-DD/
 *
 * Env:
 *   DATABASE_URL   Postgres connection (default: local supabase stack)
 *   LIMIT          optional cap on rows inserted (for a smoke test, e.g. LIMIT=5000)
 *   BATCH          upsert batch size (default 1000)
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
const BATCH = process.env.BATCH ? parseInt(process.env.BATCH, 10) : 1000;

const [, , source, inputPath] = process.argv;
if (!['off', 'usda'].includes(source) || !inputPath) {
  console.error('Usage: node scripts/load-foods-bulk.mjs <off|usda> <path>');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });

// ---- shared transform (mirrors apps/web/app/lib/services/foods-loader-service.ts) -----------
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function localeFromCountries(tags) {
  if (!Array.isArray(tags) || !tags.length) return null;
  if (tags.includes('en:canada')) return 'en-CA';
  if (tags.includes('en:india')) return 'en-IN';
  if (tags.includes('en:united-kingdom')) return 'en-GB';
  if (tags.includes('en:united-states')) return 'en-US';
  return null;
}
function parseServingGrams(serving) {
  if (!serving || typeof serving !== 'string') return null;
  const m = serving.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  return m ? Number(m[1]) : null;
}

function transformOff(p) {
  const name = (p.product_name ?? '').trim();
  const code = (p.code ?? '').trim();
  const n = p.nutriments ?? {};
  if (!name || !code || n['energy-kcal_100g'] == null) return null;
  return {
    source: 'off', source_id: code, name,
    brand: (p.brands ?? '').split(',')[0]?.trim() || null,
    barcode: code,
    serving_size_g: parseServingGrams(p.serving_size),
    serving_unit: (p.serving_size && p.serving_size.trim()) || null,
    calories_per_100g: num(n['energy-kcal_100g']),
    protein_per_100g: num(n.proteins_100g),
    carbs_per_100g: num(n.carbohydrates_100g),
    fat_per_100g: num(n.fat_100g),
    fiber_per_100g: num(n.fiber_100g),
    sugar_per_100g: num(n.sugars_100g),
    locale: localeFromCountries(p.countries_tags),
  };
}

// ---- batched idempotent upsert --------------------------------------------------------------
const COLS = ['source','source_id','name','brand','barcode','serving_size_g','serving_unit',
  'calories_per_100g','protein_per_100g','carbs_per_100g','fat_per_100g','fiber_per_100g','sugar_per_100g','locale'];

async function upsertBatch(rows) {
  if (!rows.length) return 0;
  const values = [];
  const params = [];
  let i = 1;
  for (const r of rows) {
    const ph = COLS.map(() => `$${i++}`);
    values.push(`(${ph.join(',')}, NULL)`); // trailing NULL = owner_id (global ref row)
    for (const c of COLS) params.push(r[c]);
  }
  const sql =
    `INSERT INTO foods (${COLS.join(',')}, owner_id) VALUES ${values.join(',')} ` +
    `ON CONFLICT (source, source_id) DO UPDATE SET ` +
    COLS.filter((c) => c !== 'source' && c !== 'source_id').map((c) => `${c}=EXCLUDED.${c}`).join(',') +
    `, updated_at=now()`;
  const res = await pool.query(sql, params);
  return res.rowCount ?? rows.length;
}

let total = 0;
let kept = 0;
let batch = [];
async function flush() {
  if (!batch.length) return;
  const b = batch; batch = [];
  await upsertBatch(b);
  kept += b.length;
  if (kept % (BATCH * 20) === 0) console.log(`  upserted ~${kept} (read ${total})`);
}

// ---- OFF: stream gunzip'd JSONL -------------------------------------------------------------
async function loadOff(file) {
  const rl = createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (kept >= LIMIT) break;
    if (!line.trim()) continue;
    total++;
    let p;
    try { p = JSON.parse(line); } catch { continue; } // skip malformed lines
    const row = transformOff(p);
    if (!row) continue;
    batch.push(row);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
}

// ---- USDA: join food.csv + branded_food.csv + food_nutrient.csv ------------------------------
// Minimal CSV parse (USDA fields are quoted, comma-separated). For a robust full load you may
// prefer Postgres \copy of the raw CSVs into staging tables; this is the streaming JS path.
const USDA_NUTRIENT = { energy: '1008', protein: '1003', carbs: '1005', fat: '1004', fiber: '1079', sugar: '2000' };
function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
async function loadUsda(dir) {
  // 1. food.csv → fdc_id -> description
  const desc = new Map();
  await forEachCsv(path.join(dir, 'food.csv'), (h, c) => {
    desc.set(c[h.fdc_id], c[h.description]);
  });
  // 2. branded_food.csv → fdc_id -> {gtin, brand, serving}
  const branded = new Map();
  try {
    await forEachCsv(path.join(dir, 'branded_food.csv'), (h, c) => {
      branded.set(c[h.fdc_id], { gtin: c[h.gtin_upc] || null, brand: c[h.brand_owner] || null,
        serving: c[h.serving_size] ? Number(c[h.serving_size]) : null });
    });
  } catch { /* Foundation/SR-only bundles have no branded_food.csv */ }
  // 3. food_nutrient.csv → fdc_id -> per-100g macros (USDA amounts are per 100g)
  const macros = new Map();
  const idToKey = Object.fromEntries(Object.entries(USDA_NUTRIENT).map(([k, v]) => [v, k]));
  await forEachCsv(path.join(dir, 'food_nutrient.csv'), (h, c) => {
    const key = idToKey[c[h.nutrient_id]];
    if (!key) return;
    const id = c[h.fdc_id];
    const m = macros.get(id) || {};
    m[key] = Number(c[h.amount]);
    macros.set(id, m);
  });
  // 4. emit rows
  for (const [fdcId, name] of desc) {
    if (kept >= LIMIT) break;
    total++;
    const mac = macros.get(fdcId);
    if (!name || !mac || mac.energy == null) continue;
    const b = branded.get(fdcId) || {};
    batch.push({
      source: 'usda', source_id: fdcId, name: name.trim(), brand: b.brand || null, barcode: b.gtin || null,
      serving_size_g: b.serving ?? null, serving_unit: null,
      calories_per_100g: num(mac.energy), protein_per_100g: num(mac.protein), carbs_per_100g: num(mac.carbs),
      fat_per_100g: num(mac.fat), fiber_per_100g: num(mac.fiber), sugar_per_100g: num(mac.sugar),
      locale: 'en-US',
    });
    if (batch.length >= BATCH) await flush();
  }
  await flush();
}
async function forEachCsv(file, fn) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let header = null;
  for await (const line of rl) {
    if (!line) continue;
    const cells = parseCsvLine(line);
    if (!header) { header = Object.fromEntries(cells.map((name, idx) => [name.replace(/^﻿/, ''), idx])); continue; }
    fn(header, cells);
  }
}

// ---- run ------------------------------------------------------------------------------------
const t0 = Date.now();
console.log(`[load-foods-bulk] source=${source} file=${inputPath} batch=${BATCH} limit=${LIMIT}`);
try {
  if (source === 'off') await loadOff(inputPath);
  else await loadUsda(inputPath);
  console.log(`[load-foods-bulk] DONE — read ${total}, upserted ${kept} in ${Math.round((Date.now() - t0) / 1000)}s`);
} catch (err) {
  console.error('[load-foods-bulk] FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
