import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ShareCardService } from '@/lib/services/share-card-service';

/**
 * GET /api/mobile/share/cards/[id]
 * Get a single share card with image URL
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireMobileAuth(request);
    const { id } = await params;

    const card = await ShareCardService.getCard(id);

    if (!card) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'NOT_FOUND', message: 'Card not found' } },
        { status: 404 }
      );
    }

    const response = NextResponse.json({
      success: true,
      data: card,
      error: null,
    });

    response.headers.set('Cache-Control', 'private, max-age=300');
    return response;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    console.error('[GET /api/mobile/share/cards/[id]] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
