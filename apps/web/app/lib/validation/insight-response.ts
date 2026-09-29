/**
 * Response hardening for `GET /api/mobile/insights`.
 *
 * The mobile models treat several `InsightDTO` fields as REQUIRED, and one bad row
 * fails the decode of the whole list:
 *   - iOS `Insight` (Core/Models/Nutrition.swift): `id`, `headline`, `detail`,
 *     `confidence` are non-optional.
 *   - Android builds before 2026-09-28: `signalA` / `signalB` are non-null `String`
 *     without a default (a missing or null value throws), `id` / `headline` /
 *     `detail` are required too.
 *
 * `CrossSignalService` fills every field today. This guard keeps that true if a
 * future insight source forgets one: it only ever ADDS a default for a missing /
 * malformed value and never changes a well-formed insight.
 *
 * An insight without an id, headline or detail cannot be shown and has no sensible
 * default, so it is dropped rather than sent half-empty.
 */
import type { Confidence, InsightDTO } from '@/lib/types/cross-signal';

const CONFIDENCE_VALUES: readonly Confidence[] = ['low', 'medium'];

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** One insight with every client-required field present, or null when it is unusable. */
export function toClientInsight(raw: unknown): InsightDTO | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const insight = raw as Record<string, unknown>;

  const id = nonEmptyString(insight.id);
  const headline = nonEmptyString(insight.headline);
  const detail = nonEmptyString(insight.detail);
  if (!id || !headline || !detail) return null;

  // The id is "<signalA>__<signalB>" for correlational insights — use it to recover
  // a missing signal before falling back to an empty string.
  const [idA = '', idB = ''] = id.split('__');
  const signalA = nonEmptyString(insight.signalA) ?? idA;
  const signalB = nonEmptyString(insight.signalB) ?? idB;

  const correlation = finiteNumber(insight.correlation) ?? 0;
  const sampleDays = Math.max(0, Math.round(finiteNumber(insight.sampleDays) ?? 0));
  const confidence = CONFIDENCE_VALUES.includes(insight.confidence as Confidence)
    ? (insight.confidence as Confidence)
    : 'low';

  return {
    ...(insight as unknown as InsightDTO),
    id,
    headline,
    detail,
    signalA: signalA as InsightDTO['signalA'],
    signalB: signalB as InsightDTO['signalB'],
    correlation,
    sampleDays,
    confidence,
  };
}

/** The list the route returns: always an array, only decodable insights. */
export function toClientInsights(raw: unknown): InsightDTO[] {
  if (!Array.isArray(raw)) return [];
  const out: InsightDTO[] = [];
  for (const item of raw) {
    const insight = toClientInsight(item);
    if (insight) out.push(insight);
  }
  return out;
}
