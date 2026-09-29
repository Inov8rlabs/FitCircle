import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { USERNAME_PATTERN } from '@/lib/services/username-service';

import { parseLenient } from '../lenient-parse';
import { PROFILE_GENDER_VALUES, isProfileGender, updateProfileSchema } from '../profile-validation';

/** The PUT /api/mobile/profile username rule as it was before 2026-09-28. */
const previousUsernameRule = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[a-zA-Z0-9_]+$/);

/** The register rule (auth/register/route.ts). */
const registerUsernameRule = z.string().trim().regex(USERNAME_PATTERN);

const accepts = (username: unknown) => updateProfileSchema.safeParse({ username }).success;

describe('updateProfileSchema: username', () => {
  const samples = [
    'abc',
    'ABC',
    'a_b',
    '___',
    'john_doe',
    'JohnDoe99',
    'a'.repeat(30),
    'john.doe',
    'j.o.e',
    'a.b',
    'fitcircle.user2',
    ' john ',
    ' john.doe\n',
    'ab',
    'a'.repeat(31),
    '.john',
    'john.',
    'jo hn',
    'john+tag',
    'jöhn',
    'john-doe',
    '',
    '...',
  ];

  it('accepts everything the previous rule accepted', () => {
    const previouslyAccepted = samples.filter((s) => previousUsernameRule.safeParse(s).success);
    expect(previouslyAccepted.length).toBeGreaterThan(5);
    for (const username of previouslyAccepted) expect(accepts(username), username).toBe(true);
  });

  it('accepts everything the register rule accepts', () => {
    const registerAccepted = samples.filter((s) => registerUsernameRule.safeParse(s).success);
    expect(registerAccepted).toEqual(expect.arrayContaining(['john.doe', 'j.o.e', ' john ']));
    for (const username of registerAccepted) expect(accepts(username), username).toBe(true);
  });

  it('is exactly the register rule (nothing wider)', () => {
    for (const username of samples) {
      expect(accepts(username), JSON.stringify(username)).toBe(registerUsernameRule.safeParse(username).success);
    }
  });

  it('trims like register does', () => {
    expect(updateProfileSchema.parse({ username: ' john.doe ' }).username).toBe('john.doe');
  });
});

describe('updateProfileSchema: gender', () => {
  it('accepts exactly the wire values of iOS UserGender and Android UserGender', () => {
    expect([...PROFILE_GENDER_VALUES]).toEqual(['female', 'male', 'non_binary', 'prefer_not_to_say']);
    for (const gender of PROFILE_GENDER_VALUES) {
      expect(updateProfileSchema.parse({ gender }).gender).toBe(gender);
      expect(isProfileGender(gender)).toBe(true);
    }
  });

  it('rejects anything else (iOS decodes a closed enum)', () => {
    for (const gender of ['other', 'Female', 'nonBinary', 'non-binary', '', 1]) {
      expect(updateProfileSchema.safeParse({ gender }).success, String(gender)).toBe(false);
      expect(isProfileGender(gender)).toBe(false);
    }
  });

  it('an explicit null means "not sent", not "clear"', () => {
    const parsed = parseLenient(updateProfileSchema, { displayName: 'Ani', gender: null });
    expect(parsed).toEqual({ displayName: 'Ani' });
    expect('gender' in parsed).toBe(false);
  });
});

describe('updateProfileSchema: dateOfBirth', () => {
  it('still accepts the calendar date', () => {
    expect(updateProfileSchema.parse({ dateOfBirth: '1984-09-26' }).dateOfBirth).toBe('1984-09-26');
  });

  it('accepts the ISO-8601 datetime iOS sends', () => {
    expect(updateProfileSchema.safeParse({ dateOfBirth: '1984-09-26T07:00:00Z' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ dateOfBirth: '1984-09-25T18:30:00.000Z' }).success).toBe(true);
  });

  it('still rejects a future calendar date and junk', () => {
    const future = updateProfileSchema.safeParse({ dateOfBirth: '2999-01-01' });
    expect(future.success).toBe(false);
    expect(future.success ? '' : future.error.issues[0].message).toBe('Date of birth cannot be in the future');

    const junk = updateProfileSchema.safeParse({ dateOfBirth: '26/09/1984' });
    expect(junk.success).toBe(false);
    expect(junk.success ? '' : junk.error.issues[0].message).toBe('Invalid date format (YYYY-MM-DD)');
  });
});

describe('updateProfileSchema: requests the shipped clients send', () => {
  it('iOS Edit Profile (UpdateProfileRequest)', () => {
    const body = {
      displayName: 'Ani B',
      bio: 'hello',
      heightCm: 178,
      weightKg: 74.5,
      dateOfBirth: '1984-09-26T07:00:00Z',
      avatarUrl: 'https://example.supabase.co/storage/v1/object/public/avatars/avatars/u_1.jpg',
      gender: 'male',
    };
    expect(parseLenient(updateProfileSchema, body)).toEqual(body);
  });

  it('Android Edit Profile (ProfileUpdateRequest), old shape without gender', () => {
    const body = { displayName: 'Ani', dateOfBirth: '1984-09-26', heightCm: 178.0, fitnessLevel: 'expert' };
    expect(parseLenient(updateProfileSchema, body)).toEqual(body);
  });

  it('Android onboarding (OnboardingProfileRequest)', () => {
    const body = { displayName: 'Ani', heightCm: 178, weightKg: 74.5, gender: 'non_binary' };
    expect(parseLenient(updateProfileSchema, body)).toEqual(body);
  });

  it('explicit nulls for every unset field (older Android builds) are tolerated', () => {
    const body = {
      displayName: 'Ani',
      bio: null,
      dateOfBirth: null,
      heightCm: null,
      weightKg: null,
      fitnessLevel: null,
      avatarUrl: null,
      username: null,
      gender: null,
    };
    expect(updateProfileSchema.safeParse(body).success).toBe(false); // the old 400
    expect(parseLenient(updateProfileSchema, body)).toEqual({ displayName: 'Ani' });
  });

  it('unknown keys are still ignored', () => {
    expect(parseLenient(updateProfileSchema, { displayName: 'Ani', somethingNew: 1 })).toEqual({
      displayName: 'Ani',
    });
  });
});
