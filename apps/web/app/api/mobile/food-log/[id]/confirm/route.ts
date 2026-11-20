/**
 * POST /api/mobile/food-log/{id}/confirm — "Add to my day" on a Draft meal
 * (docs/ENGAGEMENT_115_SPEC.md §14.6; contract docs/ENGAGEMENT_115_CLIENT_CONTRACT.md).
 *
 * Body (optional, JSON): the edited content, same fields as PATCH /api/mobile/food-log/{id}
 * (title, meal_type, notes, nutrition_data, calories / protein_g / …, tags) plus the share
 * choice (`share_with_circles`, `share_circle_ids`, `share_seen_circle_ids`). `logged_at` /
 * `entry_date` are ignored: a confirmed draft keeps its original capture time and counts for
 * the day it was eaten.
 *
 * → 200 { data: entry (entry_status "confirmed", image_urls), meta: { streak, alreadyConfirmed? } }.
 * Idempotent: confirming an already-confirmed entry returns it with meta.alreadyConfirmed:true and
 * runs nothing again. Not the caller's / deleted / unknown → 404.
 *
 * Side effects (first confirm only), as a create: the streak claim for the entry's day (usual
 * backdating rules), the circle meal card when shared (the user's default or the explicit
 * choice), the remembered share-card choices, the promo conversion.
 */
import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { promosConfig } from '@/lib/promos/config';
import { shareMealsByDefault } from '@/lib/services/food-entry-privacy';
import { FoodLogImageService } from '@/lib/services/food-log-image-service';
import { FoodLogService } from '@/lib/services/food-log-service';
import { MealShareService } from '@/lib/services/meal-share-service';
import { PromoService } from '@/lib/services/promo-service';
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';
import { requestShowsStreakCelebration } from '@/lib/streaks/celebration';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { runAfterResponse } from '@/lib/utils/after-response';
import { resolveEntryTimezone } from '@/lib/utils/entry-date';
import { UpdateFoodLogEntrySchema } from '@/lib/validation/food-log-validation';
import { safeParseLenient, validationMessage } from '@/lib/validation/lenient-parse';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

function fail(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, data: null, error: { code, message, details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status, headers: NO_STORE }
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    const { id: entryId } = await params;
    const supabase = createAdminSupabase();

    const raw = await request.json().catch(() => ({}));
    const parsed = safeParseLenient(UpdateFoodLogEntrySchema, raw && typeof raw === 'object' ? raw : {}, { ignore: ['timezone'] });
    if (!parsed.success) return fail('VALIDATION_ERROR', validationMessage(parsed.error), 400);
    // The capture time is kept: a confirmed draft counts for the day it was eaten.
    const { logged_at: _at, entry_date: _date, share_seen_circle_ids, ...edits } = parsed.data;
    void _at;
    void _date;

    const result = await FoodLogService.confirmDraft(entryId, user.id, edits, supabase, {
      defer: (task) => runAfterResponse(task, 'draft confirm side effect'),
      shareByDefault: user && 'preferences' in user ? shareMealsByDefault((user as { preferences?: unknown }).preferences) : undefined,
    });
    if (result.failure === 'NOT_FOUND') return fail('NOT_FOUND', 'Entry not found', 404);
    if (result.failure === 'VALIDATION_ERROR') return fail('VALIDATION_ERROR', result.error?.message ?? 'Invalid request', 400);
    if (result.error || !result.data) throw result.error ?? new Error('confirm failed');
    const entry = result.data;

    let streak: unknown;
    if (!result.alreadyConfirmed) {
      if (Array.isArray(share_seen_circle_ids)) {
        await MealShareService.rememberFromEntryBody(user.id, { ...edits, share_seen_circle_ids });
      }
      if (entry.entry_type === 'food' && promosConfig().enabled) {
        runAfterResponse(() => PromoService.recordConversion(user.id, 'meal_logged'), 'promo conversion');
      }
      const tz = await resolveEntryTimezone(request, (raw as { timezone?: unknown })?.timezone, user.id, supabase, user);
      streak = await StreakClaimingService.autoClaimForManualLog(user.id, {
        occurredAt: entry.entry_date ?? entry.logged_at ?? null,
        timezone: tz.source === 'default' ? null : tz.timezone,
        source: 'food_log',
        inAppCelebration: requestShowsStreakCelebration(request),
        referenceId: entry.id,
      });
    }

    const apiBase = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const [withPhotos] = await FoodLogImageService.withPhotoUrls([entry], supabase, apiBase, { alwaysIncludeList: true });
    return NextResponse.json(
      {
        success: true,
        data: withPhotos,
        error: null,
        meta: { requestTime: Date.now() - startTime, ...(streak !== undefined ? { streak } : {}), ...(result.alreadyConfirmed ? { alreadyConfirmed: true } : {}) },
      },
      { headers: NO_STORE }
    );
  } catch (error: any) {
    if (error?.message === 'Unauthorized') return fail('UNAUTHORIZED', 'Invalid or expired token', 401);
    console.error('[Mobile API] Confirm draft error:', error?.message);
    return fail('INTERNAL_SERVER_ERROR', 'An unexpected error occurred', 500);
  }
}
