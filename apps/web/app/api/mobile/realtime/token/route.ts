import { type NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';

/**
 * GET /api/mobile/realtime/token
 *
 * Mints a short-lived **Supabase-compatible** JWT for authenticating the Supabase
 * Realtime websocket (Circle Chat). Mobile clients authenticate our REST API with a
 * custom app JWT (signed with JWT_SECRET), which Supabase Realtime cannot validate —
 * so RLS `auth.uid()` is NULL and members receive zero postgres_changes events. This
 * endpoint issues a token signed with the project's **SUPABASE_JWT_SECRET**, carrying
 * the `sub` (= user id) and `role: authenticated` claims Supabase RLS needs, so
 * `circle_messages` / `circle_message_reactions` SELECT policies resolve for the
 * subscriber and realtime delivery works.
 *
 * The web app doesn't need this — it holds a real GoTrue session whose token supabase-js
 * already attaches to the socket.
 *
 * Returns: { success, data: { token, expires_at } }  (expires_at = unix seconds)
 * 503 REALTIME_UNAVAILABLE when SUPABASE_JWT_SECRET is not configured (clients then
 * degrade to REST-only chat, i.e. current behavior, rather than breaking).
 */

// The realtime token lifetime. Kept short; clients re-fetch before expiry.
const REALTIME_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const userId: string | undefined = user?.id ?? user?.userId;
    if (!userId) {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      );
    }

    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret || secret.length < 20) {
      // Not configured — realtime stays off (REST chat still works). Not an error the
      // client should retry aggressively; it's a deployment configuration gap.
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'REALTIME_UNAVAILABLE',
            message: 'Realtime token signing is not configured on the server.',
          },
        },
        { status: 503 }
      );
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = nowSeconds + REALTIME_TOKEN_TTL_SECONDS;

    // Claims required for Supabase Realtime RLS:
    //   sub  -> auth.uid()   (must match fitcircle_members.user_id / profiles.id)
    //   role -> auth.role()  ('authenticated' so RLS treats it as a logged-in user)
    //   aud  -> 'authenticated' (GoTrue audience)
    const token = jwt.sign(
      {
        sub: userId,
        role: 'authenticated',
        aud: 'authenticated',
        iat: nowSeconds,
        exp: expiresAt,
      },
      secret,
      { algorithm: 'HS256' }
    );

    return NextResponse.json({
      success: true,
      data: { token, expires_at: expiresAt },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unauthorized';
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message } },
      { status: 401 }
    );
  }
}
