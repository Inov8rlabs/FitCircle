/** GET /api/admin/ads/verify — live Apple totals vs stored delivery; read-only. */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('@/lib/ads/__tests__/fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});

import { AdsFakeDb, setAdsDb } from '@/lib/ads/__tests__/fake-db';
import { setConnectorsForTest } from '@/lib/ads/connectors';
import type { AdsConnector, NetworkTotals } from '@/lib/ads/connectors/types';

import { GET as verify } from '../verify/route';

let db: AdsFakeDb;
const get = (q: string) => verify(new NextRequest(`https://www.fitcircle.ai/api/admin/ads/verify?${q}`, { headers: { authorization: 'Bearer vsecret' } }));

function connector(totals: NetworkTotals, tz: string | null = 'America/New_York') {
  const applyChange = vi.fn();
  const c = {
    channel: 'apple_ads',
    isConfigured: () => true,
    fetchEntities: vi.fn(async () => []),
    fetchDailyMetrics: vi.fn(async () => []),
    readEntity: vi.fn(async () => null),
    applyChange,
    fetchTotals: vi.fn(async () => totals),
    reportTimeZone: vi.fn(async () => tz),
  };
  return c as unknown as AdsConnector & { applyChange: typeof applyChange; fetchTotals: ReturnType<typeof vi.fn> };
}

const f = (spend: number, impressions: number, taps: number, installs: number) => ({ spend, currency: 'USD', impressions, taps, installs });

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-24T16:00:00Z'), toFake: ['Date'] });
  process.env.ADMIN_API_SECRET = 'vsecret';
  process.env.ADS_REPORT_TIMEZONE = 'America/New_York';
  db = new AdsFakeDb();
  setAdsDb(db);
  const row = (level: string, id: string, date: string, spend: number, impressions: number, taps: number, installs: number) => ({
    channel: 'apple_ads',
    level,
    external_id: id,
    campaign_external_id: level === 'campaign' ? id : 'C1',
    date,
    spend,
    currency: 'USD',
    impressions,
    taps,
    installs,
  });
  db.rows('ad_metrics_daily').push(
    row('campaign', 'C1', '2026-10-01', 40.25, 2000, 100, 20),
    row('campaign', 'C1', '2026-10-02', 40, 2000, 100, 20),
    row('ad_group', 'G1', '2026-10-01', 40.25, 2000, 100, 20), // child levels are not compared
    row('campaign', 'C2', '2026-10-02', 19.75, 1000, 50, 10),
    { ...row('campaign', 'M1', '2026-10-02', 99, 1, 1, 1), channel: 'meta' } // other channel ignored
  );
  db.rows('ad_sync_runs').push({ id: 'r', channel: 'apple_ads', started_at: '2026-10-24T15:00:00Z', finished_at: '2026-10-24T15:01:00Z', ok: true, error: null });
});
afterEach(() => {
  vi.useRealTimers();
  setConnectorsForTest(null);
});

describe('GET /api/admin/ads/verify', () => {
  it('matching totals → ok, no campaign diffs, nothing written', async () => {
    const c = connector({
      totals: f(100, 5000, 250, 50),
      campaigns: [
        { campaignExternalId: 'C1', name: 'US Search', fields: f(80.25, 4000, 200, 40) },
        { campaignExternalId: 'C2', name: 'Brand', fields: f(19.75, 1000, 50, 10) },
      ],
    });
    setConnectorsForTest({ apple_ads: c });
    const before = JSON.stringify(db.tables);
    const res = await get('start=2026-10-01&end=2026-10-10&channel=apple_ads');
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({ channel: 'apple_ads', ok: true, campaigns: [], networkTimeZone: 'America/New_York', timeZoneMatches: true, lastSyncAt: '2026-10-24T15:01:00Z' });
    expect(data.totals).toEqual([
      { field: 'spend', network: 100, stored: 100, diff: 0, diffPct: 0, ok: true },
      { field: 'impressions', network: 5000, stored: 5000, diff: 0, diffPct: 0, ok: true },
      { field: 'taps', network: 250, stored: 250, diff: 0, diffPct: 0, ok: true },
      { field: 'installs', network: 50, stored: 50, diff: 0, diffPct: 0, ok: true },
    ]);
    expect(c.fetchTotals).toHaveBeenCalledWith('2026-10-01', '2026-10-10');
    expect(c.applyChange).not.toHaveBeenCalled();
    expect(JSON.stringify(db.tables)).toBe(before); // read-only
  });

  it('reports per-field and per-campaign diffs (stored − Apple) and a time zone mismatch', async () => {
    setConnectorsForTest({
      apple_ads: connector(
        {
          totals: f(110, 5000, 250, 52),
          campaigns: [
            { campaignExternalId: 'C1', name: 'US Search', fields: f(90.25, 4000, 200, 42) },
            { campaignExternalId: 'C2', name: 'Brand', fields: f(19.75, 1000, 50, 10) },
          ],
        },
        'Europe/London'
      ),
    });
    const { data } = await (await get('start=2026-10-01&end=2026-10-10')).json();
    expect(data.ok).toBe(false);
    expect(data.totals[0]).toEqual({ field: 'spend', network: 110, stored: 100, diff: -10, diffPct: -9.09, ok: false });
    expect(data.totals[3]).toEqual({ field: 'installs', network: 52, stored: 50, diff: -2, diffPct: -3.85, ok: false });
    expect(data.campaigns).toHaveLength(1);
    expect(data.campaigns[0]).toMatchObject({ campaignExternalId: 'C1', name: 'US Search' });
    expect(data.timeZoneMatches).toBe(false);
    expect(data.notes.join(' ')).toMatch(/Europe\/London/);
    expect(data.notes.join(' ')).toMatch(/backfill/); // range ended > 3 days ago
  });

  it('a campaign stored but missing at Apple is a diff', async () => {
    setConnectorsForTest({ apple_ads: connector({ totals: f(80.25, 4000, 200, 40), campaigns: [{ campaignExternalId: 'C1', name: 'US Search', fields: f(80.25, 4000, 200, 40) }] }) });
    const { data } = await (await get('start=2026-10-01&end=2026-10-10')).json();
    expect(data.campaigns.map((c: any) => c.campaignExternalId)).toEqual(['C2']);
    expect(data.campaigns[0].fields[0]).toMatchObject({ network: 0, stored: 19.75, diff: 19.75, diffPct: null, ok: false });
  });

  it('only apple_ads; 409 when not configured; admin only', async () => {
    setConnectorsForTest({ apple_ads: connector({ totals: f(0, 0, 0, 0), campaigns: [] }) });
    expect((await get('start=2026-10-01&end=2026-10-10&channel=meta')).status).toBe(400);
    expect((await get('start=2026-10-10&end=2026-10-01')).status).toBe(400);
    setConnectorsForTest({ apple_ads: { ...connector({ totals: f(0, 0, 0, 0), campaigns: [] }), isConfigured: () => false } as AdsConnector });
    expect((await get('start=2026-10-01&end=2026-10-10')).status).toBe(409);
    const anon = await verify(new NextRequest('https://www.fitcircle.ai/api/admin/ads/verify?start=2026-10-01&end=2026-10-10'));
    expect(anon.status).toBe(401);
  });
});
