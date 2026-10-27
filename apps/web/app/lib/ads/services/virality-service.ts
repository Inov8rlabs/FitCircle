/**
 * Read side of the Virality section (docs/ADS_METRICS_METHODOLOGY.md §8):
 * reuses the overview's sign-up cohort (AdsReportService.reportCohort — same
 * range, time zone, attribution and test-user exclusion), loads referral
 * invites, referrals and circle memberships around it, and hands everything
 * to the pure lib/ads/virality.ts.
 */
import { VIRALITY_DEFINITIONS } from '../definitions';
import type { CohortUser } from '../metrics';
import type { SliceInput } from '../report';
import type { AdsVirality, GroupBy, ViralityCoverage } from '../types';
import {
  buildVirality,
  VIRALITY_DAYS,
  type ViralityCircleRow,
  type ViralityFacts,
  type ViralityInviteRow,
  type ViralityMemberRow,
  type ViralityPerson,
  type ViralityReferralRow,
  viralityOutcomes,
} from '../virality';

import { chunk, db, selectAll } from './db';
import { AdsReportService, type RangeQuery } from './report-service';

const MEMBER_COLS = 'id, fitcircle_id, user_id, invited_by, status, joined_at, created_at, dropped_at, disqualified_at';

export const VIRALITY_COVERAGE_TEXT: Pick<ViralityCoverage, 'counted' | 'notCounted'> = {
  counted: [
    'Email and SMS invites sent from the app (referral_invites).',
    'Sign-ups attributed to a referral link or code (referrals), including share-sheet links that led to a sign-up and claimed the code.',
    'Joins into a non-public circle by invite code (fitcircle_members.invited_by). The app credits the circle creator, whoever shared the code.',
  ],
  notCounted: [
    'Share-sheet and copy-link shares. They are only in Amplitude ("Invite Shared", "Referral Invite Shared"), not in the database.',
    'Opens of invite pages (/i/<code>, /join/<code>). The server does not record them.',
    'Shared links that did not lead to an attributed sign-up, and referrals that were rejected, revoked or held for review.',
    'Public circle joins (including the demo circle). They are not a social connection.',
  ],
};

export class AdsViralityService {
  /** Rows around the cohort; `includeTest` makes test invitees / co-members count too (as in the cohort). */
  static async loadFacts(cohort: CohortUser[], includeTest: boolean): Promise<{ facts: ViralityFacts; sourceRows: ViralityCoverage['sourceRows'] }> {
    const ids = cohort.map((u) => u.userId);
    const invites: ViralityInviteRow[] = [];
    const referrals: ViralityReferralRow[] = [];
    const members = new Map<string, ViralityMemberRow>();
    let circleInviteJoins = 0;

    for (const part of chunk(ids, 150)) {
      const [inv, refs, invitedJoins, own] = await Promise.all([
        selectAll<ViralityInviteRow>(() =>
          db().from('referral_invites').select('id, inviter_id, status, sent_at, referral_id').in('inviter_id', part).order('id', { ascending: true })
        ),
        selectAll<ViralityReferralRow>(() =>
          db().from('referrals').select('id, invitee_id, inviter_id, status, attributed_at').in('inviter_id', part).order('id', { ascending: true })
        ),
        selectAll<ViralityMemberRow>(() => db().from('fitcircle_members').select(MEMBER_COLS).in('invited_by', part).order('id', { ascending: true })),
        selectAll<ViralityMemberRow>(() => db().from('fitcircle_members').select(MEMBER_COLS).in('user_id', part).order('id', { ascending: true })),
      ]);
      invites.push(...inv);
      referrals.push(...refs);
      circleInviteJoins += invitedJoins.filter((m) => m.user_id !== m.invited_by).length;
      for (const m of [...invitedJoins, ...own]) members.set(m.id, m);
    }

    const circleIds = [...new Set([...members.values()].map((m) => m.fitcircle_id))];
    const circles: ViralityCircleRow[] = [];
    for (const part of chunk(circleIds, 150)) {
      circles.push(
        ...(await selectAll<ViralityCircleRow>(() => db().from('fitcircles').select('id, visibility, status').in('id', part).order('id', { ascending: true })))
      );
    }
    // Co-members only matter in non-public circles a cohort user is in.
    const cohortIds = new Set(ids);
    const privateIds = new Set(circles.filter((c) => c.visibility !== 'public').map((c) => c.id));
    const memberCircles = [...new Set([...members.values()].filter((m) => cohortIds.has(m.user_id) && privateIds.has(m.fitcircle_id)).map((m) => m.fitcircle_id))];
    for (const part of chunk(memberCircles, 150)) {
      const rows = await selectAll<ViralityMemberRow>(() => db().from('fitcircle_members').select(MEMBER_COLS).in('fitcircle_id', part).order('id', { ascending: true }));
      for (const m of rows) members.set(m.id, m);
    }

    const otherIds = [...new Set([...referrals.map((r) => r.invitee_id), ...[...members.values()].map((m) => m.user_id)])];
    const classified = await AdsReportService.classifyUsers(otherIds);
    const people = new Map<string, ViralityPerson>();
    for (const [id, p] of classified) people.set(id, { createdAt: p.createdAt, real: includeTest || !p.testReason });

    return {
      facts: { invites, referrals, members: [...members.values()], circles, people },
      sourceRows: { referralInvites: invites.length, referrals: referrals.length, circleInviteJoins },
    };
  }

  static async report(range: RangeQuery, groupBy: GroupBy): Promise<AdsVirality> {
    const [metricRows, entities, cohortResult] = await Promise.all([
      AdsReportService.loadMetrics(range.start, range.end),
      AdsReportService.loadEntities(),
      AdsReportService.reportCohort(range),
    ]);
    const { cohort, excluded } = cohortResult;
    const { facts, sourceRows } = await this.loadFacts(cohort, range.includeTest === true);
    const outcomes = viralityOutcomes(cohort, facts);
    const input: SliceInput & { rangeStart: string } = { metricRows, entities, cohort, rangeStart: range.start, rangeEnd: range.end, today: range.today };
    const { totals, rows, days } = buildVirality(groupBy, input, outcomes);
    return {
      range: { start: range.start, end: range.end, timeZone: range.timeZone },
      groupBy,
      window: { days: VIRALITY_DAYS, label: `${VIRALITY_DAYS} days after each sign-up` },
      totals,
      rows,
      days,
      excludedUsers: excluded,
      coverage: { ...VIRALITY_COVERAGE_TEXT, sourceRows },
      definitions: VIRALITY_DEFINITIONS,
    };
  }
}
