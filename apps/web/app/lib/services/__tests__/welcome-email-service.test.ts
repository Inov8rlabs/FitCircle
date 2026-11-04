import { describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => { throw new Error('unit tests use the memory ledger'); } }));

import type { SendEmailParams, SendEmailResult } from '../../email/email-service';
import { welcomeEmail, welcomeLinks } from '../../email/welcome-email';
import {
  WELCOME_RETRY_DELAY_MS,
  firstNameOf,
  sendWelcomeOnce,
  welcomeSkipReason,
  type WelcomeLedger,
  type WelcomeProfile,
  type WelcomeRecord,
} from '../welcome-email-service';

const USER = '11111111-1111-4111-8111-111111111111';

class MemoryLedger implements WelcomeLedger {
  constructor(public profile: WelcomeProfile | null = { email: 'maya@gmail.com', isAdmin: false, metadata: null }) {}
  async load() {
    return this.profile ? structuredClone(this.profile) : null;
  }
  async claim(_: string, record: WelcomeRecord) {
    if (!this.profile || this.profile.metadata?.welcome_email) return false;
    this.profile.metadata = { ...(this.profile.metadata ?? {}), welcome_email: record };
    return true;
  }
  async finish(_: string, record: WelcomeRecord) {
    if (this.profile) this.profile.metadata = { ...(this.profile.metadata ?? {}), welcome_email: record };
  }
}

function sender(results: SendEmailResult[]) {
  const calls: SendEmailParams[] = [];
  return {
    calls,
    send: async (p: SendEmailParams) => {
      calls.push(p);
      return results.shift() ?? { success: true, id: 're_x' };
    },
  };
}

const account = { userId: USER, email: 'maya@gmail.com', displayName: 'Maya Rao', method: 'email' as const, platform: 'ios' as const };
const env = {} as NodeJS.ProcessEnv;

describe('sendWelcomeOnce', () => {
  it('claims before sending, sends once, records sent', async () => {
    const ledger = new MemoryLedger();
    const s = sender([{ success: true, id: 're_1' }]);
    expect(await sendWelcomeOnce(account, { ledger, send: s.send, env })).toBe('sent');
    expect(await sendWelcomeOnce(account, { ledger, send: s.send, env })).toBe('already_sent');
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({ to: 'maya@gmail.com', category: 'welcome', idempotencyKey: `welcome/${USER}` });
    expect(ledger.profile!.metadata!.welcome_email).toMatchObject({ status: 'sent', provider_id: 're_1', template: 'welcome@4' });
  });

  it('a concurrent claim loses → no send', async () => {
    const ledger = new MemoryLedger();
    ledger.claim = async () => false;
    const s = sender([]);
    expect(await sendWelcomeOnce(account, { ledger, send: s.send, env })).toBe('already_sent');
    expect(s.calls).toHaveLength(0);
  });

  it('retries a transient Resend error once with the same idempotency key', async () => {
    const ledger = new MemoryLedger();
    const sleep = vi.fn(async () => {});
    const s = sender([{ success: false, errorName: 'rate_limit_exceeded', error: 'slow down' }, { success: true, id: 're_2' }]);
    expect(await sendWelcomeOnce(account, { ledger, send: s.send, env, sleep })).toBe('sent');
    expect(sleep).toHaveBeenCalledWith(WELCOME_RETRY_DELAY_MS);
    expect(s.calls.map((c) => c.idempotencyKey)).toEqual([`welcome/${USER}`, `welcome/${USER}`]);
  });

  it('a permanent failure is recorded as failed and not retried', async () => {
    const ledger = new MemoryLedger();
    const s = sender([{ success: false, errorName: 'validation_error', error: 'bad' }]);
    expect(await sendWelcomeOnce(account, { ledger, send: s.send, env, sleep: async () => {} })).toBe('failed');
    expect(s.calls).toHaveLength(1);
    expect(ledger.profile!.metadata!.welcome_email).toMatchObject({ status: 'failed', reason: 'validation_error' });
  });

  it('suppressed address (bounced / complained) → recorded suppressed', async () => {
    const ledger = new MemoryLedger();
    const s = sender([{ success: false, errorName: 'suppressed', error: 'All recipients are suppressed' }]);
    expect(await sendWelcomeOnce(account, { ledger, send: s.send, env })).toBe('suppressed');
    expect(ledger.profile!.metadata!.welcome_email.status).toBe('suppressed');
  });

  it('an exception in the ledger never escapes', async () => {
    const ledger = new MemoryLedger();
    ledger.load = async () => {
      throw new Error('db down');
    };
    expect(await sendWelcomeOnce(account, { ledger, send: sender([]).send, env })).toBe('failed');
  });

  it('missing profile row: still sends (idempotency key guards a retry), records nothing', async () => {
    const ledger = new MemoryLedger(null);
    const s = sender([]);
    expect(await sendWelcomeOnce(account, { ledger, send: s.send, env })).toBe('sent');
    expect(s.calls).toHaveLength(1);
  });

  it('no email / disabled', async () => {
    expect(await sendWelcomeOnce({ ...account, email: null }, { ledger: new MemoryLedger(), send: sender([]).send, env })).toBe('no_email');
    expect(await sendWelcomeOnce(account, { ledger: new MemoryLedger(), send: sender([]).send, env: { WELCOME_EMAIL_ENABLED: 'off' } as any })).toBe('disabled');
  });

  it('robots and test accounts are skipped (and recorded so they never get one later); team members still get it', async () => {
    const flagged = new MemoryLedger({ email: 'x@gmail.com', isAdmin: false, metadata: { test_device: { at: 'x' } } });
    expect(await sendWelcomeOnce(account, { ledger: flagged, send: sender([]).send, env })).toBe('test_account');
    expect(flagged.profile!.metadata!.welcome_email).toMatchObject({ status: 'skipped', reason: 'test:test_device' });

    expect(welcomeSkipReason({ email: 'a@cloudtestlabaccounts.com' }, null, env)).toBe('test:test_lab');
    expect(welcomeSkipReason({ email: 'fitcircle.user@gmail.com' }, null, env)).toBe('test:review');
    expect(welcomeSkipReason({ email: 'janedoe.48213@gmail.com' }, null, env)).toBe('test:play_testers');
    expect(welcomeSkipReason({ email: 'qa@test.com' }, null, env)).toBe('test:qa');
    expect(welcomeSkipReason({ email: 'x@gmail.com', testDevice: true }, null, env)).toBe('test:test_device');
    expect(welcomeSkipReason({ email: 'ani@inov8rlabs.com' }, null, env)).toBeNull(); // internal → sent (QA)
    expect(welcomeSkipReason({ email: 'maya@gmail.com' }, null, env)).toBeNull();
  });

  it('first names: real names only, never a username', () => {
    expect(firstNameOf('Maya Rao')).toBe('Maya');
    expect(firstNameOf('josé')).toBe('josé');
    expect(firstNameOf('maya_r42')).toBeNull();
    expect(firstNameOf('')).toBeNull();
  });
});

describe('welcome email content', () => {
  it('app sign-ups link to fitcircle.ai/open (universal link, store fallback) with UTM per step', () => {
    const l = welcomeLinks('ios');
    for (const url of [l.logMeal, l.circles, l.fitzy]) expect(url).toMatch(/^https:\/\/fitcircle\.ai\/open\?.*utm_source=email.*utm_campaign=welcome/);
    expect(l.logMeal).toContain('utm_content=log_meal');
    expect(l.getApp).toBeNull();
    expect(welcomeLinks(null).logMeal).toMatch(/^https:\/\/fitcircle\.ai\/open\?/);
  });

  it('web sign-ups link to the web app pages, and Fitzy to the app download', () => {
    const l = welcomeLinks('web');
    expect(l.logMeal).toMatch(/^https:\/\/www\.fitcircle\.ai\/food-log\?/);
    expect(l.circles).toMatch(/^https:\/\/www\.fitcircle\.ai\/fitcircles\?/);
    expect(l.fitzy).toMatch(/^https:\/\/www\.fitcircle\.ai\/get\?/);
    expect(l.getApp).toMatch(/^https:\/\/www\.fitcircle\.ai\/get\?/);
  });

  it('three real next steps, no emoji, unsubscribe + postal address in the footer, plain-text part', () => {
    const r = welcomeEmail({ firstName: 'Maya', platform: 'android', unsubscribeUrl: 'https://www.fitcircle.ai/api/campaigns/unsubscribe?t=x', postalAddress: '1 Main St, Austin TX' });
    expect(r.subject).toBe('Welcome to FitCircle, Maya');
    for (const step of ['Log your first meal', 'Join or start a circle', 'Meet Fitzy']) {
      expect(r.html).toContain(step);
      expect(r.text).toContain(step);
    }
    expect(r.html).toContain('Unsubscribe from FitCircle tips and updates');
    expect(r.html).toContain('1 Main St, Austin TX');
    expect(r.html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(r.text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(r.html.length).toBeLessThan(60_000); // far below Gmail's 102 KB clip
    expect(welcomeEmail({ firstName: null, platform: null }).subject).toBe('Welcome to FitCircle');
  });

  it('escapes names', () => {
    const r = welcomeEmail({ firstName: '<b>x', platform: 'ios' });
    expect(r.html).not.toContain('<b>x');
  });
});
