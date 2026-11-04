/** Resend (Svix) webhook: signatures, replay, each event type, and the route's status codes. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => { throw new Error('not used: memory store'); } }));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => { throw new Error('not used: memory store'); } }));

import { POST } from '../../../api/webhooks/resend/route';
import { contactHash } from '../../referrals/contact-hash';
import {
  handleResendEvent,
  isHardBounce,
  recipientsOf,
  resetWebhookStateForTests,
  svixSignature,
  tagsOf,
  verifySvix,
  type WebhookDeps,
} from '../resend-webhook';
import { MemorySuppressionStore, setSuppressionStoreForTests } from '../suppression';

const SECRET = 'whsec_' + Buffer.from('super-secret-signing-key-32bytes!').toString('base64');
const NOW = 1_800_000_000;

describe('verifySvix', () => {
  const body = '{"type":"email.opened","data":{"email_id":"re_1"}}';
  const sig = svixSignature(SECRET, 'msg_1', String(NOW), body);
  const h = (over: Partial<{ id: string | null; timestamp: string | null; signature: string | null }> = {}) => ({ id: 'msg_1', timestamp: String(NOW), signature: `v1,${sig}`, ...over });

  it('accepts a valid signature, also among several (secret rotation)', () => {
    expect(verifySvix(SECRET, h(), body, NOW)).toBe('ok');
    expect(verifySvix(SECRET, h({ signature: `v1,bm9wZQ== v1,${sig}` }), body, NOW)).toBe('ok');
  });

  it('rejects a tampered body, wrong secret, wrong id, wrong version, missing headers', () => {
    expect(verifySvix(SECRET, h(), body.replace('re_1', 're_2'), NOW)).toBe('bad_signature');
    expect(verifySvix('whsec_' + Buffer.from('other').toString('base64'), h(), body, NOW)).toBe('bad_signature');
    expect(verifySvix(SECRET, h({ id: 'msg_2' }), body, NOW)).toBe('bad_signature');
    expect(verifySvix(SECRET, h({ signature: `v2,${sig}` }), body, NOW)).toBe('bad_signature');
    expect(verifySvix(SECRET, h({ id: null }), body, NOW)).toBe('missing_headers');
    expect(verifySvix(SECRET, h({ signature: null }), body, NOW)).toBe('missing_headers');
  });

  it('rejects replays outside the 5-minute window (old or future timestamps)', () => {
    expect(verifySvix(SECRET, h(), body, NOW + 301)).toBe('stale_timestamp');
    expect(verifySvix(SECRET, h(), body, NOW - 301)).toBe('stale_timestamp');
    expect(verifySvix(SECRET, h(), body, NOW + 299)).toBe('ok');
  });
});

describe('handleResendEvent', () => {
  const deps = () => {
    const suppressed: any[] = [];
    const logs: any[] = [];
    const d: WebhookDeps = {
      suppress: async (w) => {
        suppressed.push(w);
        return { ok: true };
      },
      log: (l) => logs.push(l),
    };
    return { d, suppressed, logs };
  };
  const ev = (type: string, data: Record<string, unknown> = {}) => ({
    type,
    created_at: '2026-11-04T10:00:00Z',
    data: { email_id: 're_1', to: ['Sam@Example.org'], tags: { category: 'referral_invite' }, ...data },
  });

  it('hard bounce → suppress every recipient (hard_bounce)', async () => {
    const { d, suppressed, logs } = deps();
    const r = await handleResendEvent(ev('email.bounced', { bounce: { type: 'Permanent', subType: 'General', message: 'no such user' } }), d);
    expect(r).toEqual({ handled: true, type: 'email.bounced', suppressed: 1, suppressFailed: 0 });
    expect(suppressed[0]).toMatchObject({ address: 'Sam@Example.org', reason: 'hard_bounce', providerEmailId: 're_1', detail: { category: 'referral_invite', bounce_subtype: 'General' } });
    expect(logs[0]).toMatchObject({ type: 'bounced', category: 'referral_invite', bounce_type: 'permanent', domains: ['example.org'], suppression: 'hard_bounce' });
    expect(JSON.stringify(logs)).not.toContain('Sam@'); // no addresses in logs
  });

  it('soft / undetermined bounce → logged, not suppressed', async () => {
    const { d, suppressed, logs } = deps();
    await handleResendEvent(ev('email.bounced', { bounce: { type: 'Transient', subType: 'MailboxFull' } }), d);
    await handleResendEvent(ev('email.bounced', { bounce: { type: 'Undetermined' } }), d);
    expect(suppressed).toEqual([]);
    expect(logs.map((l) => l.bounce_type)).toEqual(['transient', 'undetermined']);
  });

  it('complaint → suppress (complaint)', async () => {
    const { d, suppressed } = deps();
    await handleResendEvent(ev('email.complained'), d);
    expect(suppressed[0]).toMatchObject({ reason: 'complaint' });
  });

  it('delivered / opened / clicked → one engagement log line each, no suppression', async () => {
    const { d, suppressed, logs } = deps();
    await handleResendEvent(ev('email.delivered'), d);
    await handleResendEvent(ev('email.opened'), d);
    await handleResendEvent(ev('email.clicked', { click: { link: 'https://fitcircle.ai/open?utm_content=log_meal&t=secret' } }), d);
    expect(suppressed).toEqual([]);
    expect(logs.map((l) => l.type)).toEqual(['delivered', 'opened', 'clicked']);
    expect(logs[2].link).toBe('fitcircle.ai/open'); // query (may hold tokens) stripped
  });

  it('unknown types are acknowledged and ignored', async () => {
    const { d, logs } = deps();
    expect(await handleResendEvent({ type: 'contact.created' }, d)).toEqual({ handled: false, reason: 'ignored_type' });
    expect(logs).toEqual([]);
  });

  it('helpers', () => {
    expect(tagsOf({ type: 'x', data: { tags: [{ name: 'a', value: '1' }] } })).toEqual({ a: '1' });
    expect(recipientsOf({ type: 'x', data: { to: 'Sam <sam@x.io>' } })).toEqual(['sam@x.io']);
    expect(isHardBounce({ type: 'email.bounced', data: {} })).toBe(false);
  });
});

describe('POST /api/webhooks/resend', () => {
  let store: MemorySuppressionStore;
  beforeEach(() => {
    process.env.RESEND_WEBHOOK_SECRET = SECRET;
    delete process.env.RESEND_WEBHOOK_ENABLED;
    store = new MemorySuppressionStore();
    setSuppressionStoreForTests(store);
    resetWebhookStateForTests();
  });
  afterEach(() => {
    setSuppressionStoreForTests(null);
    delete process.env.RESEND_WEBHOOK_SECRET;
  });

  const call = (payload: unknown, opts: { id?: string; ts?: number; sig?: string } = {}) => {
    const body = JSON.stringify(payload);
    const id = opts.id ?? `msg_${Math.random().toString(36).slice(2)}`;
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    const sig = opts.sig ?? `v1,${svixSignature(SECRET, id, ts, body)}`;
    return POST(new Request('http://localhost/api/webhooks/resend', { method: 'POST', body, headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sig } }) as any);
  };
  const bounce = { type: 'email.bounced', data: { email_id: 're_9', to: ['gone@example.org'], bounce: { type: 'Permanent' } } };

  it('valid signature + hard bounce → 200 and the address is suppressed', async () => {
    const res = await call(bounce);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, handled: true, suppressed: 1 });
    expect(store.rows.has(contactHash('email', 'gone@example.org'))).toBe(true);
  });

  it('invalid signature → 401, nothing stored', async () => {
    const res = await call(bounce, { sig: 'v1,AAAA' });
    expect(res.status).toBe(401);
    expect(store.rows.size).toBe(0);
  });

  it('replayed (stale) delivery → 401', async () => {
    const res = await call(bounce, { ts: Math.floor(Date.now() / 1000) - 600 });
    expect(res.status).toBe(401);
  });

  it('duplicate svix-id → acknowledged once, processed once', async () => {
    expect((await call(bounce, { id: 'msg_dup' })).status).toBe(200);
    const again = await call(bounce, { id: 'msg_dup' });
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    expect(store.rows.get(contactHash('email', 'gone@example.org'))!.event_count).toBe(1);
  });

  it('suppression table missing → 500 so Resend retries (and the retry is not treated as a duplicate)', async () => {
    store.failWith = { code: '42P01', message: 'relation "email_suppressions" does not exist' };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call(bounce, { id: 'msg_retry' })).status).toBe(500);
    store.failWith = null;
    expect((await call(bounce, { id: 'msg_retry' })).status).toBe(200);
    err.mockRestore();
  });

  it('secret not configured → 503; RESEND_WEBHOOK_ENABLED=false → verified, acknowledged, ignored', async () => {
    process.env.RESEND_WEBHOOK_ENABLED = 'false';
    const res = await call(bounce);
    expect(await res.json()).toEqual({ received: true, disabled: true });
    expect(store.rows.size).toBe(0);
    delete process.env.RESEND_WEBHOOK_SECRET;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call(bounce)).status).toBe(503);
    err.mockRestore();
  });

  it('bad JSON (signed) → 400', async () => {
    const body = 'not json';
    const id = 'msg_bad';
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await POST(new Request('http://localhost/api/webhooks/resend', { method: 'POST', body, headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${svixSignature(SECRET, id, ts, body)}` } }) as any);
    expect(res.status).toBe(400);
  });
});
