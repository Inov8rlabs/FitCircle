import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { FoodsService } from '@/lib/services/foods-service';
import { createCustomFoodSchema } from '@/lib/types/foods';

/**
 * GET  /api/mobile/foods/custom  — list the user's saved custom foods + recipes.
 * POST /api/mobile/foods/custom  — save a custom food (or recipe when recipeIngredients present).
 * PRD §6.1 — custom foods & recipes. Thin route; FoodsService owns the logic.
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const foods = await FoodsService.listCustomFoods(user.id);
    return NextResponse.json({ success: true, data: foods, meta: { requestTime: Date.now() - startTime, count: foods.length }, error: null });
  } catch (error: any) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();
    const input = createCustomFoodSchema.parse(body);
    const food = await FoodsService.createCustomFood(user.id, input);
    return NextResponse.json({ success: true, data: food, meta: { requestTime: Date.now() - startTime }, error: null }, { status: 201 });
  } catch (error: any) {
    return errorResponse(error);
  }
}

function errorResponse(error: any) {
  if (error?.message === 'Unauthorized') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 401 }
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
          details: error.errors.reduce((acc: any, e) => { acc[e.path.join('.')] = e.message; return acc; }, {}),
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 400 }
    );
  }
  console.error('[Mobile API] Custom food error:', error?.message);
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}
