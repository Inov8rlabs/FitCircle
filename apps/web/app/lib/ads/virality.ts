/**
 * Virality of the sign-up cohort (docs/ADS_METRICS_METHODOLOGY.md §8). Pure: the
 * service loads rows, this decides what counts. No clock reads (callers pass
 * `today`). Conservative by design: anything we can't prove from the database
 * (a share-sheet share, a test or deleted account, a public-circle join, a
 * referral flagged as fraud) does not count.
 */
import { addDays, diffDays, eachDay } from './dates';
import { incompleteFlags, type CohortUser, ratio } from './metrics';
import { buildRows, buildTotals, effectiveAttribution, type SliceInput, userKey } from './report';
import { AD_CHANNELS, type GroupBy, type ViralityCircleStates, type ViralityDay, type ViralityMetrics, type ViralityRow } from './types';

const DAY_MS = 86_400_000;
/** Every virality window: [sign-up − 1 min, sign-up + 7 × 24 h), like activation. */
export const VIRALITY_DAYS = 7;
const GRACE_MS = 60_000;

/** The public demo circle (also `visibility = public`; listed so a visibility change can't make it count). */
export const PUBLIC_CIRCLE_IDS = new Set(['dc69b1b5-9fb6-4f50-8f5f-0f1776af82be']);
/** Circles that never ran don't connect anyone. */
const DEAD_CIRCLE_STATUSES = new Set(['cancelled', 'draft']);
/** Membership statuses that mean "still in the circle" (no end date). */
const OPEN_MEMBER_STATUSES = new Set(['active', 'completed']);
/** Referrals that were rejected (device fraud), revoked, or held for manual review don't count. */
const VALID_REFERRAL_STATUSES = new Set(['pending', 'qualified']);
const JOINED_INVITE_STATUSES = new Set(['joined', 'qualified']);

export interface ViralityInviteRow {
  id: string;
  inviter_id: string;
  status: string;
  sent_at: string | null;
  referral_id: string | null;
}

export interface ViralityReferralRow {
  id: string;
  invitee_id: string;
  inviter_id: string | null;
  status: string;
  attributed_at: string | null;
}

export interface ViralityMemberRow {
  id: string;
  fitcircle_id: string;
  user_id: string;
  invited_by: string | null;
  status: string | null;
  joined_at: string | null;
  created_at: string | null;
  dropped_at: string | null;
  disqualified_at?: string | null;
}

export interface ViralityCircleRow {
  id: string;
  visibility: string | null;
  status: string | null;
}

export interface ViralityPerson {
  /** profiles.created_at. */
  createdAt: string;
  /** Not a test / internal account (or includeTest). Unknown people are never real. */
  real: boolean;
}

export interface ViralityFacts {
  /** referral_invites sent by cohort users. */
  invites: ViralityInviteRow[];
  /** referrals whose inviter is a cohort user. */
  referrals: ViralityReferralRow[];
  /** fitcircle_members rows of: cohort users, people they invited (invited_by), and co-members of their circles. */
  members: ViralityMemberRow[];
  circles: ViralityCircleRow[];
  /** Everyone other than the cohort that the rows above mention (invitees, joiners, co-members). */
  people: Map<string, ViralityPerson>;
}

export type CircleState = keyof ViralityCircleStates;

export interface ViralityOutcome {
  userId: string;
  invited: boolean;
  routes: { sentInvite: boolean; referralJoin: boolean; circleJoin: boolean };
  invitesSent: number;
  invitesJoined: number;
  invitesFailed: number;
  /** Friends credited to this user, joined within the window. */
  friends: number;
  /** Friends credited to this user, any time after sign-up. */
  friendsToDate: number;
  sociallyActivated: boolean;
  circleState: CircleState;
  /** Brought in by an ad network (for blended CAC). */
  paid: boolean;
}

const ms = (v: string | null | undefined): number => (v ? Date.parse(v) : NaN);

/** [start, end) of a membership; end = Infinity while the member is still in. A row with no usable end never overlaps anything. */
export function membershipInterval(m: ViralityMemberRow): [number, number] {
  const start = ms(m.joined_at ?? m.created_at);
  if (!Number.isFinite(start)) return [NaN, NaN];
  if (OPEN_MEMBER_STATUSES.has(String(m.status ?? ''))) return [start, Infinity];
  const end = ms(m.dropped_at ?? m.disqualified_at ?? null);
  return [start, Number.isFinite(end) ? end : start];
}

const overlaps = (a: [number, number], b: [number, number]) => Math.max(a[0], b[0]) < Math.min(a[1], b[1]);

/**
 * Per-user virality. A friend counts once in the whole cohort: credited to the
 * inviter of their (valid) referral, else to whoever invited them into a
 * non-public circle first. So slices add up to the totals.
 */
export function viralityOutcomes(cohort: CohortUser[], facts: ViralityFacts): Map<string, ViralityOutcome> {
  const signup = new Map(cohort.map((u) => [u.userId, ms(u.signupAt)]));
  const circles = new Map(facts.circles.map((c) => [c.id, c]));
  const isPublic = (id: string) => PUBLIC_CIRCLE_IDS.has(id) || circles.get(id)?.visibility === 'public';
  // A circle we couldn't load is never social (and not "public" either).
  const isSocialCircle = (id: string) => circles.has(id) && !isPublic(id) && !DEAD_CIRCLE_STATUSES.has(String(circles.get(id)?.status ?? ''));
  const isReal = (id: string) => facts.people.get(id)?.real === true;
  const window = (userId: string): [number, number] => {
    const s = signup.get(userId)!;
    return [s - GRACE_MS, s + VIRALITY_DAYS * DAY_MS];
  };
  const inWindow = (userId: string, t: number) => {
    const [a, b] = window(userId);
    return Number.isFinite(t) && t >= a && t < b;
  };
  const afterSignup = (userId: string, t: number) => Number.isFinite(t) && t >= window(userId)[0];

  const out = new Map<string, ViralityOutcome>();
  for (const u of cohort) {
    out.set(u.userId, {
      userId: u.userId,
      invited: false,
      routes: { sentInvite: false, referralJoin: false, circleJoin: false },
      invitesSent: 0,
      invitesJoined: 0,
      invitesFailed: 0,
      friends: 0,
      friendsToDate: 0,
      sociallyActivated: false,
      circleState: 'none',
      paid: (AD_CHANNELS as string[]).includes(effectiveAttribution(u)?.channel ?? ''),
    });
  }

  // 1. Email / SMS invites sent from the app.
  const validReferrals = new Map(
    facts.referrals.filter((r) => r.inviter_id && signup.has(r.inviter_id) && VALID_REFERRAL_STATUSES.has(r.status) && r.invitee_id !== r.inviter_id && isReal(r.invitee_id)).map((r) => [r.id, r])
  );
  for (const inv of facts.invites) {
    const o = out.get(inv.inviter_id);
    if (!o || !inWindow(inv.inviter_id, ms(inv.sent_at))) continue;
    if (inv.status === 'failed') {
      o.invitesFailed += 1;
      continue;
    }
    o.invitesSent += 1;
    o.routes.sentInvite = true;
    const ref = inv.referral_id ? validReferrals.get(inv.referral_id) : undefined;
    if (JOINED_INVITE_STATUSES.has(inv.status) && ref && ref.inviter_id === inv.inviter_id) o.invitesJoined += 1;
  }

  // 2. Someone joined through their referral link / code.
  type Credit = { friendId: string; inviterId: string; at: number; kind: 'referral' | 'circle' };
  const credits: Credit[] = [];
  for (const r of validReferrals.values()) {
    const inviter = r.inviter_id!;
    const at = ms(r.attributed_at);
    if (inWindow(inviter, at)) out.get(inviter)!.routes.referralJoin = true;
    credits.push({ friendId: r.invitee_id, inviterId: inviter, at, kind: 'referral' });
  }

  // 3. Someone else joined a non-public circle with invited_by = them (self-rows excluded).
  for (const m of facts.members) {
    const inviter = m.invited_by;
    if (!inviter || !signup.has(inviter) || m.user_id === inviter || !isSocialCircle(m.fitcircle_id) || !isReal(m.user_id)) continue;
    const at = ms(m.joined_at ?? m.created_at);
    if (inWindow(inviter, at)) out.get(inviter)!.routes.circleJoin = true;
    credits.push({ friendId: m.user_id, inviterId: inviter, at, kind: 'circle' });
  }

  // Friends brought in: new real users (signed up after their inviter), each credited once.
  const best = new Map<string, Credit>();
  for (const c of credits) {
    const friend = facts.people.get(c.friendId);
    if (!friend?.real || !Number.isFinite(c.at) || !afterSignup(c.inviterId, c.at)) continue;
    if (!(ms(friend.createdAt) >= window(c.inviterId)[0])) continue;
    const prev = best.get(c.friendId);
    const better = !prev || (c.kind === 'referral' && prev.kind === 'circle') || (c.kind === prev.kind && (c.at < prev.at || (c.at === prev.at && c.inviterId < prev.inviterId)));
    if (better) best.set(c.friendId, c);
  }
  for (const c of best.values()) {
    const o = out.get(c.inviterId)!;
    o.friendsToDate += 1;
    if (inWindow(c.inviterId, c.at)) o.friends += 1;
  }

  // Socially activated / circle state.
  const byCircle = new Map<string, ViralityMemberRow[]>();
  for (const m of facts.members) {
    const list = byCircle.get(m.fitcircle_id) ?? [];
    if (!list.some((x) => x.id === m.id)) list.push(m);
    byCircle.set(m.fitcircle_id, list);
  }
  for (const o of out.values()) {
    const w = window(o.userId);
    let solo = false;
    let pub = false;
    for (const mine of facts.members) {
      if (mine.user_id !== o.userId) continue;
      const iv = membershipInterval(mine);
      const seen: [number, number] = [Math.max(iv[0], w[0]), Math.min(iv[1], w[1])];
      if (!(seen[0] < seen[1])) continue;
      if (!isSocialCircle(mine.fitcircle_id)) {
        if (isPublic(mine.fitcircle_id)) pub = true;
        continue;
      }
      solo = true;
      const others = (byCircle.get(mine.fitcircle_id) ?? []).filter((x) => x.user_id !== o.userId && isReal(x.user_id));
      if (others.some((x) => overlaps(seen, membershipInterval(x)))) o.sociallyActivated = true;
    }
    o.circleState = o.sociallyActivated ? 'social' : solo ? 'soloPrivate' : pub ? 'publicOnly' : 'none';
    o.invited = o.routes.sentInvite || o.routes.referralJoin || o.routes.circleJoin;
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeVirality(outcomes: ViralityOutcome[], ctx: { spend: number; maturing: boolean }): ViralityMetrics {
  const users = outcomes.length;
  const n = (f: (o: ViralityOutcome) => boolean) => outcomes.filter(f).length;
  const sum = (f: (o: ViralityOutcome) => number, list = outcomes) => list.reduce((s, o) => s + f(o), 0);
  const paid = outcomes.filter((o) => o.paid);
  const invited = n((o) => o.invited);
  const inviters = n((o) => o.invitesSent > 0);
  const invitesSent = sum((o) => o.invitesSent);
  const invitesJoined = sum((o) => o.invitesJoined);
  const friendsBroughtIn = sum((o) => o.friends);
  const friendsToDate = sum((o) => o.friendsToDate);
  const sociallyActivated = n((o) => o.sociallyActivated);
  const paidUsers = paid.length;
  const paidFriends = sum((o) => o.friends, paid);
  const spend = round2(ctx.spend);
  return {
    users,
    invited,
    invitedRate: ratio(invited, users),
    invitedBy: { sentInvite: n((o) => o.routes.sentInvite), referralJoin: n((o) => o.routes.referralJoin), circleJoin: n((o) => o.routes.circleJoin) },
    inviters,
    invitesSent,
    invitesPerInviter: ratio(invitesSent, inviters),
    invitesJoined,
    inviteJoinRate: ratio(invitesJoined, invitesSent),
    invitesFailed: sum((o) => o.invitesFailed),
    friendsBroughtIn,
    kFactor: ratio(friendsBroughtIn, users),
    friendsToDate,
    kFactorToDate: ratio(friendsToDate, users),
    sociallyActivated,
    sociallyActivatedRate: ratio(sociallyActivated, users),
    circles: { social: n((o) => o.circleState === 'social'), soloPrivate: n((o) => o.circleState === 'soloPrivate'), publicOnly: n((o) => o.circleState === 'publicOnly'), none: n((o) => o.circleState === 'none') },
    spend,
    paidUsers,
    paidFriends,
    // No spend → no CAC (not $0): organic rows are outcome-only.
    blendedCac: spend > 0 ? ratio(spend, paidUsers + paidFriends) : null,
    costPerPaidUser: spend > 0 ? ratio(spend, paidUsers) : null,
    maturing: ctx.maturing,
  };
}

/** A cohort day is maturing until its 7-day window has fully passed (same rule as D7 ROAS). */
export const dayMaturing = (day: string, today: string) => diffDays(day, today) < VIRALITY_DAYS + 1;

export interface ViralityReport {
  totals: ViralityRow;
  rows: ViralityRow[];
  days: ViralityDay[];
}

/** Slices the cohort's virality like the overview (same row keys / labels / spend). */
export function buildVirality(groupBy: GroupBy, input: SliceInput & { rangeStart: string }, outcomes: Map<string, ViralityOutcome>): ViralityReport {
  const maturing = incompleteFlags(input.rangeEnd, input.today).d7;
  const of = (users: CohortUser[]) => users.map((u) => outcomes.get(u.userId)).filter((o): o is ViralityOutcome => !!o);

  const byKey = new Map<string, CohortUser[]>();
  for (const u of input.cohort) {
    const k = userKey(u, groupBy);
    byKey.set(k, [...(byKey.get(k) ?? []), u]);
  }
  const rows: ViralityRow[] = buildRows(groupBy, input).map((r) => ({
    key: r.key,
    groupBy: r.groupBy,
    label: r.label,
    sublabel: r.sublabel,
    channel: r.channel,
    platform: r.platform,
    level: r.level,
    externalId: r.externalId,
    campaignExternalId: r.campaignExternalId,
    metrics: computeVirality(of(byKey.get(r.key) ?? []), { spend: r.metrics.spend, maturing }),
  }));
  rows.sort((a, b) => b.metrics.users - a.metrics.users || b.metrics.spend - a.metrics.spend || a.label.localeCompare(b.label));

  const totals: ViralityRow = {
    key: 'total',
    groupBy,
    label: 'All sign-ups',
    sublabel: null,
    channel: null,
    platform: null,
    level: null,
    externalId: null,
    campaignExternalId: null,
    metrics: computeVirality(of(input.cohort), { spend: buildTotals(input).metrics.spend, maturing }),
  };

  const days: ViralityDay[] = eachDay(input.rangeStart, input.rangeEnd).map((date) => {
    const list = of(input.cohort.filter((u) => u.signupDate === date));
    return {
      date,
      users: list.length,
      invited: list.filter((o) => o.invited).length,
      friendsBroughtIn: list.reduce((s, o) => s + o.friends, 0),
      sociallyActivated: list.filter((o) => o.sociallyActivated).length,
      maturing: dayMaturing(date, input.today),
    };
  });
  return { totals, rows, days };
}

/** Last day whose cohort has a closed 7-day window (for the UI hint). */
export const lastMatureDay = (today: string) => addDays(today, -(VIRALITY_DAYS + 1));
