/** Envelope + error mapping for the Fitzy routes (docs/FITZY_V2_SPEC.md §3, §6). */
import { type NextResponse } from 'next/server';

import { reportRouteError } from '../api/route-errors';
import { fail, ok } from '../referrals/http';
import { AiConsentRequiredError, aiConsentErrorDetails } from '../services/consent-service';
import { FitzyLockedError, FitzyNotFoundError } from '../services/fitzy-conversation-service';
import { UpgradeRequiredError } from '../services/usage-service';
import type { FitzyPaywall } from '../types/fitzy';

import { fitzyUpgradeMessage, fitzyWeeklyUsedMessage, paywallFor } from './paywall';

export { ok, fail };

export interface FitzyErrorBody {
  status: number;
  code: string;
  message: string;
  paywall?: FitzyPaywall;
  details?: Record<string, unknown>;
}

/**
 * The UPGRADE_REQUIRED `message` + `details` for a Fitzy quota refusal: daily refusals are
 * byte-identical to 1.1.4; weekly ones (1.1.5) add `window` + `resetsAt` and the weekly copy.
 */
export function fitzyUpgradeEnvelope(error: UpgradeRequiredError, dailyUsedMessage?: string): { message: string; details: Record<string, unknown> } {
  const weekly = error.extra.window === 'week';
  const trialEligible = error.trialEligible === true;
  const message = weekly
    ? fitzyWeeklyUsedMessage(error.limit)
    : error.limit > 0 && dailyUsedMessage
      ? dailyUsedMessage
      : fitzyUpgradeMessage(error.limit, trialEligible);
  return {
    message,
    details: {
      feature: error.feature,
      used: error.used,
      limit: error.limit,
      ...(weekly ? { window: 'week', resetsAt: error.extra.resetsAt ?? null } : {}),
      paywall: paywallFor('fitzy_quota', { trialEligible, trialDays: error.trialDays, weekly }),
    },
  };
}

/** Map anything a Fitzy route can throw to {status, code, message, paywall?}. */
export function describeFitzyError(error: unknown, label = 'fitzy'): FitzyErrorBody {
  if (error instanceof UpgradeRequiredError) {
    const weekly = error.extra.window === 'week';
    return {
      status: 429,
      code: 'UPGRADE_REQUIRED',
      message: weekly ? fitzyWeeklyUsedMessage(error.limit) : fitzyUpgradeMessage(error.limit, error.trialEligible === true),
      paywall: paywallFor('fitzy_quota', { trialEligible: error.trialEligible === true, trialDays: error.trialDays, weekly }),
      // 1.1.5 weekly mode adds window + resetsAt (ENGAGEMENT_115_SPEC §3.3); the daily refusal is unchanged.
      details: { feature: error.feature, used: error.used, limit: error.limit, ...(weekly ? { window: 'week', resetsAt: error.extra.resetsAt ?? null } : {}) },
    };
  }
  if (error instanceof AiConsentRequiredError) {
    return { status: 403, code: error.code, message: error.message, details: aiConsentErrorDetails(error.feature) };
  }
  if (error instanceof FitzyLockedError) {
    return { status: 403, code: 'UPGRADE_REQUIRED', message: 'This is a Fitzy Pro feature.', paywall: paywallFor(error.trigger) };
  }
  if (error instanceof FitzyNotFoundError) return { status: 404, code: 'NOT_FOUND', message: error.message };
  const e = error as any;
  if (e?.message === 'Unauthorized') return { status: 401, code: 'UNAUTHORIZED', message: 'Invalid or expired token' };
  if (e?.message === 'RateLimited') return { status: 429, code: 'RATE_LIMITED', message: "You've reached today's message limit — try again tomorrow." };
  if (e?.name === 'ZodError') return { status: 400, code: 'VALIDATION_ERROR', message: e.issues?.[0]?.message ?? 'Invalid request body' };
  if (e?.code === 'VALIDATION_ERROR') return { status: 400, code: 'VALIDATION_ERROR', message: e.message };
  reportRouteError(label, error, { code: 'INTERNAL' });
  return { status: 500, code: 'INTERNAL', message: 'An unexpected error occurred' };
}

export function fitzyFail(error: unknown, label = 'fitzy'): NextResponse {
  const d = describeFitzyError(error, label);
  // AI consent: details in error.details (the standard place), like every other AI route.
  if (d.code === 'AI_CONSENT_REQUIRED') return fail(d.status, d.code, d.message, null, d.details ?? {});
  return fail(d.status, d.code, d.message, d.paywall ? { paywall: d.paywall, ...(d.details ?? {}) } : (d.details ?? null));
}

export async function readJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
