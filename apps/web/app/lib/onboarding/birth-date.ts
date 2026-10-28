/**
 * Onboarding v3 date of birth (docs/USER_TARGETS_CONTRACT.md §3) — pure.
 *
 * The About-you step asks for an age or a birth year; the plan uses it and the
 * profile keeps it in profiles.date_of_birth (a DATE). Accepted on the
 * onboarding save points as either
 *   birthYear    int, giving an age of 13–100 this year
 *   dateOfBirth  "YYYY-MM-DD", giving an age of 13–100 today
 *
 * A year alone is stored as YYYY-07-01 (mid-year: the age is off by at most
 * six months either way) and remembered as an estimate in
 * profiles.preferences.date_of_birth_estimate = { from: 'birth_year', date }.
 *
 * Write rules:
 *   - a full date always wins and clears the estimate marker;
 *   - a year is written only when nothing is stored, or when the stored date
 *     is itself a year estimate (the marker's `date` equals the stored date) —
 *     a year never overwrites a full date the user entered anywhere else;
 *   - an unchanged value writes nothing.
 * Never log these values.
 */
import { z } from 'zod';

import { isCalendarDate } from '../validation/date-of-birth';

import { ageFrom } from './plan';

export const MIN_AGE = 13;
export const MAX_AGE = 100;
export const ESTIMATE_KEY = 'date_of_birth_estimate';

/** Fields merged into the onboarding schemas (progress / plan / complete). */
export const birthDateFields = {
  birthYear: z.number().int().nullish(),
  dateOfBirth: z.string().trim().max(10).nullish(),
};

export type BirthDateInput = { birthYear?: number | null; dateOfBirth?: string | null };

export interface ParsedBirthDate {
  date: string;
  precision: 'day' | 'year';
}

/** Age check for a birth year as of `now`'s calendar year (UTC). */
function yearAgeOk(year: number, now: Date): boolean {
  const age = now.getUTCFullYear() - year;
  return age >= MIN_AGE && age <= MAX_AGE;
}

/**
 * The value to store, or null when neither field is sent. Validate first with
 * `refineBirthDate`; a full date wins when both are sent.
 */
export function parseBirthDate(input: BirthDateInput): ParsedBirthDate | null {
  if (input.dateOfBirth != null && input.dateOfBirth !== '') {
    return { date: input.dateOfBirth, precision: 'day' };
  }
  if (input.birthYear != null) {
    return { date: `${String(input.birthYear).padStart(4, '0')}-07-01`, precision: 'year' };
  }
  return null;
}

/** zod superRefine for any schema that spreads `birthDateFields`. */
export function refineBirthDate(v: BirthDateInput, ctx: z.RefinementCtx, now: Date = new Date()): void {
  if (v.dateOfBirth != null && v.dateOfBirth !== '') {
    if (!isCalendarDate(v.dateOfBirth)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dateOfBirth'], message: 'dateOfBirth must be YYYY-MM-DD' });
    } else if (ageFrom(v.dateOfBirth, now) === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dateOfBirth'], message: `age must be ${MIN_AGE}-${MAX_AGE}` });
    }
  }
  if (v.birthYear != null && !yearAgeOk(v.birthYear, now)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['birthYear'], message: `age must be ${MIN_AGE}-${MAX_AGE}` });
  }
}

type Json = Record<string, any>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});

/** profiles.date_of_birth as YYYY-MM-DD (Postgres may hand back a timestamp-ish string). */
function storedDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1] : null;
}

/**
 * The profile update to apply (date_of_birth + preferences), or null when nothing
 * changes. `profile` needs date_of_birth and preferences.
 */
export function birthDateUpdate(
  profile: { date_of_birth?: unknown; preferences?: unknown } | null | undefined,
  parsed: ParsedBirthDate
): { date_of_birth: string; preferences: Json } | null {
  const current = storedDate(profile?.date_of_birth);
  const prefs = obj(profile?.preferences);
  const estimate = obj(prefs[ESTIMATE_KEY]);
  const currentIsEstimate = current !== null && estimate.date === current;

  if (parsed.precision === 'day') {
    if (current === parsed.date && !currentIsEstimate && !(ESTIMATE_KEY in prefs)) return null;
    const preferences = { ...prefs };
    delete preferences[ESTIMATE_KEY];
    return { date_of_birth: parsed.date, preferences };
  }

  // Year precision: never overwrite a full date.
  if (current !== null && !currentIsEstimate) return null;
  if (current === parsed.date) return null;
  return {
    date_of_birth: parsed.date,
    preferences: { ...prefs, [ESTIMATE_KEY]: { from: 'birth_year', date: parsed.date } },
  };
}
