import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { NutritionIntelligenceService } from '@/lib/services/nutrition-intelligence-service';
import { UpgradeRequiredError } from '@/lib/services/usage-service';
import { safeParseLenient } from '@/lib/validation/lenient-parse';
import { readParseFallbackOptionsFromJson } from '@/lib/validation/nutrition-parse-options';

// LLM parse can exceed the platform default function timeout; give it room.
export const maxDuration = 60;

/**
 * POST /api/mobile/food/voice-parse
 * PRD v4 §6.1 / §7.6 — spoken food description → structured nutrition DRAFT.
 *
 * Native STT runs ON THE CLIENT (Speech framework / SpeechRecognizer / Web Speech API) and
 * produces TEXT; this endpoint receives that transcript and parses it into the SAME draft shape
 * as photo-parse. JSON body `{ transcript: string }`. Returns a draft the client shows on a
 * "tap to fix" card; it does NOT create a food log entry. The user confirms, then the existing
 * POST /api/mobile/food-log (or PATCH) commits the entry with the draft's values.
 *
 * Optional body fields `skip_fallback_save` (true) and `existing_entry_id` (uuid) switch off
 * the Option-B fallback save for form prefill / re-analysis of a saved entry — see
 * lib/validation/nutrition-parse-options.ts. Without them the route behaves exactly as before.
 *
 * Thin route: all nutrition logic lives in NutritionIntelligenceService (§7.2.1).
 */

const bodySchema = z.object({
  transcript: z.string().trim().min(1, 'Transcript is empty').max(1000, 'Transcript too long'),
});

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const user = await requireMobileAuth(request);

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body', details: {}, timestamp: new Date().toISOString() },
          meta: null,
        },
        { status: 400 }
      );
    }

    const parsed = safeParseLenient(bodySchema, json);
    // Both absent (every shipped client today) → the Option-B save below is unchanged.
    const fallback = readParseFallbackOptionsFromJson(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues[0]?.message ?? 'Invalid request body',
            details: { issues: parsed.error.issues },
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    try {
      const draft = await NutritionIntelligenceService.parseVoice(user.id, parsed.data.transcript);

      return NextResponse.json({
        success: true,
        data: draft,
        meta: { requestTime: Date.now() - startTime },
        error: null,
      });
    } catch (parseError: any) {
      // Option B (§6.1): a failed OR rate-limited parse must not lose the user's spoken note.
      // Save the transcript as a normal food-log entry and return its id so the client can drop
      // the user into that entry to finish manually.
      const isUpgrade = parseError instanceof UpgradeRequiredError;
      const isRate = parseError?.message === 'RateLimited' || isUpgrade;
      if (!isRate && parseError?.message !== 'ParseFailed') {
        throw parseError; // Unauthorized / unexpected → outer catch
      }

      let saved: { entryId: string } | null = null;
      if (fallback.skipFallbackSave) {
        // The client is prefilling a form it saves itself, or re-running the AI on an
        // entry that already exists: a fallback entry would only be a duplicate.
        // Echo the existing id ONLY when it really is this user's entry.
        if (
          fallback.existingEntryId &&
          (await NutritionIntelligenceService.ownsFoodLogEntry(user.id, fallback.existingEntryId))
        ) {
          saved = { entryId: fallback.existingEntryId };
        }
      } else {
        try {
          saved = await NutritionIntelligenceService.saveUnparsedVoice(user.id, parsed.data.transcript);
        } catch (saveError) {
          console.error('[Mobile API] Voice parse fallback save failed:', saveError);
        }
      }

      // Route-level correlation log for a real analysis failure (rate-limits skipped).
      // The service logs WHY the parse failed ([nutrition-parse-failure]); this ties it
      // to the saved entry the user sees, plus request latency.
      if (!isRate) {
        console.error(
          '[nutrition-parse-failure:route]',
          JSON.stringify({
            source: 'voice',
            userId: user.id,
            code: 'PARSE_FAILED',
            transcriptLength: parsed.data.transcript.length,
            requestMs: Date.now() - startTime,
            fallbackSaved: !!saved && !fallback.skipFallbackSave,
            fallbackSkipped: fallback.skipFallbackSave,
            savedEntryId: saved?.entryId ?? null,
          })
        );
      }

      // Nothing was saved when the fallback is skipped, so the copy must not claim it was.
      const message = fallback.skipFallbackSave
        ? isUpgrade
          ? `You've used your ${parseError.limit} free AI logs today — go Pro for unlimited.`
          : isRate
            ? "You've reached today's voice-estimate limit — you can add the details yourself."
            : "Couldn't understand that — you can add the details yourself."
        : isUpgrade
          ? `You've used your ${parseError.limit} free AI logs today — go Pro for unlimited. We saved your note so you can add the details.`
          : isRate
            ? "You've reached today's voice-estimate limit — we saved your note so you can add the details."
            : "Couldn't understand that — we saved your note so you can add the details.";

      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: isUpgrade ? 'UPGRADE_REQUIRED' : isRate ? 'RATE_LIMITED' : 'PARSE_FAILED',
            message,
            details: {
              ...(saved ? { savedEntryId: saved.entryId } : {}),
              // Only present when the client asked for the fallback to be skipped:
              // tells it that `savedEntryId` (if any) is ITS OWN entry, not a new copy.
              ...(fallback.skipFallbackSave ? { fallbackSaved: false } : {}),
              ...(isUpgrade
                ? {
                    feature: (parseError as UpgradeRequiredError).feature,
                    used: (parseError as UpgradeRequiredError).used,
                    limit: (parseError as UpgradeRequiredError).limit,
                  }
                : {}),
            },
            timestamp: new Date().toISOString(),
          },
          meta: { requestTime: Date.now() - startTime },
        },
        { status: isRate ? 429 : 422 }
      );
    }
  } catch (error: any) {
    console.error('[Mobile API] Voice parse error:', {
      message: error?.message,
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });

    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
        { status: 401 }
      );
    }

    return NextResponse.json(
      { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 500 }
    );
  }
}
