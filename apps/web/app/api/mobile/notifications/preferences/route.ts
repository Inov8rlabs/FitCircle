import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { mealReminderPrefsFrom } from '@/lib/journey/meal-slots';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { JourneyService } from '@/lib/services/journey-service';
import { NotificationPreferencesService } from '@/lib/services/notification-preferences-service';

const updateSchema = z.object({
  journey_enabled: z.boolean().optional(),
  momentum_enabled: z.boolean().optional(),
  circle_enabled: z.boolean().optional(),
  challenge_enabled: z.boolean().optional(),
  social_enabled: z.boolean().optional(),
  celebration_enabled: z.boolean().optional(),
  // "Coaching tips from Fitzy" (migration 107).
  coach_enabled: z.boolean().optional(),
  quiet_hours_start: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quiet_hours_end: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  quiet_hours_timezone: z.string().optional(),
  // Per-slot meal reminder toggles (ACTIVATION_JOURNEY_SPEC §4), stored in
  // profiles.preferences.notifications.meal_reminders. Defaults: breakfast/lunch/dinner on, snack off.
  meal_reminders: z
    .object({ breakfast: z.boolean().optional(), lunch: z.boolean().optional(), snack: z.boolean().optional(), dinner: z.boolean().optional() })
    .strict()
    .optional(),
});

/**
 * GET /api/mobile/notifications/preferences
 * Get notification preferences for the authenticated user. Adds
 * `meal_reminders: { breakfast, lunch, snack, dinner }` (with defaults) next to
 * the notification_preferences row — extra key, safe for shipped decoders.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const prefs = await NotificationPreferencesService.getPreferences(user.id);

    return NextResponse.json({
      success: true,
      data: { ...prefs, meal_reminders: mealReminderPrefsFrom(user.preferences) },
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
    const { meal_reminders, ...validated } = updateSchema.parse(body);

    const mealReminders = meal_reminders
      ? await JourneyService.updateMealReminderPrefs(user.id, meal_reminders)
      : mealReminderPrefsFrom(user.preferences);
    const updated =
      Object.keys(validated).length > 0 || !meal_reminders
        ? await NotificationPreferencesService.updatePreferences(user.id, validated)
        : await NotificationPreferencesService.getPreferences(user.id);

    return NextResponse.json({
      success: true,
      data: { ...updated, meal_reminders: mealReminders },
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
