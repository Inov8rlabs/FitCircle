import { NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MobileAPIService } from '@/lib/services/mobile-api-service';

import { PUT as updateSettingsPreferences } from '../../settings/preferences/route';

/**
 * PUT /api/mobile/profile/preferences
 *
 * Alias of PUT /api/mobile/settings/preferences for the iOS app, which saves
 * Privacy and Display settings here (APIClient.swift `updatePreferences`).
 *
 * iOS sends   { "preferences": { "notifications": {…}, "privacy": {…}, "display": {…} } }
 * iOS decodes APIResponse<ProfileResponseWrapper>  ->  data.user is a full `User`.
 *
 * The save itself is done by the settings/preferences handler (same validation,
 * same merge). This route only adapts the body and the response:
 *  - the `preferences` wrapper is removed (an unwrapped body works too);
 *  - `notifications` is NOT saved from here. iOS re-sends the whole preferences
 *    object of the profile it loaded, but only edits privacy and display on
 *    these screens; notification settings have their own endpoint
 *    (/api/mobile/notifications/preferences) and must not be overwritten by a
 *    stale copy;
 *  - the response is `{ user }` in the shape of GET /api/mobile/profile.
 */

const FORWARDED_SECTIONS = ['privacy', 'display', 'security'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSettingsBody(body: unknown): Record<string, unknown> {
  const root = isPlainObject(body) ? body : {};
  const source = isPlainObject(root.preferences) ? root.preferences : root;
  const out: Record<string, unknown> = {};
  for (const section of FORWARDED_SECTIONS) {
    if (section in source) out[section] = source[section];
  }
  return out;
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    {
      success: false,
      data: null,
      error: { code, message, details: {}, timestamp: new Date().toISOString() },
      meta: null,
    },
    { status }
  );
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, 'VALIDATION_ERROR', 'Request body must be JSON');
    }

    // Same credentials and client headers, adapted body.
    const headers = new Headers(request.headers);
    headers.set('content-type', 'application/json');
    headers.delete('content-length');
    const delegated = await updateSettingsPreferences(
      new NextRequest(new URL('/api/mobile/settings/preferences', request.url), {
        method: 'PUT',
        headers,
        body: JSON.stringify(toSettingsBody(body)),
      })
    );

    // Validation / auth / server errors: already in the standard envelope.
    if (!delegated.ok) return delegated;

    const profile = await MobileAPIService.getUserProfileWithStats(user.id);

    const response = NextResponse.json({
      success: true,
      data: { user: profile },
      error: null,
      meta: null,
    });

    // Keep the silent token refresh the delegated handler may have issued.
    for (const name of ['X-New-Access-Token', 'X-New-Refresh-Token', 'X-New-Expires-At']) {
      const value = delegated.headers.get(name);
      if (value) response.headers.set(name, value);
    }
    // Never cacheable: caches key by URL, not Authorization.
    response.headers.set('Cache-Control', 'private, no-store');

    return response;
  } catch (error: any) {
    console.error('[Mobile API] Update profile preferences error:', { message: error?.message });

    if (error?.message === 'Unauthorized') {
      return errorResponse(401, 'UNAUTHORIZED', 'Invalid or expired token');
    }
    return errorResponse(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');
  }
}
