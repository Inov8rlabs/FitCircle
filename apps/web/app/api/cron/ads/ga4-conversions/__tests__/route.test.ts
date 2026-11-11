import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { Ga4ConversionService } from '@/lib/ads/services/ga4-conversion-service';

import { GET } from '../route';

const req = (qs = '', auth?: string) =>
  new NextRequest(`https://fitcircle.test/api/cron/ads/ga4-conversions${qs}`, { headers: auth ? { authorization: auth } : {} });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/cron/ads/ga4-conversions', () => {
  it('401 without the cron or admin secret', async () => {
    vi.stubEnv('CRON_SECRET', 'cron');
    vi.stubEnv('ADMIN_API_SECRET', 'admin');
    expect((await GET(req('', 'Bearer nope'))).status).toBe(401);
  });

  it('dry-run by default; apply / validate / hours / limit are passed through', async () => {
    vi.stubEnv('CRON_SECRET', 'cron');
    vi.stubEnv('ADMIN_API_SECRET', 'admin');
    const sweep = vi.spyOn(Ga4ConversionService, 'sweep').mockResolvedValue({ mode: 'dry_run' } as any);
    expect((await GET(req('', 'Bearer cron'))).status).toBe(200);
    expect(sweep).toHaveBeenLastCalledWith({ mode: 'dry_run', windowMs: undefined, limit: undefined });
    await GET(req('?apply=1&hours=24&limit=50', 'Bearer admin'));
    expect(sweep).toHaveBeenLastCalledWith({ mode: 'apply', windowMs: 24 * 3_600_000, limit: 50 });
    await GET(req('?validate=true', 'Bearer cron'));
    expect(sweep).toHaveBeenLastCalledWith({ mode: 'validate', windowMs: undefined, limit: undefined });
  });
});
