/**
 * /api/cron/ads/report — auth, dryRun never sends, real run sends to the
 * configured recipients, and the DB-side funnel (platform inference, onboarding,
 * first meal, test-user exclusion) against the in-memory Supabase.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('@/lib/ads/__tests__/fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});
const sendEmail = vi.fn(async (_p: { to: string | string[]; subject: string; html: string; text?: string }) => ({ success: true, id: 'em_1' }));
vi.mock('@/lib/email/email-service', () => ({ sendEmail: (p: any) => sendEmail(p) }));

import { AdsFakeDb, setAdsDb } from '@/lib/ads/__tests__/fake-db';
import { setConnectorsForTest } from '@/lib/ads/connectors';
import type { AdsConnector } from '@/lib/ads/connectors/types';
import { addDays, todayInTz } from '@/lib/ads/dates';
import { reportRecipients } from '@/lib/ads/services/email-report-service';

import { GET as cronReport } from '../../../cron/ads/report/route';

const TZ = 'America/New_York';
let db: AdsFakeDb;

const req = (url: string, auth?: string) => new NextRequest(`https://www.fitcircle.ai${url}`, { headers: auth ? { authorization: auth } : {} });

const connector = { channel: 'apple_ads', isConfigured: () => true } as unknown as AdsConnector;

beforeEach(() => {
  db = new AdsFakeDb();
  setAdsDb(db);
  sendEmail.mockClear();
  process.env.CRON_SECRET = 'cron';
  process.env.ADS_REPORT_TIMEZONE = TZ;
  setConnectorsForTest({ apple_ads: connector });
  const today = todayInTz(TZ);
  const yesterday = addDays(today, -1);
  const start = addDays(today, -3);
  db.rows('ad_entities').push({
    channel: 'apple_ads',
    platform: 'ios',
    level: 'campaign',
    external_id: 'C1',
    parent_external_id: null,
    campaign_external_id: 'C1',
    name: 'US Search',
    status: 'ENABLED',
    serving_status: 'RUNNING',
    start_at: `${start}T12:00:00Z`,
    end_at: null,
    synced_at: new Date().toISOString(),
  });
  const m = (date: string, spend: number, installs: number) => ({ channel: 'apple_ads', level: 'campaign', external_id: 'C1', campaign_external_id: 'C1', date, spend, currency: 'USD', impressions: 100, taps: 10, installs });
  db.rows('ad_metrics_daily').push(m(start, 30, 4), m(yesterday, 40, 5), m(today, 10, 1));
  const done = new Date(Date.now() - 30 * 60_000).toISOString();
  db.rows('ad_sync_runs').push({ id: 'r1', channel: 'apple_ads', started_at: done, finished_at: done, ok: true, error: null });

  const at = `${today}T16:00:00Z`; // noon ET
  db.rows('profiles').push(
    { id: 'u-ios', email: 'jane.doe@gmail.com', is_admin: false, onboarding_completed: true, created_at: at },
    { id: 'u-android', email: 'raj@example.co', is_admin: false, onboarding_completed: false, created_at: at },
    { id: 'u-feed', email: 'sam@icloud.com', is_admin: false, onboarding_completed: true, created_at: at },
    { id: 'u-play', email: 'larrythornton.09170@gmail.com', is_admin: false, onboarding_completed: true, created_at: at },
    { id: 'u-admin', email: 'ani@inov8rlabs.com', is_admin: true, onboarding_completed: true, created_at: at },
    { id: 'u-old', email: 'old@gmail.com', is_admin: false, onboarding_completed: true, created_at: '2025-01-01T00:00:00Z' }
  );
  db.rows('push_tokens').push(
    { id: 'p1', user_id: 'u-ios', platform: 'ios', created_at: at },
    { id: 'p2', user_id: 'u-android', platform: 'android', created_at: at },
    { id: 'p3', user_id: 'u-play', platform: 'android', created_at: at }
  );
  db.rows('home_feed_decisions').push({ id: 'h1', user_id: 'u-feed', platform: 'iOS', created_at: at });
  db.rows('user_attribution').push({ user_id: 'u-ios', channel: 'apple_ads', platform: 'ios', source: 'apple_search_ads', campaign_external_id: 'C1', is_test: false });
  db.rows('food_log_entries').push(
    { id: 'f1', user_id: 'u-ios', input_method: 'photo', created_at: at },
    { id: 'f2', user_id: 'u-feed', input_method: 'imported', created_at: at }
  );
});

afterEach(() => {
  setConnectorsForTest(null);
  for (const k of ['CRON_SECRET', 'ADS_REPORT_TIMEZONE', 'ADS_REPORT_RECIPIENTS']) delete process.env[k];
});

describe('/api/cron/ads/report', () => {
  it('requires the CRON_SECRET bearer (dryRun too)', async () => {
    expect((await cronReport(req('/api/cron/ads/report'))).status).toBe(401);
    expect((await cronReport(req('/api/cron/ads/report?dryRun=1', 'Bearer nope'))).status).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('dryRun renders the report and does not send', async () => {
    const res = await cronReport(req('/api/cron/ads/report?dryRun=1', 'Bearer cron'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(body.data).toMatchObject({ dryRun: true, sent: false, recipients: ['ani@inov8rlabs.com'] });
    const r = body.data.report;
    expect(r.timeZone).toBe(TZ);
    expect(r.totals.launch).toMatchObject({ spend: 80, installs: 10 });
    expect(r.totals.yesterday).toMatchObject({ spend: 40, installs: 5 });
    expect(r.totals.today).toMatchObject({ spend: 10, installs: 1 });
    // Play tester + admin excluded; platform from attribution / push token / home feed.
    expect(r.funnel.today).toEqual({ signups: 3, byPlatform: { ios: 2, android: 1 }, onboarded: 2, firstMeal: 1, trials: 0, payers: 0, attributedPaid: 1, excludedTest: 2 });
    expect(r.alerts).toEqual([]);
    expect(body.data.text).toContain('FUNNEL');
    expect(body.data.html).toContain('/admin/ads');

    const html = await cronReport(req('/api/cron/ads/report?dryRun=1&format=html', 'Bearer cron'));
    expect(html.headers.get('content-type')).toContain('text/html');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('a real run sends once to ADS_REPORT_RECIPIENTS', async () => {
    process.env.ADS_REPORT_RECIPIENTS = 'a@x.com, b@y.com,not-an-email';
    const res = await cronReport(req('/api/cron/ads/report', 'Bearer cron'));
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const arg = sendEmail.mock.calls[0][0];
    expect(arg.to).toEqual(['a@x.com', 'b@y.com']);
    expect(arg.subject).toMatch(/^FitCircle ads — /);
    expect(arg.text).toContain('Apple Ads (iOS) — US Search');
  });

  it('send failure → 502', async () => {
    sendEmail.mockResolvedValueOnce({ success: false, error: 'domain not verified' } as any);
    const res = await cronReport(req('/api/cron/ads/report', 'Bearer cron'));
    expect(res.status).toBe(502);
  });

  it('recipients default to ani@inov8rlabs.com', () => {
    expect(reportRecipients({})).toEqual(['ani@inov8rlabs.com']);
    expect(reportRecipients({ ADS_REPORT_RECIPIENTS: ' ' })).toEqual(['ani@inov8rlabs.com']);
  });
});
