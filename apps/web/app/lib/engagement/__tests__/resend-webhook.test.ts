/** Resend (Svix) webhook signature verification and event → ledger/analytics mapping. */
import { describe, expect, it } from 'vitest';

import { EVENT_MAP, handleResendEvent, isHardBounce, svixSignature, tagsOf, verifySvix } from '../resend-webhook';

import { MemoryAnalytics, MemoryConsent, MemoryLedger, USER } from './fixtures';

const SECRET = 'whsec_' + Buffer.from('super-secret-signing-key-32bytes!').toString('base64');
const NOW = 1_800_000_000;

describe('verifySvix', () => {
  const body = '{"type":"email.opened","data":{"email_id":"re_1"}}';
  const sig = svixSignature(SECRET, 'msg_1', String(NOW), body);

  it('accepts a valid signature (also among several, e.g. during rotation)', () => {
    expect(verifySvix(SECRET, { id: 'msg_1', timestamp: String(NOW), signature: `v1,${sig}` }, body, NOW)).toBe(true);
    expect(verifySvix(SECRET, { id: 'msg_1', timestamp: String(NOW), signature: `v1,bm9wZQ== v1,${sig}` }, body, NOW)).toBe(true);
  });

  it('rejects a tampered body, wrong secret, wrong id, missing headers and an unset secret', () => {
    expect(verifySvix(SECRET, { id: 'msg_1', timestamp: String(NOW), signature: `v1,${sig}` }, body.replace('re_1', 're_2'), NOW)).toBe(false);
    expect(verifySvix('whsec_' + Buffer.from('other').toString('base64'), { id: 'msg_1', timestamp: String(NOW), signature: `v1,${sig}` }, body, NOW)).toBe(false);
    expect(verifySvix(SECRET, { id: 'msg_2', timestamp: String(NOW), signature: `v1,${sig}` }, body, NOW)).toBe(false);
    expect(verifySvix(SECRET, { id: null, timestamp: String(NOW), signature: `v1,${sig}` }, body, NOW)).toBe(false);
    expect(verifySvix(undefined, { id: 'msg_1', timestamp: String(NOW), signature: `v1,${sig}` }, body, NOW)).toBe(false);
    expect(verifySvix(SECRET, { id: 'msg_1', timestamp: String(NOW), signature: `v2,${sig}` }, body, NOW)).toBe(false);
  });

  it('rejects stale or future timestamps (replay window 5 min)', () => {
    expect(verifySvix(SECRET, { id: 'msg_1', timestamp: String(NOW), signature: `v1,${sig}` }, body, NOW + 301)).toBe(false);
    expect(verifySvix(SECRET, { id: 'msg_1', timestamp: String(NOW), signature: `v1,${sig}` }, body, NOW - 301)).toBe(false);
  });
});

describe('handleResendEvent', () => {
  const setup = async () => {
    const ledger = new MemoryLedger();
    const id = (await ledger.claim({ userId: USER, messageKey: 'weekly_report', periodKey: '2026-W44', channel: 'email', variant: 'hero:best_week', templateVersion: 'weekly_report@1', goalKey: 'active' }))!;
    await ledger.complete(id, { status: 'sent', providerId: 're_1' });
    return { ledger, analytics: new MemoryAnalytics(), consent: new MemoryConsent(), id };
  };

  it('maps every handled type to a ledger column + tracking-plan event', () => {
    expect(Object.keys(EVENT_MAP).sort()).toEqual(['email.bounced', 'email.clicked', 'email.complained', 'email.delivered', 'email.opened']);
  });

  it('opened: stamps once, emits Email Opened with ledger context; replay is a no-op', async () => {
    const d = await setup();
    const e = { type: 'email.opened', data: { email_id: 're_1', created_at: '2026-11-02T01:00:00Z' } };
    expect(await handleResendEvent(e, d)).toMatchObject({ handled: true, event: 'Email Opened', sendId: d.id });
    expect(await handleResendEvent(e, d)).toEqual({ handled: false, reason: 'unknown_or_repeat' });
    expect(d.ledger.rows[0].opened_at).toBe('2026-11-02T01:00:00Z');
    expect(d.analytics.events).toHaveLength(1);
    expect(d.analytics.events[0]).toMatchObject({ event: 'Email Opened', props: { message_key: 'weekly_report', variant: 'hero:best_week', period_key: '2026-W44' }, insertId: `${d.id}:opened_at` });
  });

  it('clicked: finds the row by our send_id tag (before provider_id is stored) and records the CTA', async () => {
    const d = await setup();
    d.ledger.rows[0].provider_id = null;
    const e = { type: 'email.clicked', data: { email_id: 're_x', tags: { send_id: d.id }, click: { link: 'https://fitcircle.ai/open?screen=circles&utm_term=growth' } } };
    expect(await handleResendEvent(e, d)).toMatchObject({ handled: true, event: 'Email Clicked' });
    expect(d.analytics.events[0].props.cta).toBe('growth');
  });

  it('hard bounce and complaint suppress further engagement email; soft bounce does not', async () => {
    const d = await setup();
    await handleResendEvent({ type: 'email.bounced', data: { email_id: 're_1', bounce: { type: 'Transient' } } }, d);
    expect(d.consent.suppressed).toEqual([]);
    const d2 = await setup();
    await handleResendEvent({ type: 'email.bounced', data: { email_id: 're_1', bounce: { type: 'Permanent' } } }, d2);
    await handleResendEvent({ type: 'email.complained', data: { email_id: 're_1' } }, d2);
    expect(d2.consent.suppressed).toEqual([
      [USER, 'bounced'],
      [USER, 'complained'],
    ]);
  });

  it('unknown emails and unhandled types are acknowledged without side effects', async () => {
    const d = await setup();
    expect(await handleResendEvent({ type: 'email.sent', data: { email_id: 're_1' } }, d)).toEqual({ handled: false, reason: 'ignored_type' });
    expect(await handleResendEvent({ type: 'email.opened', data: { email_id: 're_unknown' } }, d)).toEqual({ handled: false, reason: 'unknown_or_repeat' });
    expect(d.analytics.events).toHaveLength(0);
  });

  it('tags arrive as an object or a list', () => {
    expect(tagsOf({ type: 'x', data: { tags: { a: '1' } } })).toEqual({ a: '1' });
    expect(tagsOf({ type: 'x', data: { tags: [{ name: 'a', value: '1' }] } })).toEqual({ a: '1' });
    expect(isHardBounce({ type: 'email.bounced', data: {} })).toBe(true);
  });
});
