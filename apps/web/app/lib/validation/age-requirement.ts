/**
 * Minimum age 18 (Terms §3; docs/PRIVACY_COMPLIANCE_SPEC.md §5).
 *
 * Every place that accepts a date of birth, birth year or age rejects an
 * under-18 value with 400 AGE_REQUIREMENT. The message is neutral: it states
 * the rule and does not hint at "try another year".
 *
 * Existing accounts: a profile update that only echoes the stored date back
 * (clients send the whole profile) is not re-checked, so accounts created
 * before the gate keep working until the owner decides how to handle them.
 *
 * Never log the values.
 */
import { z } from 'zod';

export const MIN_USER_AGE = 18;
export const AGE_REQUIREMENT_CODE = 'AGE_REQUIREMENT';
export const AGE_REQUIREMENT_MESSAGE = 'FitCircle is only available to people aged 18 and over.';

export class AgeRequirementError extends Error {
  readonly code = AGE_REQUIREMENT_CODE;
  readonly status = 400;
  constructor(readonly field: string = 'dateOfBirth') {
    super(AGE_REQUIREMENT_MESSAGE);
    this.name = 'AgeRequirementError';
  }
}

/** Whole years between a YYYY-MM-DD (or ISO datetime) date and `now` (UTC). Null when unreadable. */
export function ageOn(dateOfBirth: string, now: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth ?? '');
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age--;
  return age;
}

/** True when the date is a readable past date giving an age under 18. */
export function isUnderMinimumAge(dateOfBirth: string, now: Date = new Date()): boolean {
  const age = ageOn(dateOfBirth, now);
  return age !== null && age >= 0 && age < MIN_USER_AGE;
}

/**
 * A birth year alone: the age this calendar year. Someone born in the year that makes
 * them 18 this year passes (the year is all we know).
 */
export function isUnderMinimumAgeByYear(year: number, now: Date = new Date()): boolean {
  const age = now.getUTCFullYear() - year;
  return age >= 0 && age < MIN_USER_AGE;
}

export function isUnderMinimumAgeValue(age: number): boolean {
  return Number.isFinite(age) && age >= 0 && age < MIN_USER_AGE;
}

/** zod issue carrying the AGE_REQUIREMENT marker (mapped to 400 AGE_REQUIREMENT by the routes). */
export function addAgeIssue(ctx: z.RefinementCtx, field: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: AGE_REQUIREMENT_MESSAGE, params: { code: AGE_REQUIREMENT_CODE } });
}

/** True when a ZodError (or anything with `issues`) carries an AGE_REQUIREMENT issue. */
export function isAgeRequirementZodError(error: unknown): boolean {
  const issues = (error as any)?.issues;
  return Array.isArray(issues) && issues.some((i: any) => i?.params?.code === AGE_REQUIREMENT_CODE);
}

/** The field an age error is about (AgeRequirementError.field or the AGE_REQUIREMENT zod issue path). */
export function ageErrorField(error: unknown): string {
  if (error instanceof AgeRequirementError) return error.field;
  const issue = ((error as any)?.issues ?? []).find((i: any) => i?.params?.code === AGE_REQUIREMENT_CODE);
  const p = issue?.path?.[0];
  return typeof p === 'string' ? p : 'dateOfBirth';
}

/** The standard 400 body fields for AGE_REQUIREMENT. */
export function ageRequirementBody(field = 'dateOfBirth') {
  return {
    success: false,
    data: null,
    error: {
      code: AGE_REQUIREMENT_CODE,
      message: AGE_REQUIREMENT_MESSAGE,
      details: { field, minimumAge: MIN_USER_AGE },
      timestamp: new Date().toISOString(),
    },
    meta: null,
  };
}
