/**
 * /api/admin/ads/** contract + auth, /api/cron/ads/sync auth, and the shared
 * admin gate's X-Admin-Actor resolution (ADMIN_API_SECRET callers).
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('@/lib/ads/__tests__/fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});
vi.mock('@/lib/middleware/mobile-auth', async () => {
  const { getAdsDb } = await import('@/lib/ads/__tests__/fake-db');
  return {
    requireMobileAuth: async (request: Request) => {
      const auth = request.headers.get('authorization') ?? '';
      const id = auth.startsWith('Bearer user:') ? auth.slice('Bearer user:'.length) : null;
      const profile = id ? getAdsDb().rows('profiles').find((p) => p.id === id) : null;
      if (!profile) throw new Error('Unauthorized');
      return { ...profile };
    },
  };
});

import { AdsFakeDb, setAdsDb } from '@/lib/ads/__tests__/fake-db';
import { setConnectorsForTest } from '@/lib/ads/connectors';
import type { AdsConnector } from '@/lib/ads/connectors/types';
import { todayInTz } from '@/lib/ads/dates';
import type { AdEntityInput } from '@/lib/ads/types';
import { requireAdmin, requireAdminUser } from '@/lib/campaigns/admin-auth';

import { GET as cronSync } from '../../../cron/ads/sync/route';
import { GET as campaignGet } from '../campaigns/[channel]/[externalId]/route';
import { GET as changesList, POST as changesPost } from '../changes/route';
import { GET as overview } from '../overview/route';
import { POST as syncNow } from '../sync/route';
import { GET as timeseries } from '../timeseries/route';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PAYER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TZ = 'America/New_York';
let db: AdsFakeDb;

const req = (url: string, opts: { as?: string; auth?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`https://www.fitcircle.ai${url}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.as ? { authorization: `Bearer user:${opts.as}` } : {}),
      ...(opts.auth ? { authorization: opts.auth } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
const params = <T>(p: T) => ({ params: Promise.resolve(p) });

const kw = (bid: number): AdEntityInput => ({
  channel: 'apple_ads',
  platform: 'ios',
  level: 'keyword',
  externalId: 'K1',
  parentExternalId: 'G1',
  campaignExternalId: 'C1',
  name: 'calorie counter',
  status: 'ACTIVE',
  servingStatus: null,
  bidStrategy: 'MANUAL_CPT',
  bidAmount: bid,
  bidCurrency: 'USD',
  dailyBudget: null,
  totalBudget: null,
  matchType: 'EXACT',
  countries: null,
  startAt: null,
  endAt: null,
  creative: null,
  raw: {},
});

function fakeConnector(over: Partial<AdsConnector> = {}): AdsConnector & { applied: unknown[]; remoteBid: number } {
  const c: any = {
    channel: 'apple_ads',
    applied: [] as unknown[],
    remoteBid: 2,
    isConfigured: () => true,
    fetchEntities: async () => [
      { ...kw(2), level: 'campaign', externalId: 'C1', parentExternalId: null, name: 'US Search', status: 'ENABLED', bidAmount: null, dailyBudget: 50, matchType: null },
      { ...kw(2), level: 'ad_group', externalId: 'G1', parentExternalId: 'C1', name: 'Snap a meal', status: 'ENABLED', matchType: null },
      kw(2),
    ],
    fetchDailyMetrics: async (start: string, end: string) => [
      { channel: 'apple_ads', level: 'campaign', externalId: 'C1', campaignExternalId: 'C1', date: end, spend: 20, currency: 'USD', impressions: 400, taps: 10, installs: 4, newDownloads: 4, redownloads: 0 },
      { channel: 'apple_ads', level: 'keyword', externalId: 'K1', campaignExternalId: 'C1', date: end, spend: 20, currency: 'USD', impressions: 400, taps: 10, installs: 4, newDownloads: 4, redownloads: 0 },
      { channel: 'apple_ads', level: 'campaign', externalId: 'C1', campaignExternalId: 'C1', date: start, spend: 0, currency: 'USD', impressions: 0, taps: 0, installs: 0, newDownloads: 0, redownloads: 0 },
    ],
    readEntity: async () => kw(c.remoteBid),
    applyChange: async (change: any) => {
      c.applied.push(change);
      c.remoteBid = change.value;
      return { confirmedValue: change.value, entity: kw(change.value) };
    },
    ...over,
  };
  return c;
}

let conn: ReturnType<typeof fakeConnector>;

beforeEach(async () => {
  db = new AdsFakeDb();
  setAdsDb(db);
  const today = todayInTz(TZ);
  db.rows('profiles').push(
    { id: ADMIN, is_admin: true, email: 'ani@inov8rlabs.com', display_name: 'Ani', created_at: '2026-01-01T00:00:00Z' },
    { id: USER, is_admin: false, email: 'ben@example.com', display_name: 'Ben', created_at: '2026-01-01T00:00:00Z' },
    { id: PAYER, is_admin: false, email: 'p@example.com', display_name: 'P', created_at: `${today}T16:00:00Z` }
  );
  db.rows('user_attribution').push({ user_id: PAYER, channel: 'apple_ads', platform: 'ios', source: 'apple_search_ads', campaign_external_id: 'C1', ad_group_external_id: 'G1', keyword_external_id: 'K1', ad_external_id: null, is_test: false });
  db.rows('subscription_events').push(
    { id: 'e1', user_id: PAYER, type: 'INITIAL_PURCHASE', store: 'APP_STORE', environment: 'PRODUCTION', event_timestamp: `${today}T17:00:00Z`, raw: { price: 9.99, takehome_percentage: 0.85 } },
    { id: 'e2', user_id: PAYER, type: 'INITIAL_PURCHASE', store: 'APP_STORE', environment: 'SANDBOX', event_timestamp: `${today}T17:00:00Z`, raw: { price: 99 } }
  );
  db.rows('food_log_entries').push({ user_id: PAYER, created_at: `${today}T16:30:00Z` });
  process.env.ADMIN_API_SECRET = 'shh';
  process.env.CRON_SECRET = 'cron';
  process.env.ADS_REPORT_TIMEZONE = TZ;
  process.env.APPLE_ADS_WRITE_ENABLED = 'true';
  conn = fakeConnector();
  setConnectorsForTest({ apple_ads: conn });
  // Seed entities + metrics through the cron (also exercises sync).
  await cronSync(req('/api/cron/ads/sync', { auth: 'Bearer cron' }));
});
afterEach(() => {
  setConnectorsForTest(null);
  for (const k of ['ADMIN_API_SECRET', 'CRON_SECRET', 'ADS_REPORT_TIMEZONE', 'APPLE_ADS_WRITE_ENABLED']) delete process.env[k];
});

describe('auth', () => {
  it('401 signed out, 403 non-admin, 200 admin + API secret (GETs need no actor)', async () => {
    expect((await overview(req('/api/admin/ads/overview'))).status).toBe(401);
    expect((await overview(req('/api/admin/ads/overview', { as: USER }))).status).toBe(403);
    expect((await overview(req('/api/admin/ads/overview', { as: ADMIN }))).status).toBe(200);
    expect((await overview(req('/api/admin/ads/overview', { auth: 'Bearer shh' }))).status).toBe(200);
    expect((await changesList(req('/api/admin/ads/changes', { auth: 'Bearer shh' }))).status).toBe(200);
    expect((await overview(req('/api/admin/ads/overview', { auth: 'Bearer nope' }))).status).toBe(401);
    expect((await changesPost(req('/api/admin/ads/changes', { as: USER, method: 'POST', body: {} }))).status).toBe(403);
  });

  it('secret + mutating without X-Admin-Actor → 400 missing_actor', async () => {
    const body = { channel: 'apple_ads', level: 'keyword', externalId: 'K1', field: 'bid', value: 2.2, dryRun: true };
    const r1 = await changesPost(req('/api/admin/ads/changes', { auth: 'Bearer shh', method: 'POST', body }));
    expect(r1.status).toBe(400);
    expect((await r1.json()).error.code).toBe('missing_actor');
    const r2 = await syncNow(req('/api/admin/ads/sync', { auth: 'Bearer shh', method: 'POST', body: {} }));
    expect(r2.status).toBe(400);
    expect((await r2.json()).error.code).toBe('missing_actor');
  });

  it('secret + X-Admin-Actor is recorded in ad_change_log (actor_email; user id when it is an admin)', async () => {
    const body = { channel: 'apple_ads', level: 'keyword', externalId: 'K1', field: 'bid', value: 2.2, dryRun: true };
    const unknownActor = await changesPost(req('/api/admin/ads/changes', { auth: 'Bearer shh', method: 'POST', body, headers: { 'X-Admin-Actor': 'Ops@Inov8rlabs.com' } }));
    expect(unknownActor.status).toBe(200);
    const known = await changesPost(req('/api/admin/ads/changes', { auth: 'Bearer shh', method: 'POST', body, headers: { 'X-Admin-Actor': 'ani@inov8rlabs.com' } }));
    expect(known.status).toBe(200);
    const log = db.rows('ad_change_log');
    expect(log[0]).toMatchObject({ actor_email: 'ops@inov8rlabs.com', actor_user_id: null, outcome: 'dry_run' });
    expect(log[1]).toMatchObject({ actor_email: 'ani@inov8rlabs.com', actor_user_id: ADMIN });
    const list = await (await changesList(req('/api/admin/ads/changes', { as: ADMIN }))).json();
    expect(list.data.changes.find((c: any) => c.actorUserId === ADMIN)).toMatchObject({ actorEmail: 'ani@inov8rlabs.com', actorName: 'Ani', field: 'bid', outcome: 'dry_run' });
    expect(list.data.changes.find((c: any) => !c.actorUserId)).toMatchObject({ actorEmail: 'ops@inov8rlabs.com', actorName: 'ops@inov8rlabs.com' });
  });
});

describe('shared admin gate: X-Admin-Actor resolution', () => {
  it('maps an admin email to that profile (viaSecret stays true) so "as me" routes work', async () => {
    const caller = await requireAdmin(req('/x', { auth: 'Bearer shh', headers: { 'x-admin-actor': 'ANI@inov8rlabs.com' } }));
    expect(caller).toMatchObject({ viaSecret: true, userId: ADMIN, actorEmail: 'ani@inov8rlabs.com' });
    expect(requireAdminUser(caller)).toBe(ADMIN);
  });
  it('non-admin or unknown email: userId stays null, email still carried', async () => {
    const nonAdmin = await requireAdmin(req('/x', { auth: 'Bearer shh', headers: { 'x-admin-actor': 'ben@example.com' } }));
    expect(nonAdmin).toMatchObject({ viaSecret: true, userId: null, actorEmail: 'ben@example.com' });
    expect(() => requireAdminUser(nonAdmin)).toThrow(/signed-in admin/);
    const none = await requireAdmin(req('/x', { auth: 'Bearer shh' }));
    expect(none).toMatchObject({ userId: null, actorEmail: null });
  });
  it('session callers carry their own email', async () => {
    expect(await requireAdmin(req('/x', { as: ADMIN }))).toMatchObject({ viaSecret: false, userId: ADMIN, actorEmail: 'ani@inov8rlabs.com' });
  });
});

describe('overview / timeseries / campaign shapes', () => {
  it('overview by channel: rows, totals, lastSync', async () => {
    const res = await overview(req('/api/admin/ads/overview?groupBy=channel', { as: ADMIN }));
    const { data } = await res.json();
    expect(Object.keys(data).sort()).toEqual(['groupBy', 'lastSync', 'range', 'rows', 'targets', 'testUsers', 'totals']);
    const apple = data.rows.find((r: any) => r.key === 'apple_ads');
    expect(apple.metrics).toMatchObject({ spend: 20, installs: 4, users: 1, activated: 1, payers: 1, revenueToDate: 8.49, cpi: 5, costPerPayer: 20 });
    expect(apple.metrics.roasToDate).toBeCloseTo(8.49 / 20);
    expect(data.totals.metrics.users).toBe(1); // admin/user profiles signed up outside the range
    expect(data.lastSync.find((s: any) => s.channel === 'apple_ads')).toMatchObject({ configured: true, writeEnabled: true, ok: true });
    expect(data.targets).toEqual({ costPerPayerMax: 35, roasD7Min: 0.1, roasD30Min: 0.3, roas12mMin: 1 });
  });

  it('validates params', async () => {
    expect((await overview(req('/api/admin/ads/overview?groupBy=nope', { as: ADMIN }))).status).toBe(400);
    expect((await overview(req('/api/admin/ads/overview?start=2026-10-30&end=2026-10-01', { as: ADMIN }))).status).toBe(400);
    expect((await timeseries(req('/api/admin/ads/timeseries?channel=tiktok', { as: ADMIN }))).status).toBe(400);
  });

  it('timeseries points', async () => {
    const { data } = await (await timeseries(req('/api/admin/ads/timeseries?channel=apple_ads', { as: ADMIN }))).json();
    expect(data.points).toHaveLength(7);
    const last = data.points[6];
    expect(last).toMatchObject({ spend: 20, users: 1, payers: 1, revenue: 8.49 });
  });

  it('campaign drill-down with editability', async () => {
    const res = await campaignGet(req('/api/admin/ads/campaigns/apple_ads/C1', { as: ADMIN }), params({ channel: 'apple_ads', externalId: 'C1' }));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.campaign).toMatchObject({ externalId: 'C1', name: 'US Search', dailyBudget: 50 });
    expect(data.campaign.editability.dailyBudget.editable).toBe(true);
    expect(data.campaign.editability.bid).toMatchObject({ editable: false });
    expect(data.adGroups).toHaveLength(1);
    expect(data.keywords[0]).toMatchObject({ externalId: 'K1', matchType: 'EXACT', bidAmount: 2, todaySpend: 20 });
    expect(data.keywords[0].metrics).toMatchObject({ users: 1, payers: 1 });
    expect(data.keywords[0].editability.bid.editable).toBe(true);
    expect((await campaignGet(req('/api/admin/ads/campaigns/apple_ads/NOPE', { as: ADMIN }), params({ channel: 'apple_ads', externalId: 'NOPE' }))).status).toBe(404);
  });

  it('read-only connector: editability says enable writes', async () => {
    delete process.env.APPLE_ADS_WRITE_ENABLED;
    const { data } = await (await campaignGet(req('/api/admin/ads/campaigns/apple_ads/C1', { as: ADMIN }), params({ channel: 'apple_ads', externalId: 'C1' }))).json();
    expect(data.keywords[0].editability.bid).toEqual({ editable: false, reason: 'Read-only: enable writes' });
  });
});

describe('changes', () => {
  const body = (over: Record<string, unknown> = {}) => ({ channel: 'apple_ads', level: 'keyword', externalId: 'K1', field: 'bid', value: 2.4, ...over });

  it('dry run → guardrail result, nothing applied, logged', async () => {
    const { data } = await (await changesPost(req('/api/admin/ads/changes', { as: ADMIN, method: 'POST', body: body({ dryRun: true }) }))).json();
    expect(data).toMatchObject({ ok: true, outcome: 'dry_run', oldValue: 2, requestedValue: 2.4, todaySpend: 20 });
    expect(data.pctChange).toBeCloseTo(20);
    expect(conn.applied).toHaveLength(0);
    expect(db.rows('ad_change_log')[0]).toMatchObject({ outcome: 'dry_run', actor_user_id: ADMIN, old_value: '2', requested_value: '2.4' });
  });

  it('applies, re-reads, updates ad_entities, logs applied', async () => {
    const { data } = await (await changesPost(req('/api/admin/ads/changes', { as: ADMIN, method: 'POST', body: body({ expectedOldValue: 2 }) }))).json();
    expect(data).toMatchObject({ ok: true, outcome: 'applied', newValue: 2.4 });
    expect(conn.applied).toHaveLength(1);
    expect(db.rows('ad_entities').find((e) => e.external_id === 'K1')!.bid_amount).toBe(2.4);
    expect(db.rows('ad_change_log')[0]).toMatchObject({ outcome: 'applied', new_value: '2.4' });
  });

  it('rejects over the step limit and when writes are off (still logged)', async () => {
    const r = await (await changesPost(req('/api/admin/ads/changes', { as: ADMIN, method: 'POST', body: body({ value: 5 }) }))).json();
    expect(r.data).toMatchObject({ ok: false, outcome: 'rejected', code: 'step_limit' });
    delete process.env.APPLE_ADS_WRITE_ENABLED;
    const r2 = await (await changesPost(req('/api/admin/ads/changes', { as: ADMIN, method: 'POST', body: body() }))).json();
    expect(r2.data).toMatchObject({ ok: false, code: 'writable' });
    expect(conn.applied).toHaveLength(0);
    expect(db.rows('ad_change_log').map((l) => l.outcome)).toEqual(['rejected', 'rejected']);
  });

  it('stale: re-reads an old entity; rejects when the network value moved', async () => {
    const k = db.rows('ad_entities').find((e) => e.external_id === 'K1')!;
    k.synced_at = new Date(Date.now() - 60 * 60_000).toISOString();
    conn.remoteBid = 2.3; // changed in the Apple Ads UI
    const { data } = await (await changesPost(req('/api/admin/ads/changes', { as: ADMIN, method: 'POST', body: body({ expectedOldValue: 2 }) }))).json();
    expect(data).toMatchObject({ ok: false, outcome: 'rejected', code: 'stale', oldValue: 2.3 });
  });

  it('a failed network write is 502 + logged failed', async () => {
    setConnectorsForTest({ apple_ads: fakeConnector({ applyChange: async () => { throw new Error('Apple Ads PUT: HTTP 403'); } }) });
    const res = await changesPost(req('/api/admin/ads/changes', { as: ADMIN, method: 'POST', body: body() }));
    expect(res.status).toBe(502);
    expect((await res.json()).data).toMatchObject({ ok: false, outcome: 'failed', code: 'apply_failed' });
    expect(db.rows('ad_change_log')[0]).toMatchObject({ outcome: 'failed', error: 'Apple Ads PUT: HTTP 403' });
  });

  it('validates the body', async () => {
    expect((await changesPost(req('/api/admin/ads/changes', { as: ADMIN, method: 'POST', body: { channel: 'apple_ads' } }))).status).toBe(400);
  });
});

describe('sync', () => {
  it('cron requires CRON_SECRET; backfill requires the admin secret', async () => {
    expect((await cronSync(req('/api/cron/ads/sync'))).status).toBe(401);
    expect((await cronSync(req('/api/cron/ads/sync', { auth: 'Bearer nope' }))).status).toBe(401);
    expect((await cronSync(req('/api/cron/ads/sync?start=2026-10-01&end=2026-10-02', { auth: 'Bearer cron' }))).status).toBe(401);
    const ok = await cronSync(req('/api/cron/ads/sync?start=2026-10-01&end=2026-10-02&channel=apple_ads', { auth: 'Bearer shh' }));
    expect(ok.status).toBe(200);
    expect(db.rows('ad_sync_runs').at(-1)).toMatchObject({ trigger: 'backfill', range_start: '2026-10-01', range_end: '2026-10-02', ok: true });
    expect((await cronSync(req('/api/cron/ads/sync?start=bad', { auth: 'Bearer shh' }))).status).toBe(400);
  });

  it('records ad_sync_runs; one failing channel does not block another', async () => {
    const meta = { ...fakeConnector(), channel: 'meta', fetchEntities: async () => { throw new Error('Meta down'); } } as any;
    setConnectorsForTest({ apple_ads: conn, meta });
    const res = await cronSync(req('/api/cron/ads/sync', { auth: 'Bearer cron' }));
    const { data } = await res.json();
    expect(data.results.find((r: any) => r.channel === 'apple_ads')).toMatchObject({ ok: true, rowsEntities: 3, rowsMetrics: 3 });
    expect(data.results.find((r: any) => r.channel === 'meta')).toMatchObject({ ok: false, error: 'Meta down' });
  });

  it('sync now is debounced (< 2 min since the last run)', async () => {
    const { data } = await (await syncNow(req('/api/admin/ads/sync', { as: ADMIN, method: 'POST', body: {} }))).json();
    expect(data.results[0]).toMatchObject({ channel: 'apple_ads', skipped: 'debounced' });
    const withActor = await syncNow(req('/api/admin/ads/sync', { auth: 'Bearer shh', method: 'POST', body: {}, headers: { 'X-Admin-Actor': 'ani@inov8rlabs.com' } }));
    expect(withActor.status).toBe(200);
  });

  it('not-configured connectors are skipped', async () => {
    setConnectorsForTest({ apple_ads: fakeConnector({ isConfigured: () => false }) });
    const { data } = await (await cronSync(req('/api/cron/ads/sync', { auth: 'Bearer cron' }))).json();
    expect(data.results[0]).toMatchObject({ skipped: 'not_configured' });
  });
});
