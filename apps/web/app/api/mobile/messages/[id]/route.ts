import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { CircleChatService } from '@/lib/services/circle-chat-service';
import { MESSAGE_EDIT_BODY_MAX_LENGTH } from '@/lib/types/circle-chat';

// Validation schema for PATCH body (trimmed, 1..2000 chars per the
// cross-platform edit contract; the service re-enforces this server-side).
const editMessageSchema = z.object({
  body: z.string().trim().min(1).max(MESSAGE_EDIT_BODY_MAX_LENGTH),
});

/**
 * PATCH /api/mobile/messages/[id]
 * Edit a message (sender only, user_text only, within the 15-minute window)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Await params in Next.js 15
    const { id } = await params;

    // Parse and validate request body
    const json = await request.json();
    const { body } = editMessageSchema.parse(json);

    const message = await CircleChatService.editMessage(user.id, id, body);

    return NextResponse.json({
      success: true,
      data: {
        message,
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Edit message error:', {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    return mapMessageError(error);
  }
}

/**
 * DELETE /api/mobile/messages/[id]
 * Soft-delete a message (sender only) — tombstone: body/photo cleared
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Await params in Next.js 15
    const { id } = await params;

    const message = await CircleChatService.deleteMessage(user.id, id);

    return NextResponse.json({
      success: true,
      data: {
        message,
      },
      meta: {
        requestTime: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Delete message error:', {
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
    return mapMessageError(error);
  }
}

/**
 * Shared error mapping for edit/delete, following the chat route family's
 * envelope conventions (see reactions/route.ts).
 */
function mapMessageError(error: any) {
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
          message: 'You can only modify your own messages',
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
          message: 'Message not found',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 404 }
    );
  }

  // Conflict family: edit window expired / tombstone / wrong kind.
  const conflictMessages: Record<string, { code: string; message: string }> = {
    EditWindowExpired: {
      code: 'EDIT_WINDOW_EXPIRED',
      message: 'Messages can only be edited within 15 minutes of sending',
    },
    MessageDeleted: {
      code: 'MESSAGE_DELETED',
      message: 'This message has been deleted',
    },
    InvalidMessageKind: {
      code: 'INVALID_MESSAGE_KIND',
      message: 'This kind of message cannot be modified',
    },
  };

  const conflict = conflictMessages[error.message as string];
  if (conflict) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: conflict.code,
          message: conflict.message,
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 409 }
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
