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
 * Customisation enums — TWO spellings are accepted on input.
 *
 * The mobile apps are the only clients that set size / temperature / milk, and both
 * encode AND decode the camelCase spellings: iOS `BeverageCustomizations.BeverageSize`
 * (`extraLarge`), `.Temperature` (`room`), `.MilkType` (`cream`) are strict
 * `String`-backed `Codable` enums, Android uses the same `@SerialName`s. The schema
 * used to accept only `extra_large` / `room_temp` and had no `cream`, so choosing
 * XL, Room Temp or Heavy Cream was a 400 on both platforms.
 *
 * The value that is STORED and RETURNED is always the client spelling
 * (see `toClientBeverageCustomizations`): iOS cannot decode `extra_large` /
 * `room_temp` at all (one such row fails the whole list, and a failed decode of
 * the create response makes iOS re-post the drink).
 */

/**
 * Temperature options (`room` is the client spelling of `room_temp`)
 */
export const TemperatureEnum = z.enum(['hot', 'cold', 'iced', 'room_temp', 'room']);

/**
 * Size options (`extraLarge` is the client spelling of `extra_large`)
 */
export const SizeEnum = z.enum(['small', 'medium', 'large', 'extra_large', 'extraLarge']);

/**
 * Milk type options (`cream` = heavy cream, sent by both mobile apps)
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
  'cream',
]);

/** Backend spelling → the spelling both mobile clients encode and decode. */
const CLIENT_SIZE_SPELLING: Record<string, string> = { extra_large: 'extraLarge' };
const CLIENT_TEMPERATURE_SPELLING: Record<string, string> = { room_temp: 'room' };

/**
 * Return `customizations` with `size` / `temperature` in the spelling the mobile
 * clients decode. Used on write (so new rows are stored in that spelling) and on
 * read (so rows stored with the old backend spelling still decode on iOS).
 * Every other key and value is passed through untouched; non-objects are returned as-is.
 */
export function toClientBeverageCustomizations<T>(customizations: T): T {
  if (
    typeof customizations !== 'object' ||
    customizations === null ||
    Array.isArray(customizations)
  ) {
    return customizations;
  }
  const source = customizations as Record<string, unknown>;
  const size = typeof source.size === 'string' ? CLIENT_SIZE_SPELLING[source.size] : undefined;
  const temperature =
    typeof source.temperature === 'string'
      ? CLIENT_TEMPERATURE_SPELLING[source.temperature]
      : undefined;
  if (size === undefined && temperature === undefined) return customizations;
  return {
    ...source,
    ...(size !== undefined ? { size } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  } as T;
}

/**
 * A `beverage_logs` row as returned to clients: same row, customizations in the
 * client spelling. Null / undefined rows are returned unchanged.
 */
export function toClientBeverageEntry<T>(entry: T): T {
  if (typeof entry !== 'object' || entry === null) return entry;
  const row = entry as Record<string, unknown>;
  if (!('customizations' in row)) return entry;
  const customizations = toClientBeverageCustomizations(row.customizations);
  if (customizations === row.customizations) return entry;
  return { ...row, customizations } as T;
}

/**
 * Beverage source
 */
export const BeverageSourceEnum = z.enum(['manual', 'import', 'api', 'ios', 'android', 'web']);

/**
 * Alcohol sub-type — covered keys clients should use for alcohol entries.
 * Stored inside customizations JSONB. Indexed via the existing GIN index.
 */
export const AlcoholTypeEnum = z.enum(['beer', 'wine', 'spirit', 'cocktail', 'other']);

/**
 * Beverage customizations schema
 * Flexible schema allowing various customization properties. For alcohol
 * entries clients should populate the alcohol_* fields below; for coffee/
 * tea the size/temperature/milk_type fields. Unknown keys pass through.
 */
export const BeverageCustomizationsSchema = z
  .object({
    // Generic
    size: SizeEnum.optional(),
    temperature: TemperatureEnum.optional(),
    milk_type: MilkTypeEnum.optional(),
    sweetener: z.string().max(100).optional(),
    add_ins: z.array(z.string().max(100)).max(20).optional(),
    ice: z.boolean().optional(),
    shots: z.number().int().min(0).max(10).optional(),
    flavor: z.string().max(100).optional(),

    // Alcohol-specific (only meaningful when category === 'alcohol')
    alcohol_type: AlcoholTypeEnum.optional(),
    brand: z.string().max(200).optional(),
    name: z.string().max(200).optional(),
    abv_percent: z.number().min(0).max(100).optional(),
    serving_count: z.number().int().min(1).max(50).optional(),
    serving_size_ml: z.number().int().min(1).max(5000).optional(),
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
    logged_at: z.string().datetime().optional(),
    entry_date: z.string().date().optional(),
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
