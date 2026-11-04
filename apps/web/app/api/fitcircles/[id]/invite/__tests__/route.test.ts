import { beforeEach, describe, expect, it, vi } from 'vitest';

const mail = vi.hoisted(() => ({
  single: vi.fn(async (_: any) => ({ success: true })),
  batch: vi.fn(async (list: any[]) => ({ success: list.length, failed: 0, suppressed: 0, errors: [] as string[] })),
}));
vi.mock('@/lib/email/email-service', () => ({
  sendInvitationEmail: (p: any) => mail.single(p),
  sendBatchInvitationEmails: (l: any[]) => mail.batch(l),
}));

const optouts = vi.hoisted(() => ({ hashes: [] as string[] }));
vi.mock('@/lib/supabase-admin', () => ({
  createAdminSupabase: () => ({
    from: () => ({
      select: () => ({
        in: async (_col: string, values: string[]) => ({ data: values.filter((v) => optouts.hashes.includes(v)).map((email_hash) => ({ email_hash })), error: null }),
      }),
    }),
  }),
}));

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'maya@example.com' } }, error: null }) },
    from: (table: string) => {
      if (table === 'fitcircles') {
        const row = { id: 'c1', name: 'Morning Movers', type: 'step_count', start_date: '2026-11-01', end_date: '2026-12-01', invite_code: 'FITAB12CD', creator_id: 'u1', profiles: { display_name: 'Maya' } };
        const chain: any = { select: () => chain, eq: () => chain, single: async () => ({ data: row, error: null }) };
        return chain;
      }
      const chain: any = { select: () => chain, eq: () => chain, then: (r: any) => r({ count: 2 }) };
      return chain;
    },
  }),
}));

import { MemorySuppressionStore, setSuppressionStoreForTests } from '@/lib/email/suppression';
import { contactHash } from '@/lib/services/referral-invite-service';

import { POST } from '../route';

const call = (body: unknown) =>
  POST(new Request('http://localhost/api/fitcircles/c1/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as any, {
    params: Promise.resolve({ id: 'c1' }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  optouts.hashes = [];
});

describe('POST /api/fitcircles/[id]/invite — email validation', () => {
  it('422s a typo with a suggestion and sends nothing', async () => {
    const res = await call({ emails: ['ok@example.com', 'r.celeste1957@yahoo.comr', 'sam@gmial.com'] });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'INVALID_EMAIL',
      message: "That email doesn't look right.",
      invalidEmails: [
        { index: 1, email: 'r.celeste1957@yahoo.comr', reason: 'unknown_tld', suggestion: 'r.celeste1957@yahoo.com' },
        { index: 2, email: 'sam@gmial.com', reason: 'typo_likely', suggestion: 'sam@gmail.com' },
      ],
    });
    expect(mail.batch).not.toHaveBeenCalled();
  });

  it('422s a single bad address', async () => {
    const res = await call({ email: 'sam@gmail.con' });
    expect(res.status).toBe(422);
    expect((await res.json()).invalidEmails[0]).toMatchObject({ index: 0, reason: 'unknown_tld', suggestion: 'sam@gmail.com' });
    expect(mail.single).not.toHaveBeenCalled();
  });

  it('sends valid addresses (domain lower-cased) and skips suppressed ones', async () => {
    optouts.hashes = [contactHash('email', 'gone@example.com')];
    const res = await call({ emails: [' Sam@Example.COM ', 'gone@example.com'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, sent: 1, skipped: 1 });
    expect(mail.batch.mock.calls[0][0].map((i: any) => i.to)).toEqual(['Sam@example.com']);
  });

  it('skips hard-bounced / complained addresses (suppression list)', async () => {
    setSuppressionStoreForTests(new MemorySuppressionStore().add('gone@example.org', 'complaint'));
    try {
      const res = await call({ emails: ['ok@example.com', 'gone@example.org'] });
      expect(await res.json()).toMatchObject({ success: true, sent: 1, skipped: 1 });
      expect(mail.batch.mock.calls[0][0].map((i: any) => i.to)).toEqual(['ok@example.com']);
      const single = await call({ email: 'gone@example.org' });
      expect(await single.json()).toMatchObject({ success: true, sent: 0, skipped: 1 });
      expect(mail.single).not.toHaveBeenCalled();
    } finally {
      setSuppressionStoreForTests(null);
    }
  });

  it('still 400s a malformed body', async () => {
    const res = await call({ emails: [] });
    expect(res.status).toBe(400);
  });
});
