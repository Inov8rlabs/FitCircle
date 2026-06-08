import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FitzyConversationService } from '@/lib/services/fitzy-conversation-service';

/**
 * GET  /api/mobile/fitzy/history?conversationId=&before=&limit=
 *   → { conversationId, messages: [{id,role,content,createdAt}] (oldest→newest), hasMore, nextBefore }
 *   Cross-device scrollback for Fitzy. `before` (ISO timestamp) pages further into the past;
 *   omit conversationId to use the user's active conversation (get-or-create).
 *
 * DELETE /api/mobile/fitzy/history?conversationId=
 *   → clears the conversation's messages ("clear history"). → { conversationId }
 *
 * Thin route: all logic + ownership scoping live in FitzyConversationService.
 */

function unauthorized() {
  return NextResponse.json(
    { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 401 }
  );
}

function serverError() {
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId') ?? undefined;
    const before = searchParams.get('before') ?? undefined;
    const limitRaw = searchParams.get('limit');
    const limit = limitRaw ? parseInt(limitRaw, 10) : undefined;

    const data = await FitzyConversationService.getHistory(user.id, {
      conversationId,
      before,
      limit: Number.isFinite(limit as number) ? (limit as number) : undefined,
    });

    return NextResponse.json({ success: true, data, meta: { requestTime: Date.now() - startTime }, error: null });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') return unauthorized();
    console.error('[Mobile API] Fitzy history error:', { message: error?.message });
    return serverError();
  }
}

export async function DELETE(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get('conversationId') ?? undefined;

    const data = await FitzyConversationService.clear(user.id, conversationId);

    return NextResponse.json({ success: true, data, meta: { requestTime: Date.now() - startTime }, error: null });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') return unauthorized();
    console.error('[Mobile API] Fitzy history clear error:', { message: error?.message });
    return serverError();
  }
}
