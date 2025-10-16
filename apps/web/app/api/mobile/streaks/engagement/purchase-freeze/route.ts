import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';

/**
 * POST /api/streaks/engagement/purchase-freeze
 * Purchase additional streak freeze (100 XP or $0.99)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[POST /api/streaks/engagement/purchase-freeze] User:', user.id);

    // Parse request body
    const body = await request.json();
    const { payment_method } = body; // 'xp' or 'money'

    // TODO: Implement payment/XP deduction logic here
    // For now, just purchase the freeze

    // Purchase freeze
    await EngagementStreakService.purchaseFreeze(user.id);

    return NextResponse.json({
      success: true,
      message: 'Freeze purchased successfully',
      payment_method: payment_method || 'xp',
    });

  } catch (error) {
    console.error('[POST /api/streaks/engagement/purchase-freeze] Error:', error);

    // Handle specific error types
    if (error instanceof Error && error.message.includes('maximum')) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to purchase freeze', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
