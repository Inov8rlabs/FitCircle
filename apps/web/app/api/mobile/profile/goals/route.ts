import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MobileAPIService } from '@/lib/services/mobile-api-service';

// Validation schema for PUT
const updateGoalsSchema = z.object({
  goals: z.array(
    z.object({
      type: z.string(),
      target: z.number(),
      unit: z.string(),
      description: z.string().optional(),
      deadline: z.string().optional(),
    })
  ),
});

/**
 * PUT /api/mobile/profile/goals
 * Update user goals
 */
export async function PUT(request: NextRequest) {
  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Parse and validate request body
    const body = await request.json();
    const validatedData = updateGoalsSchema.parse(body);

    // Update goals
    const result = await MobileAPIService.updateUserGoals(user.id, validatedData.goals);

    return NextResponse.json({
      success: true,
      goals: result.goals,
    });
  } catch (error: any) {
    console.error('Update goals error:', error);

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Invalid or expired token',
        },
        { status: 401 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation error',
          message: 'Invalid input data',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: 'An unexpected error occurred',
      },
      { status: 500 }
    );
  }
}
