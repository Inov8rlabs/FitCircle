/**
 * Circle (FitCircle) request validation for the mobile API.
 *
 * The three clients disagree on the wire format:
 *   - Android and the original route contract: camelCase keys, `YYYY-MM-DD` dates.
 *   - iOS 1.0 (`CreateCircleRequest` / `UpdateCircleRequest` in
 *     FitCircle/Core/Models/FitCircle.swift): snake_case keys, ISO-8601 datetimes
 *     (`JSONEncoder.dateEncodingStrategy = .iso8601`, e.g. `2026-09-28T19:12:33Z`).
 *
 * Everything here only ever accepts MORE than the routes accepted before: the old
 * request shapes parse to exactly the same values.
 */
import { z } from 'zod';

import type { CircleType, CircleVisibility } from '../types/circle';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)?$/;
const HAS_ZONE = /(?:[Zz]|[+-]\d{2}(?::?\d{2})?)$/;

function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** `YYYY-MM-DD` (a real calendar day). */
export function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && DATE_ONLY.test(value) && isRealCalendarDate(value);
}

/** `YYYY-MM-DD` or an ISO-8601 datetime that resolves to a real instant. */
export function isFlexibleDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) return isRealCalendarDate(trimmed);
  if (!ISO_DATETIME.test(trimmed)) return false;
  return isRealCalendarDate(trimmed.slice(0, 10)) && !Number.isNaN(new Date(trimmed).getTime());
}

/**
 * The calendar day a client meant.
 *
 * - `YYYY-MM-DD` is returned unchanged.
 * - A datetime WITH a zone (`Z`, `+05:30`) is an instant; when the client's IANA
 *   timezone is known (`x-client-timezone`) the day is that instant's LOCAL day,
 *   so an evening pick in Los Angeles does not roll over to tomorrow's UTC date.
 *   Without a timezone the date part of the string is used.
 * - A datetime without a zone is taken as written.
 */
export function toCalendarDate(value: string, timeZone?: string | null): string {
  const trimmed = value.trim();
  if (DATE_ONLY.test(trimmed)) return trimmed;

  if (timeZone && HAS_ZONE.test(trimmed)) {
    const instant = new Date(trimmed);
    if (!Number.isNaN(instant.getTime())) {
      try {
        return new Intl.DateTimeFormat('en-CA', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(instant);
      } catch {
        // Unknown zone: fall through to the date part.
      }
    }
  }
  return trimmed.slice(0, 10);
}

/** Epoch milliseconds of a flexible date, or null when it cannot be read. */
export function toEpochMillis(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  const time = new Date(value.trim()).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * True when two dates are the same moment. Swift's `.iso8601` encoder drops
 * fractional seconds, so a value that round-trips through iOS can differ from the
 * stored one by less than a second; that is not a change.
 */
export function isSameMoment(a: unknown, b: unknown): boolean {
  const left = toEpochMillis(a);
  const right = toEpochMillis(b);
  if (left === null || right === null) return false;
  return Math.abs(left - right) < 1000;
}

const flexibleDate = (label: string) =>
  z
    .string()
    .refine(isFlexibleDate, { message: `Invalid ${label} (use YYYY-MM-DD or an ISO 8601 datetime)` });

// ---------------------------------------------------------------------------
// Key aliases
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Copy `alias` onto `canonical` when the canonical key carries no value. The
 * canonical key always wins, so a request that already used it is untouched.
 */
function applyAliases(body: unknown, aliases: Record<string, string>): unknown {
  if (!isPlainObject(body)) return body;
  const out: Record<string, unknown> = { ...body };
  for (const [alias, canonical] of Object.entries(aliases)) {
    const hasCanonical = out[canonical] !== undefined && out[canonical] !== null;
    if (!hasCanonical && out[alias] !== undefined && out[alias] !== null) {
      out[canonical] = out[alias];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

export const CIRCLE_VISIBILITIES: readonly CircleVisibility[] = ['public', 'private', 'invite_only'];

/**
 * The visibility to store, or undefined when none was sent. An unknown value is
 * ignored rather than rejected: before this field was read, any value was
 * accepted (and dropped), so rejecting one now would tighten the contract.
 */
export function normalizeVisibility(value: unknown): CircleVisibility | undefined {
  if (typeof value !== 'string') return undefined;
  const candidate = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (CIRCLE_VISIBILITIES as readonly string[]).includes(candidate)
    ? (candidate as CircleVisibility)
    : undefined;
}

// ---------------------------------------------------------------------------
// POST /api/mobile/circles
// ---------------------------------------------------------------------------

// fitcircles.type is a NOT NULL enum (weight_loss | step_count | workout_minutes | custom).
// iOS also sends its legacy ChallengeType raw values; map them onto the DB enum.
export const CIRCLE_TYPE_ALIASES: Record<string, CircleType> = {
  weight_loss: 'weight_loss',
  weight: 'weight_loss',
  step_count: 'step_count',
  steps: 'step_count',
  workout_minutes: 'workout_minutes',
  exercise: 'workout_minutes',
  check_in: 'custom',
  custom: 'custom',
};

const CREATE_CIRCLE_ALIASES: Record<string, string> = {
  start_date: 'startDate',
  end_date: 'endDate',
  allow_late_join: 'allowLateJoin',
  late_join_deadline: 'lateJoinDeadline',
};

/** snake_case (iOS) → the camelCase keys the schema reads. */
export function normalizeCreateCircleBody(body: unknown): unknown {
  return applyAliases(body, CREATE_CIRCLE_ALIASES);
}

export const createCircleSchema = z.object({
  name: z.string().min(1, 'Circle name is required').max(100),
  description: z.string().optional(),
  type: z
    .string()
    .transform((value) => CIRCLE_TYPE_ALIASES[value])
    .refine((value): value is CircleType => value !== undefined, {
      message: 'type must be one of weight_loss, step_count, workout_minutes, custom',
    })
    .optional(),
  startDate: flexibleDate('start date'),
  endDate: flexibleDate('end date'),
  allowLateJoin: z.boolean().optional(),
  lateJoinDeadline: z.number().int().min(1).max(30).optional(),
  // Read leniently by normalizeVisibility(); never a reason to reject the request.
  visibility: z.unknown().optional(),
});

export type CreateCircleBody = z.infer<typeof createCircleSchema>;

// ---------------------------------------------------------------------------
// PUT /api/mobile/circles/[id]
// ---------------------------------------------------------------------------

const UPDATE_CIRCLE_ALIASES: Record<string, string> = {
  startDate: 'start_date',
  endDate: 'end_date',
};

/** camelCase → the snake_case keys the schema reads (what iOS and Android send). */
export function normalizeUpdateCircleBody(body: unknown): unknown {
  return applyAliases(body, UPDATE_CIRCLE_ALIASES);
}

export const updateCircleSchema = z.object({
  name: z.string().min(3).max(100).optional(),
  // '' clears the description. A JSON null is dropped by parseLenient (= not sent).
  description: z.string().max(500).optional(),
  start_date: flexibleDate('start date').optional(),
  end_date: flexibleDate('end date').optional(),
});

export type UpdateCircleBody = z.infer<typeof updateCircleSchema>;

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * iOS builds paths with `UUID.uuidString`, which is UPPERCASE, while Supabase
 * returns lowercase ids. Postgres compares uuids case-insensitively but `===`
 * does not, so ids from a path are lowercased before any comparison in code.
 */
export function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}
