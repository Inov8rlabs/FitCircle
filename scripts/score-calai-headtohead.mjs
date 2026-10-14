#!/usr/bin/env node
/**
 * Score the Cal AI head-to-head (docs/FOOD-AI-ACCURACY-PLAN-2026-10-13.md §3c): the same 30 SNAPMe
 * plates logged by hand in Cal AI (calai-sheet.csv) and parsed by FitCircle (an eval cases file
 * from scripts/run-nutrition-eval.mjs on the calai-headtohead-v1 golden set). Both are scored
 * against the plates' known nutrition with the same metrics, overall and by cuisine.
 *
 * Usage:
 *   node scripts/score-calai-headtohead.mjs <calai-sheet.csv> <fitcircle .cases.json> [--md] [--paired]
 *
 * The sheet columns: #, photo, calai_calories, calai_protein_g, calai_carbs_g, calai_fat_g, notes.
 * Blank Cal AI rows count as failures (the plate is excluded from Cal AI's accuracy but reported).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [sheetPath, casesPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const md = process.argv.includes('--md');
// --paired: score both apps on the plates BOTH have a result for (fair comparison when the
// Cal AI sheet has gaps).
const paired = process.argv.includes('--paired');
if (!sheetPath || !casesPath) {
  console.error('Usage: node scripts/score-calai-headtohead.mjs <calai-sheet.csv> <fitcircle .cases.json> [--md]');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(path.resolve('scripts/golden/calai-headtohead-v1.json'), 'utf8'));
const byId = new Map(manifest.plates.map((p) => [p.id, p]));
const byN = new Map(manifest.plates.map((p) => [p.n, p]));

// ---- Cal AI numbers from the sheet ----------------------------------------------------------
const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) && String(v).trim() !== '' ? n : null; };
const calai = new Map(); // n -> {calories, protein, carbs, fat, note}
const lines = readFileSync(sheetPath, 'utf8').split(/\r?\n/).filter((l) => l.trim());
for (const line of lines.slice(1)) {
  const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"(.*)"$/, '$1').replace(/""/g, '"')) ?? [];
  const n = Number(cells[0]);
  if (!byN.has(n)) continue;
  calai.set(n, { calories: num(cells[2]), protein: num(cells[3]), carbs: num(cells[4]), fat: num(cells[5]), note: cells[6] ?? '' });
}

// ---- FitCircle numbers from the eval cases ---------------------------------------------------
const cases = JSON.parse(readFileSync(path.resolve(casesPath), 'utf8'));
const fit = new Map(); // n -> totals
for (const c of cases.cases ?? []) {
  const p = byId.get(c.id);
  if (!p) continue;
  const items = c.modelOutput?.items ?? [];
  const sum = (k) => items.reduce((a, it) => a + (Number(it[k]) || 0), 0);
  fit.set(p.n, { calories: sum('calories'), protein: sum('proteinG'), carbs: sum('carbsG'), fat: sum('fatG') });
}

// ---- metrics ---------------------------------------------------------------------------------
function score(get) {
  const rows = [];
  for (const p of manifest.plates) {
    const est = get(p.n);
    const t = p.truth.total;
    if (!est || est.calories == null || !t.calories) { rows.push({ p, failed: true }); continue; }
    const e = (est.calories - t.calories) / t.calories;
    const mac = (k, tk) => (est[k] != null && t[tk] ? Math.abs(est[k] - t[tk]) / t[tk] : null);
    rows.push({ p, failed: false, e, protein: mac('protein', 'protein'), carbs: mac('carbs', 'carbs'), fat: mac('fat', 'fat') });
  }
  return rows;
}
function agg(rows) {
  const ok = rows.filter((r) => !r.failed);
  const n = ok.length;
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
  return {
    n: rows.length,
    failed: rows.length - n,
    in25: pct(n ? ok.filter((r) => Math.abs(r.e) <= 0.25).length / n : null),
    in40: pct(n ? ok.filter((r) => Math.abs(r.e) <= 0.4).length / n : null),
    mape: pct(mean(ok.map((r) => Math.abs(r.e)))),
    bias: pct(mean(ok.map((r) => r.e))),
    protMAPE: pct(mean(ok.map((r) => r.protein).filter((x) => x != null))),
    carbMAPE: pct(mean(ok.map((r) => r.carbs).filter((x) => x != null))),
    fatMAPE: pct(mean(ok.map((r) => r.fat).filter((x) => x != null))),
  };
}
const both = (n) => (!paired || (calai.get(n)?.calories != null && fit.get(n)?.calories != null));
const apps = [
  ['Cal AI', score((n) => (both(n) ? calai.get(n) : null))],
  ['FitCircle', score((n) => (both(n) ? fit.get(n) : null))],
];
if (paired) console.log(`paired on ${manifest.plates.filter((p) => both(p.n)).length} plates with results from both apps\n`);
const cuisines = [...new Set(manifest.plates.map((p) => p.cuisine))];
const table = [];
for (const [name, rows] of apps) {
  table.push({ app: name, slice: 'all', ...agg(rows) });
  for (const c of cuisines) table.push({ app: name, slice: c, ...agg(rows.filter((r) => r.p.cuisine === c)) });
}
if (md) {
  const cols = Object.keys(table[0]);
  console.log(`| ${cols.join(' | ')} |`);
  console.log(`| ${cols.map(() => '---').join(' | ')} |`);
  for (const r of table) console.log(`| ${cols.map((c) => r[c]).join(' | ')} |`);
} else {
  console.table(table);
}
// Per-plate detail for the doc appendix / debugging.
console.log('\nper plate (truth kcal | Cal AI | FitCircle):');
for (const p of manifest.plates) {
  const a = calai.get(p.n); const f = fit.get(p.n);
  console.log(`  ${String(p.n).padStart(2)} ${p.cuisine.padEnd(13)} ${Math.round(p.truth.total.calories).toString().padStart(4)} | ${a?.calories != null ? Math.round(a.calories) : '  –'} | ${f ? Math.round(f.calories) : '  –'}${a?.note ? `  (${a.note})` : ''}`);
}
