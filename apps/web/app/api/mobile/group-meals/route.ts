import { type NextRequest, NextResponse } from 'next/server';

import { groupMealErrorResponse } from '@/lib/http/group-meal-errors';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { GroupMealService } from '@/lib/services/group-meal-service';
import { createGroupMealSchema } from '@/lib/types/group-meal';

/**
 * POST /api/mobile/group-meals
 * PRD §6.12 — log a SHARED meal for the table and tag circle members. Creates the meal,
 * a pending tag per tagged user, and the creator's own diary entry. Thin route: all logic
 * lives in GroupMealService.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();
    const input = createGroupMealSchema.parse(body);

    const meal = await GroupMealService.createGroupMeal(user.id, input);

    return NextResponse.json(
      {
        success: true,
        data: meal,
        meta: { requestTime: Date.now() - startTime },
        error: null,
      },
      { status: 201 }
    );
  } catch (error: any) {
    return groupMealErrorResponse(error, startTime);
  }
}
