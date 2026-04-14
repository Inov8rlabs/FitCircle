import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ShareCardService } from '@/lib/services/share-card-service';

/**
 * POST /api/mobile/share/cards/[id]/shared
 * Increment share count when card is shared
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireMobileAuth(request);
    const { id } = await params;

    await ShareCardService.incrementShareCount(id, user.id);

    return NextResponse.json({
      success: true,
      data: { shared: true },
      error: null,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    if (error instanceof Error && error.message === 'Card not found') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'NOT_FOUND', message: 'Card not found' } },
        { status: 404 }
      );
    }

    console.error('[POST /api/mobile/share/cards/[id]/shared] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
