/**
 * Request validation for PUT /api/mobile/profile.
 *
 * Every rule here accepts at least what the route accepted before 2026-09-28
 * (the submitted iOS build cannot be updated): fields were only added or widened.
 */
import { z } from 'zod';

import { USERNAME_PATTERN, USERNAME_RULES_MESSAGE } from '@/lib/services/username-service';

import { isDateOfBirthInput, isFutureCalendarDate } from './date-of-birth';

/**
 * Wire values of "Sex / Gender". Identical on both clients:
 *   iOS     Core/Models/User.swift `enum UserGender: String`
 *   Android features/onboarding/models/OnboardingModels.kt `enum class UserGender`
 * and identical to the CHECK constraint in migration 088.
 *
 * iOS decodes this as a CLOSED enum: a value outside this list in a profile
 * response fails the whole `User` decode. Never return anything else.
 */
export const PROFILE_GENDER_VALUES = ['female', 'male', 'non_binary', 'prefer_not_to_say'] as const;
export type ProfileGender = (typeof PROFILE_GENDER_VALUES)[number];

export function isProfileGender(value: unknown): value is ProfileGender {
  return typeof value === 'string' && (PROFILE_GENDER_VALUES as readonly string[]).includes(value);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  // The register rule (username-service.ts): 3–30 letters, digits, underscores
  // and periods, no leading/trailing period, surrounding whitespace trimmed.
  // It is a superset of the previous rule here (3–30 of [a-zA-Z0-9_]).
  username: z.string().trim().regex(USERNAME_PATTERN, USERNAME_RULES_MESSAGE).optional(),
  avatarUrl: z.string().url().optional(),
  bio: z.string().max(500).optional(),
  // Physical profile / onboarding fields sent by iOS + Android
  heightCm: z.number().positive().max(300, 'Height must be less than 300 cm').optional(),
  weightKg: z.number().positive().max(1000, 'Weight must be less than 1000 kg').optional(),
  // "YYYY-MM-DD" (Android) or an ISO-8601 datetime (iOS). The route turns a
  // datetime into the calendar date with normalizeDateOfBirth(); a calendar
  // date is checked here exactly as before.
  dateOfBirth: z
    .string()
    .refine(isDateOfBirthInput, 'Invalid date format (YYYY-MM-DD)')
    .refine(
      (val) => !DATE_ONLY.test(val.trim()) || !isFutureCalendarDate(val.trim()),
      'Date of birth cannot be in the future'
    )
    .optional(),
  fitnessLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert', 'athlete']).optional(),
  // Not nullable on purpose: an explicit null is dropped by parseLenient and
  // means "not sent", never "clear" (clients serialise unset fields as null).
  gender: z.enum(PROFILE_GENDER_VALUES).optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
