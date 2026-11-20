/**
 * Experiment `onboarding_meal_step` (docs/ENGAGEMENT_115_SPEC.md §14.8) — the create body for
 * POST /api/admin/experiments. Created at release as a DRAFT (scripts/onboarding-meal-step-
 * experiment.ts, dry run by default), started from Admin Tools once 1.1.5 is live.
 *
 * Arm keys are generic (control, variantA, … with no gaps — lib/experiments/model.ts), so the
 * spec's "variantB" ships as `variantA`; the apps act on the payload, never on the key.
 * Primary metric: `first_meal_24h_after_onboarding` on the scorecard (lib/experiments/results.ts);
 * secondary: meal-step completion (Amplitude), retention_d1, trial_started_d1; guardrail:
 * onboarding_completed. Independent of `onboarding_paywall` (no layer).
 */
import type { CreateExperimentInput } from './model';

export const ONBOARDING_MEAL_STEP_KEY = 'onboarding_meal_step';

export const ONBOARDING_MEAL_STEP_EXPERIMENT = {
  key: ONBOARDING_MEAL_STEP_KEY,
  name: 'Onboarding meal step',
  description:
    'ENGAGEMENT_115_SPEC §14.8. control = today\'s meal step; variantA "Example + describe" = example result card, Snap a photo / Describe it, skip "I\'ll do it at my next meal" (sets next_meal_nudge). Primary: first_meal_24h_after_onboarding.',
  arms: [
    { key: 'control', name: 'Today\'s meal step', weight: 50, payload: {} },
    { key: 'variantA', name: 'Example + describe', weight: 50, payload: { meal_step: 'example_describe' } },
  ],
  trafficPct: 100,
  audience: { platforms: ['ios', 'android'], minAppVersion: '1.1.5', newUsersOnly: true },
  fallbackArm: 'control',
} satisfies CreateExperimentInput;
