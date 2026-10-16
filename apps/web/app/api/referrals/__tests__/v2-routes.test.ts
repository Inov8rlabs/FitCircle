import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferralError } from '@/lib/referrals/types';

const getUser = vi.fn();
const inviteContacts = vi.fn();
const nudge = vi.fn();

vi.mock('@/lib/supabase-server', () => ({
  createServerSupabase: async () => ({ auth: { getUser: () => getUser() } }),
}));
vi.mock('@/lib/services/referral-service', () => ({
  ReferralService: {
    inviteContacts: (...a: unknown[]) => inviteContacts(...a),
    nudge: (...a: unknown[]) => nudge(...a),
  },
}));

import { POST as INVITES } from '../me/invites/route';
import { POST as NUDGE } from '../me/nudge/route';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'me@x.com' };
const UUID = '22222222-2222-4222-8222-222222222222';

const post = (body: unknown) =>
  new Request('http://localhost/api/referrals/me/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: USER }, error: null });
});

describe('POST /api/referrals/me/invites', () => {
  it('401s without a session', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await INVITES(post({ contacts: [{ email: 'a@x.com' }] }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
    expect(inviteContacts).not.toHaveBeenCalled();
  });

  it('passes contacts through to the service (shared schema) and returns the envelope', async () => {
    const result = { results: [{ contact: 'sa•••@x.com', channel: 'email', name: 'Sam', status: 'sent', inviteId: UUID }], sentCount: 1 };
    inviteContacts.mockResolvedValue(result);
    const contacts = [{ email: 'sam@x.com', name: 'Sam', channel: 'email' }, { phone: '+14165550123', channel: 'sms' }];
    const res = await INVITES(post({ contacts, circleId: UUID }));
    expect(res.status).toBe(200);
    expect(inviteContacts).toHaveBeenCalledWith(USER.id, { contacts, circleId: UUID });
    const body = await res.json();
    expect(body).toMatchObject({ success: true, data: result, error: null });
  });

  it('treats circleId:null as not sent', async () => {
    inviteContacts.mockResolvedValue({ results: [], sentCount: 0 });
    await INVITES(post({ contacts: [{ email: 'a@x.com' }], circleId: null }));
    expect(inviteContacts).toHaveBeenCalledWith(USER.id, { contacts: [{ email: 'a@x.com' }], circleId: null });
  });

  it.each([
    ['no contacts', { contacts: [] }],
    ['more than 10', { contacts: Array.from({ length: 11 }, (_, i) => ({ email: `p${i}@x.com` })) }],
    ['bad channel', { contacts: [{ email: 'a@x.com', channel: 'fax' }] }],
    ['bad circleId', { contacts: [{ email: 'a@x.com' }], circleId: 'x' }],
    ['not JSON', 'not-json'],
  ])('400s on %s', async (_label, body) => {
    const res = await INVITES(post(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    expect(inviteContacts).not.toHaveBeenCalled();
  });

  it('maps ReferralError to its status', async () => {
    inviteContacts.mockRejectedValue(new ReferralError('PROGRAM_DISABLED', 'off'));
    const res = await INVITES(post({ contacts: [{ email: 'a@x.com' }] }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('PROGRAM_DISABLED');
  });

  it('500s on unexpected errors', async () => {
    inviteContacts.mockRejectedValue(new Error('boom'));
    const res = await INVITES(post({ contacts: [{ email: 'a@x.com' }] }));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/referrals/me/nudge', () => {
  it('nudges an invite', async () => {
    const result = { status: 'sent', nextAt: null, remaining: 1, smsBody: 'Hey!' };
    nudge.mockResolvedValue(result);
    const res = await NUDGE(post({ inviteId: UUID }));
    expect(res.status).toBe(200);
    expect(nudge).toHaveBeenCalledWith(USER.id, { inviteId: UUID });
    expect((await res.json()).data).toEqual(result);
  });

  it('nudges a referral', async () => {
    nudge.mockResolvedValue({ status: 'too_soon', nextAt: '2026-10-18T00:00:00Z', remaining: 2, smsBody: null });
    await NUDGE(post({ referralId: UUID }));
    expect(nudge).toHaveBeenCalledWith(USER.id, { referralId: UUID });
  });

  it.each([
    ['empty', {}],
    ['both ids', { inviteId: UUID, referralId: UUID }],
    ['bad uuid', { inviteId: 'x' }],
  ])('400s on %s', async (_label, body) => {
    const res = await NUDGE(post(body));
    expect(res.status).toBe(400);
    expect(nudge).not.toHaveBeenCalled();
  });

  it('401s without a session', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await NUDGE(post({ inviteId: UUID }))).status).toBe(401);
  });
});
