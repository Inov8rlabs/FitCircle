/**
 * Remote-config version rules on the REAL client headers (docs/TRIAL_FIRST_SPEC.md §6.6).
 *
 * Old-client protection at deploy time: keep a generous admin DEFAULT for old builds and add
 * per-platform rules `appVersionGte: <first build that handles the paywall>` with the strict
 * value. A build that sends no version (pre-1.1.0 non-feed requests) is "unknown", never
 * matches a version rule, and therefore gets the default — the safe side.
 *
 * Headers are the shipped apps' real sets (home-feed fixtures ios-1.0.8 / android-1.0.8,
 * version bumped): iOS AppClientHeaders on every request (APISession, 1.1.0+), Android
 * ClientInfoInterceptor (1.1.0+). Resolution reads them via next/headers inside the route.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => h.headers }));
vi.mock('@/lib/supabase-admin', async () => {
  const { getDb } = await import('@/lib/services/__tests__/fake-supabase-admin');
  return { createAdminSupabase: () => getDb().client() };
});
vi.mock('@/lib/middleware/mobile-auth', async () => {
  const { getDb } = await import('@/lib/services/__tests__/fake-supabase-admin');
  return {
    requireMobileAuth: async () => {
      const p = getDb().profiles.get(USER);
      if (!p) throw new Error('Unauthorized');
      return { ...p };
    },
  };
});

import { resetRemoteConfigCache } from '@/lib/remote-config/service';
import { FakeDb, getDb, setDb } from '@/lib/services/__tests__/fake-supabase-admin';
import { UpgradeRequiredError, UsageService } from '@/lib/services/usage-service';

import { GET as entitlements } from '../entitlements/route';

const USER = '11111111-2222-3333-4444-555555555555';
const fixture = (name: string): Record<string, string> =>
  JSON.parse(readFileSync(join(__dirname, '..', 'home-feed', '__tests__', 'fixtures', name), 'utf8')).headers;
const IOS = fixture('ios-1.0.8.request.json'); // X-App-Platform: ios, X-App-Version, X-App-Build
const ANDROID = fixture('android-1.0.8.request.json'); // X-App-Platform + X-Platform: android, X-App-Version, X-App-Build

const as = (base: Record<string, string> | null, version?: string) => {
  const hdrs = new Headers(base ?? {});
  if (version) hdrs.set('X-App-Version', version);
  h.headers = hdrs;
  return new NextRequest('https://www.fitcircle.ai/api/mobile/entitlements', { headers: hdrs });
};

const rule = (id: string, platform: 'ios' | 'android', key: string, value: number) => ({
  id,
  config_key: key,
  name: `${platform} 1.2.0+ strict`,
  enabled: true,
  priority: 10,
  audience: { platforms: [platform], appVersionGte: '1.2.0' },
  value,
  created_at: '2026-11-06T00:00:00Z',
});

beforeEach(() => {
  const db = new FakeDb();
  db.profiles.set(USER, { id: USER, subscription_tier: 'free', subscription_platform: null, trial_started_at: null, created_at: '2026-10-01T00:00:00Z', onboarding_completed: true });
  for (const k of ['food_ai_unlimited', 'fitzy_unlimited']) db.feature_gates.set(k, 'premium');
  // Old-client protection: generous defaults…
  db.remote_config_defaults.push(
    { config_key: 'free_fitzy_messages_per_day', value: 5, updated_by: 'ops', updated_at: '2026-11-06T00:00:00Z' },
    { config_key: 'free_food_ai_analyses_total', value: 1000, updated_by: 'ops', updated_at: '2026-11-06T00:00:00Z' }
  );
  // …and the strict trial-first values only for builds that handle the new paywall.
  db.remote_config_rules.push(
    rule('00000000-0000-4000-8000-0000000000a1', 'ios', 'free_fitzy_messages_per_day', 0),
    rule('00000000-0000-4000-8000-0000000000a2', 'android', 'free_fitzy_messages_per_day', 0),
    rule('00000000-0000-4000-8000-0000000000a3', 'ios', 'free_food_ai_analyses_total', 5),
    rule('00000000-0000-4000-8000-0000000000a4', 'android', 'free_food_ai_analyses_total', 5)
  );
  setDb(db);
  resetRemoteConfigCache();
});

describe.each([
  ['iOS', IOS],
  ['Android', ANDROID],
])('%s real headers', (_label, base) => {
  it('new build (1.2.0) → strict values in entitlements and in the gates', async () => {
    const body = await (await entitlements(as(base, '1.2.0'))).json();
    expect(body.data.limits).toMatchObject({ fitzyMessagesPerDay: 0, foodAiAnalysesTotal: 5, foodAiAnalysesRemaining: 5 });
    await expect(UsageService.assertFitzyQuota(USER)).rejects.toBeInstanceOf(UpgradeRequiredError);
  });

  it('a later build (1.10.0, numeric compare) is strict too', async () => {
    const body = await (await entitlements(as(base, '1.10.0'))).json();
    expect(body.data.limits.fitzyMessagesPerDay).toBe(0);
  });

  it('old build (1.1.2) → the protective defaults', async () => {
    const body = await (await entitlements(as(base, '1.1.2'))).json();
    expect(body.data.limits).toMatchObject({ fitzyMessagesPerDay: 5, foodAiAnalysesTotal: 1000 });
    await expect(UsageService.assertFitzyQuota(USER)).resolves.toBeUndefined();
    await expect(UsageService.reserveFoodAi(USER, 'h')).resolves.toBeTruthy();
  });
});

it('the other platform’s rule never applies (Android 1.2.0 headers vs an iOS-only rule set)', async () => {
  getDb().remote_config_rules = getDb().remote_config_rules.filter((r) => r.audience.platforms[0] === 'ios');
  resetRemoteConfigCache();
  const body = await (await entitlements(as(ANDROID, '1.2.0'))).json();
  expect(body.data.limits.fitzyMessagesPerDay).toBe(5);
});

it('no client headers (pre-1.1.0 non-feed requests, web) → version unknown → defaults', async () => {
  const body = await (await entitlements(as(null))).json();
  expect(body.data.limits).toMatchObject({ fitzyMessagesPerDay: 5, foodAiAnalysesTotal: 1000 });
});

it('suffixed versions are tolerated ("1.2.0 (88)")', async () => {
  const body = await (await entitlements(as(IOS, '1.2.0 (88)'))).json();
  expect(body.data.limits.fitzyMessagesPerDay).toBe(0);
});
