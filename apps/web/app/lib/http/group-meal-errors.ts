import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * Shared error → envelope mapper for the group-meal mobile routes (PRD §6.12).
 * Matches the envelope convention used across /api/mobile (success/data/error/meta).
 * GroupMealService throws by message: 'Forbidden' | 'NotFound'; auth throws 'Unauthorized'.
 */
export function groupMealErrorResponse(error: any, startTime: number): NextResponse {
  // Touch startTime so callers can rely on a consistent signature even when unused here.
  void startTime;

  if (error?.message === 'Unauthorized') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 401 }
    );
  }
  if (error?.message === 'Forbidden') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'FORBIDDEN', message: 'You are not allowed to perform this action', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 403 }
    );
  }
  if (error?.message === 'NotFound') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'NOT_FOUND', message: 'Resource not found', details: {}, timestamp: new Date().toISOString() }, meta: null },
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
          details: error.errors.reduce((acc: Record<string, string>, err) => {
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
  console.error('[Mobile API] Group meal error:', error?.message);
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}
