import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FitzyService } from '@/lib/services/fitzy-service';
import type { FitzyChatResponse } from '@/lib/types/fitzy';

/**
 * POST /api/mobile/fitzy/chat
 * Fitzy — the FitCircle AI coach (full fitness + nutrition). Multi-turn; history is held by the
 * client and sent as `messages` (oldest→newest, last turn = the new user message).
 *
 * Body: { messages: [{ role: 'user'|'assistant', content: string }], circleId?: string }
 *   → FitzyChatResponse { answer, disclaimer }  (answer is Markdown)
 *
 * Thin route: all coaching logic + the safety guardrails live in FitzyService, which never
 * returns unsafe content and never throws on bad model output.
 */

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(4000),
});

const requestSchema = z.object({
  // Cap inbound history defensively; the service also keeps only the tail.
  messages: z.array(messageSchema).min(1, 'At least one message is required').max(50),
  circleId: z.string().trim().min(1).max(100).optional(),
});

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues[0]?.message ?? 'Invalid request body',
            details: { issues: parsed.error.issues },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    const { messages, circleId } = parsed.data;

    const result: FitzyChatResponse = await FitzyService.chat(user.id, messages, circleId);

    return NextResponse.json({
      success: true,
      data: result,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Fitzy chat error:', {
      message: error?.message,
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });

    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}
