import { NextResponse } from 'next/server';

import { createServerSupabase } from '@/lib/supabase-server';
import { EntitlementService } from '@/lib/services/entitlement-service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/entitlements — web-session twin of GET /api/mobile/entitlements.
 * Same payload shape so web components and mobile clients share one contract.
 */
export async function GET() {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
        { status: 401 }
      );
    }

    const entitlements = await EntitlementService.getEntitlements(user.id);
    return NextResponse.json({ success: true, data: entitlements, error: null });
  } catch (error: any) {
    console.error('[entitlements] error:', error?.message);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } },
      { status: 500 }
    );
  }
}
