/**
 * Circle type (fitcircles.type enum) — what the circle is about. Shipped iOS and
 * Android decode exactly these four wire values.
 */
export const CIRCLE_TYPES = ['step_count', 'weight_loss', 'workout_minutes', 'custom'] as const;
export type CircleTypeValue = (typeof CIRCLE_TYPES)[number];

export const CIRCLE_TYPE_LABELS: Record<CircleTypeValue, string> = {
  step_count: 'Steps',
  weight_loss: 'Weight loss',
  workout_minutes: 'Workout minutes',
  custom: 'Custom',
};

const WEIGHT_UNITS = new Set(['lb', 'lbs', 'kg', 'kgs', 'pounds', 'kilograms']);

/**
 * The type a circle's challenge implies: steps -> step_count, a weight unit ->
 * weight_loss, minutes in a cardio challenge -> workout_minutes, else custom.
 * No challenge -> null (the creator picks).
 */
export function circleTypeForChallenge(challenge: { unit?: string | null; category?: string | null } | null): CircleTypeValue | null {
  if (!challenge) return null;
  const unit = (challenge.unit ?? '').trim().toLowerCase();
  if (unit === 'steps') return 'step_count';
  if (WEIGHT_UNITS.has(unit)) return 'weight_loss';
  if (unit === 'minutes' && challenge.category === 'cardio') return 'workout_minutes';
  return 'custom';
}
