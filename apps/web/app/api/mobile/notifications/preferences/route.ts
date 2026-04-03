import { NextRequest, NextResponse } from 'next/server';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { NotificationPreferencesService } from '@/lib/services/notification-preferences-service';
import { z } from 'zod';

const updateSchema = z.object({
  journey_enabled: z.boolean().optional(),
  momentum_enabled: z.boolean().optional(),
  circle_enabled: z.boolean().optional(),
  challenge_enabled: z.boolean().optional(),
  social_enabled: z.boolean().optional(),
  celebration_enabled: z.boolean().optional(),
  quiet_hours_start: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quiet_hours_end: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quiet_hours_timezone: z.string().optional(),
});

/**
 * GET /api/mobile/notifications/preferences
 * Get notification preferences for the authenticated user.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const prefs = await NotificationPreferencesService.getPreferences(user.id);

    return NextResponse.json({
      success: true,
      data: prefs,
      error: null,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    console.error('[GET /api/mobile/notifications/preferences] Error:', error);

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
          message: 'Failed to fetch notification preferences',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/mobile/notifications/preferences
 * Update notification preferences (partial update).
 */
export async function PATCH(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const body = await request.json();
    const validated = updateSchema.parse(body);

    const updated = await NotificationPreferencesService.updatePreferences(user.id, validated);

    return NextResponse.json({
      success: true,
      data: updated,
      error: null,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    console.error('[PATCH /api/mobile/notifications/preferences] Error:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
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
          message: 'Failed to update notification preferences',
          details: { message: error.message },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
