import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MobileAPIService } from '@/lib/services/mobile-api-service';

// Validation schema for PUT
// The canonical profiles.goals[] element — the shape every client decodes
// (iOS Goal / Android Goal / sanitizeGoalsArray). The previous {type, target,
// unit} schema overwrote goals with a shape none of them could read.
const updateGoalsSchema = z.object({
  goals: z.array(
    z.object({
      type: z.enum(['weight', 'steps', 'workout_minutes']),
      target_weight_kg: z.number().min(20).max(400).nullable().optional(),
      starting_weight_kg: z.number().min(20).max(400).nullable().optional(),
      daily_steps_target: z.number().int().min(500).max(100000).nullable().optional(),
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
