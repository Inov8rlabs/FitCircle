import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { ExerciseService } from '@/lib/services/exercise-service';
import { trackingTypeEnum } from '@/lib/validators/exercise-nested';
import { createAdminSupabase } from '@/lib/supabase-admin';

const createCustomSchema = z.object({
  name: z.string().min(1).max(120),
  primaryMuscle: z.string().max(40).nullable().optional(),
  equipment: z.string().max(30).nullable().optional(),
  trackingType: trackingTypeEnum.optional(),
});

/**
 * GET /api/mobile/exercises/catalog
 * Search the exercise catalog (global library + the user's custom exercises).
 * Query: ?search=&muscle=&equipment=&limit=
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    const { searchParams } = new URL(request.url);

    const search = searchParams.get('search') || undefined;
    const muscle = searchParams.get('muscle') || undefined;
    const equipment = searchParams.get('equipment') || undefined;
    const requestedLimit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50;
    const limit = Math.min(Number.isNaN(requestedLimit) ? 50 : requestedLimit, 200);

    const supabaseAdmin = createAdminSupabase();

    const result = await ExerciseService.searchCatalog(
      user.id,
      { search, muscle, equipment, limit },
      supabaseAdmin
    );

    if (result.error) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'FETCH_FAILED', message: result.error.message } },
        { status: 400 }
      );
    }

    const response = NextResponse.json({
      success: true,
      data: result.data,
      meta: { count: result.data.length, limit, requestTime: Date.now() - startTime },
      error: null,
    });
    response.headers.set('Cache-Control', 'private, max-age=300');
    return response;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    console.error('[GET /api/mobile/exercises/catalog] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mobile/exercises/catalog
 * Create a custom exercise owned by the user (is_custom = true, private).
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();
    const validated = createCustomSchema.parse(body);

    const supabaseAdmin = createAdminSupabase();

    const result = await ExerciseService.createCustomExercise(
      user.id,
      {
        name: validated.name,
        primary_muscle: validated.primaryMuscle ?? null,
        equipment: validated.equipment ?? null,
        tracking_type: validated.trackingType,
      },
      supabaseAdmin
    );

    if (result.error) {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'CREATE_FAILED', message: result.error.message } },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      meta: { requestTime: Date.now() - startTime },
      error: null,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } },
        { status: 401 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            details: error.errors.reduce(
              (acc: Record<string, string>, err) => {
                acc[err.path.join('.')] = err.message;
                return acc;
              },
              {}
            ),
          },
        },
        { status: 400 }
      );
    }

    console.error('[POST /api/mobile/exercises/catalog] Error:', error);
    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR' } },
      { status: 500 }
    );
  }
}
