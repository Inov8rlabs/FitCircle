/**
 * `onboarding_paywall` 1.1.5 arms (docs/ENGAGEMENT_115_SPEC.md §14.2 + the forced-trial test,
 * founder approved 2026-11-17). Pure: builds the PATCH body for /api/admin/experiments/
 * onboarding_paywall (ExperimentService.update, audited with the actor) from the live
 * experiment, so the script is idempotent and never removes or reorders arms.
 *
 *   control                     plans + trial timeline, closable (today)
 *   variantA–C                  earlier layouts, kept at weight 0 (arms can't be removed once started)
 *   variantD "After first meal" plans + timeline + paywall_position: after_meal (§14.2) — created if missing
 *   variantE "Forced trial (no close)"  plans + timeline + paywall: "hard" (no close; start the
 *                               trial or buy to finish onboarding) — the next free key
 *
 * Who can be randomised while the forced arm has weight (lib/experiments/assign.ts
 * hardPaywallIneligibility, derived from the arms so an audience edit can't drop it):
 * 1.1.5+ only, never invited users, never Pro — all served control, unpersisted, not analysed.
 * The audience minAppVersion is raised to 1.1.5 as well so Admin Tools shows it.
 */
import { HARD_PAYWALL_MIN_APP_VERSION, isHardPaywallArm } from './assign';
import { compareVersions, parseVersion } from '../home-feed/rules';
import { armsSchema, CONTROL_ARM, VARIANT_LETTERS, type Experiment, type ExperimentArm, type PatchExperimentInput } from './model';

export const ONBOARDING_PAYWALL_KEY = 'onboarding_paywall';

export const FORCED_TRIAL_ARM_NAME = 'Forced trial (no close)';
export const FORCED_TRIAL_PAYLOAD = { layout: 'plans', paywall: 'hard', trial_timeline: true } as const;
export const FORCED_TRIAL_DESCRIPTION =
  'No close button: start the free trial (or buy) to finish onboarding. Restore, Terms/Privacy and "use a different account" stay. Falls back to the closable paywall when not trial-eligible, the store offer fails or offline; skipped for Pro. 1.1.5+ only; invited users never enter the experiment.';

export const AFTER_MEAL_ARM_NAME = 'After first meal';
export const AFTER_MEAL_PAYLOAD = { layout: 'plans', paywall: 'soft', trial_timeline: true, paywall_position: 'after_meal' } as const;

/** Integer percents; must sum to 100. Every other arm gets 0. */
export interface ForcedTrialAllocation {
  control: number;
  forced: number;
  afterMeal: number;
}

/** Recommended: forced vs control head to head, after-meal paused until it reads out. */
export const RECOMMENDED_ALLOCATION: ForcedTrialAllocation = { control: 50, forced: 50, afterMeal: 0 };

export const isForcedTrialArm = (a: Pick<ExperimentArm, 'payload'>) => isHardPaywallArm(a);
export const isAfterMealArm = (a: Pick<ExperimentArm, 'payload'>) => a.payload?.paywall_position === 'after_meal' && !isHardPaywallArm(a);

/** "control,50/forced,50/afterMeal,0" style parser for --split control=50,forced=50,afterMeal=0. */
export function parseAllocation(raw: string | undefined): ForcedTrialAllocation {
  if (!raw) return { ...RECOMMENDED_ALLOCATION };
  const out: ForcedTrialAllocation = { control: 0, forced: 0, afterMeal: 0 };
  for (const part of raw.split(',')) {
    const m = /^\s*(control|forced|afterMeal)\s*=\s*(\d{1,3})\s*$/.exec(part);
    if (!m) throw new Error(`bad --split part "${part}" (use control=50,forced=50,afterMeal=0)`);
    out[m[1] as keyof ForcedTrialAllocation] = Number(m[2]);
  }
  validateAllocation(out);
  return out;
}

export function validateAllocation(a: ForcedTrialAllocation): void {
  for (const [k, v] of Object.entries(a)) {
    if (!Number.isInteger(v) || v < 0 || v > 100) throw new Error(`${k} must be an integer 0–100 (got ${v})`);
  }
  const total = a.control + a.forced + a.afterMeal;
  if (total !== 100) throw new Error(`allocation must sum to 100 (got ${total})`);
}

function nextVariantKey(arms: readonly ExperimentArm[]): string {
  const used = arms.filter((a) => a.key.startsWith('variant')).length;
  if (used >= VARIANT_LETTERS.length) throw new Error('no free arm key (max variantI)');
  return `variant${VARIANT_LETTERS[used]}`;
}

export interface ForcedTrialPlan {
  patch: PatchExperimentInput;
  forcedKey: string;
  afterMealKey: string;
  /** Human-readable changes; empty = already in this state (no-op). */
  changes: string[];
}

/** The PATCH that brings `current` to the 1.1.5 arms + allocation. Throws on an invalid result. */
export function planForcedTrialPatch(current: Pick<Experiment, 'key' | 'arms' | 'audience'>, allocation: ForcedTrialAllocation): ForcedTrialPlan {
  validateAllocation(allocation);
  if (current.key !== ONBOARDING_PAYWALL_KEY) throw new Error(`expected ${ONBOARDING_PAYWALL_KEY}, got ${current.key}`);
  const changes: string[] = [];
  const arms: ExperimentArm[] = current.arms.map((a) => ({ ...a, payload: { ...(a.payload ?? {}) } }));

  if (arms.filter(isForcedTrialArm).length > 1) throw new Error('more than one hard-paywall arm; fix by hand');
  let afterMeal = arms.find(isAfterMealArm);
  if (!afterMeal) {
    afterMeal = { key: nextVariantKey(arms), name: AFTER_MEAL_ARM_NAME, description: null, weight: 0, payload: { ...AFTER_MEAL_PAYLOAD } };
    arms.push(afterMeal);
    changes.push(`add ${afterMeal.key} "${AFTER_MEAL_ARM_NAME}" ${JSON.stringify(AFTER_MEAL_PAYLOAD)}`);
  }
  let forced = arms.find(isForcedTrialArm);
  if (!forced) {
    forced = { key: nextVariantKey(arms), name: FORCED_TRIAL_ARM_NAME, description: FORCED_TRIAL_DESCRIPTION, weight: 0, payload: { ...FORCED_TRIAL_PAYLOAD } };
    arms.push(forced);
    changes.push(`add ${forced.key} "${FORCED_TRIAL_ARM_NAME}" ${JSON.stringify(FORCED_TRIAL_PAYLOAD)}`);
  } else if (JSON.stringify(forced.payload) !== JSON.stringify(FORCED_TRIAL_PAYLOAD) || forced.name !== FORCED_TRIAL_ARM_NAME) {
    changes.push(`set ${forced.key} name/payload → "${FORCED_TRIAL_ARM_NAME}" ${JSON.stringify(FORCED_TRIAL_PAYLOAD)}`);
    forced.name = FORCED_TRIAL_ARM_NAME;
    forced.payload = { ...FORCED_TRIAL_PAYLOAD };
  }

  for (const a of arms) {
    const want = a.key === CONTROL_ARM ? allocation.control : a.key === forced.key ? allocation.forced : a.key === afterMeal.key ? allocation.afterMeal : 0;
    const before = current.arms.find((b) => b.key === a.key)?.weight;
    if (before !== undefined && before !== want) changes.push(`weight ${a.key}: ${before} → ${want}`);
    else if (before === undefined && want !== 0) changes.push(`weight ${a.key}: ${want}`);
    a.weight = want;
  }
  armsSchema.parse(arms); // sum 100, keys consecutive, one control

  const patch: PatchExperimentInput = { arms };
  const min = HARD_PAYWALL_MIN_APP_VERSION[ONBOARDING_PAYWALL_KEY];
  const currentMin = parseVersion(current.audience.minAppVersion ?? null);
  if (!currentMin || compareVersions(currentMin, parseVersion(min)!) < 0) {
    patch.audience = { ...current.audience, minAppVersion: min };
    changes.push(`audience.minAppVersion: ${current.audience.minAppVersion ?? '(none)'} → ${min}`);
  }
  return { patch, forcedKey: forced.key, afterMealKey: afterMeal.key, changes };
}
