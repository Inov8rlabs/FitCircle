/**
 * Engagement routes: cron auth (fail closed), flags default OFF, dry runs,
 * ledger-unavailable guard; Resend webhook signature gate; unsubscribe
 * (GET is side-effect free, POST / one-click unsubscribes + stamps the send).
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryLedger, USER, memoryAdapters, weeklyFacts } from '@/lib/engagement/__tests__/fixtures';
import { svixSignature } from '@/lib/engagement/resend-webhook';
import { unsubscribeUrl } from '@/lib/engagement/unsubscribe';

let adapters = memoryAdapters();
vi.mock('@/lib/engagement/adapters', () => ({ fitCircleAdapters: () => adapters }));
vi.mock('@/lib/engagement/adapters/fitcircle-attribution', () => ({ attributeConversions: vi.fn(async () => ({ checked: 0, converted: 0, growthConverted: 0 })) }));
vi.mock('@/lib/middleware/rate-limit', () => ({ applyRateLimit: async () => null, createRateLimiter: () => ({}), getIdentifier: () => 'test' }));

import { POST as webhook } from '../../../webhooks/resend/route';
import { GET as unsubGet, POST as unsubPost } from '../../../engagement/unsubscribe/route';
import { GET as lifecycleCron } from '../lifecycle/route';
import { GET as weeklyCron } from '../weekly-report/route';

const req = (url: string, init: { auth?: string; method?: string; headers?: Record<string, string>; body?: string } = {}) =>
  new NextRequest(url.startsWith('http') ? url : `https://www.fitcircle.ai${url}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.auth ? { authorization: init.auth } : {}), ...(init.headers ?? {}) },
    body: init.body,
  });

beforeEach(() => {
  process.env.CRON_SECRET = 'cron';
  adapters = memoryAdapters({
    weeklyReportCandidates: async ({ afterUserId }) => (afterUserId ? [] : [{ userId: USER, timezone: 'America/New_York', createdAt: '2026-01-01T00:00:00Z' }]),
    weeklyReportFacts: async () => weeklyFacts(),
  });
});

afterEach(() => {
  for (const k of ['WEEKLY_REPORT_ENABLED', 'ENGAGEMENT_EMAILS_ENABLED', 'RESEND_WEBHOOK_SECRET', 'ENGAGEMENT_TEST_USER_IDS']) delete process.env[k];
});

describe('cron routes', () => {
  it('401 without the cron secret (fail closed, also when CRON_SECRET is unset)', async () => {
    expect((await weeklyCron(req('/api/cron/engagement/weekly-report'))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await lifecycleCron(req('/api/cron/engagement/lifecycle', { auth: 'Bearer undefined' }))).status).toBe(401);
  });

  it('flags default OFF: nothing sent', async () => {
    const res = await weeklyCron(req('/api/cron/engagement/weekly-report', { auth: 'Bearer cron' }));
    expect(await res.json()).toMatchObject({ success: true, enabled: false });
    const life = await (await lifecycleCron(req('/api/cron/engagement/lifecycle', { auth: 'Bearer cron' }))).json();
    expect(life.lifecycle).toMatchObject({ enabled: false });
    expect(adapters.email.sent).toHaveLength(0);
  });

  it('dryRun works with the flags off and sends/writes nothing', async () => {
    const res = await weeklyCron(req('/api/cron/engagement/weekly-report?dryRun=1&ignoreWindow=1', { auth: 'Bearer cron' }));
    const body = await res.json();
    expect(body).toMatchObject({ success: true, dryRun: true });
    expect(body.decisions[0]).toMatchObject({ userId: USER, email: 'would_send', push: 'would_send' });
    expect(adapters.email.sent).toHaveLength(0);
    expect((adapters.ledger as MemoryLedger).rows).toHaveLength(0);
  });

  it('enabled: sends in the window', async () => {
    process.env.WEEKLY_REPORT_ENABLED = 'true';
    const body = await (await weeklyCron(req('/api/cron/engagement/weekly-report', { auth: 'Bearer cron' }))).json();
    expect(body.success).toBe(true);
    // Whether USER is in the window depends on the wall clock; the runner window itself is unit-tested.
    expect(adapters.email.sent.length).toBe(body.outcomes['email:sent'] ?? 0);
  });

  it('503 when the ledger table is missing (migration 119 not applied)', async () => {
    process.env.WEEKLY_REPORT_ENABLED = 'true';
    (adapters.ledger as MemoryLedger).available = false;
    expect((await weeklyCron(req('/api/cron/engagement/weekly-report', { auth: 'Bearer cron' }))).status).toBe(503);
  });

  it('validates params', async () => {
    expect((await weeklyCron(req('/api/cron/engagement/weekly-report?userId=nope', { auth: 'Bearer cron' }))).status).toBe(400);
    process.env.ENGAGEMENT_TEST_USER_IDS = USER;
    expect((await weeklyCron(req('/api/cron/engagement/weekly-report?dryRun=1&userId=22222222-2222-4222-8222-222222222222', { auth: 'Bearer cron' }))).status).toBe(400);
  });
});

describe('POST /api/webhooks/resend', () => {
  const secret = 'whsec_' + Buffer.from('route-test-secret').toString('base64');
  const signed = (body: string, overrideSig?: string) => {
    const ts = String(Math.floor(Date.now() / 1000));
    return req('/api/webhooks/resend', {
      method: 'POST',
      body,
      headers: { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': overrideSig ?? `v1,${svixSignature(secret, 'msg_1', ts, body)}` },
    });
  };

  it('401 on a bad signature or with no secret configured', async () => {
    const body = JSON.stringify({ type: 'email.opened', data: { email_id: 're_1' } });
    expect((await webhook(signed(body))).status).toBe(401);
    process.env.RESEND_WEBHOOK_SECRET = secret;
    expect((await webhook(signed(body, 'v1,AAAA'))).status).toBe(401);
  });

  it('valid signature → stamps the ledger and emits analytics', async () => {
    process.env.RESEND_WEBHOOK_SECRET = secret;
    const ledger = adapters.ledger as MemoryLedger;
    const id = (await ledger.claim({ userId: USER, messageKey: 'weekly_report', periodKey: '2026-W44', channel: 'email', variant: 'v', templateVersion: 't', goalKey: 'active' }))!;
    await ledger.complete(id, { status: 'sent', providerId: 're_1' });
    const res = await webhook(signed(JSON.stringify({ type: 'email.delivered', data: { email_id: 're_1' } })));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: true, event: 'Email Delivered' });
    expect(ledger.rows[0].delivered_at).toBeTruthy();
  });
});

describe('/api/engagement/unsubscribe', () => {
  it('GET shows a confirm page and changes nothing', async () => {
    const res = await unsubGet(req(unsubscribeUrl(USER, 'weekly_report')));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Unsubscribe from weekly recaps');
    expect(adapters.consent.unsubscribed).toEqual([]);
  });

  it('GET with a bad token → 400', async () => {
    expect((await unsubGet(req('/api/engagement/unsubscribe?t=bad'))).status).toBe(400);
  });

  it('one-click POST unsubscribes the scope, stamps the send and emits Email Unsubscribed', async () => {
    const ledger = adapters.ledger as MemoryLedger;
    const id = (await ledger.claim({ userId: USER, messageKey: 'weekly_report', periodKey: '2026-W44', channel: 'email', variant: 'v', templateVersion: 't', goalKey: 'active' }))!;
    const res = await unsubPost(req(unsubscribeUrl(USER, 'weekly_report', id), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }));
    expect(res.status).toBe(200);
    expect(adapters.consent.unsubscribed).toEqual([[USER, 'weekly_report']]);
    expect(ledger.rows[0].unsubscribed_at).toBeTruthy();
    expect(adapters.analytics.events[0]).toMatchObject({ event: 'Email Unsubscribed', props: { scope: 'weekly_report', message_key: 'weekly_report' } });
  });

  it('a token for another scope or user does not verify', async () => {
    const url = unsubscribeUrl(USER, 'tips').replace('.tips.', '.all.');
    expect((await unsubPost(req(url, { method: 'POST' }))).status).toBe(400);
  });
});
