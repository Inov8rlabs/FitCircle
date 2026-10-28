/**
 * Onboarding v3 birth year / date of birth on the save points
 * (docs/USER_TARGETS_CONTRACT.md §3): PATCH /progress, POST /plan, POST /complete.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { POST as POST_COMPLETE } from '../complete/route';
import { POST as POST_PLAN } from '../plan/route';
import { PATCH as PATCH_PROGRESS } from '../progress/route';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
vi.mock('@/lib/services/assessment-service', () => ({ AssessmentService: { completeOnboarding: vi.fn(async () => ({ success: true, xpAwarded: 0 })) } }));
vi.mock('@/lib/services/mobile-api-service', () => ({ MobileAPIService: { getUserProfileWithStats: vi.fn(async () => ({ id: 'x' })) } }));
vi.mock('@/lib/middleware/mobile-auth', () => ({ requireMobileAuth: vi.fn(async () => ({ ...db.getRows('profiles')[0] })) }));

const USER = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-28T12:00:00Z');
let db: FakeSupabase;
const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

const req = (path: string, method: string, body?: unknown) =>
  new NextRequest(`https://api.test${path}`, {
    method,
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const row = () => db.getRows('profiles')[0];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = new FakeSupabase({
    profiles: { uniqueKey: ['id'], rows: [{ id: USER, date_of_birth: null, preferences: { a: 1 }, height_cm: null, weight_kg: null }] },
    onboarding_progress: { uniqueKey: ['user_id'] },
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
  warn.mockClear();
  log.mockClear();
});
afterEach(() => vi.useRealTimers());

/** No log line may carry the birth date or year. */
function expectNotLogged(...values: string[]) {
  const lines = [...warn.mock.calls, ...log.mock.calls].map((c) => JSON.stringify(c));
  for (const v of values) expect(lines.some((l) => l.includes(v))).toBe(false);
}

describe('PATCH /onboarding/progress', () => {
  it('birthYear saves YYYY-07-01 with the estimate marker; response shape unchanged', async () => {
    const res = await PATCH_PROGRESS(req('/api/mobile/onboarding/progress', 'PATCH', { flow: 'v2', step: 'v3_about_you', birthYear: 1990 }));
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(Object.keys(data).sort()).toEqual(['data', 'flow', 'step', 'updatedAt']);
    expect(row().date_of_birth).toBe('1990-07-01');
    expect(row().preferences).toEqual({ a: 1, date_of_birth_estimate: { from: 'birth_year', date: '1990-07-01' } });
    expectNotLogged('1990');
  });

  it('a year never overwrites a full date; a full date replaces a year', async () => {
    row().date_of_birth = '1985-11-12';
    await PATCH_PROGRESS(req('/api/mobile/onboarding/progress', 'PATCH', { flow: 'v2', step: 's', birthYear: 1990 }));
    expect(row().date_of_birth).toBe('1985-11-12');

    row().date_of_birth = null;
    await PATCH_PROGRESS(req('/api/mobile/onboarding/progress', 'PATCH', { flow: 'v2', step: 's', birthYear: 1990 }));
    await PATCH_PROGRESS(req('/api/mobile/onboarding/progress', 'PATCH', { flow: 'v2', step: 's', dateOfBirth: '1990-03-04' }));
    expect(row().date_of_birth).toBe('1990-03-04');
    expect(row().preferences).toEqual({ a: 1 });
  });

  it('400 for an out-of-range year or a bad date; nothing saved', async () => {
    for (const body of [{ birthYear: 2020 }, { birthYear: 1900 }, { dateOfBirth: '1990-13-01' }, { dateOfBirth: '2020-01-01' }]) {
      const res = await PATCH_PROGRESS(req('/api/mobile/onboarding/progress', 'PATCH', { flow: 'v2', step: 's', ...body }));
      expect(res.status).toBe(400);
    }
    expect(row().date_of_birth).toBeNull();
    expect(db.getRows('onboarding_progress')).toHaveLength(0);
  });

  it('shipped body (no birth fields) behaves as before', async () => {
    const res = await PATCH_PROGRESS(req('/api/mobile/onboarding/progress', 'PATCH', { flow: 'v2', step: 'v2_goal', data: { goal: 'lose_weight' } }));
    expect(res.status).toBe(200);
    expect(row().date_of_birth).toBeNull();
    expect(row().preferences).toEqual({ a: 1 });
  });
});

describe('POST /onboarding/plan', () => {
  it('birthYear stands in for age and is saved; response keys unchanged', async () => {
    const res = await POST_PLAN(req('/api/mobile/onboarding/plan', 'POST', { goal: 'lose_weight', heightCm: 180, weightKg: 90, sex: 'male', birthYear: 1991 }));
    const data = (await res.json()).data;
    expect(Object.keys(data).sort()).toEqual(['assumptions', 'basis', 'calories', 'proteinG', 'steps', 'waterMl']);
    expect(data.assumptions).not.toContain('age_30');
    // Same as sending age 35 (born 1991-07-01, today 2026-10-28).
    const withAge = (await (await POST_PLAN(req('/api/mobile/onboarding/plan', 'POST', { goal: 'lose_weight', heightCm: 180, weightKg: 90, sex: 'male', age: 35 }))).json()).data;
    expect(data.calories).toBe(withAge.calories);
    expect(row().date_of_birth).toBe('1991-07-01');
  });

  it('400 on an invalid birth year', async () => {
    expect((await POST_PLAN(req('/api/mobile/onboarding/plan', 'POST', { goal: 'lose_weight', birthYear: 2024 }))).status).toBe(400);
  });
});

describe('POST /onboarding/complete', () => {
  it('saves an optional dateOfBirth; works with no body and ignores an invalid one', async () => {
    expect((await POST_COMPLETE(req('/api/mobile/onboarding/complete', 'POST'))).status).toBe(200);
    expect(row().date_of_birth).toBeNull();
    expect((await POST_COMPLETE(req('/api/mobile/onboarding/complete', 'POST', { birthYear: 3000 }))).status).toBe(200);
    expect(row().date_of_birth).toBeNull();
    const res = await POST_COMPLETE(req('/api/mobile/onboarding/complete', 'POST', { dateOfBirth: '1988-05-06' }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(row().date_of_birth).toBe('1988-05-06');
    expectNotLogged('1988-05-06');
  });
});
