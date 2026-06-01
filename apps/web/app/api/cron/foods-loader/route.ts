import { type NextRequest, NextResponse } from 'next/server';

import { FoodsLoaderService } from '@/lib/services/foods-loader-service';

/**
 * GET /api/cron/foods-loader
 * PRD §7.3 (load OFF → foods table) / §6.11 (cultural-cuisine wedge — bias coverage toward
 * South-Asian + Canadian foods, the slices the eval treats as first-class).
 *
 * Incremental: each run pulls a page per term and idempotently upserts on (source, source_id),
 * so repeated runs enrich coverage without duplicating. CRON_SECRET-guarded.
 *
 * `?term=` overrides the term list for a one-off targeted load.
 */

// Cuisine-wedge + common-food terms. South-Asian/Canadian first (the §6.11 priority).
const DEFAULT_TERMS = [
  // South Asian wedge
  'biryani', 'dal', 'roti', 'paneer', 'dosa', 'samosa', 'chana masala', 'naan', 'curry',
  // Canadian / common packaged
  'poutine', 'oatmeal', 'greek yogurt', 'granola bar', 'protein bar', 'almond milk',
  // staples
  'chicken breast', 'brown rice', 'banana', 'eggs', 'peanut butter',
];

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const override = searchParams.get('term');
    const terms = override ? [override] : DEFAULT_TERMS;

    let totalFetched = 0;
    let totalUpserted = 0;
    const perTerm: Record<string, { fetched: number; upserted: number; error?: string }> = {};

    // Sequential + failure-isolated per term so one bad/timed-out term doesn't abort the run.
    for (const term of terms) {
      try {
        const { fetched, upserted } = await FoodsLoaderService.loadOffBySearch(term);
        perTerm[term] = { fetched, upserted };
        totalFetched += fetched;
        totalUpserted += upserted;
      } catch (err: any) {
        perTerm[term] = { fetched: 0, upserted: 0, error: err?.message ?? 'failed' };
        console.error(`[cron/foods-loader] term "${term}" failed:`, err?.message);
      }
    }

    return NextResponse.json({
      success: true,
      data: { totalFetched, totalUpserted, terms: perTerm },
      meta: { requestTime: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[cron/foods-loader] error:', error?.message);
    return NextResponse.json({ success: false, error: error?.message ?? 'failed' }, { status: 500 });
  }
}
