import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { NutritionIntelligenceService } from '@/lib/services/nutrition-intelligence-service';

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

    const parsed = bodySchema.safeParse(json);
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
      const isRate = parseError?.message === 'RateLimited';
      if (!isRate && parseError?.message !== 'ParseFailed') {
        throw parseError; // Unauthorized / unexpected → outer catch
      }

      let saved: { entryId: string } | null = null;
      try {
        saved = await NutritionIntelligenceService.saveUnparsedVoice(user.id, parsed.data.transcript);
      } catch (saveError) {
        console.error('[Mobile API] Voice parse fallback save failed:', saveError);
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
            fallbackSaved: !!saved,
            savedEntryId: saved?.entryId ?? null,
          })
        );
      }

      return NextResponse.json(
        {
          success: false,
          data: null,
          error: {
            code: isRate ? 'RATE_LIMITED' : 'PARSE_FAILED',
            message: isRate
              ? "You've reached today's voice-estimate limit — we saved your note so you can add the details."
              : "Couldn't understand that — we saved your note so you can add the details.",
            details: saved ? { savedEntryId: saved.entryId } : {},
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
