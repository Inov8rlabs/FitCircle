/**
 * API Route: /api/cron/validate-streaks
 *
 * Validate all user streaks (run at 12:05 AM daily)
 * Checks for missed check-ins and applies freezes or breaks streaks
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret, createAdminSupabase } from '@/lib/utils/api-auth';
import { validateAllStreaks, resetWeeklyFreezes } from '@/lib/services/streak-service-v2';
import { getWeekStart } from '@/lib/services/goal-service';

/**
 * GET /api/cron/validate-streaks
 *
 * Validate streaks and reset freezes if Monday
 * Requires: CRON_SECRET in authorization header
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    if (!verifyCronSecret(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminSupabase();

    // Validate all streaks
    const { validated, freezeApplied, broken, error } = await validateAllStreaks(supabase);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Check if today is Monday - reset freezes
    const today = new Date();
    const isMonday = today.getDay() === 1;
    let freezesReset = 0;

    if (isMonday) {
      const { reset, error: resetError } = await resetWeeklyFreezes(supabase);
      if (!resetError) {
        freezesReset = reset;
      }
    }

    return NextResponse.json({
      success: true,
      date: today.toISOString().split('T')[0],
      validated_streaks: validated,
      freezes_applied: freezeApplied,
      streaks_broken: broken,
      is_monday: isMonday,
      freezes_reset: freezesReset,
    });
  } catch (error) {
    console.error('Validate streaks cron error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
