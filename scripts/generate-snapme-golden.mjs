#!/usr/bin/env node
/**
 * Generate a golden eval dataset (PRD §8.3) from USDA's **SNAPMe** dataset — real smartphone
 * meal photos taken by 95 free-living participants, each linked to an ASA24 food record
 * (FNDDS food code, consumed grams, kcal and macros per line item).
 *
 * Why: Nutrition5k is a controlled overhead rig in a cafeteria. SNAPMe is what our users
 * actually shoot — a phone, a kitchen table, home-cooked and restaurant food, bad light — so it
 * is the closest public stand-in for the weighed home set we don't have yet.
 *
 * Caveats (be honest when reading the numbers):
 *  - Truth is what was CONSUMED (ASA24), the photo is what was SERVED ("before" photo). Leftovers
 *    make the truth smaller than the plate. We keep only plates whose "after" photo is absent or
 *    whose participant reported eating everything is unknowable from the link file, so expect a
 *    small downward bias in truth grams/kcal. Treat SNAPMe kcal-within-±X as a lower bound.
 *  - Participants included a black/white sizing marker in many photos. Models get a scale cue
 *    they won't have in production, so portion numbers are slightly optimistic.
 *  - Food descriptions are FNDDS strings ("Chicken, grilled, NS as to skin eaten") — the eval's
 *    token-Dice name match copes, but recall will read a little low versus human judgement.
 *
 * Source: https://agdatacommons.nal.usda.gov (Ag Data Commons id 24856449), ~2 GB tarball,
 * CC BY-SA 4.0. Download + unpack it somewhere OUTSIDE the repo (images are not committed).
 *
 * Usage:
 *   node scripts/generate-snapme-golden.mjs <snapme_cs_db dir> [outPath] [--sample=N] [--seed=S]
 *       [--min-items=N] [--max-items=N] [--version=snapme-v1]
 *   # e.g.
 *   node scripts/generate-snapme-golden.mjs /data/snapme/snapme_db_09Dec2022/snapme_cs_db \
 *     scripts/golden/snapme-v1.json --sample=200 --seed=20261013 --min-items=1
 *
 * The generated imageUri values are ABSOLUTE local paths under <dir>/before_photos, so the JSON
 * is machine-specific. Keep it out of git or regenerate it on each machine (same seed → same set).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rawArgs = process.argv.slice(2);
const flags = rawArgs.filter((a) => a.startsWith('--'));
const positional = rawArgs.filter((a) => !a.startsWith('--'));
const flag = (name, dflt) => {
  const f = flags.find((x) => x.startsWith(`--${name}=`));
  return f ? f.split('=').slice(1).join('=') : dflt;
};

const dir = positional[0];
const outPath = positional[1] || 'scripts/golden/snapme-v1.json';
const sampleSize = flag('sample') ? parseInt(flag('sample'), 10) : null;
const seed = parseInt(flag('seed', '20261013'), 10);
const minItems = parseInt(flag('min-items', '1'), 10);
const maxItems = parseInt(flag('max-items', '12'), 10);
const DATASET_VERSION = flag('version', 'snapme-v1');

if (!dir || !existsSync(path.join(dir, 'master_SNAPME_linkfile.csv'))) {
  console.error('Usage: node scripts/generate-snapme-golden.mjs <snapme_cs_db dir> [outPath] [--sample=N] [--seed=S]');
  process.exit(2);
}

// ---- tiny CSV parser (quoted fields, commas inside quotes) --------------------------------
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

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

const round = (n) => Math.round(n * 100) / 100;

// ASA24 occasion codes → our meal types.
const OCCASION = { 1: 'breakfast', 2: 'breakfast', 3: 'lunch', 4: 'dinner', 5: 'dinner', 6: 'snack', 7: 'snack', 8: 'snack' };

// Coarse cuisine tag from FNDDS descriptions (same spirit as the Nutrition5k generator).
const CUISINE_KEYWORDS = [
  ['south_asian', /\b(curry|dal|dahl|lentil soup|naan|paneer|tikka|masala|biryani|chana|samosa|raita|korma|saag|tandoori|basmati|indian)\b/i],
  ['east_asian', /\b(tofu|kimchi|edamame|teriyaki|soy sauce|sesame|bok choy|miso|sushi|ramen|lo mein|chow mein|stir[- ]?fry|fried rice|dumpling|pho|egg roll|wonton|pad thai|thai|chinese|japanese|korean|vietnamese)\b/i],
  ['latin', /\b(tortilla|salsa|guacamole|taco|burrito|black beans|refried|enchilada|carnitas|quesadilla|plantain|mexican|tamale|empanada)\b/i],
  ['mediterranean', /\b(hummus|falafel|feta|tzatziki|pita|olives|kalamata|couscous|tabbouleh|shawarma|gyro)\b/i],
];
function cuisineFor(items) {
  const names = items.map((i) => i.name).join(' | ');
  for (const [tag, re] of CUISINE_KEYWORDS) if (re.test(names)) return tag;
  return 'western';
}
function difficultyFor(n) {
  if (n <= 1) return 'easy';
  if (n <= 4) return 'medium';
  return 'hard';
}

// ---- load + group ---------------------------------------------------------------------------
const text = readFileSync(path.join(dir, 'master_SNAPME_linkfile.csv'), 'utf8');
const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
const header = parseCsvLine(lines[0]);
const col = (name) => header.indexOf(name);
const C = {
  subject: col('subject_id'), day: col('snapme_study_day'), file: col('filename'), packaged: col('packaged_food'),
  desc: col('Food_Description'), grams: col('FoodAmt'), occ: col('Occ_Name'),
  kcal: col('KCAL'), prot: col('PROT'), fat: col('TFAT'), carb: col('CARB'),
};
for (const [k, v] of Object.entries(C)) if (v < 0) { console.error(`column for ${k} not found`); process.exit(1); }

const beforeDir = path.join(dir, 'before_photos');
const plates = new Map(); // key -> { subject, day, file, occ, items[] }
let skippedPackaged = 0, skippedNoPhoto = 0, badRows = 0;
for (const line of lines.slice(1)) {
  const f = parseCsvLine(line);
  if (f.length < header.length - 5) { badRows++; continue; }
  if (f[C.packaged] !== '0') { skippedPackaged++; continue; }
  const file = f[C.file];
  if (!file || !existsSync(path.join(beforeDir, file))) { skippedNoPhoto++; continue; }
  const grams = Number(f[C.grams]);
  const kcal = Number(f[C.kcal]);
  if (!Number.isFinite(grams) || !Number.isFinite(kcal) || grams <= 0) { badRows++; continue; }
  const key = `${f[C.subject]}|${f[C.day]}|${file}`;
  if (!plates.has(key)) plates.set(key, { subject: f[C.subject], day: f[C.day], file, occ: f[C.occ], items: [] });
  plates.get(key).items.push({
    name: f[C.desc].replace(/,\s*NS as to [^,]*/gi, '').replace(/,\s*NFS/gi, '').trim(),
    canonicalId: null,
    grams: round(grams),
    calories: round(kcal),
    protein: round(Number(f[C.prot]) || 0),
    carbs: round(Number(f[C.carb]) || 0),
    fat: round(Number(f[C.fat]) || 0),
  });
}

// Drop pure beverages/water-only plates (a glass of water is not a food-recognition test) and
// plates with too few / too many items.
const WATER = /^water\b|tap water|bottled water/i;
let pool = [...plates.values()]
  .map((p) => ({ ...p, items: p.items.filter((it) => !WATER.test(it.name)) }))
  .filter((p) => p.items.length >= minItems && p.items.length <= maxItems)
  .filter((p) => p.items.reduce((s, it) => s + it.calories, 0) >= 20);

const toRecord = (p) => {
  const total = p.items.reduce(
    (a, it) => ({ calories: a.calories + it.calories, protein: a.protein + it.protein, carbs: a.carbs + it.carbs, fat: a.fat + it.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  return {
    id: `snapme:${p.subject}:${p.day}:${p.file.replace(/\.[^.]+$/, '')}`,
    imageUri: path.resolve(beforeDir, p.file),
    provenance: 'snapme',
    groundTruth: {
      items: p.items,
      total: { calories: round(total.calories), protein: round(total.protein), carbs: round(total.carbs), fat: round(total.fat) },
    },
    slices: {
      cuisine: cuisineFor(p.items),
      mealType: OCCASION[Number(p.occ)] ?? 'snack',
      difficulty: difficultyFor(p.items.length),
      // Free-living phone photos: lighting is uncontrolled; we don't have per-photo labels.
      lighting: 'mixed',
    },
    datasetVersion: DATASET_VERSION,
  };
};

let records = pool.map(toRecord);
console.log(`[generate-snapme-golden] ${plates.size} before-photo plates, ${records.length} eligible after filters`);
console.log(`  skipped: packaged=${skippedPackaged} no_photo=${skippedNoPhoto} bad_rows=${badRows}`);

if (sampleSize && sampleSize < records.length) {
  // Stratified seeded sample over difficulty × cuisine, proportional with a floor of 8 for
  // non-western strata, then trimmed/topped up on the largest strata to hit sampleSize exactly.
  const rand = rng(seed);
  const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const strata = new Map();
  for (const r of records) {
    const k = `${r.slices.difficulty}|${r.slices.cuisine}`;
    if (!strata.has(k)) strata.set(k, []);
    strata.get(k).push(r);
  }
  const quotas = new Map();
  let allocated = 0;
  for (const [k, rs] of strata) {
    const share = Math.round((rs.length / records.length) * sampleSize);
    const floor = k.endsWith('|western') ? 0 : Math.min(rs.length, 8);
    const q = Math.min(rs.length, Math.max(share, floor));
    quotas.set(k, q);
    allocated += q;
  }
  let diff = sampleSize - allocated;
  for (const [k, rs] of [...strata.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (diff === 0) break;
    const q = quotas.get(k);
    const nq = Math.min(rs.length, Math.max(0, q + diff));
    diff -= nq - q;
    quotas.set(k, nq);
  }
  const picked = [];
  for (const [k, rs] of strata) picked.push(...shuffle(rs).slice(0, quotas.get(k)));
  records = shuffle(picked);
}

mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
writeFileSync(path.resolve(outPath), JSON.stringify(records, null, 2));

const count = (f) => records.reduce((a, r) => ((a[f(r)] = (a[f(r)] || 0) + 1), a), {});
console.log(`\n[generate-snapme-golden] wrote ${records.length} records to ${outPath} (dataset_version=${DATASET_VERSION}, seed=${seed})`);
console.log('  by difficulty:', count((r) => r.slices.difficulty));
console.log('  by cuisine:', count((r) => r.slices.cuisine));
console.log('  by mealType:', count((r) => r.slices.mealType));
console.log('  avg items/plate:', round(records.reduce((s, r) => s + r.groundTruth.items.length, 0) / records.length));
