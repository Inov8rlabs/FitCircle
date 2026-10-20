/** Envelope + error mapping for the Fitzy routes (docs/FITZY_V2_SPEC.md §3, §6). */
import { type NextResponse } from 'next/server';

import { fail, ok } from '../referrals/http';
import { FitzyLockedError, FitzyNotFoundError } from '../services/fitzy-conversation-service';
import { UpgradeRequiredError } from '../services/usage-service';
import type { FitzyPaywall } from '../types/fitzy';

import { paywallFor } from './paywall';

export { ok, fail };

export interface FitzyErrorBody {
  status: number;
  code: string;
  message: string;
  paywall?: FitzyPaywall;
  details?: Record<string, unknown>;
}

/** Map anything a Fitzy route can throw to {status, code, message, paywall?}. */
export function describeFitzyError(error: unknown): FitzyErrorBody {
  if (error instanceof UpgradeRequiredError) {
    return {
      status: 429,
      code: 'UPGRADE_REQUIRED',
      message: "You've used today's free Fitzy messages — go Pro for unlimited coaching.",
      paywall: paywallFor('fitzy_quota'),
      details: { feature: error.feature, used: error.used, limit: error.limit },
    };
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
  console.error('[fitzy] route error:', e?.message ?? e);
  return { status: 500, code: 'INTERNAL', message: 'An unexpected error occurred' };
}

export function fitzyFail(error: unknown): NextResponse {
  const d = describeFitzyError(error);
  return fail(d.status, d.code, d.message, d.paywall ? { paywall: d.paywall, ...(d.details ?? {}) } : (d.details ?? null));
}

export async function readJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
