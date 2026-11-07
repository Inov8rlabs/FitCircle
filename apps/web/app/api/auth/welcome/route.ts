import { type NextRequest, NextResponse } from 'next/server';

import { reportRouteError } from '@/lib/api/route-errors';
import { verifyMobileAuth } from '@/lib/middleware/mobile-auth';
import { applyRateLimit, createRateLimiter, getIdentifier } from '@/lib/middleware/rate-limit';
import { isTestDeviceRequest } from '@/lib/services/test-device-service';
import { triggerWelcomeEmail } from '@/lib/services/welcome-email-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

/** Only accounts created this recently can ask for their welcome email. */
const NEW_ACCOUNT_WINDOW_MS = 60 * 60 * 1000;

const limiter = createRateLimiter({ name: 'auth-welcome', interval: 60 * 60_000, uniqueTokenPerInterval: 5000, maxRequests: 10 });
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * The session cookie (web) or our mobile JWT, else a Supabase access token in
 * `Authorization: Bearer` (the browser store sends it so a cookie that isn't
 * written yet can't lose the welcome email).
 */
async function resolveUser(request: NextRequest): Promise<{ id: string; email?: string | null; display_name?: string | null; created_at?: string | null } | null> {
  const viaApp = await verifyMobileAuth(request);
  if (viaApp?.id) return viaApp;
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const { data, error } = await createAdminSupabase().auth.getUser(auth.slice(7));
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? null, created_at: data.user.created_at ?? null };
}

/**
 * POST /api/auth/welcome — the web app signs up client-side
 * (supabase.auth.signUp in stores/auth-store.ts), so no server route sees the
 * new account. The store calls this right after a successful sign-up (session
 * cookie). The server re-checks that the signed-in account was created in the
 * last hour, then runs the same once-only welcome send as every other sign-up
 * path (lib/services/welcome-email-service.ts). Calling it again, or for an
 * older account, is a no-op: `{ queued: false }`.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await resolveUser(request);
    if (!user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    const limited = await applyRateLimit(request, limiter, getIdentifier(request, user.id));
    if (limited) return limited;

    const { data, error } = await createAdminSupabase().auth.admin.getUserById(user.id);
    if (error) console.warn('[auth/welcome] getUserById failed:', error.message);
    const authUser = data?.user;
    const createdAt = authUser?.created_at ?? user.created_at ?? null;
    const isNew = !!createdAt && Date.now() - Date.parse(createdAt) < NEW_ACCOUNT_WINDOW_MS;
    if (isNew) {
      const meta = (authUser?.user_metadata ?? {}) as Record<string, unknown>;
      triggerWelcomeEmail({
        userId: user.id,
        email: authUser?.email ?? user.email,
        displayName: (user.display_name as string | undefined) ?? (typeof meta.name === 'string' ? meta.name : null),
        method: 'email',
        platform: 'web',
        testDevice: isTestDeviceRequest(request.headers),
      });
    }
    return NextResponse.json({ success: true, data: { queued: isNew } }, { headers: NO_STORE });
  } catch (error) {
    reportRouteError('auth/welcome', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
