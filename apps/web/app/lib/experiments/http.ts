/**
 * Envelope + error mapping for /api/mobile/experiments/**, the new
 * /api/mobile/onboarding/* routes and /api/admin/experiments/**.
 *
 * Every response carries `Cache-Control: no-store` (ok/fail from
 * lib/referrals/http; next.config also sets `private, no-store` on /api/*):
 * authenticated responses must never be reused across accounts.
 */
import { type NextResponse } from 'next/server';

import { requireAdsAdmin } from '../ads/http';
import { CampaignError, campaignFailFrom } from '../campaigns/http';
import { fail, failFrom } from '../referrals/http';

import { ExperimentValidationError } from './model';

export { ok, fail } from '../referrals/http';
export { readJson } from '../campaigns/http';

/** ADMIN_API_SECRET bearer + X-Admin-Actor (required on mutations), or an is_admin session. */
export const requireExperimentsAdmin = requireAdsAdmin;

function zodIssues(error: any) {
  return ((error?.issues ?? []) as any[]).map((i) => ({ path: (i.path ?? []).join('.'), message: i.message }));
}

/** Mobile routes: 401 / 400 VALIDATION_ERROR {issues} / typed errors / 500. */
export function mobileFailFrom(error: unknown, label: string): NextResponse {
  if (error instanceof CampaignError) return fail(error.status, error.code, error.message, error.data);
  if ((error as any)?.name === 'ZodError') return fail(400, 'VALIDATION_ERROR', 'Invalid request body', { issues: zodIssues(error) });
  return failFrom(error, label);
}

/** Admin routes: model validation → 400 (409 for lifecycle conflicts), else the campaigns mapping. */
export function experimentsFailFrom(error: unknown, label: string): NextResponse {
  if (error instanceof ExperimentValidationError) {
    const status = error.code === 'INVALID_TRANSITION' || error.code === 'ARM_IN_USE' || error.code === 'CONCLUDED' ? 409 : 400;
    return fail(status, error.code, error.message);
  }
  return campaignFailFrom(error, `experiments/${label}`);
}
