import { createHash } from 'crypto';

import * as Sentry from '@sentry/nextjs';
import { generateText, Output } from 'ai';
import { z } from 'zod';

import { createAdminSupabase } from '../supabase-admin';
import {
  type BodyCompDraft,
  type BodyCompDraftMetrics,
  type BodyCompParseResult,
  type SegmentalData,
  BODY_COMP_PHOTO_PARSE_DAILY_SOFT_CAP,
  bodyCompParseResultSchema,
  segmentalDataSchema,
} from '../types/body-composition';

/**
 * BodyCompPhotoService — vision parse of a body-composition report into a DRAFT
 * (BODY_COMP_BUILD_CONTRACT §2 "Photo-parse implementation"). Accepts 1–3 images of
 * an InBody printed sheet, InBody app screenshots, or a DEXA summary page and returns
 * a BodyCompDraft — per-metric values + read-confidences, segmental data, warnings.
 *
 * Confirm-then-commit: this NEVER creates a log row. The user reviews the draft
 * ("tap to fix" per field, date confirm) and the client commits it via
 * POST /api/mobile/body-comp with source 'photo_scan'.
 *
 * Clones the NutritionIntelligenceService patterns exactly: Vercel AI Gateway via
 * generateText + Output.object + Zod, sha256 content-hash cache, per-user daily soft
 * cap, AbortSignal ceiling, structured '[bodycomp-parse-failure]' + Sentry logging.
 * Contract-specific addition: Haiku 4.5 first, with ONE escalation retry on
 * Sonnet 4.6 when the (validated) overallConfidence lands below 0.6 — the same
 * threshold at which clients fall back to the manual form.
 */

// Vision models via the AI Gateway (slugs match the nutrition service; gateway auth:
// AI_GATEWAY_API_KEY env, or Vercel OIDC in deployment). Haiku is materially faster
// and OCR-style extraction is well within its reach; Sonnet is the accuracy backstop
// for glare/blur/odd layouts that leave Haiku unsure.
const PRIMARY_MODEL = 'anthropic/claude-haiku-4.5';
const ESCALATION_MODEL = 'anthropic/claude-sonnet-4.6';

// Below this validated overallConfidence we escalate once to the stronger model —
// the same 0.6 rule the contract gives clients for the manual-entry fallback.
const ESCALATION_CONFIDENCE_FLOOR = 0.6;

// Hard ceiling per model call (contract). The escalation call is additionally clamped
// to the remaining function budget so primary + retry can never overrun maxDuration.
const PARSE_TIMEOUT_MS = 50_000;
// The route exports maxDuration = 60; leave headroom for validation + the response.
const FUNCTION_BUDGET_MS = 55_000;

// Plausibility + cross-check constants (contract "Cross-field validation").
const BF_PCT_PLAUSIBLE_MIN = 3;
const BF_PCT_PLAUSIBLE_MAX = 60;
const WEIGHT_PLAUSIBLE_MIN_KG = 20;
const WEIGHT_PLAUSIBLE_MAX_KG = 400;
/** fat + lean must reconstruct weight (and fat must match weight×BF%) within ±3% of body weight. */
const MASS_BALANCE_TOLERANCE = 0.03;
/** Σ segmental lean may exceed total lean by at most this factor (rounding slack). */
const SEGMENTAL_SUM_SLACK = 1.02;

const SYSTEM_PROMPT = [
  'You are a careful data-extraction assistant for body-composition reports. The user photographs',
  'an InBody (or similar bioimpedance) printed result sheet, screenshots of the InBody app, or a',
  'DEXA scan summary page. Extract ONLY values that are actually printed on the report — never',
  "estimate a person's body composition from a photo of a person, and never invent values that",
  'are not on the sheet. Set every metric you cannot find to null; do NOT derive missing metrics',
  'from other ones.',
  'Rules:',
  '- Units are STRICTLY canonical: masses in kg, body fat as a percent NUMBER (e.g. 26.6), BMR in',
  '  kcal, visceral fat as the printed level/area number. If the sheet uses pounds, convert to kg',
  '  (1 lb = 0.45359237 kg). If body fat is shown as a 0-1 fraction, multiply by 100.',
  '- Metric mapping: weightKg = Weight; bodyFatPct = Percent Body Fat (PBF); fatMassKg = Body Fat',
  '  Mass; skeletalMuscleMassKg = Skeletal Muscle Mass (SMM); leanBodyMassKg = Lean Body Mass /',
  '  Fat-Free Mass (FFM); bodyWaterKg = Total Body Water; boneMassKg = Bone Mineral Content;',
  '  visceralFatLevel = Visceral Fat Level (or Area); bmrKcal = Basal Metabolic Rate.',
  '- Each extracted metric carries a confidence 0..1 that the value was READ correctly: glare,',
  '  blur, cropped digits, or an ambiguous decimal separator lower it.',
  '- measuredAt is the test date/time printed on the report, as ISO 8601 (e.g.',
  '  2026-07-20T08:15:00Z, or 2026-07-20 when no time is shown). null when no date is visible.',
  "  NEVER substitute today's date.",
  '- segmental is the per-segment LEAN analysis (trunk, leftArm, rightArm, leftLeg, rightLeg):',
  '  leanKg and, when printed, pctOfIdeal (the % of ideal/standard). Use null for segments or the',
  '  whole block when absent. Do not use the segmental FAT analysis for these fields.',
  '- Multiple images are pages/screens of the SAME measurement session: merge them into one',
  '  result, preferring the sharpest reading when the same value appears more than once.',
  '- overallConfidence reflects the extraction as a whole; warnings lists anything the user should',
  '  double-check (e.g. "date partially cut off").',
  '- Extract, never judge: no comments about the values, the person, or their health.',
].join(' ');

export interface ParseScanImage {
  bytes: Buffer;
  mimeType: string;
}

// Cache rows store the raw model result plus the model that produced it, so a cache
// hit reports the true model while validation/draft-shaping still runs fresh (any
// later cross-check improvements apply to cached rows too).
const cacheEntrySchema = z.object({
  model: z.string(),
  parse: bodyCompParseResultSchema,
});
type CacheEntry = z.infer<typeof cacheEntrySchema>;

// Draft metric keys, in a stable order for deterministic output. leanBodyMassKg is
// deliberately absent: the frozen BodyCompDraft has no lean field (the CRUD layer
// derives lean on commit); the parsed lean value is used for cross-checks only.
const DRAFT_METRIC_KEYS = [
  'weightKg',
  'bodyFatPct',
  'fatMassKg',
  'skeletalMuscleMassKg',
  'bodyWaterKg',
  'boneMassKg',
  'visceralFatLevel',
  'bmrKcal',
] as const;
type DraftMetricKey = (typeof DRAFT_METRIC_KEYS)[number];

export class BodyCompPhotoService {
  /**
   * Parse one measurement session — photographed in 1..3 images (pages/screens of the
   * SAME report) — into a BodyCompDraft, in a single vision call (plus at most one
   * escalation retry on low confidence).
   * @throws Error('RateLimited') when the per-user daily soft cap is exceeded
   * @throws Error('ParseFailed') when the model output cannot be validated
   */
  static async parseScan(userId: string, images: ParseScanImage[]): Promise<BodyCompDraft> {
    if (images.length === 0) throw new Error('ParseFailed');
    const startedAt = Date.now();

    // 1. Cost guard — content hash cache so an identical request never re-bills.
    //    Single image → raw byte hash; multiple → fixed-width per-image digests with a
    //    count prefix (domain separation, same scheme as the nutrition service).
    const hasher = createHash('sha256');
    if (images.length === 1) {
      hasher.update(images[0].bytes);
    } else {
      hasher.update(`v2:${images.length}:`);
      for (const img of images) hasher.update(createHash('sha256').update(img.bytes).digest());
    }
    const imageHash = hasher.digest('hex');
    const cached = await this.getCachedResult(imageHash);
    if (cached) {
      return this.buildDraft(cached.parse, cached.model, true);
    }

    // 2. Per-user daily soft cap on premium vision calls. Caching is checked first so
    //    repeat/identical photos don't count against the cap. A multi-image request is
    //    ONE model call and — even with the escalation retry — counts as ONE parse.
    const usedToday = await this.countTodayParses(userId);
    if (usedToday >= BODY_COMP_PHOTO_PARSE_DAILY_SOFT_CAP) {
      throw new Error('RateLimited');
    }

    // 3. Structured vision call. generateText + Output.object validates the result
    //    against the Zod schema (retrying internally on malformed output).
    const meta = {
      imageCount: images.length,
      mimeType: images[0].mimeType,
      imageBytes: images.reduce((a, img) => a + img.bytes.length, 0),
      imageHash: imageHash.slice(0, 12),
    };
    let parse: BodyCompParseResult;
    let model = PRIMARY_MODEL;
    try {
      parse = await this.callModel(PRIMARY_MODEL, images, PARSE_TIMEOUT_MS);
    } catch (err) {
      this.logParseFailure(userId, PRIMARY_MODEL, Date.now() - startedAt, meta, err);
      throw new Error('ParseFailed');
    }

    // 3b. One escalation retry on the stronger model when the VALIDATED confidence is
    //     below the manual-fallback threshold. Failure-isolated: if the retry errors
    //     out we keep the primary result; if it succeeds we keep whichever draft is
    //     more confident. The retry's abort is clamped to the remaining function
    //     budget so primary + retry can never overrun the route's maxDuration.
    let draft = this.buildDraft(parse, model, false);
    if (draft.overallConfidence < ESCALATION_CONFIDENCE_FLOOR) {
      const remainingMs = FUNCTION_BUDGET_MS - (Date.now() - startedAt);
      if (remainingMs > 5_000) {
        try {
          const retryParse = await this.callModel(
            ESCALATION_MODEL,
            images,
            Math.min(PARSE_TIMEOUT_MS, remainingMs)
          );
          const retryDraft = this.buildDraft(retryParse, ESCALATION_MODEL, false);
          if (retryDraft.overallConfidence > draft.overallConfidence) {
            parse = retryParse;
            model = ESCALATION_MODEL;
            draft = retryDraft;
          }
        } catch (err) {
          // Keep the primary (low-confidence) draft — the client's <0.6 manual
          // fallback handles it — but record why the escalation didn't help.
          this.logParseFailure(userId, ESCALATION_MODEL, Date.now() - startedAt, {
            ...meta,
            escalation: true,
          }, err);
        }
      }
    }

    // 4. Record the call (for the daily cap) and cache the winning raw result.
    await this.recordParse(userId, imageHash, { model, parse });

    return draft;
  }

  // ---- draft shaping + cross-field validation --------------------------------

  /**
   * Turn a raw model parse into the frozen BodyCompDraft: round values, drop junk,
   * run the contract's cross-field checks (adjusting per-metric confidences and
   * appending warnings), and recompute overallConfidence from the adjusted state.
   * Pure + deterministic (exported for unit tests via the service class).
   */
  static buildDraft(parse: BodyCompParseResult, model: string, cached: boolean): BodyCompDraft {
    const warnings: string[] = [...parse.warnings];
    const metrics: BodyCompDraftMetrics = {};

    for (const key of DRAFT_METRIC_KEYS) {
      const raw = parse.metrics[key];
      if (!raw || raw.value <= 0) continue; // absent or physically impossible → omit
      const value = key === 'bmrKcal' ? Math.round(raw.value) : key === 'bodyFatPct' || key === 'visceralFatLevel' ? round1(raw.value) : round2(raw.value);
      if (value <= 0) continue;
      metrics[key] = { value, confidence: raw.confidence };
    }

    const penalize = (key: DraftMetricKey, ceiling: number, warning: string) => {
      const m = metrics[key];
      if (!m) return;
      m.confidence = round2(Math.min(m.confidence, ceiling));
      if (!warnings.includes(warning)) warnings.push(warning);
    };

    const weight = metrics.weightKg?.value;
    const bf = metrics.bodyFatPct?.value;
    const fat = metrics.fatMassKg?.value;
    const smm = metrics.skeletalMuscleMassKg?.value;

    // (a) Plausibility bounds. Values are kept (the user confirms/edits the draft);
    //     only the confidence drops so the client surfaces the field for review.
    if (bf != null && (bf < BF_PCT_PLAUSIBLE_MIN || bf > BF_PCT_PLAUSIBLE_MAX)) {
      penalize(
        'bodyFatPct',
        0.3,
        `Body fat reads as ${bf}%, outside the typical ${BF_PCT_PLAUSIBLE_MIN}-${BF_PCT_PLAUSIBLE_MAX}% range — double-check this value.`
      );
    }
    if (weight != null && (weight < WEIGHT_PLAUSIBLE_MIN_KG || weight > WEIGHT_PLAUSIBLE_MAX_KG)) {
      penalize(
        'weightKg',
        0.3,
        `Weight reads as ${weight} kg, outside the typical ${WEIGHT_PLAUSIBLE_MIN_KG}-${WEIGHT_PLAUSIBLE_MAX_KG} kg range — double-check this value.`
      );
    }

    // (b) fat mass must agree with weight × BF% (±3% of body weight).
    if (weight != null && bf != null && fat != null) {
      const expectedFat = (weight * bf) / 100;
      if (Math.abs(fat - expectedFat) > MASS_BALANCE_TOLERANCE * weight) {
        const warning =
          "Fat mass and body fat % don't agree with the weight reading — one of them may have been misread.";
        penalize('fatMassKg', 0.45, warning);
        penalize('bodyFatPct', 0.45, warning);
      }
    }

    // (c) fat + lean must reconstruct weight (±3%) when the sheet printed lean mass.
    const leanFromSheet = positiveOrNull(parse.metrics.leanBodyMassKg?.value);
    const lean = leanFromSheet ?? (weight != null && fat != null ? weight - fat : null);
    if (leanFromSheet != null && weight != null && fat != null) {
      if (Math.abs(fat + leanFromSheet - weight) > MASS_BALANCE_TOLERANCE * weight) {
        const warning =
          "Fat mass plus lean mass doesn't add up to the weight on the sheet — check these values.";
        penalize('weightKg', 0.5, warning);
        penalize('fatMassKg', 0.5, warning);
      }
    }

    // (d) Skeletal muscle must sit below lean body mass (SMM < lean < weight).
    if (smm != null && lean != null && lean > 0 && smm >= lean) {
      penalize(
        'skeletalMuscleMassKg',
        0.35,
        "Skeletal muscle reads higher than lean body mass, which isn't physically possible — check the muscle value."
      );
    }
    if (lean != null && weight != null && lean >= weight) {
      const warning = 'Lean mass reads at or above total weight — check the weight and fat values.';
      penalize('weightKg', 0.4, warning);
      penalize('fatMassKg', 0.4, warning);
    }

    // (e) Segmental: sanitize through the frozen wire schema (drops out-of-range junk),
    //     then check Σ segmental lean ≤ total lean. Segmental carries no per-field
    //     confidence in the draft, so a failed sum check dents overallConfidence.
    let segmental: SegmentalData | null = null;
    let segmentalPenalty = 0;
    if (parse.segmental) {
      const candidate: Record<string, { leanKg: number; pctOfIdeal?: number }> = {};
      for (const seg of ['trunk', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const) {
        const s = parse.segmental[seg];
        if (!s || s.leanKg <= 0) continue;
        candidate[seg] = {
          leanKg: round2(s.leanKg),
          ...(s.pctOfIdeal != null && s.pctOfIdeal > 0 ? { pctOfIdeal: round1(s.pctOfIdeal) } : {}),
        };
      }
      if (Object.keys(candidate).length > 0) {
        const parsed = segmentalDataSchema.safeParse(candidate);
        if (parsed.success) {
          segmental = parsed.data;
          const segSum = Object.values(candidate).reduce((a, s) => a + s.leanKg, 0);
          if (lean != null && lean > 0 && segSum > lean * SEGMENTAL_SUM_SLACK) {
            warnings.push(
              'Segmental lean values add up to more than total lean mass — the segmental read may be off.'
            );
            segmentalPenalty = 0.1;
          }
        } else {
          warnings.push('Segmental values could not be read reliably and were left off the draft.');
          segmentalPenalty = 0.1;
        }
      }
    }

    // (f) Overall confidence: never above the model's own estimate, never above the
    //     mean of the adjusted per-metric confidences, minus any segmental penalty.
    const present = DRAFT_METRIC_KEYS.map((k) => metrics[k]).filter(
      (m): m is { value: number; confidence: number } => m != null
    );
    let overall: number;
    if (present.length === 0) {
      overall = 0;
      warnings.push('No body-composition values could be read from the image.');
    } else {
      const mean = present.reduce((a, m) => a + m.confidence, 0) / present.length;
      overall = Math.min(parse.overallConfidence, mean) - segmentalPenalty;
    }

    return {
      measuredAt: normalizeMeasuredAt(parse.measuredAt),
      metrics,
      segmental,
      overallConfidence: round2(Math.min(1, Math.max(0, overall))),
      warnings,
      model,
      cached,
    };
  }

  // ---- private helpers -------------------------------------------------------

  private static async callModel(
    model: string,
    images: ParseScanImage[],
    timeoutMs: number
  ): Promise<BodyCompParseResult> {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: bodyCompParseResultSchema }),
      system: SYSTEM_PROMPT,
      // Bound latency: one extra try at most (the default 2 retries × a slow vision
      // call would blow the function timeout), and a hard abort ceiling.
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(timeoutMs),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                images.length > 1
                  ? `These ${images.length} images are pages/screens of the SAME body-composition report. Extract one merged set of values.`
                  : 'Extract the body-composition values printed on this report.',
            },
            ...images.map((img) => ({ type: 'image' as const, image: img.bytes, mediaType: img.mimeType })),
          ],
        },
      ],
    });
    return output;
  }

  /** Look up a previously-parsed identical image set (content-hash cache). */
  private static async getCachedResult(imageHash: string): Promise<CacheEntry | null> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('body_comp_parse_cache')
      .select('result')
      .eq('image_hash', imageHash)
      .maybeSingle();
    if (!data?.result) return null;
    const parsed = cacheEntrySchema.safeParse(data.result);
    return parsed.success ? parsed.data : null;
  }

  /** How many vision parses this user has made today (UTC), for the soft cap. */
  private static async countTodayParses(userId: string): Promise<number> {
    const supabase = createAdminSupabase();
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('body_comp_parse_log')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since.toISOString());
    return count ?? 0;
  }

  /** Log the call (cap accounting) + cache the result by image hash. Failure-isolated. */
  private static async recordParse(userId: string, imageHash: string, entry: CacheEntry): Promise<void> {
    const supabase = createAdminSupabase();
    try {
      await supabase.from('body_comp_parse_log').insert({ user_id: userId, image_hash: imageHash });
      await supabase
        .from('body_comp_parse_cache')
        .upsert({ image_hash: imageHash, result: entry }, { onConflict: 'image_hash' });
    } catch (err) {
      // Non-blocking: a logging/cache failure must not fail the user's parse.
      console.error('[BodyCompPhotoService.recordParse] non-fatal:', err);
    }
  }

  /**
   * Pull the diagnostically useful fields out of whatever `generateText` threw so a
   * parse failure produces ONE structured, greppable log line. Duck-typed (no `ai`
   * SDK class imports) to stay robust across versions. NEVER includes raw model
   * input (image bytes) — only metadata. Same classification as the nutrition
   * service so dashboards/alerts can group across both parse pipelines.
   *
   * The model's raw output (`text`/`responseBody`) frequently echoes the very
   * body-composition values it extracted — health-adjacent PII that must not land
   * in production logs/Sentry keyed to a user id. Like the route does for stack
   * traces, the raw text ships only in development; production logs carry lengths.
   */
  private static describeParseError(err: unknown): Record<string, unknown> {
    const e = err as any;
    const name: string = e?.name ?? 'Error';
    const message: string = e?.message ?? String(err);

    let kind = 'unknown';
    if (/Abort|Timeout/i.test(name) || /abort|timed?\s?out/i.test(message)) {
      kind = 'timeout_or_abort';
    } else if (e?.statusCode != null || e?.url != null) {
      kind = 'api_call_error';
    } else if (name === 'NoObjectGeneratedError' || e?.text != null) {
      kind = 'no_object_generated';
    } else if (name === 'TypeValidationError' || name === 'ZodError') {
      kind = 'schema_validation';
    }

    const truncate = (s: unknown, n = 600): string | undefined =>
      typeof s === 'string' ? (s.length > n ? `${s.slice(0, n)}…(+${s.length - n} more)` : s) : undefined;
    const lengthOf = (s: unknown): number | undefined =>
      typeof s === 'string' ? s.length : undefined;
    const isDev = process.env.NODE_ENV === 'development';

    return {
      kind,
      name,
      message,
      statusCode: e?.statusCode,
      url: e?.url,
      isRetryable: e?.isRetryable,
      finishReason: e?.finishReason,
      usage: e?.usage,
      modelText: isDev ? truncate(e?.text) : undefined,
      modelTextLength: lengthOf(e?.text),
      responseBody: isDev ? truncate(e?.responseBody) : undefined,
      responseBodyLength: lengthOf(e?.responseBody),
      causeName: e?.cause?.name,
      causeMessage: truncate(e?.cause?.message, 300),
    };
  }

  /**
   * Emit one structured log line for a failed AI parse. Tagged `[bodycomp-parse-failure]`
   * so it can be grepped/alerted on. `input` holds non-sensitive request metadata
   * (sizes, hash prefix) — never raw photos.
   */
  private static logParseFailure(
    userId: string,
    model: string,
    durationMs: number,
    input: Record<string, unknown>,
    err: unknown
  ): void {
    const detail = this.describeParseError(err);
    console.error(
      '[bodycomp-parse-failure]',
      JSON.stringify({
        userId,
        model,
        durationMs,
        input,
        error: detail,
        at: new Date().toISOString(),
      })
    );

    // Also report to Sentry (no-op until SENTRY_DSN is configured). Tags drive
    // grouping/filtering by feature and our classified failure `kind`.
    Sentry.captureException(err, {
      level: 'error',
      tags: {
        feature: 'body_comp_parse',
        parse_error_kind: String(detail.kind),
      },
      extra: { model, durationMs, input, ...detail },
      user: { id: userId },
    });
  }
}

// ---- module-private pure helpers ---------------------------------------------

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function positiveOrNull(n: number | undefined): number | null {
  return n != null && n > 0 ? n : null;
}

/**
 * Normalize the model's extracted date to ISO. Unparseable, pre-2000, or
 * future-dated (beyond tomorrow — a misread year) values become null; the client
 * then asks the user to set the date, which is safer than a wrong prefill.
 *
 * Date-only sheets ("2026-07-20", allowed by the prompt when no time is printed)
 * are anchored to NOON UTC, not midnight: ECMAScript parses a bare date as UTC
 * midnight, which clients render in local time as the PREVIOUS day anywhere west
 * of UTC. Noon keeps the printed calendar date intact across (almost) every
 * timezone the app serves.
 */
function normalizeMeasuredAt(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const t = Date.parse(dateOnly ? `${trimmed}T12:00:00Z` : trimmed);
  if (!Number.isFinite(t)) return null;
  if (new Date(t).getUTCFullYear() < 2000) return null;
  if (t > Date.now() + 86_400_000) return null;
  return new Date(t).toISOString();
}
