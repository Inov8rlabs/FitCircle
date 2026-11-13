/**
 * runSecurityAlerts delivery: an alert reaches a human by email; the cooldown is saved only
 * after Resend accepted the email (a failed send retries next run and is a Sentry error).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  emailOk: true,
  emails: [] as any[],
  upserts: [] as any[],
  sentry: [] as any[],
  rows: [] as any[],
}));

vi.mock('@sentry/nextjs', () => ({ captureMessage: (m: string, ctx: any) => void h.sentry.push({ m, ...ctx }) }));
vi.mock('@/lib/email/email-service', () => ({
  sendEmail: async (mail: any) => (h.emails.push(mail), h.emailOk ? { success: true, id: 're_1' } : { success: false, error: 'boom', errorName: 'application_error' }),
}));
vi.mock('@/lib/analytics/amplitude-server', () => ({ sendEvents: async () => true }));
vi.mock('@/lib/supabase-admin', () => {
  const q: any = {
    select: () => q,
    gte: () => q,
    lt: () => q,
    eq: () => q,
    order: () => q,
    limit: async () => ({ data: [], error: null }),
    range: async () => ({ data: h.rows, error: null }),
    then: (res: any) => res({ data: [], error: null }),
    upsert: async (rows: any) => (h.upserts.push(rows), { error: null }),
  };
  return { createAdminSupabase: () => ({ from: () => q }) };
});

import { alertRecipients, runSecurityAlerts } from '../alerts';

const NOW = new Date('2026-11-13T12:05:00Z');
const incident = () =>
  Array.from({ length: 6 }, (_, i) => ({ created_at: new Date(NOW.getTime() - (i + 1) * 3_600_000).toISOString(), kind: 'integrity', result: 'fail_open', reason: 'unusable', action: 'login', count: 1 }));

beforeEach(() => {
  Object.assign(h, { emailOk: true, emails: [], upserts: [], sentry: [], rows: incident() });
});

describe('runSecurityAlerts', () => {
  it('emails the security recipients about integrity_broken and saves the 6 h cooldown', async () => {
    const r = await runSecurityAlerts(NOW);
    expect(r.sent).toContain('integrity_broken');
    expect(r.emailed).toBe(true);
    expect(h.emails[0]).toMatchObject({ category: 'security_alert', to: alertRecipients() });
    expect(h.emails[0].subject).toContain('integrity verification is broken');
    expect(h.upserts.flat().map((u: any) => u.signal)).toContain('integrity_broken');
  });

  it('a failed email saves no cooldown (retried next run) and is a Sentry error', async () => {
    h.emailOk = false;
    const r = await runSecurityAlerts(NOW);
    expect(r.emailed).toBe(false);
    expect(h.upserts).toEqual([]);
    expect(h.sentry).toContainEqual(expect.objectContaining({ m: 'security_alert_email_failed', level: 'error' }));
  });

  it('recipients: SECURITY_ALERT_RECIPIENTS, else ADS_REPORT_RECIPIENTS, else the ads report default', () => {
    expect(alertRecipients({ SECURITY_ALERT_RECIPIENTS: 'a@x.co, b@x.co' })).toEqual(['a@x.co', 'b@x.co']);
    expect(alertRecipients({ ADS_REPORT_RECIPIENTS: 'c@x.co' })).toEqual(['c@x.co']);
    expect(alertRecipients({}).length).toBeGreaterThan(0);
  });
});
