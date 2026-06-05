import { NextResponse } from 'next/server';
import { z } from 'zod';

import { REACTION_KINDS } from '@/lib/types/food-feed';

/**
 * Shared error→HTTP mapper for the food-log reaction routes (§6.3).
 *
 * This lives OUTSIDE route.ts on purpose: a Next.js App Router `route.ts` may only export
 * HTTP method handlers (GET/POST/…) plus a few config keys. Exporting any other symbol from
 * route.ts fails the production type-check build ("X is not a valid Route export field"), which
 * is exactly what blocked every prod deploy. Both the POST (add) and DELETE (remove) routes
 * import this from here instead.
 */
export function mapReactionError(error: any, label: string) {
  console.error(`[Mobile API] ${label} error:`, {
    message: error?.message,
    stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
  });

  if (error?.message === 'Unauthorized') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 401 }
    );
  }
  if (error?.message === 'Forbidden') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'FORBIDDEN', message: 'You cannot react to this entry', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 403 }
    );
  }
  if (error?.message === 'NotFound') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'NOT_FOUND', message: 'Food log entry not found', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 404 }
    );
  }
  if (error?.message === 'BadRequest' || error instanceof z.ZodError) {
    const details =
      error instanceof z.ZodError
        ? error.errors.reduce((acc: any, err) => {
            acc[err.path.join('.')] = err.message;
            return acc;
          }, {})
        : { reaction: `Expected one of: ${REACTION_KINDS.join(', ')}` };
    return NextResponse.json(
      { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid input data', details, timestamp: new Date().toISOString() }, meta: null },
      { status: 400 }
    );
  }
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}
