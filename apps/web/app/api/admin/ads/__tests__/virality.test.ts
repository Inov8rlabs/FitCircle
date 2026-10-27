/**
 * GET /api/admin/ads/virality — end to end over the fake DB: the cohort and
 * test-user exclusion are the overview's, test users are excluded on both the
 * inviter and the invitee side, and the share-sheet gap is stated.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getAdsDb } = await import('@/lib/ads/__tests__/fake-db');
  return { createAdminSupabase: () => getAdsDb().client() };
});

import { AdsFakeDb, setAdsDb } from '@/lib/ads/__tests__/fake-db';
import type { AdsVirality } from '@/lib/ads/types';

import { GET as virality } from '../virality/route';

let db: AdsFakeDb;
const get = async (q: string, auth = 'Bearer vsecret') => {
  const res = await virality(new NextRequest(`https://www.fitcircle.ai/api/admin/ads/virality?${q}`, { headers: { authorization: auth } }));
  return { status: res.status, body: (await res.json()) as { success: boolean; data: AdsVirality } };
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [INVITER, SOLO, PUBLIC_JOINER, TESTER, FRIEND, TEST_FRIEND, DEMO_OWNER, LATE] = [1, 2, 3, 4, 5, 6, 7, 8].map(id);
const DEMO = 'dc69b1b5-9fb6-4f50-8f5f-0f1776af82be';

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-10T16:00:00Z'), toFake: ['Date'] });
  process.env.ADMIN_API_SECRET = 'vsecret';
  process.env.ADS_REPORT_TIMEZONE = 'America/Los_Angeles';
  db = new AdsFakeDb();
  setAdsDb(db);
  db.rows('profiles').push(
    { id: INVITER, email: 'ann.real@gmail.com', is_admin: false, created_at: '2026-10-25T18:00:00Z' },
    { id: SOLO, email: 'sol@icloud.com', is_admin: false, created_at: '2026-10-25T19:00:00Z' },
    { id: PUBLIC_JOINER, email: 'pub@yahoo.com', is_admin: false, created_at: '2026-10-26T18:00:00Z' },
    // Play pre-launch tester shape → excluded from the cohort.
    { id: TESTER, email: 'janedoe.12345@gmail.com', is_admin: false, created_at: '2026-10-26T18:00:00Z' },
    { id: FRIEND, email: 'friend@gmail.com', is_admin: false, created_at: '2026-10-27T18:00:00Z' },
    { id: TEST_FRIEND, email: 'qa@example.com', is_admin: false, created_at: '2026-10-27T18:00:00Z' },
    { id: DEMO_OWNER, email: 'demo@fitcircle.ai', is_admin: true, created_at: '2025-01-01T00:00:00Z' },
    { id: LATE, email: 'late@gmail.com', is_admin: false, created_at: '2026-10-29T18:00:00Z' }
  );
  db.rows('fitcircles').push(
    { id: 'c-ann', visibility: 'private', status: 'active' },
    { id: 'c-solo', visibility: 'private', status: 'upcoming' },
    { id: 'c-tester', visibility: 'private', status: 'active' },
    { id: DEMO, visibility: 'public', status: 'active' }
  );
  const m = (i: number, circle: string, user: string, invitedBy: string | null, joined: string) => ({
    id: `m${i}`,
    fitcircle_id: circle,
    user_id: user,
    invited_by: invitedBy,
    status: 'active',
    joined_at: joined,
    created_at: joined,
    dropped_at: null,
    disqualified_at: null,
  });
  db.rows('fitcircle_members').push(
    m(1, 'c-ann', INVITER, INVITER, '2026-10-25T18:05:00Z'),
    m(2, 'c-ann', FRIEND, INVITER, '2026-10-27T18:10:00Z'),
    m(3, 'c-ann', TEST_FRIEND, INVITER, '2026-10-27T18:10:00Z'),
    m(4, 'c-solo', SOLO, SOLO, '2026-10-25T19:05:00Z'),
    m(5, DEMO, DEMO_OWNER, DEMO_OWNER, '2025-01-01T00:00:00Z'),
    m(6, DEMO, PUBLIC_JOINER, DEMO_OWNER, '2026-10-26T18:05:00Z'),
    // The test user invites a real friend: the test inviter is not in the cohort, so nothing counts.
    m(7, 'c-tester', TESTER, TESTER, '2026-10-26T18:05:00Z'),
    m(8, 'c-tester', LATE, TESTER, '2026-10-29T18:10:00Z')
  );
  db.rows('referral_invites').push(
    { id: 'i1', inviter_id: INVITER, channel: 'sms', status: 'invited', sent_at: '2026-10-26T01:00:00Z', referral_id: null },
    { id: 'i2', inviter_id: INVITER, channel: 'email', status: 'joined', sent_at: '2026-10-26T01:00:00Z', referral_id: 'r1' },
    { id: 'i3', inviter_id: TESTER, channel: 'email', status: 'invited', sent_at: '2026-10-26T19:00:00Z', referral_id: null }
  );
  db.rows('referrals').push({ id: 'r1', invitee_id: FRIEND, inviter_id: INVITER, status: 'pending', attributed_at: '2026-10-27T18:09:00Z', source: 'circle_join' });
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.ADMIN_API_SECRET;
  delete process.env.ADS_REPORT_TIMEZONE;
});

describe('GET /api/admin/ads/virality', () => {
  it('needs the admin secret', async () => {
    expect((await get('start=2026-10-24&end=2026-10-27', 'Bearer nope')).status).toBe(401);
  });

  it('counts the cohort like the overview and excludes test users on both sides', async () => {
    const { status, body } = await get('start=2026-10-24&end=2026-10-27&groupBy=channel');
    expect(status).toBe(200);
    const v = body.data;
    expect(v.window).toEqual({ days: 7, label: '7 days after each sign-up' });
    expect(v.excludedUsers.total).toBe(2); // tester + test friend (both signed up in range)
    const t = v.totals.metrics;
    // Cohort: INVITER, SOLO, PUBLIC_JOINER, FRIEND (a referred friend is a sign-up too).
    expect(t.users).toBe(4);
    expect(t.invited).toBe(1);
    expect(t.invitedBy).toEqual({ sentInvite: 1, referralJoin: 1, circleJoin: 1 });
    expect(t.invitesSent).toBe(2);
    expect(t.invitesJoined).toBe(1);
    expect(t.inviteJoinRate).toBe(0.5);
    expect(t.friendsBroughtIn).toBe(1); // FRIEND once (referral + circle), not TEST_FRIEND
    expect(t.kFactor).toBe(0.25);
    expect(t.sociallyActivated).toBe(2); // INVITER and FRIEND share c-ann
    expect(t.circles).toEqual({ social: 2, soloPrivate: 1, publicOnly: 1, none: 0 });
    expect(t.maturing).toBe(false);
    expect(t.blendedCac).toBeNull();
    expect(v.rows.reduce((s, r) => s + r.metrics.users, 0)).toBe(4);
    expect(v.days.map((d) => d.date)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
  });

  it('states what is and is not counted (share-sheet gap) with the raw row counts', async () => {
    const { body } = await get('start=2026-10-24&end=2026-10-27');
    expect(body.data.coverage.notCounted.join(' ')).toMatch(/Share-sheet/);
    expect(body.data.coverage.counted.join(' ')).toMatch(/referral link or code/);
    expect(body.data.coverage.sourceRows).toEqual({ referralInvites: 2, referrals: 1, circleInviteJoins: 2 });
    expect(body.data.definitions.sociallyActivated).toBeTruthy();
  });

  it('includeTest=1 counts test users on both sides', async () => {
    const t = (await get('start=2026-10-24&end=2026-10-27&includeTest=1')).body.data.totals.metrics;
    expect(t.users).toBe(6);
    expect(t.invited).toBe(2); // the tester's email invite now counts
  });

  it('validates groupBy and the range', async () => {
    expect((await get('start=2026-10-27&end=2026-10-24')).status).toBe(400);
    expect((await get('start=2026-10-24&end=2026-10-27&groupBy=nope')).status).toBe(400);
  });
});
