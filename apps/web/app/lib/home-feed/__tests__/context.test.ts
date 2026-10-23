import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import { CONTEXT_LOADER_TIMEOUT_MS, buildFeedContext, daysSince, localParts, parsePlatform, readRequestInfo, resolveTimezone, softly, type ContextLoaders } from '../context';

const USER = '11111111-1111-4111-8111-111111111111';
const profile = { id: USER, timezone: 'Asia/Kolkata', created_at: '2026-10-01T00:00:00Z', subscription_tier: 'free', preferences: {} };
const info = { platform: 'ios' as const, appVersion: '1.0.8', appBuild: 63, clientTimezone: 'America/Los_Angeles' };
// 2026-10-23 02:30 UTC = 2026-10-22 19:30 in Los Angeles (Thursday).
const NOW = new Date('2026-10-23T02:30:00Z');

const loaders = (o: Partial<ContextLoaders> = {}): ContextLoaders => ({
  campaign: async () => ({ present: true, slug: 'hold_the_line', phase: 'live' }),
  referralProgramEnabled: async () => true,
  subscriptionsEnabled: async () => true,
  activeCircleCount: async () => 2,
  checkedIn: async () => false,
  waterTodayMl: async () => 0,
  ...o,
});

describe('readRequestInfo', () => {
  const req = (h: Record<string, string>) => ({ headers: new Headers(h) });

  it('reads the spec headers', () => {
    expect(readRequestInfo(req({ 'X-App-Platform': 'iOS', 'X-App-Version': '1.0.8', 'X-App-Build': '63', 'x-client-timezone': 'America/New_York' }))).toEqual({
      platform: 'ios',
      appVersion: '1.0.8',
      appBuild: 63,
      clientTimezone: 'America/New_York',
    });
  });

  it('falls back to X-Platform (what Android already sends)', () => {
    expect(readRequestInfo(req({ 'X-Platform': 'android' })).platform).toBe('android');
    expect(readRequestInfo(req({ 'X-App-Platform': 'ios', 'X-Platform': 'android' })).platform).toBe('ios');
  });

  it('nulls missing or junk values', () => {
    expect(readRequestInfo(req({ 'X-App-Platform': 'blackberry', 'X-App-Build': '12a', 'x-client-timezone': 'Mars/Base' }))).toEqual({
      platform: null,
      appVersion: null,
      appBuild: null,
      clientTimezone: null,
    });
    expect(parsePlatform(undefined)).toBeNull();
  });
});

describe('helpers', () => {
  it('localParts in a timezone', () => {
    expect(localParts(NOW, 'America/Los_Angeles')).toEqual({ date: '2026-10-22', hour: 19, weekday: 4 });
    expect(localParts(NOW, 'Asia/Kolkata')).toEqual({ date: '2026-10-23', hour: 8, weekday: 5 });
    expect(localParts(new Date('2026-10-22T00:30:00Z'), 'UTC').hour).toBe(0);
  });

  it('timezone: header → profile → UTC', () => {
    expect(resolveTimezone(info, profile)).toBe('America/Los_Angeles');
    expect(resolveTimezone({ ...info, clientTimezone: null }, profile)).toBe('Asia/Kolkata');
    expect(resolveTimezone({ ...info, clientTimezone: null }, { id: USER, timezone: 'bogus' })).toBe('UTC');
  });

  it('daysSince', () => {
    expect(daysSince('2026-10-01T00:00:00Z', NOW)).toBe(22);
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince('garbage', NOW)).toBeNull();
    expect(daysSince('2027-01-01T00:00:00Z', NOW)).toBe(0);
  });

  it('softly: value, error → null, timeout → null', async () => {
    expect(await softly(async () => 5)).toBe(5);
    expect(await softly(async () => { throw new Error('boom'); })).toBeNull();
    expect(await softly(() => { throw new Error('sync boom'); })).toBeNull();
    expect(await softly(() => new Promise((r) => setTimeout(() => r(1), 200)), 10)).toBeNull();
  });
});

describe('buildFeedContext', () => {
  it('assembles every field from the loaders and the profile', async () => {
    const seen: Record<string, unknown> = {};
    const ctx = await buildFeedContext(profile, info, {
      now: NOW,
      loaders: loaders({
        checkedIn: async (_u, date) => {
          seen.date = date;
          return false;
        },
        campaign: async (_p, tz) => {
          seen.tz = tz;
          return { present: true, slug: 'hold_the_line', phase: 'live' };
        },
      }),
    });
    expect(seen).toEqual({ date: '2026-10-22', tz: 'America/Los_Angeles' });
    expect(ctx).toEqual({
      userId: USER,
      now: NOW,
      platform: 'ios',
      appVersion: '1.0.8',
      appBuild: 63,
      timezone: 'America/Los_Angeles',
      localDate: '2026-10-22',
      localHour: 19,
      localWeekday: 4,
      daysSinceSignup: 22,
      isPro: false,
      subscriptionsEnabled: true,
      hasCircle: true,
      circleCount: 2,
      campaign: { present: true, slug: 'hold_the_line', phase: 'live' },
      referralProgramEnabled: true,
      checkedInToday: false,
      streakAtRisk: true,
      waterLoggedToday: false,
      adsEligible: true,
    });
  });

  it('streak is not at risk before 18:00 or after a check-in', async () => {
    const morning = await buildFeedContext(profile, { ...info, clientTimezone: 'Asia/Kolkata' }, { now: NOW, loaders: loaders() });
    expect(morning.streakAtRisk).toBe(false);
    const done = await buildFeedContext(profile, info, { now: NOW, loaders: loaders({ checkedIn: async () => true }) });
    expect(done.streakAtRisk).toBe(false);
  });

  it('premium tiers are Pro (no ads)', async () => {
    const ctx = await buildFeedContext({ ...profile, subscription_tier: 'enterprise' }, info, { now: NOW, loaders: loaders() });
    expect(ctx).toMatchObject({ isPro: true, adsEligible: false });
    const unknown = await buildFeedContext({ id: USER }, info, { now: NOW, loaders: loaders() });
    expect(unknown).toMatchObject({ isPro: null, adsEligible: null, daysSinceSignup: null, timezone: 'America/Los_Angeles' });
  });

  it('is fail-soft: every loader failing or hanging leaves unknowns, never throws', async () => {
    const boom = async () => {
      throw new Error('db down');
    };
    const hang = () => new Promise<never>(() => {});
    const ctx = await buildFeedContext(profile, info, {
      now: NOW,
      timeoutMs: 20,
      loaders: {
        campaign: boom,
        referralProgramEnabled: hang,
        subscriptionsEnabled: boom,
        activeCircleCount: hang,
        checkedIn: boom,
        waterTodayMl: hang,
      },
    });
    expect(ctx).toMatchObject({
      campaign: null,
      referralProgramEnabled: null,
      subscriptionsEnabled: null,
      hasCircle: null,
      circleCount: null,
      checkedInToday: null,
      streakAtRisk: false,
      waterLoggedToday: null,
      isPro: false,
    });
  });

  it('default budget: a hung loader costs at most CONTEXT_LOADER_TIMEOUT_MS (250 ms), not the request', async () => {
    expect(CONTEXT_LOADER_TIMEOUT_MS).toBeLessThanOrEqual(250);
    const hang = () => new Promise<never>(() => {});
    const t0 = performance.now();
    const ctx = await buildFeedContext(profile, info, { now: NOW, loaders: loaders({ campaign: hang, waterTodayMl: hang }) });
    const took = performance.now() - t0;
    expect(took).toBeLessThan(CONTEXT_LOADER_TIMEOUT_MS + 100);
    expect(ctx.campaign).toBeNull();
    expect(ctx.referralProgramEnabled).toBe(true);
  });

  it('runs loaders in parallel (one round)', async () => {
    const slow = <T,>(v: T) => () => new Promise<T>((r) => setTimeout(() => r(v), 60));
    const started = Date.now();
    await buildFeedContext(profile, info, {
      now: NOW,
      loaders: {
        campaign: slow({ present: false, slug: null, phase: null }),
        referralProgramEnabled: slow(true),
        subscriptionsEnabled: slow(true),
        activeCircleCount: slow(0),
        checkedIn: slow(true),
        waterTodayMl: slow(250),
      },
    });
    expect(Date.now() - started).toBeLessThan(300);
  });
});
