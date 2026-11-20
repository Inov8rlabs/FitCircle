/**
 * Add the "Forced trial (no close)" arm (and the §14.2 "After first meal" arm if it is still
 * missing) to the RUNNING `onboarding_paywall` experiment and set the allocation
 * (lib/experiments/onboarding-forced-trial.ts). Run when 1.1.5 is live on both stores.
 *
 * DRY RUN by default: reads the live experiment and prints the PATCH + the changes.
 * --apply sends PATCH /api/admin/experiments/onboarding_paywall (ExperimentService.update,
 * audited under --actor):
 *
 *   bun scripts/onboarding-forced-trial-experiment.ts --env .env.local --base https://www.fitcircle.ai \
 *     [--split control=50,forced=50,afterMeal=0] [--apply --actor you@inov8rlabs.com]
 *
 * Default split = recommended: control 50 / forced 50 / after-meal 0 (paused until the
 * forced test reads out). Needs ADMIN_API_SECRET in --env (Bearer token, never printed).
 * Idempotent: a re-run with the same split changes nothing. Never removes arms or changes status.
 */
import { readFileSync } from 'node:fs';

import { armsSchema, audienceSchema } from '../app/lib/experiments/model';
import { ONBOARDING_PAYWALL_KEY, parseAllocation, planForcedTrialPatch } from '../app/lib/experiments/onboarding-forced-trial';

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
const actor = arg('--actor');
const tag = `[${ONBOARDING_PAYWALL_KEY}]`;

async function main() {
  const allocation = parseAllocation(arg('--split'));
  if (apply && !actor?.includes('@')) throw new Error('--apply needs --actor <admin email> (audit log)');
  const secret = process.env.ADMIN_API_SECRET;
  if (!secret) throw new Error('ADMIN_API_SECRET missing (pass --env)');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` };
  if (actor) headers['X-Admin-Actor'] = actor;

  const res = await fetch(`${base}/api/admin/experiments/${ONBOARDING_PAYWALL_KEY}`, { headers });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.data?.experiment) throw new Error(`GET ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const e = body.data.experiment;
  const current = { key: e.key, arms: armsSchema.parse(e.arms), audience: audienceSchema.parse(e.audience ?? {}) };
  console.log(`${tag} status ${e.status}, traffic ${e.trafficPct}%, arms: ${current.arms.map((a) => `${a.key}=${a.weight}`).join(' ')}`);
  console.log(`${tag} split: control ${allocation.control} / forced ${allocation.forced} / afterMeal ${allocation.afterMeal}`);

  const plan = planForcedTrialPatch(current, allocation);
  if (!plan.changes.length) {
    console.log(`${tag} already in this state — nothing to do.`);
    return;
  }
  console.log(`${tag} forced arm = ${plan.forcedKey}, after-meal arm = ${plan.afterMealKey}`);
  for (const c of plan.changes) console.log(`${tag}   • ${c}`);
  console.log(`${tag} PATCH body:\n${JSON.stringify(plan.patch, null, 2)}`);
  if (!apply) {
    console.log(`${tag} dry run — add --apply --actor <admin email> to write it.`);
    return;
  }
  const patchRes = await fetch(`${base}/api/admin/experiments/${ONBOARDING_PAYWALL_KEY}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(plan.patch),
  });
  const text = await patchRes.text();
  console.log(`${tag} PATCH ${patchRes.status}: ${text.slice(0, 500)}`);
  if (!patchRes.ok) process.exit(1);
}

main().catch((err) => {
  console.error(`${tag} failed:`, err?.message ?? err);
  process.exit(1);
});
