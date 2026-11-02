import { NextResponse } from 'next/server';
import { z } from 'zod';

import { canonicalizeChatReaction } from '@/lib/chat/reactions';
import { CHAT_REACTION_KINDS } from '@/lib/types/circle-chat';
import { validationMessage } from '@/lib/validation/lenient-parse';

/**
 * Shared pieces for the circle-chat reaction routes (docs/CHAT_REACTIONS_V2.md).
 * Lives outside route.ts: a Next.js `route.ts` may only export HTTP handlers.
 */

const INVALID_REACTION_MESSAGE = `Expected one of ${CHAT_REACTION_KINDS.join(', ')} or a single emoji`;

/** `{ reaction }` body — a named kind or exactly one emoji; emits the canonical value. */
export const reactionBodySchema = z.object({
  reaction: z
    .string({ required_error: 'Required', invalid_type_error: INVALID_REACTION_MESSAGE })
    .transform((value, ctx) => {
      const canonical = canonicalizeChatReaction(value);
      if (!canonical) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: INVALID_REACTION_MESSAGE });
        return z.NEVER;
      }
      return canonical;
    }),
});

function errorBody(code: string, message: string, details: Record<string, unknown> = {}) {
  return {
    success: false,
    data: null,
    error: { code, message, details, timestamp: new Date().toISOString() },
    meta: null,
  };
}

export function ok<T>(data: T, startTime: number) {
  return NextResponse.json({
    success: true,
    data,
    meta: { requestTime: Date.now() - startTime },
    error: null,
  });
}

/** Service/validation error → the mobile API envelope + status. */
export function mapChatReactionError(error: any, label: string) {
  console.error(`[Mobile API] ${label} error:`, {
    message: error?.message,
    stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
  });

  switch (error?.message) {
    case 'Unauthorized':
      return NextResponse.json(errorBody('UNAUTHORIZED', 'Invalid or expired token'), { status: 401 });
    case 'Forbidden':
      return NextResponse.json(errorBody('FORBIDDEN', 'You are not a member of this circle'), { status: 403 });
    case 'NotFound':
      return NextResponse.json(errorBody('NOT_FOUND', 'Message not found'), { status: 404 });
    case 'MessageDeleted':
      return NextResponse.json(errorBody('MESSAGE_DELETED', 'You cannot react to a deleted message'), {
        status: 409,
      });
    case 'InvalidReaction':
      return NextResponse.json(
        errorBody('VALIDATION_ERROR', `reaction: ${INVALID_REACTION_MESSAGE}`, {
          reaction: INVALID_REACTION_MESSAGE,
        }),
        { status: 400 }
      );
  }

  if (error instanceof z.ZodError) {
    return NextResponse.json(
      errorBody(
        'VALIDATION_ERROR',
        validationMessage(error),
        error.errors.reduce((acc: Record<string, string>, err) => {
          acc[err.path.join('.')] = err.message;
          return acc;
        }, {})
      ),
      { status: 400 }
    );
  }

  if (error instanceof SyntaxError) {
    return NextResponse.json(errorBody('VALIDATION_ERROR', 'Request body must be JSON'), { status: 400 });
  }

  return NextResponse.json(errorBody('INTERNAL_SERVER_ERROR', 'An unexpected error occurred'), { status: 500 });
}
