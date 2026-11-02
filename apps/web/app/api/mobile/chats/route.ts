import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ChatInboxService } from '@/lib/services/chat-inbox-service';

/**
 * GET /api/mobile/chats
 * The viewer's circle chats (every active membership) with unread counts and
 * the last message, newest activity first, plus total_unread for the top-nav
 * badge and the chat the button should open. The web app calls this too.
 * Contract: docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §1
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const inbox = await ChatInboxService.listChats(user.id);
    return NextResponse.json(
      { success: true, data: inbox, error: null, meta: { requestTime: Date.now() - startTime } },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error: any) {
    if (error?.message === 'Unauthorized') return fail('UNAUTHORIZED', 'Invalid or expired token', 401);
    console.error('[Mobile API] Chats inbox error:', error?.message ?? error);
    return fail('INTERNAL_SERVER_ERROR', 'An unexpected error occurred', 500);
  }
}

function fail(code: string, message: string, status: number) {
  return NextResponse.json(
    {
      success: false,
      data: null,
      error: { code, message, details: {}, timestamp: new Date().toISOString() },
      meta: null,
    },
    { status, headers: { 'Cache-Control': 'private, no-store' } }
  );
}
