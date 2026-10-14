#!/usr/bin/env node
/**
 * Summarise persisted nutrition-eval reports (scripts/golden/reports/*.report.json or any dir)
 * into one comparison table — the latest report per (model, promptVariant, datasetVersion).
 *
 * Usage: node scripts/summarize-nutrition-eval.mjs [reportsDir] [--md] [--dataset=<version>]
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) || 'scripts/golden/reports';
const md = args.includes('--md');
const datasetFilter = args.find((a) => a.startsWith('--dataset='))?.split('=')[1];

const files = readdirSync(dir).filter((f) => f.endsWith('.report.json')).sort();
const latest = new Map();
for (const f of files) {
  const r = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  if (datasetFilter && r.datasetVersion !== datasetFilter) continue;
  const key = `${r.datasetVersion}|${r.run?.model ?? 'production'}|${r.run?.promptVariant ?? ''}`;
  latest.set(key, { file: f, r }); // sorted ascending → last write wins
}

const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}%`);
const num = (x, d = 0) => (x == null ? '–' : Number(x).toFixed(d));
const rows = [...latest.values()].map(({ r }) => {
  const o = r.overall;
  const run = r.run ?? {};
  return {
    dataset: r.datasetVersion,
    model: run.model ?? 'production',
    prompt: run.promptVariant ?? '',
    n: r.n,
    fail: run.parseFailures ?? 0,
    failPct: run.attempted ? pct(run.parseFailures / run.attempted) : '–',
    ident: pct(o.identTop1Acc),
    recall: pct(o.multiItemRecall),
    halluc: pct(o.hallucinationRate),
    gMAPE: pct(o.portionMape),
    gMAE: num(o.portionMaeG),
    kcalMAPE: pct(o.calMape),
    kcalMAE: num(o.calMae),
    bias: pct(o.calBias),
    in25: pct(o.within25Rate),
    in40: pct(o.within40Rate),
    protMAPE: pct(o.proteinMape),
    carbMAPE: pct(o.carbsMape),
    fatMAPE: pct(o.fatMape),
    dbCov: pct(o.dbMatchCoverage),
    grndOK: pct(o.groundingCorrectness),
    ece: num(r.ece, 3),
    p50s: run.latencyMsP50 != null ? (run.latencyMsP50 / 1000).toFixed(1) : '–',
    p95s: run.latencyMsP95 != null ? (run.latencyMsP95 / 1000).toFixed(1) : '–',
    usd: run.costUsdPerParse != null ? `$${run.costUsdPerParse.toFixed(4)}` : '–',
  };
});
rows.sort((a, b) => a.dataset.localeCompare(b.dataset) || parseFloat(b.in40) - parseFloat(a.in40));

if (md) {
  const cols = Object.keys(rows[0] ?? {});
  console.log(`| ${cols.join(' | ')} |`);
  console.log(`| ${cols.map(() => '---').join(' | ')} |`);
  for (const r of rows) console.log(`| ${cols.map((c) => r[c]).join(' | ')} |`);
} else {
  console.table(rows);
}
