import { type NextRequest, NextResponse } from 'next/server';

import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/cron/cleanup-token-blacklist
 * Daily cron job to remove blacklisted JWT tokens whose underlying access
 * token has already expired naturally. Once the JWT exp claim has passed,
 * keeping a row in `token_blacklist` is pointless — the JWT is already
 * rejected by signature/expiry checks before the blacklist lookup runs.
 *
 * Schedule: once a day (configured in vercel.json).
 * Protected by CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

    if (!authHeader || authHeader !== expectedAuth) {
      console.error('[Cron Cleanup Token Blacklist] Unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const startTime = Date.now();
    const supabaseAdmin = createAdminSupabase();

    // Delete every row whose expires_at is in the past. expires_at is set
    // at insert time to the JWT's natural expiry, so this is purely a
    // size-bound on the table — it never deletes a row that's still
    // semantically blocking a live token.
    const { data, error } = await supabaseAdmin
      .from('token_blacklist')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error) {
      console.error('[Cron Cleanup Token Blacklist] Delete failed:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    const deletedCount = data?.length ?? 0;
    console.log(
      `[Cron Cleanup Token Blacklist] Deleted ${deletedCount} expired token(s) in ${Date.now() - startTime}ms`
    );

    return NextResponse.json({
      success: true,
      deletedCount,
      durationMs: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error('[Cron Cleanup Token Blacklist] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
