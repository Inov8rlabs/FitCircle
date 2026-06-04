#!/usr/bin/env node
/**
 * Run the nutrition eval (PRD §8.3): push a golden dataset through the LIVE parse pipeline,
 * score all four stages + calibration, print the report, and fail (exit 1) if any tracked
 * metric is below threshold. Intended for CI and for tuning runs.
 *
 * Requires AI_GATEWAY_API_KEY (live LLM) and a populated foods table (Stage-4 DB matching).
 *
 * Usage:
 *   AI_GATEWAY_API_KEY=... node scripts/run-nutrition-eval.mjs [goldenSetPath]
 *   # default golden set: scripts/golden/off-starter.json
 *
 * This is a thin .mjs wrapper that imports the TS runner via tsx. If tsx isn't available,
 * run with:  npx tsx scripts/run-nutrition-eval.mjs [path]
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const goldenPath = process.argv[2] || 'scripts/golden/off-starter.json';

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error('AI_GATEWAY_API_KEY is required (the runner calls the live parse pipeline). Aborting.');
  process.exit(2);
}

// Import the TS runner. Run this file via `npx tsx` so the .ts import resolves.
const runnerUrl = pathToFileURL(
  path.resolve('apps/web/app/lib/services/nutrition-eval-runner.ts')
).href;

const { NutritionEvalRunner } = await import(runnerUrl);

const goldenSet = NutritionEvalRunner.loadGoldenSet(path.resolve(goldenPath));
console.log(`[run-nutrition-eval] ${goldenSet.length} golden records from ${goldenPath}`);

const report = await NutritionEvalRunner.run(goldenSet, { concurrency: 2 });

console.log('\n===== NUTRITION EVAL REPORT =====');
console.log(JSON.stringify(report, null, 2));
console.log(`\nVERDICT: ${report.pass ? 'PASS ✅' : 'FAIL ❌'}`);
if (!report.pass) {
  console.log('Failing metrics:'); for (const f of report.failures) console.log('  - ' + f);
}
process.exit(report.pass ? 0 : 1);
