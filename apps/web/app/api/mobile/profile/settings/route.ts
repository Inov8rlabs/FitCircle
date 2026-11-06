import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { addAutoRefreshHeaders } from '@/lib/middleware/mobile-auto-refresh';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { ageRequirementBody, isUnderMinimumAge } from '@/lib/validation/age-requirement';
import { parseLenient, validationMessage } from '@/lib/validation/lenient-parse';

/**
 * Validation schema for profile settings
 */
const settingsSchema = z.object({
  height_cm: z.number().min(50).max(250).optional(),
  weight_kg: z.number().min(20).max(500).optional(),
  date_of_birth: z.string().datetime().optional(),
  timezone: z.string().optional(),
  fitness_level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
});

/**
 * PUT /api/mobile/profile/settings
 * Update user profile settings
 *
 * Body:
 * - height_cm?: number (50-250)
 * - weight_kg?: number (20-500)
 * - date_of_birth?: string (ISO datetime)
 * - timezone?: string
 * - fitness_level?: "beginner" | "intermediate" | "advanced"
 *
 * Validation:
 * - Height: 50-250cm
 * - Weight: 20-500kg
 * - Age: Must be 18+ years old (400 AGE_REQUIREMENT)
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();

    // Validate input
    const validatedData = parseLenient(settingsSchema, body);

    // 18+ (lib/validation/age-requirement.ts). An unchanged echo of the stored date is not
    // re-checked, so accounts created before the gate can still save other settings.
    if (validatedData.date_of_birth) {
      const dob = validatedData.date_of_birth.slice(0, 10);
      const storedDob = typeof user.date_of_birth === 'string' ? user.date_of_birth.slice(0, 10) : null;
      if (dob !== storedDob && isUnderMinimumAge(dob)) {
        return NextResponse.json(ageRequirementBody('date_of_birth'), { status: 400 });
      }
    }

    const supabaseAdmin = createAdminSupabase();

    // Update profile
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({
        ...(validatedData.height_cm !== undefined && { height_cm: validatedData.height_cm }),
        ...(validatedData.weight_kg !== undefined && { weight_kg: validatedData.weight_kg }),
        ...(validatedData.date_of_birth && { date_of_birth: validatedData.date_of_birth }),
        ...(validatedData.timezone && { timezone: validatedData.timezone }),
        ...(validatedData.fitness_level && { fitness_level: validatedData.fitness_level }),
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    console.log(`[Profile Settings] Updated for user ${user.id}`);

    const response = NextResponse.json({
      success: true,
      data: {
        height_cm: updated.height_cm,
        weight_kg: updated.weight_kg,
        date_of_birth: updated.date_of_birth,
        timezone: updated.timezone,
        fitness_level: updated.fitness_level,
      },
      error: null,
      meta: null,
    });

    return await addAutoRefreshHeaders(request, response, user);
  } catch (error: any) {
    console.error('Update profile settings error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: validationMessage(error),
            details: error.errors,
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

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

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
