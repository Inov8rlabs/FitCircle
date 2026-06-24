import { type NextRequest, NextResponse } from 'next/server';

import { FoodsEmbeddingService } from '@/lib/services/foods-embedding-service';

/**
 * GET /api/cron/embed-foods
 * Incrementally embeds newly-loaded foods so semantic matching stays current as the weekly
 * foods-loader adds rows. (The initial ~1.9M backfill is an out-of-band job —
 * scripts/backfill-food-embeddings.ts.) CRON_SECRET-gated, FAIL CLOSED.
 */

export const maxDuration = 60;

const BATCH = 500;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await FoodsEmbeddingService.embedPendingBatch(BATCH);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[Cron embed-foods] failed:', err?.message);
    return NextResponse.json({ success: false, error: err?.message ?? 'embed failed' }, { status: 500 });
  }
}
