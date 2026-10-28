import { type NextRequest, NextResponse } from 'next/server';

import { TrialReminderService } from '@/lib/services/trial-reminder-service';

/**
 * GET /api/cron/trial-reminders — "your trial ends tomorrow" push
 * (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §3.2). Hourly; each trial is reminded
 * once at ≈10:00 local the day before it ends (TrialReminderService).
 * CRON_SECRET-gated, FAIL CLOSED. Kill switch: TRIAL_REMINDERS_ENABLED=false.
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
    const result = await TrialReminderService.run({ userId });
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Cron trial-reminders] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message ?? 'trial reminders failed' }, { status: 500 });
  }
}
