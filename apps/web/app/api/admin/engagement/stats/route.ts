import { type NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/campaigns/admin-auth';
import { campaignFailFrom } from '@/lib/campaigns/http';
import { aggregateStats, type StatsRow } from '@/lib/engagement/stats';
import { createAdminSupabase } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const PAGE = 1000;
const MAX_ROWS = 50_000;

/**
 * GET /api/admin/engagement/stats?days=30&by=all|hero|growth|subject — per
 * message / channel / variant: sent, delivered, open rate, CTR, unsubscribe
 * rate, goal conversion, holdout conversion and lift (admins only).
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const q = request.nextUrl.searchParams;
    const days = Math.min(Math.max(Number(q.get('days')) || 30, 1), 180);
    const by = (q.get('by') ?? 'all').replace(/[^a-z_]/g, '') || 'all';
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const db = createAdminSupabase();
    const rows: StatsRow[] = [];
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await db
        .from('engagement_sends')
        .select('message_key, channel, status, variant, delivered_at, opened_at, clicked_at, bounced_at, complained_at, unsubscribed_at, converted_at, meta')
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...((data ?? []) as StatsRow[]));
      if ((data ?? []).length < PAGE) break;
    }
    return NextResponse.json({ success: true, data: { days, by, rows: rows.length, stats: aggregateStats(rows, by) } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return campaignFailFrom(error, 'engagement/stats');
  }
}
