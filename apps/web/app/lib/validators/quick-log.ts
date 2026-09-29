/**
 * Quick Log request tolerance.
 *
 * exercise_logs.category is constrained (DB CHECK) to
 * cardio | strength | flexibility | sports | outdoor | other, but the iOS client's
 * brand table carries categories outside that set (`hiit`, `cycling`, `general`).
 * Unknown categories are mapped to the closest stored one instead of failing the
 * request; the six canonical values pass through untouched.
 */
import { z } from 'zod';

export const QUICK_LOG_CATEGORIES = ['cardio', 'strength', 'flexibility', 'sports', 'outdoor', 'other'] as const;
export type QuickLogCategory = (typeof QUICK_LOG_CATEGORIES)[number];

const CATEGORY_ALIASES: Record<string, QuickLogCategory> = {
  // cardio
  hiit: 'cardio',
  cycling: 'cardio',
  running: 'cardio',
  run: 'cardio',
  walking: 'cardio',
  walk: 'cardio',
  swimming: 'cardio',
  swim: 'cardio',
  dance: 'cardio',
  endurance: 'cardio',
  // strength
  weights: 'strength',
  gym: 'strength',
  crossfit: 'strength',
  // flexibility
  yoga: 'flexibility',
  pilates: 'flexibility',
  stretch: 'flexibility',
  stretching: 'flexibility',
  mobility: 'flexibility',
  // sports / outdoor
  sport: 'sports',
  hiking: 'outdoor',
  // catch-alls
  general: 'other',
  home: 'other',
};

/** Closest stored category for whatever string a client sent. */
export function normalizeQuickLogCategory(raw: string): QuickLogCategory {
  const key = raw.trim().toLowerCase();
  if ((QUICK_LOG_CATEGORIES as readonly string[]).includes(key)) return key as QuickLogCategory;
  return CATEGORY_ALIASES[key] ?? 'other';
}

/** Any non-empty string is accepted and normalized; a missing/non-string value still fails. */
export const quickLogCategorySchema = z
  .string()
  .min(1)
  .max(50)
  .transform((value): QuickLogCategory => normalizeQuickLogCategory(value));
