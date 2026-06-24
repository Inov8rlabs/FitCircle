import { type NextRequest, NextResponse } from 'next/server';

import { ReminderService } from '@/lib/services/reminder-service';

/**
 * GET /api/cron/reminders
 * State-aware daily streak reminder. Runs HOURLY; ReminderService sends to each user at
 * their local target hour and ONLY if they haven't already claimed/logged today (their tz).
 * Replaces the iOS "static" local reminders. CRON_SECRET-gated, FAIL CLOSED.
 *
 * NOTE: actual delivery requires FCM creds in the env (FCM_PROJECT_ID / _SERVICE_ACCOUNT_EMAIL
 * / _PRIVATE_KEY) and registered device tokens — until then PushService no-ops.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await ReminderService.sendDailyStreakReminders();
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Cron reminders] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message ?? 'reminders failed' }, { status: 500 });
  }
}
