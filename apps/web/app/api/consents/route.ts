import { type NextRequest } from 'next/server';

import { handleGetConsents, handlePostConsents } from '@/lib/consents/http';

export const dynamic = 'force-dynamic';

/**
 * Web twin of /api/mobile/consents (session cookie or Bearer). Same contract:
 * docs/PRIVACY_COMPLIANCE_SPEC.md §3. Rows are recorded with source 'web'.
 */
export async function GET(request: NextRequest) {
  return handleGetConsents(request);
}

export async function POST(request: NextRequest) {
  return handlePostConsents(request);
}
