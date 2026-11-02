/**
 * GET /api/mobile/app-update: server-driven update policy (feature_flags row
 * `app_update_policy`), public, no-store, fails to `none`.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  compareVersions,
  parsePlatformPolicy,
  parseVersion,
  resetAppUpdatePolicyCache,
  updateStatus,
} from '@/lib/services/app-update-service';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { GET } from '../route';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));

let db: FakeSupabase;

const POLICY = {
  ios: {
    latest_version: '1.1.1',
    recommended_version: '1.1.0',
    min_supported_version: '1.0.5',
    release_notes: {
      title: 'A fresh new FitCircle',
      subtitle: 'Redesigned Home and a smarter Fitzy.',
      highlights: [
        { icon: 'sparkle', title: 'New design', body: 'Cleaner, faster Home.' },
        { title: '' }, // dropped: no title
        { icon: 'chat', title: 'Fitzy v2' },
      ],
    },
    reprompt_after_days: 5,
  },
  android: { latest_version: '1.1.0', recommended_version: '1.1.0', min_supported_version: null, enabled: true },
};

const seed = (row: Record<string, unknown>) =>
  db.seed('feature_flags', [{ name: 'app_update_policy', is_enabled: true, metadata: POLICY, ...row }]);

const call = (headers: Record<string, string>, query = '') =>
  GET(new NextRequest(`https://api.test/api/mobile/app-update${query}`, { headers }));

beforeEach(() => {
  resetAppUpdatePolicyCache();
  db = new FakeSupabase({ feature_flags: { uniqueKey: ['name'] } });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
});

describe('version helpers', () => {
  it('parses plain and suffixed versions', () => {
    expect(parseVersion('1.1.0')).toEqual([1, 1, 0]);
    expect(parseVersion(' 1.0.9-dev')).toEqual([1, 0, 9]);
    expect(parseVersion('1.1.0 (70)')).toEqual([1, 1, 0]);
    expect(parseVersion('v2')).toEqual([2]);
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('abc')).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });

  it('compares numerically, missing parts are 0', () => {
    expect(compareVersions([1, 0, 10], [1, 0, 9])).toBe(1);
    expect(compareVersions([1, 1], [1, 1, 0])).toBe(0);
    expect(compareVersions([1, 0, 9], [1, 1, 0])).toBe(-1);
    expect(compareVersions([2], [1, 99, 99])).toBe(1);
  });

  it('status thresholds', () => {
    const p = parsePlatformPolicy(POLICY.ios)!;
    expect(updateStatus('1.0.4', p)).toBe('required');
    expect(updateStatus('1.0.9', p)).toBe('recommended');
    expect(updateStatus('1.1.0', p)).toBe('available');
    expect(updateStatus('1.1.1', p)).toBe('none');
    expect(updateStatus('1.2.0', p)).toBe('none');
    expect(updateStatus(null, p)).toBe('none');
    expect(updateStatus('1.0.4', { ...p, enabled: false })).toBe('none');
  });

  it('a threshold above latest is capped at latest (never demands an unreleased build)', () => {
    const p = parsePlatformPolicy({ latest_version: '1.1.0', min_supported_version: '9.0.0' })!;
    expect(updateStatus('1.0.9', p)).toBe('required');
    expect(updateStatus('1.1.0', p)).toBe('none');
  });

  it('policy without a valid latest_version is unusable', () => {
    expect(parsePlatformPolicy({ latest_version: 'soon' })).toBeNull();
    expect(parsePlatformPolicy(null)).toBeNull();
  });
});

describe('GET /api/mobile/app-update', () => {
  it('recommended for an old iOS build, with notes, store and caps; no-store', async () => {
    seed({});
    const res = await call({ 'x-app-platform': 'ios', 'x-app-version': '1.0.9' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      error: null,
      data: {
        platform: 'ios',
        current_version: '1.0.9',
        status: 'recommended',
        latest_version: '1.1.1',
        recommended_version: '1.1.0',
        min_supported_version: '1.0.5',
        store: { app_store_id: '6811432467', url: 'https://apps.apple.com/app/id6811432467' },
        prompt: { reprompt_after_days: 5, max_prompts_per_version: 3 },
      },
    });
    expect(body.data.release_notes.highlights).toEqual([
      { icon: 'sparkle', title: 'New design', body: 'Cleaner, faster Home.' },
      { icon: 'chat', title: 'Fitzy v2', body: null },
    ]);
  });

  it('required below min_supported_version', async () => {
    seed({});
    const body = await (await call({ 'x-app-platform': 'ios', 'x-app-version': '1.0.2' })).json();
    expect(body.data.status).toBe('required');
  });

  it('android: suffixed version, Play package', async () => {
    seed({});
    const body = await (await call({ 'x-app-platform': 'android', 'x-app-version': '1.0.9-dev' })).json();
    expect(body.data).toMatchObject({
      status: 'recommended',
      current_version: '1.0.9',
      store: { package_name: 'com.inov8rlabs.apps.fitcircle' },
    });
  });

  it('up to date → none', async () => {
    seed({});
    const body = await (await call({ 'x-app-platform': 'android', 'x-app-version': '1.1.0' })).json();
    expect(body.data.status).toBe('none');
  });

  it('kill switch (is_enabled false) → none, thresholds hidden', async () => {
    seed({ is_enabled: false });
    const body = await (await call({ 'x-app-platform': 'ios', 'x-app-version': '1.0.2' })).json();
    expect(body.data).toMatchObject({ status: 'none', latest_version: null, release_notes: null });
  });

  it('per-platform switch off → none', async () => {
    seed({ metadata: { ...POLICY, ios: { ...POLICY.ios, enabled: false } } });
    const body = await (await call({ 'x-app-platform': 'ios', 'x-app-version': '1.0.2' })).json();
    expect(body.data.status).toBe('none');
  });

  it('missing row → none', async () => {
    const body = await (await call({ 'x-app-platform': 'ios', 'x-app-version': '1.0.2' })).json();
    expect(body.data.status).toBe('none');
  });

  it('missing version header → none', async () => {
    seed({});
    const body = await (await call({ 'x-app-platform': 'ios' })).json();
    expect(body.data.status).toBe('none');
  });

  it('query params override headers', async () => {
    seed({});
    const body = await (await call({}, '?platform=ios&version=1.0.0')).json();
    expect(body.data.status).toBe('required');
  });

  it('web / unknown platform → 400', async () => {
    const res = await call({ 'x-app-platform': 'web', 'x-app-version': '1.0.0' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('UNSUPPORTED_PLATFORM');
  });

  it('DB failure → 200 none, degraded', async () => {
    vi.mocked(createAdminSupabase).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }) }),
    } as any);
    const res = await call({ 'x-app-platform': 'ios', 'x-app-version': '1.0.2' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('none');
    expect(body.meta.degraded).toBe(true);
  });
});
