/**
 * GET /api/admin/pmf — admin gate, period parsing, report passthrough.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '../route';

vi.mock('@/lib/campaigns/admin-auth', () => ({
  requireAdmin: async (req: Request) => {
    if (req.headers.get('authorization') !== 'Bearer s3cret') {
      const { CampaignError } = await import('@/lib/campaigns/http');
      throw new CampaignError(401, 'UNAUTHORIZED', 'Admin access required');
    }
    return { userId: null, actorEmail: null, viaSecret: true };
  },
}));
const report = vi.hoisted(() => vi.fn());
vi.mock('@/lib/pmf/services/pmf-service', async (orig) => {
  const real: any = await orig();
  return { ...real, PmfService: { report } };
});

const get = (qs = '', auth = 'Bearer s3cret') => GET(new NextRequest(`https://www.fitcircle.ai/api/admin/pmf${qs}`, { headers: { authorization: auth } }));

beforeEach(() => {
  report.mockReset();
  report.mockImplementation(async (period: number) => ({ period, kpis: [], insights: [] }));
});

describe('GET /api/admin/pmf', () => {
  it('401 without the admin secret', async () => {
    expect((await get('', 'Bearer nope')).status).toBe(401);
    expect(report).not.toHaveBeenCalled();
  });

  it('defaults to 28 days and accepts 7 / 7d / 90', async () => {
    expect((await (await get()).json()).data.period).toBe(28);
    expect((await (await get('?period=7')).json()).data.period).toBe(7);
    expect((await (await get('?period=7d')).json()).data.period).toBe(7);
    expect((await (await get('?period=90')).json()).data.period).toBe(90);
  });

  it('400 for any other period', async () => {
    const res = await get('?period=30');
    expect(res.status).toBe(400);
    expect(report).not.toHaveBeenCalled();
  });
});
