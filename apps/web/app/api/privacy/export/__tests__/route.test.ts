import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/privacy/export (web, cookie auth) and GET /api/mobile/privacy/export
 * (mobile, bearer auth): auth, rate limit, response shape and headers. The
 * export content itself is covered by data-export-service.test.ts.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  buildExport: vi.fn(),
  logExport: vi.fn(),
  check: vi.fn(),
}));

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabase: async () => ({ auth: { getUser: () => mocks.getUser() } }),
}));
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async (request: Request) => {
    if (!request.headers.get('Authorization')?.startsWith('Bearer ')) throw new Error('Unauthorized');
    return { id: 'user-1', email: 'me@example.com' };
  },
}));
vi.mock('@/lib/services/data-export-service', () => ({
  DataExportService: { buildExport: mocks.buildExport, logExport: mocks.logExport },
  dataExportRateLimiter: { check: mocks.check },
}));

import { GET as mobileGET } from '../../../mobile/privacy/export/route';
import { GET as webGET } from '../route';

const EXPORT = {
  exportVersion: 2,
  generatedAt: '2026-11-06T12:00:00.000Z',
  signedUrlExpiresAt: '2026-11-06T13:00:00.000Z',
  tables: { profiles: 1 },
  manifest: { rowCap: 50000, truncated: [], errors: [], signedUrls: 0 },
  export_metadata: { export_format: 'JSON', user_id: 'user-1' },
  account: { user_id: 'user-1' },
  profile: { id: 'user-1' },
  health_data: { daily_tracking: [], check_ins: [], record_count: 0 },
  challenges: { participations: [], count: 0 },
  notifications: [],
  privacy: { consent_history: [], current_settings: null },
  data: { profiles: [{ id: 'user-1' }] },
};

const request = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'GET', headers }) as any;

beforeEach(() => {
  mocks.getUser.mockReset().mockResolvedValue({
    data: { user: { id: 'user-1', email: 'me@example.com', created_at: '2026-01-01', last_sign_in_at: '2026-11-05' } },
  });
  mocks.buildExport.mockReset().mockResolvedValue(EXPORT);
  mocks.logExport.mockReset().mockResolvedValue(undefined);
  mocks.check.mockReset().mockResolvedValue({ success: true, limit: 5, remaining: 4, reset: Date.now() + 1000 });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe.each([
  ['web', webGET, 'http://localhost/api/privacy/export', {}],
  ['mobile', mobileGET, 'http://localhost/api/mobile/privacy/export', { Authorization: 'Bearer t' }],
] as const)('%s export route', (platform, handler, url, authHeaders) => {
  it('returns 401 when unauthenticated', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const res = await handler(request(url));
    expect(res.status).toBe(401);
    expect(mocks.buildExport).not.toHaveBeenCalled();
  });

  it('returns the export as a no-store JSON download', async () => {
    const res = await handler(request(url, authHeaders));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="fitcircle-data-export-user-1-\d+\.json"$/);

    const body = await res.json();
    for (const key of [
      'export_metadata',
      'account',
      'profile',
      'health_data',
      'challenges',
      'notifications',
      'privacy',
      'exportVersion',
      'generatedAt',
      'signedUrlExpiresAt',
      'tables',
      'manifest',
      'data',
    ]) {
      expect(body, key).toHaveProperty(key);
    }
    expect(mocks.buildExport).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1', email: 'me@example.com' }), {
      platform,
    });
    expect(mocks.logExport).toHaveBeenCalledWith('user-1', expect.objectContaining({ platform }));
    expect(mocks.check).toHaveBeenCalledWith('user:user-1');
  });

  it('returns 429 when the user exported too often', async () => {
    mocks.check.mockResolvedValue({ success: false, limit: 5, remaining: 0, reset: Date.now() + 60_000 });
    const res = await handler(request(url, authHeaders));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(mocks.buildExport).not.toHaveBeenCalled();
  });

  it('returns 500 when the export cannot be built', async () => {
    mocks.buildExport.mockRejectedValue(new Error('boom'));
    const res = await handler(request(url, authHeaders));
    expect(res.status).toBe(500);
  });
});

it('web route passes the auth account dates through', async () => {
  await webGET(request('http://localhost/api/privacy/export'));
  expect(mocks.buildExport).toHaveBeenCalledWith(
    { id: 'user-1', email: 'me@example.com', created_at: '2026-01-01', last_sign_in_at: '2026-11-05' },
    { platform: 'web' }
  );
});
