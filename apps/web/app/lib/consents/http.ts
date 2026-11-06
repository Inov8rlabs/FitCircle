/**
 * Shared handlers for GET/POST consents (docs/PRIVACY_COMPLIANCE_SPEC.md §3).
 * Mounted at /api/mobile/consents (Bearer, apps) and /api/consents (web session or Bearer).
 */
import { type NextRequest, type NextResponse } from 'next/server';
import { z } from 'zod';

import { reportRouteError } from '../api/route-errors';
import { requireMobileAuth } from '../middleware/mobile-auth';
import { fail, ok } from '../referrals/http';
import {
  type AiConsentRequiredError,
  CONSENT_TYPES,
  CURRENT_CONSENT_POLICY_VERSION,
  ConsentService,
  ConsentStoreUnavailableError,
  aiConsentErrorDetails,
  appVersionFor,
  consentSourceFor,
  type ConsentSnapshot,
} from '../services/consent-service';

export const consentsBodySchema = z.object({
  consents: z
    .array(
      z.object({
        type: z.enum(CONSENT_TYPES),
        granted: z.boolean(),
        policyVersion: z.string().trim().min(1).max(40),
        grantedAt: z.string().datetime({ offset: true }).nullish(),
      })
    )
    .min(1)
    .max(10),
});

export function consentsPayload(consents: ConsentSnapshot, effective: { marketingEmail: boolean }) {
  return { consents, effective, currentPolicyVersion: CURRENT_CONSENT_POLICY_VERSION };
}

export async function handleGetConsents(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireMobileAuth(request);
    const [consents, effective] = await Promise.all([ConsentService.current(user.id), ConsentService.effective(user.id)]);
    return ok(consentsPayload(consents, effective));
  } catch (error) {
    return consentsFail(error, 'consents GET');
  }
}

export async function handlePostConsents(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireMobileAuth(request);
    let json: unknown = null;
    try {
      json = await request.json();
    } catch {
      json = null;
    }
    const parsed = consentsBodySchema.safeParse(json);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request body', null, { issues: parsed.error.issues });
    }
    const snapshot = await ConsentService.record(user.id, parsed.data.consents, {
      source: consentSourceFor(request),
      appVersion: appVersionFor(request),
    });
    return ok(consentsPayload(snapshot, await ConsentService.effective(user.id)));
  } catch (error) {
    return consentsFail(error, 'consents POST');
  }
}

function consentsFail(error: unknown, label: string): NextResponse {
  if ((error as any)?.message === 'Unauthorized') return fail(401, 'UNAUTHORIZED', 'Invalid or expired token');
  if (error instanceof ConsentStoreUnavailableError) return fail(503, 'CONSENT_STORE_UNAVAILABLE', 'We could not save your choice. Please try again.');
  reportRouteError(label, error, { code: 'INTERNAL_SERVER_ERROR' });
  return fail(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
}

/** The standard 403 envelope for AI without consent. */
export function aiConsentFail(error: AiConsentRequiredError, extraDetails: Record<string, unknown> = {}): NextResponse {
  return fail(403, error.code, error.message, null, { ...aiConsentErrorDetails(error.feature), ...extraDetails });
}
