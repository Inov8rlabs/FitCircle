import { type NextRequest, NextResponse } from 'next/server';

import { Day1MorningPushService } from '@/lib/services/day1-morning-push-service';
import { DeferredNudgeService } from '@/lib/services/deferred-nudge-service';
import { MealReminderService } from '@/lib/services/meal-reminder-service';

/**
 * GET /api/cron/meal-reminders — meal-slot reminder pushes (docs/ACTIVATION_JOURNEY_SPEC.md §4).
 * Runs every 15 minutes so breakfast 08:30 / lunch 12:30 / snack 15:30 / dinner 18:30 land within
 * 15 min of local time in every timezone. Idempotent per (user, slot, local day) via the dedupe key.
 * CRON_SECRET-gated, FAIL CLOSED. Kill switch: MEAL_REMINDERS_ENABLED=false.
 * Ops: ?userId=<uuid> runs the pass for one user only.
 *
 * The same 15-minute tick also runs (retention fixes, 2026-11-09), in this order:
 *   1. DeferredNudgeService.releaseDue — nudges held by quiet hours, released at
 *      the end of the user's quiet hours (≤ 1 per user per morning).
 *      Remote config: quiet_hours_deferral.
 *   2. Day1MorningPushService.run — the guaranteed Day-1 morning push.
 *      Remote config: day1_morning_push, day1_morning_push_hour.
 * Each pass is failure-isolated: one failing never stops the others.
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
  const deferred = await DeferredNudgeService.releaseDue({ userId }).catch((err: any) => {
    console.error('[Cron meal-reminders] deferred release failed:', err?.message);
    return { error: err?.message ?? 'deferred release failed' };
  });
  const day1 = await Day1MorningPushService.run({ userId }).catch((err: any) => {
    console.error('[Cron meal-reminders] day-1 push failed:', err?.message);
    return { error: err?.message ?? 'day-1 push failed' };
  });
  try {
    const result = await MealReminderService.run({ userId });
    return NextResponse.json({ success: true, ...result, deferred, day1 });
  } catch (err: any) {
    console.error('[Cron meal-reminders] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message ?? 'meal reminders failed' }, { status: 500 });
  }
}
