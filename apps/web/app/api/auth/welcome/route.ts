import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { triggerUserCreated } from '@/lib/services/user-created-hook';

export const dynamic = 'force-dynamic';

/** Only accounts created this recently can ask for their welcome email. */
const NEW_ACCOUNT_WINDOW_MS = 60 * 60 * 1000;

/**
 * POST /api/auth/welcome — the web app signs up client-side
 * (supabase.auth.signUp in stores/auth-store.ts), so no server route sees the
 * new account. It calls this right after a successful sign-up; the server
 * re-checks that the signed-in account really is new, then runs the same
 * onUserCreated hook as every other signup path (idempotent: one welcome
 * email per account, ever).
 */
export async function POST(request: NextRequest) {
  let user: any;
  try {
    user = await requireMobileAuth(request);
  } catch {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const { data } = await createAdminSupabase().auth.admin.getUserById(user.id);
  const createdAt = data?.user?.created_at ?? user.created_at;
  const isNew = !!createdAt && Date.now() - Date.parse(createdAt) < NEW_ACCOUNT_WINDOW_MS;
  if (isNew) {
    triggerUserCreated({
      userId: user.id,
      email: data?.user?.email ?? user.email,
      displayName: user.display_name ?? user.full_name ?? (data?.user?.user_metadata as any)?.name ?? null,
      method: 'email',
      platform: 'web',
    });
  }
  return NextResponse.json({ success: true, data: { queued: isNew } }, { headers: { 'Cache-Control': 'no-store' } });
}
