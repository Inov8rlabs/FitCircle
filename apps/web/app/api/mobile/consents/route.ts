import { type NextRequest } from 'next/server';

import { handleGetConsents, handlePostConsents } from '@/lib/consents/http';

export const dynamic = 'force-dynamic';

/**
 * GET  /api/mobile/consents → { consents: {health_data, ai_processing, marketing_email}, currentPolicyVersion }
 * POST /api/mobile/consents { consents: [{ type, granted, policyVersion, grantedAt? }] } → same shape.
 * Contract: docs/PRIVACY_COMPLIANCE_SPEC.md §3.
 */
export async function GET(request: NextRequest) {
  return handleGetConsents(request);
}

export async function POST(request: NextRequest) {
  return handlePostConsents(request);
}
