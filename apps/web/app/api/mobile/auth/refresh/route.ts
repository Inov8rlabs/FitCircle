import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { checkIntegrity, recordSessionAttestation, resolveBypass, userIdFromAccessToken } from '@/lib/integrity/enforcement';
import { enforceAbuseLimits } from '@/lib/security/abuse-limits';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';

// Validation schema
const refreshSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await enforceAbuseLimits(request, 'refresh');
    if (rateLimitResponse) return rateLimitResponse;

    // Parse and validate request body
    // Read a clone: checkIntegrity hashes the raw body afterwards, which needs the original unread.
    const body = await request.clone().json();
    const validatedData = parseLenient(refreshSchema, body);

    // Android integrity_v1 clients re-attest on every refresh (new session id).
    // A failing device continues only for a user on integrity_bypass_user_ids or an email on
    // integrity_reviewer_emails; both come from a refresh token that verifies (signature +
    // expiry; we signed the email in at login / google), never from the client.
    const integrity = await checkIntegrity(request, { action: 'refresh' });
    if (!integrity.allowed) {
      const payload = integrity.bypassEligible ? await MobileAPIService.verifyRefreshToken(validatedData.refresh_token) : null;
      const identity = { userId: payload?.userId ?? null, email: payload?.email ?? null };
      if (!(await resolveBypass(request, integrity, identity, 'refresh'))) return integrity.response!;
    }

    // Refresh the access token
    const tokens = await MobileAPIService.refreshAccessToken(validatedData.refresh_token);
    const userId = tokens ? userIdFromAccessToken(tokens.access_token) : null;
    if (tokens && userId) await recordSessionAttestation(request, integrity, { userId, accessToken: tokens.access_token });

    if (!tokens) {
      return NextResponse.json(
        {
          error: 'Invalid refresh token',
          message: 'The refresh token is invalid or has expired',
        },
        { status: 401 }
      );
    }

    // Return new token pair (iOS expects just { session: {...} })
    return NextResponse.json({
      session: tokens,
    });
  } catch (error) {
    console.error('Mobile refresh error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation error',
          message: validationMessage(error),
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
