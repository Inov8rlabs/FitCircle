/**
 * API Route: /api/streaks/freeze
 *
 * Use weekly streak freeze
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, createAdminSupabase } from '@/lib/utils/api-auth';
import { useFreeze } from '@/lib/services/streak-service-v2';

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

    const { success, error } = await useFreeze(user.id, supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success, message: 'Freeze applied successfully' });
  } catch (error) {
    console.error('Use freeze error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
