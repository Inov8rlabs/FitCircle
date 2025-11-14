/**
 * Beverage Log Validation Schemas
 * Zod schemas for validating beverage log API requests
 */

import { z } from 'zod';

/**
 * Beverage categories
 */
export const BeverageCategoryEnum = z.enum([
  'water',
  'coffee',
  'tea',
  'smoothie',
  'protein_shake',
  'juice',
  'soda',
  'alcohol',
  'energy_drink',
  'sports_drink',
  'milk',
  'other',
]);

/**
 * Temperature options
 */
export const TemperatureEnum = z.enum(['hot', 'cold', 'iced', 'room_temp']);

/**
 * Size options
 */
export const SizeEnum = z.enum(['small', 'medium', 'large', 'extra_large']);

/**
 * Milk type options
 */
export const MilkTypeEnum = z.enum([
  'whole',
  'skim',
  '2_percent',
  'oat',
  'almond',
  'soy',
  'coconut',
  'none',
]);

/**
 * Beverage source
 */
export const BeverageSourceEnum = z.enum(['manual', 'import', 'api', 'ios', 'android', 'web']);

/**
 * Beverage customizations schema
 * Flexible schema allowing various customization properties
 */
export const BeverageCustomizationsSchema = z
  .object({
    size: SizeEnum.optional(),
    temperature: TemperatureEnum.optional(),
    milk_type: MilkTypeEnum.optional(),
    sweetener: z.string().max(100).optional(),
    add_ins: z.array(z.string().max(100)).max(20).optional(),
    ice: z.boolean().optional(),
    shots: z.number().int().min(0).max(10).optional(),
    flavor: z.string().max(100).optional(),
  })
  .passthrough(); // Allow additional properties for flexibility

/**
 * Schema for creating a new beverage log entry
 */
export const CreateBeverageLogSchema = z
  .object({
    category: BeverageCategoryEnum,
    beverage_type: z.string().min(1).max(200),
    customizations: BeverageCustomizationsSchema.optional(),
    volume_ml: z.number().int().min(1).max(10000),
    calories: z.number().int().min(0).max(5000).optional(),
    caffeine_mg: z.number().int().min(0).max(1000).optional(),
    sugar_g: z.number().min(0).max(500).optional(),
    notes: z.string().max(2000).optional(),
    is_favorite: z.boolean().optional(),
    favorite_name: z.string().min(1).max(200).optional(),
    is_private: z.boolean().optional(),
    logged_at: z.string().datetime().optional(),
    entry_date: z.string().date().optional(),
    source: BeverageSourceEnum.optional(),
  })
  .refine(
    (data) => {
      // If is_favorite is true, favorite_name must be provided
      if (data.is_favorite === true) {
        return !!data.favorite_name && data.favorite_name.length > 0;
      }
      return true;
    },
    {
      message: 'favorite_name is required when is_favorite is true',
      path: ['favorite_name'],
    }
  );

/**
 * Schema for updating a beverage log entry
 */
export const UpdateBeverageLogSchema = z
  .object({
    beverage_type: z.string().min(1).max(200).optional(),
    customizations: BeverageCustomizationsSchema.optional(),
    volume_ml: z.number().int().min(1).max(10000).optional(),
    calories: z.number().int().min(0).max(5000).optional(),
    caffeine_mg: z.number().int().min(0).max(1000).optional(),
    sugar_g: z.number().min(0).max(500).optional(),
    notes: z.string().max(2000).optional(),
    is_favorite: z.boolean().optional(),
    favorite_name: z.string().min(1).max(200).optional(),
    is_private: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // If is_favorite is true, favorite_name must be provided
      if (data.is_favorite === true) {
        return !!data.favorite_name && data.favorite_name.length > 0;
      }
      return true;
    },
    {
      message: 'favorite_name is required when is_favorite is true',
      path: ['favorite_name'],
    }
  );

/**
 * Schema for querying beverage log entries
 */
export const BeverageLogQuerySchema = z.object({
  page: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .optional()
    .nullable(),
  limit: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive().max(100))
    .optional()
    .nullable(),
  category: z
    .enum([
      'water',
      'coffee',
      'tea',
      'smoothie',
      'protein_shake',
      'juice',
      'soda',
      'alcohol',
      'energy_drink',
      'sports_drink',
      'milk',
      'other',
      'all',
    ])
    .optional()
    .nullable(),
  start_date: z.string().date().optional().nullable(),
  end_date: z.string().date().optional().nullable(),
  favorites_only: z
    .string()
    .transform((val) => val === 'true')
    .pipe(z.boolean())
    .optional()
    .nullable(),
});

/**
 * Schema for beverage stats query parameters
 */
export const BeverageStatsQuerySchema = z.object({
  start_date: z.string().date().optional().nullable(),
  end_date: z.string().date().optional().nullable(),
});
