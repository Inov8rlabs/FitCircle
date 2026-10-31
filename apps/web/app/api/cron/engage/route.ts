import { type NextRequest, NextResponse } from 'next/server';

import { EngageSendService } from '@/lib/services/engage-send-service';
import { verifyCronSecret } from '@/lib/utils/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** GET /api/cron/engage (every 15 min) — Engage push + email sends (docs/ENGAGE_SPEC.md §9). */
export async function GET(request: NextRequest) {
  if (!verifyCronSecret(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ success: true, data: await EngageSendService.runCron() });
  } catch (error: any) {
    console.error('[cron/engage] failed:', error?.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
