/** 18+ wherever a date of birth / birth year / age is accepted (docs/PRIVACY_COMPLIANCE_SPEC.md §5). */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferralFakeDb, getReferralDb, setReferralDb } from '@/lib/services/__tests__/referral-fake-db';
import {
  AGE_REQUIREMENT_MESSAGE,
  isUnderMinimumAge,
  isUnderMinimumAgeByYear,
  isUnderMinimumAgeValue,
} from '@/lib/validation/age-requirement';

const u = vi.hoisted(() => ({ profile: { id: 'u1', date_of_birth: null as string | null }, updates: [] as any[] }));

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getReferralDb().client() }));
vi.mock('@/lib/middleware/mobile-auth', () => ({ requireMobileAuth: async () => ({ ...u.profile }) }));
vi.mock('@/lib/middleware/mobile-auto-refresh', () => ({ addAutoRefreshHeaders: async (_r: unknown, res: unknown) => res }));
vi.mock('@/lib/services/test-device-service', () => ({ recordTestDeviceSignal: async () => false }));
vi.mock('@/lib/services/assessment-service', () => ({ AssessmentService: { completeOnboarding: async () => ({ xpAwarded: 0 }) } }));
vi.mock('@/lib/fitzy/plan-warmup', () => ({ warmFitzyPlanPreview: async () => false }));
vi.mock('@/lib/utils/after-response', () => ({ runAfterResponse: () => {} }));
vi.mock('@/lib/services/mobile-api-service', () => ({
  MobileAPIService: {
    getUserProfileWithStats: async () => ({}),
    updateUserProfile: async (_id: string, updates: any) => {
      u.updates.push(updates);
      return { id: 'u1', ...updates };
    },
  },
}));
vi.mock('@/lib/services/mobile-profile-response', () => ({ toProfileUpdateResponse: (p: unknown) => p }));

import { POST as register } from '../../auth/register/route';
import { POST as complete } from '../onboarding/complete/route';
import { POST as plan } from '../onboarding/plan/route';
import { PATCH as progress } from '../onboarding/progress/route';
import { PUT as putProfile } from '../profile/route';
import { PUT as putSettings } from '../profile/settings/route';

const year = new Date().getUTCFullYear();
const req = (path: string, method: string, body: unknown) =>
  new NextRequest(`https://www.fitcircle.ai${path}`, { method, headers: { authorization: 'Bearer t', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const isAgeError = async (res: Response) => {
  const b = await res.json();
  return res.status === 400 && b.error?.code === 'AGE_REQUIREMENT' && b.error?.message === AGE_REQUIREMENT_MESSAGE;
};
const minorDate = () => `${year - 16}-01-01`;
const adultDate = '1990-05-14';

let db: ReferralFakeDb;
beforeEach(() => {
  db = new ReferralFakeDb();
  setReferralDb(db);
  db.addProfile({ id: 'u1', date_of_birth: null, preferences: {} });
  db.rows('onboarding_progress');
  u.profile = { id: 'u1', date_of_birth: null };
  u.updates.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('pure checks', () => {
  it('date, year and age forms', () => {
    const now = new Date('2026-11-06T12:00:00Z');
    expect(isUnderMinimumAge('2008-11-07', now)).toBe(true); // 18 tomorrow
    expect(isUnderMinimumAge('2008-11-06', now)).toBe(false); // 18 today
    expect(isUnderMinimumAge('2020-01-01T00:00:00Z', now)).toBe(true);
    expect(isUnderMinimumAgeByYear(2009, now)).toBe(true);
    expect(isUnderMinimumAgeByYear(2008, now)).toBe(false);
    expect(isUnderMinimumAgeValue(17)).toBe(true);
    expect(isUnderMinimumAgeValue(18)).toBe(false);
  });
});

describe('onboarding', () => {
  it('PATCH /onboarding/progress: under-18 birthYear or dateOfBirth → 400 AGE_REQUIREMENT; nothing stored', async () => {
    expect(await isAgeError(await progress(req('/api/mobile/onboarding/progress', 'PATCH', { flow: 'v3', step: 'about', birthYear: year - 15 })))).toBe(true);
    expect(await isAgeError(await progress(req('/api/mobile/onboarding/progress', 'PATCH', { flow: 'v3', step: 'about', dateOfBirth: minorDate() })))).toBe(true);
    expect(await isAgeError(await progress(req('/api/mobile/onboarding/progress', 'PATCH', { flow: 'v3', step: 'about', birthYear: year - 12 })))).toBe(true); // same neutral answer
    expect(db.profile('u1')!.date_of_birth).toBeNull();
    const ok = await progress(req('/api/mobile/onboarding/progress', 'PATCH', { flow: 'v3', step: 'about', birthYear: 1990 }));
    expect(ok.status).toBe(200);
    expect(db.profile('u1')!.date_of_birth).toBe('1990-07-01');
  });

  it('POST /onboarding/plan: under-18 age / birthYear → 400 AGE_REQUIREMENT', async () => {
    expect(await isAgeError(await plan(req('/api/mobile/onboarding/plan', 'POST', { goal: 'lose_weight', age: 16 })))).toBe(true);
    expect(await isAgeError(await plan(req('/api/mobile/onboarding/plan', 'POST', { goal: 'lose_weight', birthYear: year - 14 })))).toBe(true);
    expect((await plan(req('/api/mobile/onboarding/plan', 'POST', { goal: 'lose_weight', age: 30 }))).status).toBe(200);
  });

  it('POST /onboarding/complete: an under-18 birth date is refused; a malformed one is still ignored', async () => {
    expect(await isAgeError(await complete(req('/api/mobile/onboarding/complete', 'POST', { dateOfBirth: minorDate() })))).toBe(true);
    expect((await complete(req('/api/mobile/onboarding/complete', 'POST', { dateOfBirth: 'not-a-date' }))).status).toBe(200);
    expect((await complete(req('/api/mobile/onboarding/complete', 'POST', { birthYear: 1985 }))).status).toBe(200);
  });
});

describe('profile settings', () => {
  it('PUT /profile: a new under-18 date → 400 AGE_REQUIREMENT, nothing written', async () => {
    expect(await isAgeError(await putProfile(req('/api/mobile/profile', 'PUT', { dateOfBirth: minorDate() })))).toBe(true);
    expect(u.updates).toHaveLength(0);
  });

  it('PUT /profile: an adult date saves; an unchanged echo of an existing under-18 date is not re-checked', async () => {
    expect((await putProfile(req('/api/mobile/profile', 'PUT', { dateOfBirth: adultDate }))).status).toBe(200);
    expect(u.updates[0].date_of_birth).toBe(adultDate);
    u.profile = { id: 'u1', date_of_birth: minorDate() }; // account created before the gate
    expect((await putProfile(req('/api/mobile/profile', 'PUT', { dateOfBirth: minorDate(), bio: 'hi' }))).status).toBe(200);
  });

  it('PUT /profile/settings: under-18 date_of_birth → 400 AGE_REQUIREMENT', async () => {
    expect(await isAgeError(await putSettings(req('/api/mobile/profile/settings', 'PUT', { date_of_birth: `${minorDate()}T00:00:00Z` })))).toBe(true);
    expect((await putSettings(req('/api/mobile/profile/settings', 'PUT', { date_of_birth: `${adultDate}T00:00:00Z` }))).status).toBe(200);
  });
});

describe('web register API', () => {
  it('POST /api/auth/register with an under-18 birthYear → 400 AGE_REQUIREMENT before any account is created', async () => {
    const res = await register(
      new NextRequest('https://www.fitcircle.ai/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
        body: JSON.stringify({ email: 'kid@example.com', password: 'longenough1', fullName: 'Kid Example', birthYear: year - 15 }),
      })
    );
    expect(await isAgeError(res)).toBe(true);
  });
});
