import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CustomChallengeModule from '@/lib/services/custom-challenge-service';
import type * as TemplateModule from '@/lib/services/template-service';

const mocks = vi.hoisted(() => ({
  createCustomChallenge: vi.fn(),
  createFromTemplate: vi.fn(),
}));

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => ({}) }));
vi.mock('@/lib/services/custom-challenge-service', async (importOriginal) => {
  const actual = await importOriginal<typeof CustomChallengeModule>();
  // Keep the real validateChallenge / estimateDifficulty; only the insert is stubbed.
  vi.spyOn(actual.CustomChallengeService, 'createCustomChallenge').mockImplementation(mocks.createCustomChallenge);
  return actual;
});
vi.mock('@/lib/services/template-service', async (importOriginal) => {
  const actual = await importOriginal<typeof TemplateModule>();
  vi.spyOn(actual.TemplateService, 'createFromTemplate').mockImplementation(mocks.createFromTemplate);
  return actual;
});
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async (request: Request) => {
    if (!request.headers.get('Authorization')?.startsWith('Bearer ')) throw new Error('Unauthorized');
    return { id: 'user-1' };
  },
}));

import { POST as custom } from '../custom/route';
import { POST as fromTemplate } from '../from-template/route';
import { POST as validate } from '../validate/route';

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const TEMPLATE = '66666666-6666-4666-8666-666666666666';

const post = (handler: any, body: unknown, authed = true) =>
  handler(
    new Request('http://localhost/api/mobile/challenges/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authed ? { Authorization: 'Bearer t' } : {}) },
      body: JSON.stringify(body),
    }) as any
  );

const customBody = {
  name: 'Run club',
  category: 'cardio',
  goal_amount: 50,
  unit: 'km',
  duration_days: 14,
  fitcircle_id: CIRCLE,
};
const row = { id: 'c-1', name: 'Run club', category: 'cardio', status: 'active' };

beforeEach(() => {
  mocks.createCustomChallenge.mockReset().mockResolvedValue({ ...row, difficulty: 'medium' });
  mocks.createFromTemplate.mockReset().mockResolvedValue(row);
});
afterEach(() => vi.clearAllMocks());

describe('POST /api/mobile/challenges/custom', () => {
  it('accepts explicit nulls for the optional fields', async () => {
    const res = await post(custom, { ...customBody, description: null, quest_type: null });
    expect(res.status).toBe(200);
    expect(mocks.createCustomChallenge).toHaveBeenCalledWith('user-1', customBody);
  });

  it('accepts a null circle exactly like an omitted one', async () => {
    const { fitcircle_id: _omit, ...solo } = customBody;
    expect((await post(custom, { ...solo, fitcircle_id: null })).status).toBe(200);
    expect(mocks.createCustomChallenge).toHaveBeenLastCalledWith('user-1', solo);
    expect((await post(custom, solo)).status).toBe(200);
    expect(mocks.createCustomChallenge).toHaveBeenLastCalledWith('user-1', solo);
  });

  it('still accepts the old shape and returns the row untouched', async () => {
    const res = await post(custom, { ...customBody, description: 'Weekend runs', quest_type: 'collaborative' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { ...row, difficulty: 'medium' }, error: null });
  });

  it('still rejects invalid input, keeping code + details and adding a readable message', async () => {
    const res = await post(custom, { ...customBody, goal_amount: null, duration_days: 400 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Object.keys(body.error).sort()).toEqual(['code', 'details', 'message']);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.message).toBe('goal_amount: Required (+1 more)');
    expect(mocks.createCustomChallenge).not.toHaveBeenCalled();
  });

  it('keeps the 403 for a non-member and the 401 without a token', async () => {
    mocks.createCustomChallenge.mockRejectedValueOnce(new Error('You must be an active member of this circle'));
    const forbidden = await post(custom, customBody);
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe('FORBIDDEN');

    expect((await post(custom, customBody, false)).status).toBe(401);
  });
});

describe('POST /api/mobile/challenges/from-template', () => {
  it('accepts the documented body and ignores unrelated null keys', async () => {
    const res = await post(fromTemplate, { template_id: TEMPLATE, fitcircle_id: CIRCLE, note: null });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, data: row, error: null });
    expect(mocks.createFromTemplate).toHaveBeenCalledWith(TEMPLATE, CIRCLE, 'user-1');
  });

  it('still requires both ids: a null circle is a 400 that names the field', async () => {
    const res = await post(fromTemplate, { template_id: TEMPLATE, fitcircle_id: null });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('fitcircle_id: Required');
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(mocks.createFromTemplate).not.toHaveBeenCalled();
  });
});

describe('POST /api/mobile/challenges/validate', () => {
  it('returns { valid, errors, difficulty } for a valid challenge, as before', async () => {
    const res = await post(validate, customBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { valid: true, errors: [], difficulty: 'medium' },
      error: null,
    });
  });

  it('treats explicit nulls as missing fields', async () => {
    const withNulls = await (await post(validate, { ...customBody, description: null, quest_type: null, fitcircle_id: null })).json();
    expect(withNulls.data).toEqual({ valid: true, errors: [], difficulty: 'medium' });

    const missing = await (await post(validate, { ...customBody, unit: null, goal_amount: null })).json();
    const omitted = await (await post(validate, { name: 'Run club', category: 'cardio', duration_days: 14, fitcircle_id: CIRCLE })).json();
    expect(missing.data).toEqual(omitted.data);
    expect(missing.data.valid).toBe(false);
  });

  it('reports errors instead of failing for an empty or null body', async () => {
    for (const body of [{}, null]) {
      const res = await post(validate, body);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.valid).toBe(false);
      expect(json.data.errors.length).toBeGreaterThan(0);
    }
  });
});
