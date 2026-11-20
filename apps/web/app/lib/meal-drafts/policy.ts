/**
 * Draft meals (docs/ENGAGEMENT_115_SPEC.md §14.6) — pure rules. No I/O.
 *
 * A successful AI analysis by a 1.1.5+ client is held in meal_analysis_results. If the user
 * neither saves (food-log create with `analysis_id`) nor discards it within 30 minutes, it
 * becomes a Draft meal: a private food-log entry with entry_status 'draft' that counts nowhere
 * until the user confirms it.
 */
import { isValidTimezone, localDayOf } from '../streaks/streak-calculator';
import type { CreateFoodLogEntryInput, MealType } from '../types/food-log';
import type { NutritionDraftDTO } from '../types/nutrition';

import { DRAFT_PROMOTION_AFTER_MS, PENDING_MAX_AGE_MS, SUPERSEDE_WINDOW_MS } from './config';

export type AnalysisMethod = 'photo' | 'voice' | 'text';

export type PromotionDecision =
  /** Not 30 minutes old yet. */
  | 'wait'
  | 'promote'
  /** A newer analysis by the same user (re-scan / Fix) within 15 min, or a meal saved without a link right after: never two copies. */
  | 'superseded'
  /** Older than the 24 h backlog limit, or nothing to review (no food found). */
  | 'expired';

export interface PendingAnalysis {
  created_at: string;
  draft: Partial<NutritionDraftDTO> | null;
}

/**
 * What to do with one pending analysis.
 * `newerAnalysisAt`: created_at of the user's next analysis after this one (if any).
 * `unlinkedFoodSaveAt`: created_at of the first food entry the user saved WITHOUT an analysis
 * link after this analysis (if any).
 */
export function promotionDecision(i: {
  row: PendingAnalysis;
  now: Date;
  newerAnalysisAt?: string | null;
  unlinkedFoodSaveAt?: string | null;
}): PromotionDecision {
  const created = Date.parse(i.row.created_at);
  if (Number.isNaN(created)) return 'expired';
  const age = i.now.getTime() - created;
  if (age < DRAFT_PROMOTION_AFTER_MS) return 'wait';
  if (age > PENDING_MAX_AGE_MS) return 'expired';
  if (!i.row.draft || !Array.isArray(i.row.draft.items) || i.row.draft.items.length === 0) return 'expired';
  const within = (at: string | null | undefined, windowMs: number) => {
    const t = at ? Date.parse(at) : NaN;
    return !Number.isNaN(t) && t > created && t - created <= windowMs;
  };
  if (within(i.newerAnalysisAt, SUPERSEDE_WINDOW_MS)) return 'superseded';
  if (within(i.unlinkedFoodSaveAt, DRAFT_PROMOTION_AFTER_MS)) return 'superseded';
  return 'promote';
}

/** Meal slot for a capture time in the user's zone (the draft lands in the slot it was eaten in). */
export function mealTypeAt(at: Date, timezone: string | null | undefined): MealType {
  const tz = isValidTimezone(timezone) ? timezone : 'UTC';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const minutes = h * 60 + m;
  if (minutes >= 4 * 60 && minutes < 10 * 60 + 30) return 'breakfast';
  if (minutes >= 11 * 60 && minutes < 14 * 60 + 30) return 'lunch';
  if (minutes >= 17 * 60 && minutes < 21 * 60 + 30) return 'dinner';
  return 'snack';
}

const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

/** "Grilled chicken, Rice + 2 more" (≤ 80 chars). */
export function draftTitle(items: Array<{ name?: unknown }>): string {
  const names = items.map((i) => (typeof i.name === 'string' ? i.name.trim() : '')).filter(Boolean);
  if (names.length === 0) return 'Meal';
  const shown = names.slice(0, 2).join(', ');
  const title = names.length > 2 ? `${shown} + ${names.length - 2} more` : shown;
  return title.length > 80 ? `${title.slice(0, 77)}…` : title;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * The food-log entry a draft becomes: the AI items and totals exactly as the client was shown
 * them, filed under the capture time / day / slot in the user's zone.
 */
export function draftEntryInput(a: {
  draft: Partial<NutritionDraftDTO>;
  method: AnalysisMethod;
  capturedAt: string;
  timezone: string | null | undefined;
  mealType?: string | null;
}): CreateFoodLogEntryInput {
  const items = Array.isArray(a.draft.items) ? a.draft.items : [];
  const t = (a.draft.totals ?? {}) as Partial<NutritionDraftDTO['totals']>;
  const captured = new Date(a.capturedAt);
  const tz = isValidTimezone(a.timezone) ? a.timezone : 'UTC';
  const mealType = MEAL_TYPES.includes(a.mealType as MealType) ? (a.mealType as MealType) : mealTypeAt(captured, tz);
  const calories = num(t.calories);
  return {
    entry_type: 'food',
    logged_at: captured.toISOString(),
    entry_date: localDayOf(captured, tz),
    meal_type: mealType,
    title: draftTitle(items as Array<{ name?: unknown }>),
    nutrition_data: {
      ...(calories !== undefined ? { calories } : {}),
      ...(num(t.proteinG) !== undefined ? { protein_g: num(t.proteinG) } : {}),
      ...(num(t.carbsG) !== undefined ? { carbs_g: num(t.carbsG) } : {}),
      ...(num(t.fatG) !== undefined ? { fat_g: num(t.fatG) } : {}),
      ...(num(t.fiberG) !== undefined ? { fiber_g: num(t.fiberG) } : {}),
      ...(num(t.sugarG) !== undefined ? { sugar_g: num(t.sugarG) } : {}),
      ...(num(t.sodiumMg) !== undefined ? { sodium_mg: num(t.sodiumMg) } : {}),
      ...(num(a.draft.healthScore) !== undefined ? { health_score: num(a.draft.healthScore) } : {}),
      items: items as unknown as Array<Record<string, unknown>>,
      ...(Array.isArray(a.draft.assumptions) && a.draft.assumptions.length ? { assumptions: a.draft.assumptions } : {}),
    },
    input_method: a.method,
    nutrition_source: a.method === 'photo' ? 'llm_vision' : 'llm_voice',
    ...(num(a.draft.overallConfidence) !== undefined ? { llm_confidence: num(a.draft.overallConfidence) } : {}),
    is_private: true,
    visibility: 'private',
    share_with_circles: false,
  };
}
