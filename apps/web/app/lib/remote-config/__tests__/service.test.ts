/** RemoteConfigService: cache, fail-safe, lazy facts (TRIAL_FIRST_SPEC §6.4). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { RemoteConfigService, resetRemoteConfigCache } from '../service';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));

const USER = '11111111-2222-3333-4444-555555555555';
const KEY = 'free_food_ai_analyses_total' as const;

let db: FakeSupabase;
let fromSpy: ReturnType<typeof vi.fn>;
let failing = false;

function install() {
  fromSpy = vi.fn((table: string) => {
    if (failing && table.startsWith('remote_config_')) {
      const err = { data: null, error: { code: '08006', message: 'connection failure' } };
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => err, then: (r: any) => Promise.resolve(err).then(r) };
      return q;
    }
    return db.from(table);
  });
  vi.mocked(createAdminSupabase).mockReturnValue({ from: fromSpy } as any);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
  failing = false;
  db = new FakeSupabase({
    remote_config_rules: {},
    remote_config_defaults: { uniqueKey: ['config_key'] },
    remote_config_changes: {},
    user_attribution: { rows: [{ user_id: USER, channel: 'apple_ads', country: 'US', platform: 'ios' }] },
    experiment_assignments: {},
    profiles: { rows: [{ id: USER, created_at: '2026-11-01T00:00:00Z' }] },
  });
  install();
  resetRemoteConfigCache();
});
afterEach(() => vi.useRealTimers());

const remoteReads = () => fromSpy.mock.calls.filter(([t]) => t === 'remote_config_rules').length;

describe('cache', () => {
  it('serves from memory for 30 s, then refreshes; writes clear it', async () => {
    db.seed('remote_config_defaults', [{ config_key: KEY, value: 9, updated_by: null, updated_at: '2026-11-01T00:00:00Z' }]);
    expect(await RemoteConfigService.value(KEY, { userId: USER })).toBe(9);
    // Replace the row (the fake hands out row references; the cache must not see in-place edits).
    db.getRows('remote_config_defaults').length = 0;
    db.seed('remote_config_defaults', [{ config_key: KEY, value: 12, updated_by: null, updated_at: '2026-11-01T00:00:00Z' }]);
    expect(await RemoteConfigService.value(KEY, { userId: USER })).toBe(9); // cached
    expect(remoteReads()).toBe(1);
    vi.setSystemTime(new Date('2026-11-06T12:00:31Z'));
    expect(await RemoteConfigService.value(KEY, { userId: USER })).toBe(9); // stale → still served (refresh kicked off)
    expect(remoteReads()).toBe(2);
    resetRemoteConfigCache();
    expect(await RemoteConfigService.value(KEY, { userId: USER })).toBe(12);
    await RemoteConfigService.setDefault(KEY, { value: 20 }, { email: 'a@x' });
    expect(await RemoteConfigService.value(KEY, { userId: USER })).toBe(20); // cleared on write
  });
});

describe('fail-safe', () => {
  it('DB error with nothing cached → code default', async () => {
    failing = true;
    expect(await RemoteConfigService.resolveConfig(KEY, { userId: USER })).toEqual({ value: 5, source: 'code' });
  });

  it('DB error after a good load → the last good snapshot', async () => {
    db.seed('remote_config_defaults', [{ config_key: KEY, value: 9, updated_by: null, updated_at: '2026-11-01T00:00:00Z' }]);
    expect(await RemoteConfigService.value(KEY, { userId: USER })).toBe(9);
    failing = true;
    vi.setSystemTime(new Date('2026-11-06T13:00:00Z')); // past maxStale → must reload, which fails
    expect(await RemoteConfigService.value(KEY, { userId: USER })).toBe(9);
  });

  it('migration not applied (42P01) → code defaults, no error', async () => {
    vi.mocked(createAdminSupabase).mockReturnValue({
      from: () => {
        const res = { data: null, error: { code: '42P01', message: 'relation does not exist' } };
        const q: any = { select: () => q, then: (r: any) => Promise.resolve(res).then(r) };
        return q;
      },
    } as any);
    expect(await RemoteConfigService.resolveConfig('free_fitzy_messages_per_day', { userId: USER })).toEqual({ value: 0, source: 'code' });
  });
});

describe('context', () => {
  it('channel / signup / experiment are read lazily, only when a candidate rule needs them', async () => {
    db.seed('remote_config_rules', [
      { id: '00000000-0000-4000-8000-000000000001', config_key: KEY, name: 'Apple Ads', enabled: true, priority: 1, audience: { channels: ['apple_ads'] }, value: 10, created_at: '2026-11-01T00:00:00Z' },
    ]);
    // Fitzy key has no rules → no fact reads at all.
    await RemoteConfigService.value('free_fitzy_messages_per_day', { userId: USER });
    expect(fromSpy.mock.calls.some(([t]) => t === 'user_attribution')).toBe(false);
    expect(await RemoteConfigService.value(KEY, { userId: USER })).toBe(10);
    expect(fromSpy.mock.calls.filter(([t]) => t === 'user_attribution')).toHaveLength(1);
    // Caller-provided facts are used as is (no read).
    fromSpy.mockClear();
    expect(await RemoteConfigService.value(KEY, { userId: USER, channel: 'organic' })).toBe(5);
    expect(fromSpy.mock.calls.some(([t]) => t === 'user_attribution')).toBe(false);
  });

  it('experiment arm comes from the stored assignment', async () => {
    db.seed('experiment_assignments', [{ experiment_key: 'onboarding_paywall', user_id: USER, arm: 'hard' }]);
    db.seed('remote_config_rules', [
      { id: '00000000-0000-4000-8000-000000000002', config_key: KEY, name: 'Hard arm', enabled: true, priority: 1, audience: { experiment: { key: 'onboarding_paywall', arms: ['hard'] } }, value: 3, created_at: '2026-11-01T00:00:00Z' },
    ]);
    expect(await RemoteConfigService.resolveConfig(KEY, { userId: USER })).toMatchObject({ value: 3, source: 'rule', ruleName: 'Hard arm' });
  });

  it('platform/app version unknown outside a request → platform rules never match', async () => {
    db.seed('remote_config_rules', [
      { id: '00000000-0000-4000-8000-000000000003', config_key: KEY, name: 'iOS', enabled: true, priority: 1, audience: { platforms: ['ios'] }, value: 3, created_at: '2026-11-01T00:00:00Z' },
    ]);
    expect(await RemoteConfigService.value(KEY, { userId: USER })).toBe(5);
    expect(await RemoteConfigService.value(KEY, { userId: USER, platform: 'ios' })).toBe(3);
  });
});
