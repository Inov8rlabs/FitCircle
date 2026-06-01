import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleChatService } from '@/lib/services/circle-chat-service';
import {
  MESSAGE_BODY_MAX_LENGTH,
  type ListMessagesParams,
  type SendMessageInput,
} from '@/lib/types/circle-chat';

/**
 * Validation schema for POST (send member message).
 *
 * Cross-field rules (text requires body, photo requires photoUrl) are
 * enforced in CircleChatService.sendMessage; this schema validates shape.
 */
const sendMessageSchema = z.object({
  kind: z.enum(['user_text', 'user_photo']),
  body: z.string().max(MESSAGE_BODY_MAX_LENGTH).optional(),
  photoUrl: z.string().url().optional(),
  clientId: z.string().uuid().optional(),
});

/**
 * GET /api/mobile/circles/[id]/messages
 * List the circle's message timeline (reverse-chronological, paginated).
 *
 * Query params:
 * - before: ISO timestamp - return messages created strictly before this (optional)
 * - limit: page size (optional; default 30, max 100)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Await params in Next.js 15
    const { id: circleId } = await params;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const before = searchParams.get('before');
    const limitParam = searchParams.get('limit');

    const listParams: ListMessagesParams = {};
    if (before) {
      listParams.before = before;
    }
    if (limitParam !== null) {
      const parsedLimit = Number.parseInt(limitParam, 10);
      if (!Number.isNaN(parsedLimit)) {
        listParams.limit = parsedLimit;
      }
    }

    const result = await CircleChatService.listMessages(circleId, user.id, listParams);

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] List circle messages error:', {
      userId: error.userId,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    if (error.message === 'Forbidden') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'You are not a member of this circle',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    if (error.message === 'NotFound') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'NOT_FOUND',
            message: 'Circle not found',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mobile/circles/[id]/messages
 * Send a member message to the circle.
 *
 * Body:
 * - kind: 'user_text' | 'user_photo'
 * - body?: string (max MESSAGE_BODY_MAX_LENGTH; required for user_text)
 * - photoUrl?: string (URL; required for user_photo)
 * - clientId?: string (UUID; for optimistic de-dupe)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Await params in Next.js 15
    const { id: circleId } = await params;

    // Parse and validate request body
    const body = await request.json();
    const validatedData = sendMessageSchema.parse(body);

    const input: SendMessageInput = {
      kind: validatedData.kind,
      body: validatedData.body ?? null,
      photoUrl: validatedData.photoUrl ?? null,
      clientId: validatedData.clientId ?? null,
    };

    const message = await CircleChatService.sendMessage(circleId, user.id, input);

    return NextResponse.json(
      {
        success: true,
        data: message,
        meta: {
          requestTime: Date.now() - startTime,
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[Mobile API] Send circle message error:', {
      userId: error.userId,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    if (error.message === 'Forbidden') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'FORBIDDEN',
            message: 'You are not a member of this circle',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 403 }
      );
    }

    if (error.message === 'NotFound') {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'NOT_FOUND',
            message: 'Circle not found',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 404 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.errors.reduce((acc: any, err) => {
              acc[err.path.join('.')] = err.message;
              return acc;
            }, {}),
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
