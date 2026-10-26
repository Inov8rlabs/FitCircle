import { type NextRequest, NextResponse } from 'next/server';

import { MealReminderService } from '@/lib/services/meal-reminder-service';

/**
 * GET /api/cron/meal-reminders — meal-slot reminder pushes (docs/ACTIVATION_JOURNEY_SPEC.md §4).
 * Runs every 15 minutes so breakfast 08:30 / lunch 12:30 / snack 15:30 / dinner 18:30 land within
 * 15 min of local time in every timezone. Idempotent per (user, slot, local day) via the dedupe key.
 * CRON_SECRET-gated, FAIL CLOSED. Kill switch: MEAL_REMINDERS_ENABLED=false.
 * Ops: ?userId=<uuid> runs the pass for one user only.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = request.nextUrl.searchParams.get('userId') ?? undefined;
  if (userId && !/^[0-9a-f-]{36}$/i.test(userId)) {
    return NextResponse.json({ error: 'userId must be a uuid' }, { status: 400 });
  }
  try {
    const result = await MealReminderService.run({ userId });
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Cron meal-reminders] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message ?? 'meal reminders failed' }, { status: 500 });
  }
}
