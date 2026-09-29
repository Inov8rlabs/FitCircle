import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import {
  ShieldPurchaseError,
  SHIELD_PURCHASE_ERROR_CODES,
  StreakShieldService,
} from '@/lib/services/streak-shield-service';
import { readJsonBody } from '@/lib/streaks/request-body';

/**
 * POST /api/mobile/streaks/engagement/purchase-freeze
 * Buy one streak shield with XP.
 *
 * Body: { payment_method?: 'xp' }   // absent or null means 'xp'
 *
 * Only XP is accepted. Every other payment method ('iap', 'in_app_purchase',
 * 'money', 'stripe', ...) is refused: the $0.99 option has no store product
 * and no server-side receipt validation yet, so there is no verified payment
 * this route could settle. It never grants a shield without charging XP.
 *
 * Success (existing keys `success`, `message`, `payment_method` unchanged):
 * {
 *   success: true,
 *   message: 'Freeze purchased successfully',
 *   payment_method: 'xp',
 *   data: { success, payment_method, new_freeze_count, xp_spent, xp_remaining }
 * }
 *
 * Failure keeps `{ success: false, error: <string>, data: null }` and adds
 * `code`, `message` and `details`.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    console.log('[POST /api/mobile/streaks/engagement/purchase-freeze] User:', user.id);

    // Parse request body (an absent or empty body means an XP purchase, as before)
    const body = await readJsonBody(request);
    const rawMethod = body.payment_method ?? body.paymentMethod;
    const paymentMethod =
      rawMethod === undefined || rawMethod === null || rawMethod === ''
        ? 'xp'
        : String(rawMethod).trim().toLowerCase();

    if (paymentMethod !== 'xp') {
      throw new ShieldPurchaseError(
        'Paid shield purchases are not available yet. You can buy a shield with XP.',
        SHIELD_PURCHASE_ERROR_CODES.PAYMENT_NOT_SUPPORTED,
        400,
        { payment_method: paymentMethod, supported: ['xp'] }
      );
    }

    const purchase = await StreakShieldService.purchaseWithXp(user.id);

    return NextResponse.json({
      success: true,
      message: 'Freeze purchased successfully',
      payment_method: purchase.payment_method,
      data: {
        success: true,
        payment_method: purchase.payment_method,
        new_freeze_count: purchase.new_freeze_count,
        xp_spent: purchase.xp_spent,
        xp_remaining: purchase.xp_remaining,
      },
    });

  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', data: null },
        { status: 401 }
      );
    }

    if (error instanceof ShieldPurchaseError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          data: null,
          code: error.code,
          message: error.message,
          details: error.details,
        },
        { status: error.status }
      );
    }

    console.error('[POST /api/mobile/streaks/engagement/purchase-freeze] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to purchase freeze',
        data: null,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to purchase freeze',
      },
      { status: 500 }
    );
  }
}
