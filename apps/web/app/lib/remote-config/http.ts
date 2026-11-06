/** Envelope + error mapping for /api/admin/remote-config/** (docs/TRIAL_FIRST_SPEC.md §6.5). */
import { type NextResponse } from 'next/server';

import { campaignFailFrom } from '../campaigns/http';
import { fail } from '../referrals/http';

import { RemoteConfigError } from './service';

export { ok } from '../referrals/http';
export { readJson } from '../campaigns/http';
/** Same auth as /api/admin/experiments: ADMIN_API_SECRET bearer + X-Admin-Actor (required on writes), or an is_admin session. */
export { requireExperimentsAdmin as requireRemoteConfigAdmin } from '../experiments/http';

/** 400 VALIDATION_ERROR with details.issues [{path, message}] (zod or value-bound errors), 404, else the campaigns mapping. */
export function remoteConfigFailFrom(error: unknown, label: string): NextResponse {
  if (error instanceof RemoteConfigError) return fail(error.status, error.code, error.message, Object.keys(error.details).length ? error.details : null, error.details);
  if ((error as any)?.name === 'ZodError') {
    const issues = ((error as any).issues ?? []).map((i: any) => ({ path: (i.path ?? []).join('.'), message: i.message }));
    return fail(400, 'VALIDATION_ERROR', 'Invalid request body', { issues }, { issues });
  }
  return campaignFailFrom(error, `remote-config/${label}`);
}
