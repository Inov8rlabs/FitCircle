/**
 * Step-count source aliases.
 *
 * daily_tracking.steps_source is constrained (DB CHECK) to
 * manual | healthkit | google_fit, and both clients read those stored values
 * (`stepsSource == "healthkit"` / `"google_fit"`). Clients have used other names
 * for the same platforms on the way in, so they are accepted as aliases and
 * stored under the canonical name:
 *   apple_health   → healthkit   (iOS "Sync Last 7 Days")
 *   health_connect → google_fit  (the DB's name for Android Health Connect)
 */
import { z } from 'zod';

const STEPS_SOURCE_ALIASES: Record<string, string> = {
  apple_health: 'healthkit',
  health_connect: 'google_fit',
};

export function normalizeStepsSource(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return STEPS_SOURCE_ALIASES[value] ?? value;
}

/** manual | healthkit | google_fit (+ aliases) — single daily entries. */
export const stepsSourceSchema = z.preprocess(
  normalizeStepsSource,
  z.enum(['manual', 'healthkit', 'google_fit'])
);

/** healthkit | google_fit (+ aliases) — bulk sync is platform data only. */
export const platformStepsSourceSchema = z.preprocess(
  normalizeStepsSource,
  z.enum(['healthkit', 'google_fit'])
);
