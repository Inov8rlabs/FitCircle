/**
 * Retention fixes 4 + 5: server-side app opens (one row per user / local day /
 * platform, last_active_at throttled) and the profiles.timezone backfill from
 * X-Client-Timezone.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { AppOpenService, clientTimezoneFrom, planAppOpen, platformFrom, timezoneBackfill } from '../app-open-service';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));

const U = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-10T05:30:00Z'); // 23:30 Chicago Nov 9, 00:30 New York Nov 10
const req = (h: Record<string, string>) => ({ headers: new Headers(h) });

let db: FakeSupabase;
beforeEach(() => {
  db = new FakeSupabase({
    profiles: { uniqueKey: ['id'], rows: [{ id: U, timezone: 'UTC', last_active_at: null }] },
    app_opens: { uniqueKey: ['user_id', 'local_date', 'platform'], rows: [] },
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
  AppOpenService.resetForTests();
});

describe('pure helpers', () => {
  it('platform from X-App-Platform (or X-Platform); unknown otherwise', () => {
    expect(platformFrom(req({ 'x-app-platform': 'iOS' }))).toBe('ios');
    expect(platformFrom(req({ 'x-platform': 'android' }))).toBe('android');
    expect(platformFrom(req({}))).toBe('unknown');
  });
  it('client timezone must be a real zone (UTC from a device is not trusted as a backfill)', () => {
    expect(clientTimezoneFrom(req({ 'x-client-timezone': 'America/Chicago' }))).toBe('America/Chicago');
    expect(clientTimezoneFrom(req({ 'x-client-timezone': 'UTC' }))).toBeNull();
    expect(clientTimezoneFrom(req({ 'x-client-timezone': 'Mars/Base' }))).toBeNull();
  });
  it('backfill only replaces a placeholder', () => {
    expect(timezoneBackfill('UTC', 'Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(timezoneBackfill(null, 'Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(timezoneBackfill('America/Denver', 'Asia/Kolkata')).toBeNull();
    expect(timezoneBackfill('UTC', null)).toBeNull();
  });
  it('local day of the open is the DEVICE day; last_active_at throttled to 10 min', () => {
    const p = planAppOpen({ id: U, timezone: 'UTC', last_active_at: new Date(NOW.getTime() - 60_000).toISOString() }, req({ 'x-client-timezone': 'America/Chicago', 'x-app-platform': 'android', 'x-app-version': '1.1.2' }), 'entitlements', NOW);
    expect(p.row).toMatchObject({ user_id: U, local_date: '2026-11-09', platform: 'android', timezone: 'America/Chicago', app_version: '1.1.2', source: 'entitlements' });
    expect(p.profilePatch).toEqual({ timezone: 'America/Chicago' });
    const stale = planAppOpen({ id: U, timezone: 'America/Chicago', last_active_at: new Date(NOW.getTime() - 11 * 60_000).toISOString() }, req({}), 'targets', NOW);
    expect(stale.profilePatch).toEqual({ last_active_at: NOW.toISOString() });
  });
});

describe('AppOpenService.record', () => {
  const headers = { 'x-client-timezone': 'America/Chicago', 'x-app-platform': 'ios' };

  it('writes one row per user / local day / platform, bumps last_active_at and backfills the zone', async () => {
    await AppOpenService.record({ id: U, timezone: 'UTC', last_active_at: null }, req(headers), 'entitlements', { now: NOW });
    await AppOpenService.record({ id: U, timezone: 'UTC', last_active_at: null }, req(headers), 'targets', { now: new Date(NOW.getTime() + 60_000) });
    expect(db.getRows('app_opens')).toEqual([expect.objectContaining({ user_id: U, local_date: '2026-11-09', platform: 'ios', source: 'entitlements', first_open_at: NOW.toISOString() })]);
    expect(db.getRows('profiles')[0]).toMatchObject({ timezone: 'America/Chicago', last_active_at: expect.any(String) });
  });

  it('a second platform the same day is its own row', async () => {
    await AppOpenService.record({ id: U }, req(headers), 'entitlements', { now: NOW });
    await AppOpenService.record({ id: U }, req({ ...headers, 'x-app-platform': 'android' }), 'entitlements', { now: NOW });
    expect(db.getRows('app_opens').map((r) => r.platform).sort()).toEqual(['android', 'ios']);
  });

  it('home feed passes backfillTimezone:false (its own sync owns the zone)', async () => {
    await AppOpenService.record({ id: U, timezone: 'UTC' }, req(headers), 'home_feed', { now: NOW, backfillTimezone: false });
    expect(db.getRows('profiles')[0].timezone).toBe('UTC');
  });

  it('fails soft when app_opens is missing (migration 133 not applied): last_active_at still bumps', async () => {
    const realFrom = db.from.bind(db);
    (db as any).from = (t: string) =>
      t === 'app_opens' ? { upsert: async () => ({ data: null, error: { code: '42P01', message: 'relation "app_opens" does not exist' } }) } : realFrom(t);
    await expect(AppOpenService.record({ id: U, last_active_at: null }, req(headers), 'entitlements', { now: NOW })).resolves.toBeUndefined();
    expect(db.getRows('profiles')[0].last_active_at).toBe(NOW.toISOString());
  });
});

describe('openedSince (Day-1 skip)', () => {
  it('last_active_at today, or an app_opens row after the cut-off', async () => {
    const morning = new Date('2026-11-10T10:00:00Z');
    expect(await AppOpenService.openedSince(U, morning, '2026-11-10')).toBe(false);
    db.getRows('app_opens').push({ user_id: U, local_date: '2026-11-10', platform: 'ios', first_open_at: '2026-11-10T11:00:00Z' });
    expect(await AppOpenService.openedSince(U, morning, '2026-11-10')).toBe(true);
    db.getRows('app_opens').length = 0;
    db.getRows('profiles')[0].last_active_at = '2026-11-10T12:00:00Z';
    expect(await AppOpenService.openedSince(U, morning, '2026-11-10')).toBe(true);
  });
});

describe('timezone backfill on any authenticated request (verifyMobileAuth)', () => {
  it('pending only for placeholder profiles with a real header, once per user per instance', async () => {
    const r = new NextRequest('https://www.fitcircle.ai/api/mobile/streaks/current', { headers: { 'x-client-timezone': 'Asia/Kolkata' } });
    expect(AppOpenService.pendingTimezoneBackfill({ id: U, timezone: 'America/Chicago' }, r)).toBeNull();
    expect(AppOpenService.pendingTimezoneBackfill({ id: U, timezone: 'UTC' }, r)).toBe('Asia/Kolkata');
    await AppOpenService.backfillTimezone(U, 'Asia/Kolkata');
    expect(db.getRows('profiles')[0].timezone).toBe('Asia/Kolkata');
    expect(AppOpenService.pendingTimezoneBackfill({ id: U, timezone: 'UTC' }, r)).toBeNull();
  });
  it('never overwrites a real zone written meanwhile', async () => {
    db.getRows('profiles')[0].timezone = 'Europe/Paris';
    await AppOpenService.backfillTimezone(U, 'Asia/Kolkata');
    expect(db.getRows('profiles')[0].timezone).toBe('Europe/Paris');
  });
});
