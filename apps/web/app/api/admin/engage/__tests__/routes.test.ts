import { File as NodeFile } from 'node:buffer';

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as mobileEvents } from '@/api/mobile/engage/events/route';
import { GET as mobileEngage } from '@/api/mobile/engage/route';
import { cardContent, messageRow, png } from '@/lib/services/__tests__/engage-fixtures';
import { ReferralFakeDb, getReferralDb, setReferralDb } from '@/lib/services/__tests__/referral-fake-db';

import { DELETE as archiveAsset } from '../assets/[id]/route';
import { GET as listAssets, POST as uploadAsset } from '../assets/route';
import { POST as launchMessage } from '../messages/[id]/launch/route';
import { PATCH as patchMessage } from '../messages/[id]/route';
import { GET as messageStats } from '../messages/[id]/stats/route';
import { GET as listMessages, POST as createMessage } from '../messages/route';
import { GET as overview } from '../overview/route';
import { POST as estimate } from '../segments/estimate/route';
import { POST as createSegment } from '../segments/route';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getReferralDb().client() }));
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async (request: Request) => {
    const auth = request.headers.get('authorization') ?? '';
    const id = auth.startsWith('Bearer user:') ? auth.slice('Bearer user:'.length) : null;
    const profile = id ? getReferralDb().profile(id) : null;
    if (!profile) throw new Error('Unauthorized');
    return { ...profile };
  },
}));

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db: ReferralFakeDb;

const req = (url: string, o: { as?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`https://www.fitcircle.ai${url}`, {
    method: o.method ?? 'GET',
    headers: { ...(o.as ? { authorization: `Bearer user:${o.as}` } : {}), ...(o.body ? { 'content-type': 'application/json' } : {}), ...(o.headers ?? {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
const params = <T>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  db = new ReferralFakeDb();
  setReferralDb(db);
  db.addProfile({ id: ADMIN, display_name: 'Ani', is_admin: true, preferences: {} });
  db.addProfile({ id: USER, display_name: 'Ben', is_admin: false, preferences: {} });
});

describe('engage admin routes', () => {
  it('403 for non-admins on every admin surface', async () => {
    for (const res of [
      await listMessages(req('/api/admin/engage/messages', { as: USER })),
      await listAssets(req('/api/admin/engage/assets', { as: USER })),
      await overview(req('/api/admin/engage/overview', { as: USER })),
      await estimate(req('/api/admin/engage/segments/estimate', { as: USER, method: 'POST', body: { filters: [] } })),
    ]) {
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('FORBIDDEN');
    }
    expect((await listMessages(req('/api/admin/engage/messages'))).status).toBe(401);
  });

  it('message lifecycle over HTTP: create, version conflict, launch, stats', async () => {
    const created = await createMessage(
      req('/api/admin/engage/messages', {
        as: ADMIN,
        method: 'POST',
        body: { name: 'Card', channel: 'content_card', placement: 'home_feed', layout: 'card', startsAt: '2026-01-01T00:00:00Z', variants: [{ id: 'A', name: 'A', weight: 100, content: cardContent() }] },
      })
    );
    expect(created.status).toBe(201);
    const m = (await created.json()).data;
    const ok = await patchMessage(req(`/api/admin/engage/messages/${m.id}`, { as: ADMIN, method: 'PATCH', body: { version: 1, priority: 5 } }), params({ id: m.id }));
    expect((await ok.json()).data).toMatchObject({ priority: 5, version: 2 });
    const stale = await patchMessage(req(`/api/admin/engage/messages/${m.id}`, { as: ADMIN, method: 'PATCH', body: { version: 1, priority: 1 } }), params({ id: m.id }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe('VERSION_CONFLICT');
    const bad = await patchMessage(req(`/api/admin/engage/messages/${m.id}`, { as: ADMIN, method: 'PATCH', body: { version: 2, variants: [] } }), params({ id: m.id }));
    expect(bad.status).toBe(400);
    const listed = await (await listMessages(req('/api/admin/engage/messages', { as: ADMIN }))).json();
    expect(listed.data.messages[0]).toMatchObject({
      id: m.id,
      summary: { days: 7, daily: [0, 0, 0, 0, 0, 0, 0], uniqueImpressions: 0, uniqueClicks: 0, ctr: null, conversions: 0, conversionRate: null },
      stats: { impressions: 0, clicks: 0, ctr: null, conversions: 0, daily: [0, 0, 0, 0, 0, 0, 0] },
    });
    const launched = await launchMessage(req(`/api/admin/engage/messages/${m.id}/launch`, { as: ADMIN, method: 'POST' }), params({ id: m.id }));
    expect((await launched.json()).data.status).toBe('live');
    const stats = await messageStats(req(`/api/admin/engage/messages/${m.id}/stats?platform=ios`, { as: ADMIN }), params({ id: m.id }));
    expect((await stats.json()).data).toMatchObject({ messageId: m.id, platform: 'ios', variants: [{ variantId: 'A', exposedUsers: 0 }] });
  });

  it('asset upload (multipart) dedupes; archive blocked while in use', async () => {
    // jsdom's FormData/File don't round-trip through undici's multipart parser:
    // build the body by hand and let undici use Node's File class.
    const jsdomFile = globalThis.File;
    (globalThis as any).File = NodeFile;
    const upload = () => {
      const boundary = 'xBOUNDARYx';
      const enc = new TextEncoder();
      const parts: Uint8Array[] = [
        enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hero.png"\r\nContent-Type: image/png\r\n\r\n`),
        png(1200, 600),
        enc.encode(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify({ name: 'Hero', tags: ['launch'], dominantColor: '#abcdef' })}\r\n--${boundary}--\r\n`),
      ];
      const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of parts) {
        body.set(p, o);
        o += p.length;
      }
      return new NextRequest('https://www.fitcircle.ai/api/admin/engage/assets', {
        method: 'POST',
        headers: { authorization: `Bearer user:${ADMIN}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
        body: Buffer.from(body),
      });
    };
    const first = await uploadAsset(upload());
    expect(first.status).toBe(201);
    const asset = (await first.json()).data.asset;
    expect(asset).toMatchObject({ name: 'Hero', width: 1200, dominantColor: '#abcdef', tags: ['launch'] });
    const dup = await uploadAsset(upload());
    expect(dup.status).toBe(200);
    expect((await dup.json()).data).toMatchObject({ deduped: true, asset: { id: asset.id } });

    db.rows('engage_messages').push(messageRow({ variants: [{ id: 'A', name: 'A', weight: 100, content: cardContent({ image: { assetId: asset.id } }) }] }));
    const blocked = await archiveAsset(req(`/api/admin/engage/assets/${asset.id}`, { as: ADMIN, method: 'DELETE' }), params({ id: asset.id }));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe('ASSET_IN_USE');
    (globalThis as any).File = jsdomFile;
  });

  it('segments + estimate', async () => {
    const seg = await createSegment(req('/api/admin/engage/segments', { as: ADMIN, method: 'POST', body: { name: 'Admins', filters: [{ key: 'is_pro', op: 'eq', value: false }] } }));
    const s = (await seg.json()).data;
    const est = await estimate(req('/api/admin/engage/segments/estimate', { as: ADMIN, method: 'POST', body: { segmentId: s.id, filters: [] } }));
    expect((await est.json()).data).toMatchObject({ count: 2, approximate: false });
    expect(db.rows('engage_segments')[0].estimated_count).toBe(2);
    const badKey = await estimate(req('/api/admin/engage/segments/estimate', { as: ADMIN, method: 'POST', body: { filters: [{ key: 'shoe_size', op: 'eq', value: 9 }] } }));
    expect(badKey.status).toBe(400);
  });
});

describe('mobile engage routes', () => {
  it('GET /api/mobile/engage honours x-platform; POST events accepts a batch', async () => {
    const webOnly = messageRow({ platforms: ['web'], name: 'web' });
    const everyone = messageRow({ name: 'all' });
    db.rows('engage_messages').push(webOnly, everyone);
    const ios = await (await mobileEngage(req('/api/mobile/engage', { as: USER, headers: { 'x-platform': 'ios', 'x-app-version': '1.0.4' } }))).json();
    expect(ios.success).toBe(true);
    expect(ios.data.cards.home_feed.map((c: any) => c.messageId)).toEqual([everyone.id]);
    expect(ios.data).toMatchObject({ inApp: [], prefetch: [], heroCampaignSlug: null, caps: { inAppPer24h: 2, inAppPerSession: 1 } });
    const web = await (await mobileEngage(req('/api/mobile/engage', { as: USER, headers: { 'x-platform': 'web' } }))).json();
    expect(web.data.cards.home_feed).toHaveLength(2);

    const res = await mobileEvents(
      req('/api/mobile/engage/events', { as: USER, method: 'POST', headers: { 'x-platform': 'android' }, body: { events: [{ type: 'impression', messageId: everyone.id, variantId: 'A', at: new Date().toISOString() }] } })
    );
    expect((await res.json()).data).toEqual({ accepted: 1, dropped: 0 });
    expect(db.rows('engage_events')[0]).toMatchObject({ platform: 'android', user_id: USER });
    expect((await mobileEvents(req('/api/mobile/engage/events', { as: USER, method: 'POST', body: { events: 'nope' } }))).status).toBe(400);
  });
});
