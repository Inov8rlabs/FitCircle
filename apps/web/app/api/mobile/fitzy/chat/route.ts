import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { paywallFor } from '@/lib/fitzy/paywall';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FitzyNotFoundError } from '@/lib/services/fitzy-conversation-service';
import { FitzyService } from '@/lib/services/fitzy-service';
import { JourneyService } from '@/lib/services/journey-service';
import { UpgradeRequiredError } from '@/lib/services/usage-service';
import type { FitzyChatResponse } from '@/lib/types/fitzy';
import { runAfterResponse } from '@/lib/utils/after-response';
import { safeParseLenient } from '@/lib/validation/lenient-parse';

/**
 * POST /api/mobile/fitzy/chat
 * Fitzy — the FitCircle AI coach (full fitness + nutrition). Multi-turn; history is held by the
 * client and sent as `messages` (oldest→newest, last turn = the new user message).
 *
 * Body: { messages: [{ role: 'user'|'assistant', content: string }], circleId?: string, conversationId?: uuid }
 *   → FitzyChatResponse { answer, disclaimer, conversationId, messageId, suggestions, actions, remaining, tier }
 *   (answer is Markdown). Old clients send only `messages` and read answer/disclaimer — unchanged.
 *   With `conversationId`, server-held history wins and only the last user message is used.
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
  conversationId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    // First Fitzy open → profiles.fitzy_opened_at (ACTIVATION_JOURNEY_SPEC §6). Zero queries once set.
    runAfterResponse(() => JourneyService.markFitzyOpened(user.id, user), 'fitzy opened');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const parsed = safeParseLenient(requestSchema, body);
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

    const { messages, circleId, conversationId } = parsed.data;

    const result: FitzyChatResponse = await FitzyService.chat(user.id, messages, circleId, {
      conversationId: conversationId ?? null,
      timezone: request.headers.get('x-client-timezone'),
    });

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

    if (error instanceof UpgradeRequiredError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UPGRADE_REQUIRED',
            message: "You've used today's free Fitzy messages — go Pro for unlimited coaching.",
            details: { feature: error.feature, used: error.used, limit: error.limit, paywall: paywallFor('fitzy_quota') },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 429 }
      );
    }

    if (error instanceof FitzyNotFoundError) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'NOT_FOUND', message: error.message, details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 404 }
      );
    }

    if (error?.message === 'RateLimited') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'RATE_LIMITED', message: "You've reached today's message limit — try again tomorrow.", details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}
