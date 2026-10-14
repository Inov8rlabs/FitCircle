#!/usr/bin/env node
/**
 * Run the nutrition eval (PRD §8.3): push a golden dataset through the LIVE parse pipeline,
 * score all four stages + calibration, print the report, persist it, and fail (exit 1) if any
 * tracked metric is below threshold. Intended for CI, tuning runs and model bake-offs.
 *
 * Requires AI_GATEWAY_API_KEY (live LLM) and a populated foods table (Stage-4 DB matching).
 * Loads apps/web/.env.local if present so a local run needs no exports.
 *
 * Usage:
 *   npx tsx scripts/run-nutrition-eval.mjs [options]
 *
 * Options:
 *   --golden=<path>        golden set JSON (default scripts/golden/nutrition5k.json)
 *   --model=<slug>         bake-off: vision model to test (no fallback/cache/quota). Repeatable
 *                          as a comma list: --models=a,b,c runs them one after another and
 *                          prints a comparison table at the end.
 *   --prompt=<variant>     prompt variant id passed to the service (default production prompt)
 *   --limit=<n>            only the first n golden records
 *   --concurrency=<n>      parallel parses (default 3)
 *   --out=<dir>            where reports go (default scripts/golden/reports)
 *   --no-gate              exit 0 even when thresholds fail (bake-offs)
 *
 * Examples:
 *   npx tsx scripts/run-nutrition-eval.mjs                       # production config, CI gate
 *   npx tsx scripts/run-nutrition-eval.mjs --models=anthropic/claude-haiku-4.5,google/gemini-3-flash --limit=100 --no-gate
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ---- env files without a dotenv dependency ---------------------------------------------------
// --env=<path> (e.g. a `vercel env pull` file) is loaded first, then apps/web/.env.local.
// Existing process env always wins; nothing is ever printed.
const envArg = process.argv.find((a) => a.startsWith('--env='))?.slice(6);
for (const envPath of [envArg, 'apps/web/.env.local', '.env.local'].filter(Boolean)) {
  const abs = path.resolve(envPath);
  if (!existsSync(abs)) continue;
  for (const line of readFileSync(abs, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k] != null) continue;
    const value = raw.replace(/^(['"])(.*)\1$/, '$2');
    // `vercel env pull` writes Sensitive variables as a bracketed placeholder; setting that
    // would shadow the working OIDC auth, so skip it.
    if (/^\[.*\]$/.test(value)) continue;
    process.env[k] = value;
  }
}

// ---- args -------------------------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? 'true'] : [a, 'true'];
  }),
);
const goldenPath = args.golden || args._ || 'scripts/golden/nutrition5k.json';
const models = (args.models || args.model || '').split(',').map((s) => s.trim()).filter(Boolean);
const promptVariant = args.prompt || undefined;
const limit = args.limit ? parseInt(args.limit, 10) : undefined;
const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : 3;
const outDir = args.out || 'scripts/golden/reports';
const gate = args['no-gate'] !== 'true';

// Gateway auth: an API key, or the VERCEL_OIDC_TOKEN that `vercel env pull` writes into
// apps/web/.env.local (valid ~12 h; re-pull when the gateway answers "Unauthenticated").
if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
  console.error('AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN is required (the runner calls the live parse pipeline). Aborting.');
  process.exit(2);
}

// Import the TS runner. Run this file via `npx tsx` so the .ts import resolves.
const runnerUrl = pathToFileURL(path.resolve('apps/web/app/lib/services/nutrition-eval-runner.ts')).href;
const { NutritionEvalRunner } = await import(runnerUrl);

const goldenSet = NutritionEvalRunner.loadGoldenSet(path.resolve(goldenPath));
console.log(`[run-nutrition-eval] ${goldenSet.length} golden records from ${goldenPath}${limit ? ` (limit ${limit})` : ''}`);

// --rescore=<a.cases.json,b.cases.json>: re-score captured outputs with the current scorer
// (no model calls) and write fresh reports; exits afterwards.
if (args.rescore) {
  for (const p of args.rescore.split(',').map((s) => s.trim()).filter(Boolean)) {
    const report = await NutritionEvalRunner.rescore(path.resolve(p), goldenSet, { outDir });
    const o = report.overall;
    console.log(`  rescored ${path.basename(p)} → ident ${(o.identTop1Acc * 100).toFixed(0)}% recall ${(o.multiItemRecall * 100).toFixed(0)}% halluc ${(o.hallucinationRate * 100).toFixed(0)}% in40 ${(o.within40Rate * 100).toFixed(0)}%`);
  }
  process.exit(0);
}

const fmt = (x, d = 2) => (x == null ? '   –' : typeof x === 'number' ? x.toFixed(d) : String(x));
const pct = (x) => (x == null ? '   –' : `${(x * 100).toFixed(0)}%`);

function summarize(report) {
  const o = report.overall;
  const r = report.run ?? {};
  return {
    model: r.model ?? 'production',
    n: report.n,
    fail: r.parseFailures ?? 0,
    ident: pct(o.identTop1Acc),
    recall: pct(o.multiItemRecall),
    halluc: pct(o.hallucinationRate),
    gMAPE: pct(o.portionMape),
    gMAE: fmt(o.portionMaeG, 0),
    kcalMAPE: pct(o.calMape),
    kcalMAE: fmt(o.calMae, 0),
    bias: pct(o.calBias),
    in25: pct(o.within25Rate),
    in40: pct(o.within40Rate),
    protMAPE: pct(o.proteinMape),
    carbMAPE: pct(o.carbsMape),
    fatMAPE: pct(o.fatMape),
    dbCov: pct(o.dbMatchCoverage),
    grndOK: pct(o.groundingCorrectness),
    ece: fmt(report.ece, 3),
    p50s: r.latencyMsP50 != null ? (r.latencyMsP50 / 1000).toFixed(1) : '–',
    p95s: r.latencyMsP95 != null ? (r.latencyMsP95 / 1000).toFixed(1) : '–',
    usd: r.costUsdPerParse != null ? `$${r.costUsdPerParse.toFixed(4)}` : '–',
  };
}

const summaries = [];
const runs = models.length ? models : [undefined];
let anyFail = false;
for (const model of runs) {
  const label = model ?? 'production config';
  console.log(`\n[run-nutrition-eval] ▶ ${label}${promptVariant ? ` (prompt=${promptVariant})` : ''}`);
  const started = Date.now();
  let report;
  try {
    report = await NutritionEvalRunner.run(goldenSet, {
      concurrency,
      model,
      promptVariant,
      limit,
      outDir,
      onProgress: (done, total) => {
        if (done % 10 === 0 || done === total) process.stdout.write(`  ${done}/${total}\n`);
      },
    });
  } catch (err) {
    // One broken model (bad slug, provider outage) must not abort the rest of a bake-off.
    console.error(`  ✖ ${label} produced no report: ${err?.message ?? err}`);
    summaries.push({ model: label, n: 0, fail: 'all' });
    anyFail = true;
    continue;
  }
  console.log(`  done in ${((Date.now() - started) / 1000).toFixed(0)}s — ${report.pass ? 'PASS ✅' : 'FAIL ❌'}`);
  for (const f of report.failures) console.log('   - ' + f);
  const cuisine = report.bySlice.filter((s) => s.slice.startsWith('cuisine='));
  for (const s of cuisine) {
    console.log(`   ${s.slice.padEnd(22)} n=${String(s.n).padStart(3)} ident=${pct(s.identTop1Acc)} recall=${pct(s.multiItemRecall)} kcal±40=${pct(s.within40Rate)} gMAPE=${pct(s.portionMape)}`);
  }
  summaries.push(summarize(report));
  if (!report.pass) anyFail = true;
}

console.log('\n===== SUMMARY =====');
console.table(summaries);
process.exit(gate && anyFail ? 1 : 0);
