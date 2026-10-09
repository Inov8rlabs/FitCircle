/**
 * Meal-logging instrumentation shared by the photo/voice/manual entry points.
 */
import { AnalyticsEvents, type MealPhotoAnalyzedConfidence } from './events.generated';
import { isUpgradeRequired, toErrorKind } from './helpers';

import { analytics } from './index';

export function confidenceBand(confidence: number | null | undefined): MealPhotoAnalyzedConfidence | undefined {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return undefined;
  if (confidence < 0.6) return 'low';
  if (confidence < 0.85) return 'medium';
  return 'high';
}

/**
 * Wraps an AI photo-parse call with Meal Photo Analysis Started / Analyzed /
 * Failed (+ AI Limit Reached when the free quota is exhausted). Rethrows.
 */
export async function trackedPhotoParse<T extends { items: unknown[]; overallConfidence?: number; cached?: boolean }>(
  run: () => Promise<T>,
  meta: { imageCount: number; hasNote?: boolean; source?: string }
): Promise<T> {
  analytics.track(AnalyticsEvents.mealPhotoAnalysisStarted({ image_count: meta.imageCount, has_note: meta.hasNote }));
  try {
    const result = await run();
    analytics.track(
      AnalyticsEvents.mealPhotoAnalyzed({
        item_count: result.items.length,
        confidence: confidenceBand(result.overallConfidence),
        cached: result.cached,
      })
    );
    return result;
  } catch (error) {
    const upgrade = isUpgradeRequired(error);
    analytics.track(
      AnalyticsEvents.mealPhotoAnalysisFailed({ error_kind: toErrorKind(error), upgrade_required: upgrade })
    );
    if (upgrade) analytics.track(AnalyticsEvents.aiLimitReached({ feature: 'photo_log', source: meta.source }));
    throw error;
  }
}
