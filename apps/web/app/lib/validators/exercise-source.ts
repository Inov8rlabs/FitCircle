/**
 * Exercise log `source`: what a client may SEND versus what is STORED and returned.
 *
 * Stored / returned `exercise_logs.source` stays `manual | healthkit`:
 *  - the DB CHECK (`exercise_logs_source_check`) only allows those two values;
 *  - both shipped clients test `source == "healthkit"` to show the "synced" badge
 *    and to lock the platform-owned fields (iOS `ExerciseEntryDetailFeature`,
 *    Android `ExerciseLogEntry.isSynced`), and the server's own edit protection
 *    (`ExerciseService.updateExercise`) keys on the same value.
 *  A row stored as `health_connect` would therefore read as an editable manual
 *  workout on every released build. So a Health Connect import is stored as
 *  `source = 'healthkit'` ("synced from a health platform") and its true origin
 *  goes in the separate nullable column `source_platform` (migration 092).
 *
 * `source_platform` is only written when the client DECLARES a non-Apple origin.
 * A plain `healthkit` is ambiguous (Android has always sent it for Health Connect
 * imports), so it is left NULL rather than recorded as a fact.
 */
import { z } from 'zod';

export const EXERCISE_SOURCE_INPUTS = ['manual', 'healthkit', 'health_connect', 'google_fit'] as const;
export type ExerciseSourceInput = (typeof EXERCISE_SOURCE_INPUTS)[number];

export const exerciseSourceInputSchema = z.enum(EXERCISE_SOURCE_INPUTS);

export type StoredExerciseSource = 'manual' | 'healthkit';
export type ExerciseSourcePlatform = 'health_connect' | 'google_fit';

export interface ResolvedExerciseSource {
  /** Value for `exercise_logs.source` — always one the released clients understand. */
  source: StoredExerciseSource;
  /** Value for `exercise_logs.source_platform`, or null when the origin was not declared. */
  sourcePlatform: ExerciseSourcePlatform | null;
}

export function resolveExerciseSource(
  input: ExerciseSourceInput | undefined,
  fallback: StoredExerciseSource
): ResolvedExerciseSource {
  switch (input) {
    case 'manual':
      return { source: 'manual', sourcePlatform: null };
    case 'healthkit':
      return { source: 'healthkit', sourcePlatform: null };
    case 'health_connect':
    case 'google_fit':
      return { source: 'healthkit', sourcePlatform: input };
    default:
      return { source: fallback, sourcePlatform: null };
  }
}

/**
 * True when an insert/update failed only because `column` does not exist yet
 * (migration not applied): PostgREST schema-cache miss (PGRST204) or Postgres
 * undefined_column (42703). Callers retry without the column.
 */
export function isMissingColumnError(
  error: { code?: string | null; message?: string | null } | null | undefined,
  column: string
): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  if (!message.includes(column)) return false;
  return error.code === 'PGRST204' || error.code === '42703' || /column/i.test(message);
}
