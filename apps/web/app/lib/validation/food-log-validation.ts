/**
 * Food Log Validation Schemas
 * Zod schemas for validating food log API requests
 */

import { z } from 'zod';

// `nutrition_data` is a JSONB passthrough that carries the macro summary AND the rich
// AI breakdown (per-ingredient `items`, `health_score`). iOS/Android round-trip the full
// object on create AND on the re-analyze PATCH, so accept the known numeric fields plus
// extra keys (.passthrough). The old `z.record(z.number())` wrongly rejected `items: [...]`,
// which 400'd any entry that carried an ingredient breakdown.
const nutritionDataSchema = z
  .object({
    calories: z.number().optional(),
    protein_g: z.number().optional(),
    carbs_g: z.number().optional(),
    fat_g: z.number().optional(),
    fiber_g: z.number().optional(),
    sugar_g: z.number().optional(),
    sodium_mg: z.number().optional(),
    health_score: z.number().optional(),
    items: z.array(z.record(z.any())).max(100).optional(),
  })
  .passthrough();

export const CreateFoodLogEntrySchema = z.object({
  entry_type: z.enum(['food', 'water', 'supplement']),
  logged_at: z.string().datetime().optional(),
  entry_date: z.string().date().optional(),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'other']).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  nutrition_data: nutritionDataSchema.optional(),
  water_ml: z.number().int().min(1).max(10000).optional(),
  supplement_name: z.string().max(200).optional(),
  supplement_dosage: z.string().max(100).optional(),
  is_private: z.boolean().optional(),
  visibility: z.enum(['private', 'shared', 'circle']).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
}).refine(
  (data) => {
    if (data.entry_type === 'food') return !!data.meal_type;
    if (data.entry_type === 'water') return !!data.water_ml;
    if (data.entry_type === 'supplement') return !!data.supplement_name;
    return false;
  },
  {
    message: 'Invalid entry data for entry type',
  }
);

export const UpdateFoodLogEntrySchema = z.object({
  logged_at: z.string().datetime().optional(),
  entry_date: z.string().date().optional(),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'other']).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
  nutrition_data: nutritionDataSchema.optional(),
  water_ml: z.number().int().min(1).max(10000).optional(),
  supplement_name: z.string().max(200).optional(),
  supplement_dosage: z.string().max(100).optional(),
  is_private: z.boolean().optional(),
  visibility: z.enum(['private', 'shared', 'circle']).optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
});

// Day-grouped chronological view (breakfast → lunch → dinner ordering).
export const FoodLogDayQuerySchema = z.object({
  date: z.string().date(),
});

export const ShareFoodLogSchema = z.object({
  share_with: z.enum(['user', 'circle']),
  user_ids: z.array(z.string().uuid()).optional(),
  circle_id: z.string().uuid().optional(),
  can_comment: z.boolean().optional(),
  expires_at: z.string().datetime().optional(),
  message: z.string().max(500).optional(),
}).refine(
  (data) => {
    if (data.share_with === 'user') return !!data.user_ids && data.user_ids.length > 0;
    if (data.share_with === 'circle') return !!data.circle_id;
    return false;
  },
  {
    message: 'Must provide user_ids or circle_id based on share_with value',
  }
);

export const FoodLogQuerySchema = z.object({
  page: z.string().transform(Number).pipe(z.number().int().positive()).optional().nullable(),
  limit: z.string().transform(Number).pipe(z.number().int().positive().max(100)).optional().nullable(),
  entry_type: z.enum(['food', 'water', 'supplement', 'all']).optional().nullable(),
  start_date: z.string().date().optional().nullable(),
  end_date: z.string().date().optional().nullable(),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'other']).optional().nullable(),
  tags: z.string().optional().nullable(), // comma-separated
});
