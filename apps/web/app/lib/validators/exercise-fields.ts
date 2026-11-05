/**
 * Field schemas shared by the exercise create / update / sync routes, tolerant of
 * what the shipped clients actually send.
 */
import { z } from 'zod';

/**
 * A positive measurement where 0 (or less) means "not measured".
 * iOS sends HealthKit's `totalEnergyBurned` / `totalDistance` as-is (0.0 when the
 * workout has none) and `Double("0")` from the manual form; with `.positive()` one
 * such value was a 400 — for exercises/sync, of the whole batch of up to 100.
 * Android already drops values <= 0 client-side; the server now does the same.
 */
export const optionalPositiveMeasure = z.preprocess(
  (value) => (typeof value === 'number' && value <= 0 ? undefined : value),
  z.number().positive().optional()
);

/**
 * ISO 8601 instant, with `Z` or a numeric offset. iOS echoes `started_at` back as
 * PostgREST returned it ("2026-11-05T14:00:00+00:00") when editing a workout; plain
 * `.datetime()` accepts only `Z`, so every structured edit of a synced workout was a 400.
 */
export const isoInstant = z.string().datetime({ offset: true });
