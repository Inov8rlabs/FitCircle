/**
 * onUserCreated → welcome email: sent once per account (ledger claim),
 * survives a missing ledger, honours the kill switch, never throws.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import { sendWelcome } from '../../services/user-created-hook';

import { MemoryAnalytics, MemoryLedger, USER } from './fixtures';

const deps = () => ({
  ledger: new MemoryLedger(),
  analytics: new MemoryAnalytics(),
  send: vi.fn(async (_p: any) => ({ success: true as const, id: 're_w1' })),
});

afterEach(() => {
  delete process.env.WELCOME_EMAIL_ENABLED;
});

describe('sendWelcome', () => {
  it('sends the welcome email once, tagged and attributed', async () => {
    const d = deps();
    expect(await sendWelcome({ userId: USER, email: 'sam@example.com', displayName: 'Sam Lee', method: 'apple' }, d)).toBe('sent');
    expect(await sendWelcome({ userId: USER, email: 'sam@example.com', displayName: 'Sam Lee', method: 'apple' }, d)).toBe('already_sent');
    expect(d.send).toHaveBeenCalledTimes(1);
    const p = d.send.mock.calls[0][0];
    expect(p.subject).toBe('Welcome to FitCircle, Sam');
    expect(p.tags).toMatchObject({ message_key: 'welcome', medium: 'transactional' });
    expect(p.idempotencyKey).toBe(`welcome/${USER}`);
    expect(p.html).toContain('utm_medium=transactional');
    expect(p.headers).toBeUndefined(); // transactional: no List-Unsubscribe
    expect(d.ledger.rows[0]).toMatchObject({ message_key: 'welcome', period_key: 'once', status: 'sent', provider_id: 're_w1' });
    expect(d.analytics.events[0]).toMatchObject({ event: 'Email Sent', props: { message_key: 'welcome', medium: 'transactional', variant: 'method:apple' } });
  });

  it('still sends before migration 119 (ledger unavailable)', async () => {
    const d = deps();
    d.ledger.available = false;
    expect(await sendWelcome({ userId: USER, email: 'sam@example.com', method: 'email' }, d)).toBe('sent');
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it('no email / kill switch → nothing sent', async () => {
    const d = deps();
    expect(await sendWelcome({ userId: USER, email: null, method: 'google' }, d)).toBe('no_email');
    process.env.WELCOME_EMAIL_ENABLED = 'false';
    expect(await sendWelcome({ userId: USER, email: 'a@b.co', method: 'google' }, d)).toBe('disabled');
    expect(d.send).not.toHaveBeenCalled();
  });

  it('a transient failure releases the claim so a retry can send', async () => {
    const d = deps();
    d.send.mockResolvedValueOnce({ success: false, error: 'rate_limit_exceeded: x' } as any);
    expect(await sendWelcome({ userId: USER, email: 'sam@example.com', method: 'email' }, d)).toBe('failed');
    expect(d.ledger.rows).toHaveLength(0);
    expect(await sendWelcome({ userId: USER, email: 'sam@example.com', method: 'email' }, d)).toBe('sent');
  });
});
