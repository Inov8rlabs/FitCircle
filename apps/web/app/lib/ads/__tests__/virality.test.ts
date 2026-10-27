/**
 * Virality rules (lib/ads/virality.ts, docs/ADS_METRICS_METHODOLOGY.md §8):
 * each route that counts as "invited", each thing that must NOT count, friend
 * de-duplication, socially activated overlap, slices adding up, maturing, CAC.
 */
import { describe, expect, it } from 'vitest';

import type { CohortUser } from '../metrics';
import type { AttributionRow } from '../types';
import {
  buildVirality,
  computeVirality,
  membershipInterval,
  PUBLIC_CIRCLE_IDS,
  type ViralityFacts,
  type ViralityMemberRow,
  viralityOutcomes,
} from '../virality';

const SIGNUP = '2026-10-20T15:00:00Z';
const at = (days: number, hours = 0) => new Date(Date.parse(SIGNUP) + days * 86_400_000 + hours * 3_600_000).toISOString();
const DEMO = [...PUBLIC_CIRCLE_IDS][0];

const attr = (userId: string, channel: AttributionRow['channel'], campaign: string | null = null): AttributionRow => ({
  user_id: userId,
  channel,
  platform: 'ios',
  source: 'apple_search_ads',
  campaign_external_id: campaign,
  ad_group_external_id: null,
  keyword_external_id: null,
  ad_external_id: null,
  click_at: null,
  country: 'US',
  is_test: false,
  raw: null,
});

const user = (id: string, over: Partial<CohortUser> = {}): CohortUser => ({
  userId: id,
  signupAt: SIGNUP,
  signupDate: '2026-10-20',
  attribution: null,
  firstActivityAt: null,
  events: [],
  ...over,
});

let seq = 0;
const member = (circle: string, userId: string, over: Partial<ViralityMemberRow> = {}): ViralityMemberRow => ({
  id: `m${++seq}`,
  fitcircle_id: circle,
  user_id: userId,
  invited_by: null,
  status: 'active',
  joined_at: at(1),
  created_at: at(1),
  dropped_at: null,
  ...over,
});

function facts(over: Partial<ViralityFacts> = {}): ViralityFacts {
  return {
    invites: [],
    referrals: [],
    members: [],
    circles: [
      { id: 'priv', visibility: 'private', status: 'active' },
      { id: 'inv', visibility: 'invite_only', status: 'upcoming' },
      { id: 'pub', visibility: 'public', status: 'active' },
      { id: DEMO, visibility: 'public', status: 'active' },
      { id: 'dead', visibility: 'private', status: 'cancelled' },
    ],
    people: new Map([
      ['F1', { createdAt: at(1), real: true }],
      ['F2', { createdAt: at(2), real: true }],
      ['OLD', { createdAt: '2025-01-01T00:00:00Z', real: true }],
      ['TEST', { createdAt: at(1), real: false }],
      ['A', { createdAt: SIGNUP, real: true }],
      ['B', { createdAt: SIGNUP, real: true }],
    ]),
    ...over,
  };
}

const one = (f: ViralityFacts, u: CohortUser = user('A')) => viralityOutcomes([u], f).get(u.userId)!;

describe('invited (7-day window, DB-visible routes)', () => {
  it('nobody invited → all zero, solo private circle is not social', () => {
    const o = one(facts({ members: [member('priv', 'A', { invited_by: 'A', role: 'owner' } as any)] }));
    expect(o).toMatchObject({ invited: false, invitesSent: 0, friends: 0, sociallyActivated: false, circleState: 'soloPrivate' });
  });

  it('a sent email/SMS invite counts; a failed one does not', () => {
    const f = facts({
      invites: [
        { id: 'i1', inviter_id: 'A', status: 'invited', sent_at: at(2), referral_id: null },
        { id: 'i2', inviter_id: 'A', status: 'failed', sent_at: at(2), referral_id: null },
      ],
    });
    expect(one(f)).toMatchObject({ invited: true, invitesSent: 1, invitesFailed: 1, routes: { sentInvite: true, referralJoin: false, circleJoin: false } });
    const onlyFailed = facts({ invites: [{ id: 'i2', inviter_id: 'A', status: 'failed', sent_at: at(2), referral_id: null }] });
    expect(one(onlyFailed).invited).toBe(false);
  });

  it('window is [sign-up − 1 min, sign-up + 7 d)', () => {
    const inv = (sent: string) => facts({ invites: [{ id: 'i', inviter_id: 'A', status: 'invited', sent_at: sent, referral_id: null }] });
    expect(one(inv(at(7) /* exactly 7 d */)).invited).toBe(false);
    expect(one(inv(new Date(Date.parse(at(7)) - 1000).toISOString())).invited).toBe(true);
    expect(one(inv(new Date(Date.parse(SIGNUP) - 30_000).toISOString())).invited).toBe(true);
    expect(one(inv(new Date(Date.parse(SIGNUP) - 120_000).toISOString())).invited).toBe(false);
  });

  it('a referral join counts only when valid and the invitee is real', () => {
    const ref = (status: string, invitee = 'F1') => facts({ referrals: [{ id: 'r', invitee_id: invitee, inviter_id: 'A', status, attributed_at: at(3) }] });
    expect(one(ref('pending'))).toMatchObject({ invited: true, friends: 1, routes: { referralJoin: true } });
    expect(one(ref('qualified')).friends).toBe(1);
    for (const s of ['rejected', 'revoked', 'review']) expect(one(ref(s)), s).toMatchObject({ invited: false, friends: 0 });
    expect(one(ref('pending', 'TEST'))).toMatchObject({ invited: false, friends: 0 });
    expect(one(ref('pending', 'GHOST' /* deleted profile */))).toMatchObject({ invited: false, friends: 0 });
  });

  it('circle invite: someone else joined a non-public circle with invited_by = them; self rows, public, dead circles and test joiners do not count', () => {
    const base = [member('priv', 'A', { invited_by: 'A' })];
    expect(one(facts({ members: [...base, member('priv', 'F1', { invited_by: 'A', joined_at: at(2) })] }))).toMatchObject({ invited: true, friends: 1, routes: { circleJoin: true } });
    expect(one(facts({ members: [member('pub', 'F1', { invited_by: 'A' })] })).invited).toBe(false);
    expect(one(facts({ members: [member(DEMO, 'F1', { invited_by: 'A' })] })).invited).toBe(false);
    expect(one(facts({ members: [member('dead', 'F1', { invited_by: 'A' })] })).invited).toBe(false);
    expect(one(facts({ members: [...base, member('priv', 'TEST', { invited_by: 'A' })] })).invited).toBe(false);
    expect(one(facts({ members: base })).invited).toBe(false);
  });

  it('an unknown circle (not loaded) never counts as private', () => {
    expect(one(facts({ members: [member('ghost', 'A'), member('ghost', 'F1', { invited_by: 'A' })] }))).toMatchObject({ invited: false, sociallyActivated: false, circleState: 'none' });
  });
});

describe('invite join rate', () => {
  it('joined/qualified invites whose referral resolves to a real invitee', () => {
    const f = facts({
      referrals: [
        { id: 'r1', invitee_id: 'F1', inviter_id: 'A', status: 'pending', attributed_at: at(3) },
        { id: 'r2', invitee_id: 'TEST', inviter_id: 'A', status: 'pending', attributed_at: at(3) },
      ],
      invites: [
        { id: 'i1', inviter_id: 'A', status: 'joined', sent_at: at(1), referral_id: 'r1' },
        { id: 'i2', inviter_id: 'A', status: 'joined', sent_at: at(1), referral_id: 'r2' },
        { id: 'i3', inviter_id: 'A', status: 'joined', sent_at: at(1), referral_id: null },
        { id: 'i4', inviter_id: 'A', status: 'invited', sent_at: at(1), referral_id: null },
      ],
    });
    const o = one(f);
    expect(o.invitesSent).toBe(4);
    expect(o.invitesJoined).toBe(1);
    const m = computeVirality([o], { spend: 0, maturing: false });
    expect(m.inviteJoinRate).toBe(0.25);
    expect(m.invitesPerInviter).toBe(4);
  });
});

describe('friends brought in', () => {
  it('a friend counts once across the cohort: referral inviter wins over circle inviter', () => {
    const f = facts({
      referrals: [{ id: 'r', invitee_id: 'F1', inviter_id: 'B', status: 'pending', attributed_at: at(3) }],
      members: [member('priv', 'A'), member('priv', 'F1', { invited_by: 'A', joined_at: at(2) })],
    });
    const out = viralityOutcomes([user('A'), user('B')], f);
    expect(out.get('A')!.friends).toBe(0);
    expect(out.get('A')!.invited).toBe(true); // still an invite by A
    expect(out.get('B')!.friends).toBe(1);
    expect(computeVirality([...out.values()], { spend: 0, maturing: false }).friendsBroughtIn).toBe(1);
  });

  it('an account older than the inviter is not "brought in" (still an invite)', () => {
    const o = one(facts({ members: [member('priv', 'A'), member('priv', 'OLD', { invited_by: 'A', joined_at: at(2) })] }));
    expect(o).toMatchObject({ invited: true, friends: 0, friendsToDate: 0 });
  });

  it('joins after the window count to date but not in K (7 d)', () => {
    const o = one(facts({ referrals: [{ id: 'r', invitee_id: 'F2', inviter_id: 'A', status: 'qualified', attributed_at: at(9) }] }));
    expect(o).toMatchObject({ invited: false, friends: 0, friendsToDate: 1 });
    const m = computeVirality([o, one(facts(), user('B'))], { spend: 0, maturing: false });
    expect(m.kFactor).toBe(0);
    expect(m.kFactorToDate).toBe(0.5);
  });
});

describe('socially activated', () => {
  it('needs another real member in a non-public circle at the same time, within 7 days', () => {
    const priv = (other: Partial<ViralityMemberRow>, otherId = 'F1') => facts({ members: [member('priv', 'A', { joined_at: at(0, 1) }), member('priv', otherId, other)] });
    expect(one(priv({ joined_at: at(3) }))).toMatchObject({ sociallyActivated: true, circleState: 'social' });
    expect(one(priv({ joined_at: at(3) }, 'TEST')).sociallyActivated).toBe(false);
    expect(one(priv({ joined_at: at(8) })).sociallyActivated).toBe(false); // joined after the window
    expect(one(priv({ joined_at: '2026-01-01T00:00:00Z', status: 'dropped', dropped_at: at(0, -2) })).sociallyActivated).toBe(false); // left before A joined
    expect(one(priv({ joined_at: '2026-01-01T00:00:00Z', status: 'dropped', dropped_at: at(2) })).sociallyActivated).toBe(true); // overlapped 2 days
    expect(one(priv({ status: 'pending', joined_at: at(1) })).sociallyActivated).toBe(false); // never active
  });

  it('public circles (incl. the demo circle) never count, and set circleState publicOnly', () => {
    const f = facts({ members: [member(DEMO, 'A'), member(DEMO, 'F1'), member('pub', 'A'), member('pub', 'F2')] });
    expect(one(f)).toMatchObject({ sociallyActivated: false, circleState: 'publicOnly' });
  });

  it('A who left the circle before anyone joined is solo, not social', () => {
    const f = facts({ members: [member('priv', 'A', { joined_at: at(0, 1), status: 'dropped', dropped_at: at(1) }), member('priv', 'F1', { joined_at: at(2) })] });
    expect(one(f)).toMatchObject({ sociallyActivated: false, circleState: 'soloPrivate' });
  });

  it('membership interval: open while active/completed; a dropped row with no date never overlaps', () => {
    expect(membershipInterval(member('priv', 'A', { status: 'active' }))[1]).toBe(Infinity);
    const [s, e] = membershipInterval(member('priv', 'A', { status: 'dropped', dropped_at: null }));
    expect(e).toBe(s);
  });
});

describe('slicing, maturing, blended CAC', () => {
  const cohort = [
    user('A', { attribution: attr('A', 'apple_ads', 'C1') }),
    user('B', { attribution: attr('B', 'organic') }),
    user('C', { attribution: attr('C', 'apple_ads', 'C1'), signupDate: '2026-10-21', signupAt: at(1) }),
    user('D', { testReason: null }),
  ];
  const f = facts({
    referrals: [
      { id: 'r1', invitee_id: 'F1', inviter_id: 'A', status: 'pending', attributed_at: at(2) },
      { id: 'r2', invitee_id: 'F2', inviter_id: 'B', status: 'pending', attributed_at: at(3) },
    ],
    members: [member('priv', 'B'), member('priv', 'F2', { invited_by: 'B', joined_at: at(3) })],
  });
  const outcomes = viralityOutcomes(cohort, f);
  const metricRows = [{ channel: 'apple_ads' as const, level: 'campaign' as const, external_id: 'C1', campaign_external_id: 'C1', date: '2026-10-20', spend: 30, currency: 'USD', impressions: 0, taps: 0, installs: 0 }];
  const input = { metricRows, entities: [], cohort, rangeStart: '2026-10-20', rangeEnd: '2026-10-21', today: '2026-10-25' };

  it('rows by channel add up to totals (users, invited, friends, social)', () => {
    const { totals, rows } = buildVirality('channel', input, outcomes);
    for (const k of ['users', 'invited', 'friendsBroughtIn', 'friendsToDate', 'sociallyActivated', 'invitesSent'] as const) {
      expect(rows.reduce((s, r) => s + r.metrics[k], 0), k).toBe(totals.metrics[k]);
    }
    expect(totals.metrics.users).toBe(4);
    expect(totals.metrics.friendsBroughtIn).toBe(2);
    expect(totals.metrics.kFactor).toBe(0.5);
    expect(totals.metrics.sociallyActivated).toBe(1); // B with F2
  });

  it('blended CAC = spend ÷ (paid users + their friends); null without spend', () => {
    const { totals, rows } = buildVirality('channel', input, outcomes);
    expect(totals.metrics).toMatchObject({ spend: 30, paidUsers: 2, paidFriends: 1, blendedCac: 10, costPerPaidUser: 15 });
    const apple = rows.find((r) => r.key === 'apple_ads')!;
    expect(apple.metrics.blendedCac).toBe(10);
    expect(rows.find((r) => r.key === 'organic')!.metrics.blendedCac).toBeNull();
  });

  it('cohorts younger than the 7-day window are maturing (whole range and per day)', () => {
    const r = buildVirality('channel', input, outcomes);
    expect(r.totals.metrics.maturing).toBe(true);
    expect(r.days.map((d) => d.maturing)).toEqual([true, true]);
    const old = buildVirality('channel', { ...input, today: '2026-10-29' }, outcomes);
    expect(old.totals.metrics.maturing).toBe(false);
    expect(old.days.map((d) => [d.date, d.maturing])).toEqual([
      ['2026-10-20', false],
      ['2026-10-21', false],
    ]);
    expect(buildVirality('channel', { ...input, today: '2026-10-28' }, outcomes).days.map((d) => d.maturing)).toEqual([false, true]);
  });

  it('days add up to totals', () => {
    const { totals, days } = buildVirality('campaign', input, outcomes);
    expect(days.reduce((s, d) => s + d.users, 0)).toBe(totals.metrics.users);
    expect(days.reduce((s, d) => s + d.friendsBroughtIn, 0)).toBe(totals.metrics.friendsBroughtIn);
  });

  it('every ratio is null with an empty cohort (never NaN)', () => {
    const m = computeVirality([], { spend: 10, maturing: false });
    for (const k of ['invitedRate', 'invitesPerInviter', 'inviteJoinRate', 'kFactor', 'kFactorToDate', 'sociallyActivatedRate', 'blendedCac', 'costPerPaidUser'] as const) expect(m[k], k).toBeNull();
  });
});
