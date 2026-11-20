/**
 * Create the `onboarding_meal_step` experiment as a DRAFT (docs/ENGAGEMENT_115_SPEC.md §14.8).
 * Run at release; start it from Admin Tools (Experiments → onboarding_meal_step → Start) once
 * 1.1.5 is live on both stores. Never starts it.
 *
 * DRY RUN by default (prints the body). --apply POSTs it to the admin API:
 *
 *   bun scripts/onboarding-meal-step-experiment.ts --env .env.local --base https://www.fitcircle.ai [--apply]
 *
 * Needs ADMIN_API_SECRET in --env (sent as the Bearer token, never printed). Idempotent: an
 * existing key answers 409 and nothing changes.
 */
import { readFileSync } from 'node:fs';

import { ONBOARDING_MEAL_STEP_EXPERIMENT } from '../app/lib/experiments/onboarding-meal-step';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const envFile = arg('--env');
if (envFile) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const base = (arg('--base') ?? 'https://www.fitcircle.ai').replace(/\/$/, '');
const apply = args.includes('--apply');

async function main() {
  console.log(`[onboarding_meal_step] body:\n${JSON.stringify(ONBOARDING_MEAL_STEP_EXPERIMENT, null, 2)}`);
  if (!apply) {
    console.log('[onboarding_meal_step] dry run — add --apply to create it (status draft).');
    return;
  }
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) throw new Error('ADMIN_API_SECRET missing (pass --env)');
  const res = await fetch(`${base}/api/admin/experiments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, 'X-Admin-Actor': 'release-script' },
    body: JSON.stringify(ONBOARDING_MEAL_STEP_EXPERIMENT),
  });
  const text = await res.text();
  console.log(`[onboarding_meal_step] ${res.status}: ${text.slice(0, 500)}`);
  if (!res.ok && res.status !== 409) process.exit(1);
}

main().catch((err) => {
  console.error('[onboarding_meal_step] failed:', err?.message ?? err);
  process.exit(1);
});
