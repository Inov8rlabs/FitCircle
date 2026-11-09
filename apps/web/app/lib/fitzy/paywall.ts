/**
 * Fitzy Pro paywall payloads (docs/FITZY_V2_SPEC.md §6, docs/TRIAL_FIRST_SPEC.md §2).
 *
 * `paywallFor(trigger)` is the original payload (unchanged for weekly_plan / memory /
 * history). Passing `{ trialEligible }` makes it trial-aware: it adds the additive
 * `trialDays` + `trialEligible` fields and, for the chat gate (fitzy_quota), the
 * trial-first headline + CTA. Shipped clients ignore the extra fields.
 *
 * Trial length: the caller passes `trialDays` (remote config `trial_days`, resolved for the
 * request — UpgradeRequiredError.trialDays); omitted → the code default (lib/config/trial.ts).
 */
import { DEFAULT_TRIAL_DAYS, normalizeTrialDays, trialDayAdjective, tryProFreeHeadline } from '../config/trial';
import type { FitzyPaywall, PaywallTrigger } from '../types/fitzy';

const HEADLINES: Record<PaywallTrigger, string> = {
  fitzy_quota: 'Keep the momentum going',
  weekly_plan: 'Your plan is ready',
  memory: 'Fitzy can remember what matters to you',
  history: 'Pick up any conversation',
};

const BULLETS = ['Unlimited coaching with Fitzy, every day', 'A weekly plan built around your goals', 'Fitzy remembers your routines and preferences'];

/** Trial-first copy (TRIAL_FIRST_SPEC §2). The headline is tryProFreeHeadline(trialDays). */
export const TRIAL_COPY = {
  cta: 'Start free trial',
  cancelAnytime: 'Cancel anytime',
} as const;

/** Copy for users who already used their trial (or had Pro before). */
export const NON_TRIAL_COPY = {
  headline: 'Unlock Fitzy Pro',
  cta: 'Continue with Pro',
} as const;

/** The 429 UPGRADE_REQUIRED message when free Fitzy chat is 0/day (chat requires Pro or a trial). */
export const FITZY_CHAT_LOCKED_MESSAGE = {
  trial: 'Start your free trial to chat with Fitzy.',
  noTrial: 'Upgrade to Pro to chat with Fitzy.',
} as const;

/** The pre-trial-first message, still used if the free limit is ever raised above 0 again. */
export const FITZY_QUOTA_USED_MESSAGE = "You've used today's free Fitzy messages — go Pro for unlimited coaching.";

export function paywallFor(trigger: PaywallTrigger, opts?: { trialEligible: boolean; trialDays?: number }): FitzyPaywall {
  const base: FitzyPaywall = { trigger, headline: HEADLINES[trigger], bullets: [...BULLETS], cta: 'Unlock Fitzy Pro' };
  if (!opts) return base;
  const trial = opts.trialEligible;
  const days = normalizeTrialDays(opts.trialDays ?? DEFAULT_TRIAL_DAYS);
  const withTrial: FitzyPaywall = { ...base, trialDays: days, trialEligible: trial };
  if (trigger !== 'fitzy_quota') return withTrial;
  return {
    ...withTrial,
    headline: trial ? tryProFreeHeadline(days) : NON_TRIAL_COPY.headline,
    // "Cancel anytime" rides in the bullets so shipped clients that render bullets show it too.
    bullets: trial ? [...BULLETS, TRIAL_COPY.cancelAnytime] : [...BULLETS],
    cta: trial ? TRIAL_COPY.cta : NON_TRIAL_COPY.cta,
  };
}

/** UPGRADE_REQUIRED message for a blocked Fitzy chat turn. */
export function fitzyUpgradeMessage(limit: number, trialEligible: boolean): string {
  if (limit > 0) return FITZY_QUOTA_USED_MESSAGE;
  return trialEligible ? FITZY_CHAT_LOCKED_MESSAGE.trial : FITZY_CHAT_LOCKED_MESSAGE.noTrial;
}

// ---------------------------------------------------------------- food AI (TRIAL_FIRST_SPEC §5)

/** The paywall payload for the food AI lifetime allowance (details.paywall on food UPGRADE_REQUIRED). */
export interface FoodAiPaywall {
  trigger: 'food_ai';
  headline: string;
  body: string;
  bullets: string[];
  cta: string;
  trialDays: number;
  trialEligible: boolean;
}

export const FOOD_AI_COPY = {
  headline: 'Unlock food logging analysis',
  bullets: ['AI analysis for every meal photo and description', 'Calories and macros in seconds', 'Fitzy coaching and your weekly plan'],
} as const;

/** "You've used your 5 free AI food analyses. Start your free 7-day trial to keep logging with AI." */
export function foodAiBody(limit: number, trialEligible: boolean, trialDays: number = DEFAULT_TRIAL_DAYS): string {
  const used = `You've used your ${limit} free AI food analyses.`;
  return trialEligible ? `${used} Start your free ${trialDayAdjective(trialDays)} trial to keep logging with AI.` : `${used} Upgrade to Pro to keep logging with AI.`;
}

export function foodAiPaywall(limit: number, trialEligible: boolean, trialDays: number = DEFAULT_TRIAL_DAYS): FoodAiPaywall {
  return {
    trigger: 'food_ai',
    headline: FOOD_AI_COPY.headline,
    body: foodAiBody(limit, trialEligible, trialDays),
    bullets: trialEligible ? [...FOOD_AI_COPY.bullets, TRIAL_COPY.cancelAnytime] : [...FOOD_AI_COPY.bullets],
    cta: trialEligible ? TRIAL_COPY.cta : NON_TRIAL_COPY.cta,
    trialDays: normalizeTrialDays(trialDays),
    trialEligible,
  };
}

/** The food-route UPGRADE_REQUIRED message. `savedNote`: the photo/entry was kept (Option B). */
export function foodAiUpgradeMessage(limit: number, trialEligible: boolean, savedNote = false, trialDays: number = DEFAULT_TRIAL_DAYS): string {
  const body = foodAiBody(limit, trialEligible, trialDays);
  return savedNote ? `${body} We saved your photo so you can add the details.` : body;
}

/** details for a food UPGRADE_REQUIRED: the legacy {feature, used, limit} plus the additive paywall. */
export function foodAiUpgradeDetails(err: { feature: string; used: number; limit: number; trialEligible?: boolean; trialDays?: number }) {
  return {
    feature: err.feature,
    used: err.used,
    limit: err.limit,
    paywall: foodAiPaywall(err.limit, err.trialEligible === true, err.trialDays),
  };
}
