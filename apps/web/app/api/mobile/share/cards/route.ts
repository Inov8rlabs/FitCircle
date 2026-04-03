import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ShareCardService, ShareCardType } from '@/lib/services/share-card-service';

const VALID_CARD_TYPES: ShareCardType[] = [
  'milestone',
  'challenge_complete',
  'perfect_week',
  'momentum_flame',
  'circle_boost',
];

const generateCardSchema = z.object({
  card_type: z.enum(VALID_CARD_TYPES as [string, ...string[]]),
  card_data: z.record(z.unknown()),
});

/**
 * POST /api/mobile/share/cards
 * Generate a new share card
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();
    const { card_type, card_data } = generateCardSchema.parse(body);

    const card = await ShareCardService.generateCard(
      user.id,
      card_type as ShareCardType,
      card_data as unknown as Parameters<typeof ShareCardService.generateCard>[2]
    );

    return NextResponse.json({
      success: true,
      data: card,
      error: null,
    }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.errors } },
        { status: 400 }
      );
    }

    console.error('[POST /api/mobile/share/cards] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

/**
 * GET /api/mobile/share/cards
 * Get user's recent share cards
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50);

    const cards = await ShareCardService.getUserCards(user.id, limit);

    const response = NextResponse.json({
      success: true,
      data: cards,
      error: null,
    });

    response.headers.set('Cache-Control', 'private, max-age=60');
    return response;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    console.error('[GET /api/mobile/share/cards] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
