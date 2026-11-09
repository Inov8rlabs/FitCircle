/**
 * GET /api/admin/retention — D1/D7 by platform and source from app_opens.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { GET } from '../route';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
vi.mock('@/lib/campaigns/admin-auth', () => ({
  requireAdmin: async (req: Request) => {
    if (req.headers.get('authorization') !== 'Bearer s3cret') {
      const { CampaignError } = await import('@/lib/campaigns/http');
      throw new CampaignError(401, 'UNAUTHORIZED', 'Admin access required');
    }
    return { userId: null, actorEmail: null, viaSecret: true };
  },
}));
const cohort = vi.hoisted(() => ({ users: [] as any[] }));
vi.mock('@/lib/ads/services/report-service', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    AdsReportService: { reportCohort: async () => ({ cohort: cohort.users, excluded: { total: 2, byReason: { play_testers: 2 }, included: false }, duplicatesDropped: 0 }) },
  };
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let db: FakeSupabase;

beforeEach(() => {
  cohort.users = [
    { userId: A, signupAt: '2026-11-02T18:00:00Z', signupDate: '2026-11-02', attribution: { channel: 'apple_ads', platform: 'ios' }, firstActivityAt: null, events: [] },
    { userId: B, signupAt: '2026-11-02T18:00:00Z', signupDate: '2026-11-02', attribution: { channel: 'google_ads', platform: 'android' }, firstActivityAt: null, events: [] },
  ];
  db = new FakeSupabase({
    app_opens: {
      rows: [
        { user_id: A, local_date: '2026-11-02', platform: 'ios', first_open_at: '2026-11-01T12:00:00Z', timezone: 'America/Chicago' },
        { user_id: A, local_date: '2026-11-03', platform: 'ios', first_open_at: '2026-11-03T14:00:00Z', timezone: 'America/Chicago' },
        { user_id: B, local_date: '2026-11-02', platform: 'android', first_open_at: '2026-11-02T18:00:00Z', timezone: 'America/Chicago' },
      ],
    },
    profiles: { rows: [{ id: A, timezone: 'America/Chicago' }, { id: B, timezone: 'UTC' }] },
    push_tokens: { rows: [] },
    referrals: { rows: [] },
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
});

const get = (qs = 'start=2026-11-01&end=2026-11-03', auth = 'Bearer s3cret') =>
  GET(new NextRequest(`https://www.fitcircle.ai/api/admin/retention?${qs}`, { headers: { authorization: auth } }));

describe('GET /api/admin/retention', () => {
  it('401 without the admin secret', async () => {
    expect((await get(undefined, 'Bearer nope')).status).toBe(401);
  });

  it('D1 by platform and by source, with definitions and the signal start', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.signalSince).toBe('2026-11-01T12:00:00Z');
    expect(data.totals).toMatchObject({ signups: 2, d1Eligible: 2, d1Retained: 1, d1Rate: 0.5 });
    expect(data.byPlatform).toEqual(
      expect.arrayContaining([expect.objectContaining({ platform: 'ios', d1Rate: 1 }), expect.objectContaining({ platform: 'android', d1Rate: 0 })])
    );
    expect(data.bySource.map((s: any) => s.source).sort()).toEqual(['apple_ads', 'google_ads']);
    expect(data.definitions.d1).toMatch(/local day after the sign-up day/);
    expect(data.excludedUsers.total).toBe(2);
  });

  it('referral invitees are reported as source "invite"', async () => {
    db.getRows('referrals').push({ id: 'r1', invitee_id: B });
    const { data } = await (await get()).json();
    expect(data.bySource.map((s: any) => s.source).sort()).toEqual(['apple_ads', 'invite']);
  });
});
