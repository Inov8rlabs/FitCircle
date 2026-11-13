/**
 * GET /api/mobile/paywall/config (docs/PAYWALL_DEFAULT_PLAN.md): optional auth, only the
 * two paywall keys, no-store, never 5xx because of config.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyMobileAuth } from '@/lib/middleware/mobile-auth';
import { resetRemoteConfigCache } from '@/lib/remote-config';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../../__tests__/helpers/fake-supabase';
import { GET } from '../route';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
vi.mock('@/lib/middleware/mobile-auth', () => ({ verifyMobileAuth: vi.fn() }));

const USER = '11111111-2222-3333-4444-555555555555';
let db: FakeSupabase;
let n = 0;

const rule = (key: string, audience: Record<string, unknown>, value: unknown, priority = 1) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  config_key: key,
  name: `rule ${n}`,
  enabled: true,
  priority,
  audience,
  value,
  created_by: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_by: null,
  updated_at: '2026-11-01T00:00:00Z',
});
const def = (key: string, value: unknown) => ({ config_key: key, value, updated_by: 'a@x', updated_at: '2026-11-01T00:00:00Z' });

const call = async (headers: Record<string, string> = {}) => {
  const res = await GET(new NextRequest('https://api.test/api/mobile/paywall/config', { headers }));
  return { res, body: await res.json() };
};

beforeEach(() => {
  db = new FakeSupabase({
    remote_config_rules: {},
    remote_config_defaults: { uniqueKey: ['config_key'] },
    user_attribution: {},
    profiles: {},
    experiment_assignments: {},
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
  vi.mocked(verifyMobileAuth).mockReset().mockResolvedValue(null);
  resetRemoteConfigCache();
});

describe('GET /api/mobile/paywall/config', () => {
  it('signed out, nothing configured → code defaults (annual / annual), no-store envelope', async () => {
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toMatchObject({ success: true, data: { defaultPlan: 'annual', badgePlan: 'annual' }, error: null });
    expect(Object.keys(body.data).sort()).toEqual(['badgePlan', 'defaultPlan']); // only these two keys, ever
  });

  it('signed out → admin defaults and platform / version rules still apply', async () => {
    db.seed('remote_config_defaults', [def('paywall_default_plan', 'monthly'), def('paywall_badge_plan', 'none')]);
    db.seed('remote_config_rules', [rule('paywall_default_plan', { platforms: ['android'], appVersionGte: '1.1.4' }, 'annual')]);
    expect((await call()).body.data).toEqual({ defaultPlan: 'monthly', badgePlan: 'none' });
    resetRemoteConfigCache();
    const android = await call({ 'x-app-platform': 'android', 'x-app-version': '1.1.4' });
    expect(android.body.data).toEqual({ defaultPlan: 'annual', badgePlan: 'none' });
    const oldAndroid = await call({ 'x-app-platform': 'android', 'x-app-version': '1.1.3' });
    expect(oldAndroid.body.data.defaultPlan).toBe('monthly');
  });

  it('signed out → user-scoped rules (userIds, percent, experiment) never match and no per-user rows are read', async () => {
    db.seed('remote_config_rules', [
      rule('paywall_default_plan', { userIds: [USER] }, 'monthly', 3),
      rule('paywall_default_plan', { percent: 100 }, 'monthly', 2),
      rule('paywall_default_plan', { experiment: { key: 'onboarding_paywall', arms: ['hard'] } }, 'monthly', 1),
      rule('paywall_badge_plan', { channels: ['apple_ads'] }, 'none'),
    ]);
    const from = vi.spyOn(db, 'from');
    expect((await call()).body.data).toEqual({ defaultPlan: 'annual', badgePlan: 'annual' });
    const tables = from.mock.calls.map(([t]) => t);
    expect(tables).not.toContain('experiment_assignments');
    expect(tables).not.toContain('user_attribution');
  });

  it('signed in → user rules apply (rule override beats the admin default)', async () => {
    vi.mocked(verifyMobileAuth).mockResolvedValue({ id: USER });
    db.seed('experiment_assignments', [{ experiment_key: 'onboarding_paywall', user_id: USER, arm: 'hard' }]);
    db.seed('remote_config_defaults', [def('paywall_default_plan', 'annual')]);
    db.seed('remote_config_rules', [
      rule('paywall_default_plan', { experiment: { key: 'onboarding_paywall', arms: ['hard'] } }, 'monthly'),
      rule('paywall_badge_plan', { userIds: [USER] }, 'monthly'),
    ]);
    const { res, body } = await call({ authorization: 'Bearer t', 'x-app-platform': 'ios' });
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ defaultPlan: 'monthly', badgePlan: 'monthly' });
  });

  it('invalid stored values fall through to the code default', async () => {
    vi.mocked(verifyMobileAuth).mockResolvedValue({ id: USER });
    db.seed('remote_config_defaults', [def('paywall_default_plan', 'weekly'), def('paywall_badge_plan', 42)]);
    db.seed('remote_config_rules', [rule('paywall_default_plan', {}, 'lifetime'), rule('paywall_badge_plan', {}, ['annual'])]);
    expect((await call()).body.data).toEqual({ defaultPlan: 'annual', badgePlan: 'annual' });
  });

  it('auth throwing → anonymous, still 200', async () => {
    vi.mocked(verifyMobileAuth).mockRejectedValue(new Error('boom'));
    db.seed('remote_config_defaults', [def('paywall_default_plan', 'monthly')]);
    const { res, body } = await call({ authorization: 'Bearer bad' });
    expect(res.status).toBe(200);
    expect(body.data.defaultPlan).toBe('monthly');
  });

  it('config store down → 200 with code defaults', async () => {
    vi.mocked(createAdminSupabase).mockImplementation(() => {
      throw new Error('no service role');
    });
    const { res, body } = await call();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, data: { defaultPlan: 'annual', badgePlan: 'annual' } });
  });
});
