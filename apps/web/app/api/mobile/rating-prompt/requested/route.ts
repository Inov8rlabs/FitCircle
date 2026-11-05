/**
 * POST /api/mobile/rating-prompt/requested { trigger } — the app asked the OS
 * for the rating prompt (whether it was shown, and whether the user rated, is
 * never reported by the OS). Records profiles.metadata.rating_prompt
 * (last_prompt_at, prompt_count): the server-side cooldown and max-prompts
 * rules run from it. Retry-safe (a repeat within 60 s is not counted twice).
 *
 * data: { recorded, promptCount, lastPromptAt }
 */
import { type NextRequest } from 'next/server';
import { z } from 'zod';

import { readExperimentRequestInfo } from '@/lib/experiments/request-info';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { fail, ok } from '@/lib/referrals/http';
import { RatingPromptService } from '@/lib/services/rating-prompt-service';
import { safeParseLenient } from '@/lib/validation/lenient-parse';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ trigger: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/) }).passthrough();

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let user: { id: string };
  try {
    user = await requireMobileAuth(request);
  } catch {
    return fail(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const parsed = safeParseLenient(bodySchema, body);
  if (!parsed.success) return fail(400, 'VALIDATION_ERROR', 'trigger is required (snake_case key)');
  const info = readExperimentRequestInfo(request);
  try {
    const result = await RatingPromptService.recordRequested(user.id, {
      trigger: parsed.data.trigger,
      platform: info.platform,
      appVersion: info.appVersion,
    });
    return ok(result, startTime);
  } catch (error: any) {
    console.error('[Mobile API] rating-prompt report failed:', error?.message ?? error);
    return fail(500, 'INTERNAL_SERVER_ERROR', 'Could not record the rating prompt');
  }
}
