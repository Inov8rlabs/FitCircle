/**
 * API Route: /api/streaks/freeze
 *
 * Use weekly streak freeze
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { type NextRequest, NextResponse } from 'next/server';

import { useFreeze as applyFreeze } from '@/lib/services/streak-service-v2';
import { getAuthenticatedUser, createAdminSupabase } from '@/lib/utils/api-auth';

/**
 * POST /api/streaks/freeze
 *
 * Manually use the weekly freeze
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminSupabase();

    // Honour the device's local timezone so "today" is the user's today.
    const timezone = request.headers.get('x-client-timezone') || undefined;

    const { success, error } = await applyFreeze(user.id, supabase, timezone);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success, message: 'Freeze applied successfully' });
  } catch (error) {
    console.error('Use freeze error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
