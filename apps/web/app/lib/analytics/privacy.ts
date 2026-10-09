/**
 * Privacy backstop. The generated constructors already restrict call sites to
 * plan properties; this catches anything that slips through (hand-built
 * payloads, provider enrichment, future plan mistakes) before it leaves the
 * browser. Exact keys only: pattern matching would also drop legitimate plan
 * keys such as `step_name` or `has_weight`.
 */
import type { AnalyticsProperties } from './types';

export const BLOCKED_PROPERTY_KEYS: ReadonlySet<string> = new Set([
  // Identity / contact
  'email',
  'email_address',
  'name',
  'first_name',
  'last_name',
  'full_name',
  'display_name',
  'username',
  'user_name',
  'phone',
  'phone_number',
  'address',
  'password',
  'date_of_birth',
  'dob',
  'birthday',
  // Health values
  'weight',
  'weight_kg',
  'weight_lbs',
  'target_weight',
  'goal_weight',
  'height',
  'height_cm',
  'height_in',
  'bmi',
  'body_fat',
  'body_fat_percent',
  'body_fat_percentage',
  'muscle_mass',
  'calories',
  'kcal',
  'protein',
  'protein_g',
  'carbs',
  'carbs_g',
  'fat',
  'fat_g',
  'fiber',
  'sugar',
  'sodium',
  'steps',
  'step_count',
  'water',
  'water_ml',
  'water_oz',
  'volume_ml',
  'duration_minutes',
  'minutes',
  'heart_rate',
  // Free text
  'note',
  'notes',
  'message',
  'text',
  'content',
  'description',
  'query',
  'search_query',
  'circle_name',
  'food_name',
  'bio',
]);

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const MAX_STRING_LENGTH = 200;

/**
 * Returns a copy with blocked keys removed, plus anything that looks like an
 * email address or long free text. Non-primitive values are dropped.
 */
export function sanitizeProperties(properties: Readonly<Record<string, unknown>>): AnalyticsProperties {
  const out: AnalyticsProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (BLOCKED_PROPERTY_KEYS.has(key.toLowerCase())) continue;
    if (typeof value === 'string') {
      if (EMAIL_PATTERN.test(value) || value.length > MAX_STRING_LENGTH) continue;
      out[key] = value;
    } else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      out[key] = value;
    }
  }
  return out;
}
