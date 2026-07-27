import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { BodyCompositionService } from '@/lib/services/body-composition-service';
import { EntitlementService } from '@/lib/services/entitlement-service';
import { type BodyCompImportItem, bodyCompImportItemSchema } from '@/lib/types/body-composition';

/**
 * POST /api/mobile/body-comp/import — idempotent HealthKit / Health Connect batch import.
 * Dedup by source_external_id; samples within 10 minutes collapse into one log row.
 * → { received, imported, skipped }. Feature gate: body_comp_logging.
 *
 * Validation is tolerant PER ITEM (contract §2): platform data is dirty — a flaky
 * smart scale or third-party app can write a 1.5% body-fat or 0 kg sample, and the
 * clients POST raw samples without range-filtering. One bad sample must never 400
 * the whole batch (that would stall the client's import cursor and re-poison every
 * subsequent sync window). Only the envelope is strict; invalid items are skipped
 * (counted in `skipped`), and an out-of-range metric on an otherwise-valid item is
 * dropped field-wise so its remaining metrics still import.
 * BODY_COMP_BUILD_CONTRACT §2.
 */

// Strict envelope; item payloads are sanitized individually below.
const importEnvelopeSchema = z.object({
  platform: z.enum(['healthkit', 'health_connect']),
  items: z.array(z.unknown()).max(500),
});

// externalId + measuredAt are the item's identity (dedup key + grouping anchor) —
// without them the sample can't be imported idempotently, so the item is skipped.
const importItemIdentitySchema = z.object({
  externalId: z.string().min(1).max(255),
  measuredAt: z.string().datetime({ offset: true }),
});

const IMPORT_METRIC_KEYS = ['weightKg', 'bodyFatPct', 'leanBodyMassKg', 'bmrKcal'] as const;

/**
 * One platform sample → a valid BodyCompImportItem, or null when its identity is
 * malformed. Metric fields are validated against the contract ranges independently
 * (via the frozen item schema's own field schemas, so the bounds cannot drift);
 * out-of-range values are dropped, not fatal. An item left with no metrics flows
 * through to the service, whose ≥1-metric filter counts it as skipped.
 */
function sanitizeImportItem(raw: unknown): BodyCompImportItem | null {
  const strict = bodyCompImportItemSchema.safeParse(raw);
  if (strict.success) return strict.data;

  const identity = importItemIdentitySchema.safeParse(raw);
  if (!identity.success) return null;

  const record = raw as Record<string, unknown>;
  const item: BodyCompImportItem = identity.data;
  for (const key of IMPORT_METRIC_KEYS) {
    const parsed = bodyCompImportItemSchema.shape[key].safeParse(record[key]);
    if (parsed.success && parsed.data !== undefined) item[key] = parsed.data;
  }
  return item;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  try {
    const user = await requireMobileAuth(request);
    await EntitlementService.requireFeature(user.id, 'body_comp_logging');
    const body = await request.json();
    const envelope = importEnvelopeSchema.parse(body);

    const received = envelope.items.length;
    const items = envelope.items
      .map(sanitizeImportItem)
      .filter((item): item is BodyCompImportItem => item !== null);

    const result = await BodyCompositionService.importBatch(user.id, {
      platform: envelope.platform,
      items,
    });
    // Recount against the RAW batch so identity-malformed items land in `skipped`
    // and { received, imported, skipped } stays truthful.
    const data = {
      received,
      imported: result.imported,
      skipped: received - result.imported,
    };
    return NextResponse.json({ success: true, data, meta: { requestTime: Date.now() - startTime }, error: null });
  } catch (error: any) {
    return mapError(error);
  }
}

function mapError(error: any) {
  if (error?.message === 'Unauthorized') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 401 }
    );
  }
  if (error?.message === 'PREMIUM_REQUIRED') {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'PREMIUM_REQUIRED', message: 'This feature requires a premium subscription', details: {}, timestamp: new Date().toISOString() }, meta: null },
      { status: 403 }
    );
  }
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { success: false, data: null, error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors.reduce((a: any, e) => { a[e.path.join('.')] = e.message; return a; }, {}), timestamp: new Date().toISOString() }, meta: null },
      { status: 400 }
    );
  }
  console.error('[Mobile API] body-comp import error:', error?.message);
  return NextResponse.json(
    { success: false, data: null, error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred', details: {}, timestamp: new Date().toISOString() }, meta: null },
    { status: 500 }
  );
}
