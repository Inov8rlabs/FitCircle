/**
 * Loads the facts for the PMF scorecard (read-only, service role) and assembles the report.
 * Reuses the Ads Console loaders so numbers line up with Ads / Virality / Retention / Finance:
 *  - AdsReportService.reportCohort  sign-ups in the report time zone, attribution, PRODUCTION RevenueCat events,
 *                                   test-user exclusion (lib/ads/test-users.ts)
 *  - AdsViralityService.loadFacts   invites, referrals, circle joins → per-user virality (ADS_METRICS_METHODOLOGY §8)
 *  - AdsReportService.loadMetrics   campaign-level ad spend
 *  - FinanceData.activity           Home feed loads + app opens (activity signal)
 *  - FinanceData.productionEvents   every PRODUCTION subscription event (subscription state / churn / ARPU)
 * Pure math: lib/pmf/scorecard.ts and lib/pmf/insights.ts.
 */
import { reportTimeZone } from '../../ads/config';
import { addDays, todayInTz } from '../../ads/dates';
import type { CohortUser, RevenueEvent } from '../../ads/metrics';
import { chunk, db, selectAll } from '../../ads/services/db';
import { AdsReportService } from '../../ads/services/report-service';
import { AdsViralityService } from '../../ads/services/virality-service';
import { classifyTestUser } from '../../ads/test-users';
import { membershipInterval, PUBLIC_CIRCLE_IDS, viralityOutcomes, type ViralityMemberRow } from '../../ads/virality';
import { CampaignError } from '../../campaigns/http';
import { FinanceData } from '../../finance/services/finance-data';
import { DEFAULT_NOTIFICATION_TZ, isPlaceholderTimezone } from '../../notifications/user-timezone';
import { SOURCES } from '../catalog';
import { buildInsights, SIGNAL_NOTE_PREFIX } from '../insights';
import { buildKpis, pmfScore, type PmfFacts, type PmfMembership, type PmfPlatform, type PmfUser } from '../scorecard';
import { PMF_PERIODS, type PmfPeriod, type PmfReport } from '../types';

const DEAD_CIRCLE_STATUSES = new Set(['cancelled', 'draft']);
const ACTIVITY_KPIS = new Set(['dau', 'mau', 'stickiness', 'buddy_wau', 'arpu_monthly']);

interface Person {
  id: string;
  createdAt: string;
  timezone: string | null;
  onboardingCompleted: boolean;
  paywallAt: string | null;
  testReason: string | null;
}

export const POPULATION_METHOD =
  'Real users only. Left out: internal accounts (profiles.is_admin, @fitcircle.ai / @inov8rlabs.com and the ADS_TEST_EMAILS list), the App Review demo account, Firebase Test Lab accounts (@cloudtestlabaccounts.com), QA domains (example.com …), Google Play pre-launch robot accounts (generated firstnamelastname.12345@gmail.com addresses, which sign up on OnePlus 8 Pro test devices after each Play release and never return), Apple’s mock AdServices attribution (TestFlight / dev builds) — the Ads Console rules in lib/ads/test-users.ts — plus accounts the Android app flagged with the X-Test-Device header (profiles.metadata.test_device). The same rules apply to everyone counted as active, paying or as a circle buddy.';

const normPlatform = (v: unknown): PmfPlatform | null => {
  const s = String(v ?? '').toLowerCase();
  if (s === 'ios' || s === 'android' || s === 'web') return s;
  return null;
};

/** ?period=7|28|90 (also 7d / 28d / 90d); default 28. */
export function parsePeriod(v: string | null): PmfPeriod {
  if (v === null || v === '') return 28;
  const n = Number(v.replace(/d$/i, ''));
  if (!(PMF_PERIODS as number[]).includes(n)) throw new CampaignError(400, 'VALIDATION_ERROR', `period must be one of ${PMF_PERIODS.join(', ')}`);
  return n as PmfPeriod;
}

function push<T>(m: Map<string, T[]>, k: string, v: T): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export class PmfService {
  /** Profiles (+ mock attribution) for ids → test verdict and the fields the scorecard needs. */
  static async loadPeople(ids: string[]): Promise<Map<string, Person>> {
    const out = new Map<string, Person>();
    const uuids = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    for (const part of chunk(uuids, 150)) {
      const [profiles, attr] = await Promise.all([
        selectAll<{
          id: string;
          created_at: string;
          email: string | null;
          is_admin: boolean | null;
          timezone: string | null;
          onboarding_completed: boolean | null;
          onboarding_paywall_at: string | null;
          test_device: unknown;
        }>(() =>
          db()
            .from('profiles')
            .select('id, created_at, email, is_admin, timezone, onboarding_completed, onboarding_paywall_at, test_device:metadata->test_device')
            .in('id', part)
            .order('id', { ascending: true })
        ),
        selectAll<{ user_id: string; is_test: boolean | null }>(() => db().from('user_attribution').select('user_id, is_test').in('user_id', part).order('user_id', { ascending: true })),
      ]);
      const mock = new Set(attr.filter((a) => a.is_test === true).map((a) => a.user_id));
      for (const p of profiles) {
        const reason = classifyTestUser({ email: p.email, isAdmin: p.is_admin, mockAttribution: mock.has(p.id) }) ?? (p.test_device ? 'test_device' : null);
        out.set(p.id, {
          id: p.id,
          createdAt: p.created_at,
          timezone: p.timezone,
          onboardingCompleted: p.onboarding_completed === true,
          paywallAt: p.onboarding_paywall_at,
          testReason: reason,
        });
      }
    }
    return out;
  }

  /** Earliest row of a table's timestamp column, or null (empty / missing table). */
  static async firstAt(table: string, column: string): Promise<string | null> {
    const { data, error } = await db().from(table).select(column).order(column, { ascending: true }).limit(1);
    if (error) return null;
    return ((data ?? []) as unknown as Array<Record<string, string>>)[0]?.[column] ?? null;
  }

  static async report(period: PmfPeriod, opts: { now?: Date } = {}): Promise<PmfReport> {
    const now = opts.now ?? new Date();
    const timeZone = reportTimeZone();
    const today = todayInTz(timeZone, now);
    // Oldest day any KPI touches: D30 maturity + max(previous window, 12 trend weeks).
    const spanStart = addDays(today, -(32 + Math.max(2 * period, 84)));
    const activityFrom = new Date(Date.parse(`${addDays(spanStart, -31)}T00:00:00Z`) - 14 * 3600_000).toISOString();
    const nowIso = now.toISOString();

    const [{ cohort: adsCohort, excluded }, activity, mealRows, allEvents, metricRows, feedSince, opensSince] = await Promise.all([
      AdsReportService.reportCohort({ start: spanStart, end: today, today, timeZone, includeTest: false, now }),
      FinanceData.activity(activityFrom, nowIso),
      selectAll<{ id: string; user_id: string; created_at: string }>(() =>
        db()
          .from('food_log_entries')
          .select('id, user_id, created_at')
          .eq('entry_type', 'food')
          .or('input_method.is.null,input_method.neq.imported')
          .gte('created_at', activityFrom)
          .lt('created_at', nowIso)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
      ),
      FinanceData.productionEvents(),
      AdsReportService.loadMetrics(spanStart, today),
      this.firstAt('home_feed_decisions', 'created_at'),
      this.firstAt('app_opens', 'first_open_at'),
    ]);

    // Everyone we may count: cohort + anyone active / logging / paying in the span.
    const otherIds = new Set<string>([...activity.rows.map((r) => r.userId), ...mealRows.map((r) => r.user_id), ...allEvents.map((e) => e.user_id).filter((x): x is string => !!x)]);
    for (const u of adsCohort) otherIds.add(u.userId);
    const people = await this.loadPeople([...otherIds]);
    const isReal = (id: string | null | undefined) => !!id && people.has(id) && !people.get(id)!.testReason;

    // Cohort: Ads Console rules + the X-Test-Device flag.
    const byReason: Record<string, number> = { ...(excluded.byReason as Record<string, number>) };
    let excludedTotal = excluded.total;
    const cohort: CohortUser[] = [];
    for (const u of adsCohort) {
      if (people.get(u.userId)?.testReason === 'test_device') {
        byReason.test_device = (byReason.test_device ?? 0) + 1;
        excludedTotal++;
      } else cohort.push(u);
    }
    const cohortIds = cohort.map((u) => u.userId);

    // Referral invitees + push-device platform (fallbacks for source / platform, as the retention report does).
    const invitees = new Set<string>();
    const devicePlatform = new Map<string, PmfPlatform>();
    for (const part of chunk(cohortIds, 150)) {
      const [refs, tokens] = await Promise.all([
        selectAll<{ id: string; invitee_id: string }>(() => db().from('referrals').select('id, invitee_id').in('invitee_id', part).order('id', { ascending: true })),
        selectAll<{ id: string; user_id: string; platform: string | null }>(() => db().from('push_tokens').select('id, user_id, platform').in('user_id', part).order('id', { ascending: true })),
      ]);
      for (const r of refs) invitees.add(r.invitee_id);
      for (const t of tokens) {
        const p = normPlatform(t.platform);
        if (p && !devicePlatform.has(t.user_id)) devicePlatform.set(t.user_id, p);
      }
    }

    // Activity (real users only) and first-seen platform.
    const act = new Map<string, number[]>();
    const firstPlatform = new Map<string, { at: number; p: PmfPlatform }>();
    for (const r of activity.rows) {
      if (!isReal(r.userId)) continue;
      const t = Date.parse(r.at);
      if (!Number.isFinite(t)) continue;
      push(act, r.userId, t);
      const p = normPlatform(r.platform);
      if (p && (!firstPlatform.has(r.userId) || t < firstPlatform.get(r.userId)!.at)) firstPlatform.set(r.userId, { at: t, p });
    }
    const meals = new Map<string, number[]>();
    for (const r of mealRows) {
      if (!isReal(r.user_id)) continue;
      const t = Date.parse(r.created_at);
      if (!Number.isFinite(t)) continue;
      push(meals, r.user_id, t);
      push(act, r.user_id, t);
    }

    const eventsByUser = new Map<string, RevenueEvent[]>();
    for (const e of allEvents) if (isReal(e.user_id)) push(eventsByUser, e.user_id!, e);

    // Virality (same rules as Ads → Virality).
    const { facts: vFacts } = await AdsViralityService.loadFacts(cohort, false);
    const outcomes = viralityOutcomes(cohort, vFacts);

    const users: PmfUser[] = cohort.map((u) => {
      const person = people.get(u.userId);
      const tz = !isPlaceholderTimezone(person?.timezone) ? person!.timezone! : DEFAULT_NOTIFICATION_TZ;
      const platform = firstPlatform.get(u.userId)?.p ?? normPlatform(u.attribution?.platform) ?? devicePlatform.get(u.userId) ?? 'unknown';
      const channel = invitees.has(u.userId) ? 'invite' : u.attribution?.channel && !u.attribution.is_test ? u.attribution.channel : 'unknown';
      const signupMs = Date.parse(u.signupAt);
      const firstMeal = (meals.get(u.userId) ?? []).filter((t) => t >= signupMs - 60_000).sort((a, b) => a - b)[0];
      const o = outcomes.get(u.userId);
      return {
        userId: u.userId,
        signupAt: u.signupAt,
        signupDate: u.signupDate,
        timezone: tz,
        platform,
        channel,
        onboardingCompleted: person?.onboardingCompleted ?? false,
        reachedPaywall: !!person?.paywallAt,
        firstMealAt: firstMeal !== undefined ? new Date(firstMeal).toISOString() : null,
        events: u.events,
        virality: o
          ? { invited: o.invited, invitesSent: o.invitesSent, invitesJoined: o.invitesJoined, friends: o.friends, sociallyActivated: o.sociallyActivated }
          : null,
      };
    });

    const userPlatform = new Map<string, PmfPlatform>();
    for (const [id, v] of firstPlatform) userPlatform.set(id, v.p);
    for (const u of users) if (!userPlatform.has(u.userId)) userPlatform.set(u.userId, u.platform);

    const memberships = await this.loadMemberships([...act.keys()], isReal);

    const activitySince = [feedSince, opensSince].filter((x): x is string => !!x).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
    const facts: PmfFacts = {
      now,
      today,
      timeZone,
      users,
      activity: act,
      meals,
      userPlatform,
      spend: metricRows.filter((r) => r.level === 'campaign').map((r) => ({ date: r.date, channel: r.channel, spend: Number(r.spend) || 0 })),
      eventsByUser,
      memberships,
      activitySince,
    };

    const kpis = buildKpis(facts, period);
    // A new activity signal starting inside the compared windows inflates activity KPIs; say so on the row and in insights.
    for (const k of kpis) {
      if (!ACTIVITY_KPIS.has(k.id)) continue;
      for (const [label, since] of [['App-open recording (app_opens)', opensSince], ['Home feed logging (home_feed_decisions)', feedSince]] as const) {
        if (!since) continue;
        const day = since.slice(0, 10);
        if (day > k.previous.window.start && day <= k.current.window.end) {
          k.notes.unshift(`${SIGNAL_NOTE_PREFIX} ${label} started on ${day}, inside the compared windows, so part of any rise is the new signal, not more usage.`);
        }
      }
    }
    const score = pmfScore(kpis);
    const insights = buildInsights(kpis, score);
    const cur = { start: addDays(today, -period), end: addDays(today, -1) };
    const prev = { start: addDays(cur.start, -period), end: addDays(cur.end, -period) };
    const inW = (w: { start: string; end: string }) => users.filter((u) => u.signupDate >= w.start && u.signupDate <= w.end).length;
    const mixedCurrency = metricRows.some((r) => r.level === 'campaign' && r.currency && r.currency !== 'USD');

    return {
      generatedAt: now.toISOString(),
      period,
      today,
      timeZone,
      kpis,
      insights,
      score,
      population: {
        method: POPULATION_METHOD,
        excluded: { total: excludedTotal, byReason },
        realSignups: { current: inW(cur), previous: inW(prev) },
        currentWindow: cur,
        previousWindow: prev,
      },
      signals: { activitySince, appOpensSince: opensSince },
      notes: [
        `Days are ${timeZone} calendar days, except retention, which uses each user’s own time zone (profile time zone, else ${DEFAULT_NOTIFICATION_TZ}).`,
        `Active = an app open (app_opens, since ${opensSince ? opensSince.slice(0, 10) : 'n/a'}), a Home feed load (home_feed_decisions, 1.0.8+ apps, since ${feedSince ? feedSince.slice(0, 10) : 'n/a'}, kept 90 days) or a logged meal. Retention counts only sign-ups after the first activity signal; DAU / MAU windows that reach before it are undercounted.`,
        'Cohort KPIs use sign-ups old enough for their whole window (e.g. D7 uses sign-ups at least 8 days old), so each KPI shows its own sign-up dates. Previous = the same-length window just before.',
        'Trend sparklines: 12 weekly buckets ending at the current window’s end, same definition per bucket.',
        'Revenue is net of store fees and tax, cash basis, PRODUCTION RevenueCat events only (Ads Console rules, docs/ADS_METRICS_METHODOLOGY.md §4). Spend is campaign-level Apple Ads / Google Ads / Meta delivery.',
        'Status: on track at or beyond target; at risk between the doc’s minimum and the target (or within 20% of target when the doc gives no minimum); off track beyond that. Rates on fewer than 5 users are not judged (“too few”); under 30 users are flagged as a small sample.',
        ...(mixedCurrency ? ['Some ad spend is not in USD and is summed as reported; money KPIs are approximate.'] : []),
        ...(activity.note ? [activity.note] : []),
      ],
      sources: SOURCES,
    };
  }

  /** Memberships of real users in private, live circles (public / demo / cancelled / draft removed). */
  static async loadMemberships(userIds: string[], isReal: (id: string) => boolean): Promise<PmfMembership[]> {
    const rows: ViralityMemberRow[] = [];
    for (const part of chunk(userIds, 150)) {
      rows.push(
        ...(await selectAll<ViralityMemberRow>(() =>
          db()
            .from('fitcircle_members')
            .select('id, fitcircle_id, user_id, invited_by, status, joined_at, created_at, dropped_at, disqualified_at')
            .in('user_id', part)
            .order('id', { ascending: true })
        ))
      );
    }
    const circleIds = [...new Set(rows.map((r) => r.fitcircle_id))];
    const live = new Set<string>();
    for (const part of chunk(circleIds, 150)) {
      const circles = await selectAll<{ id: string; visibility: string | null; status: string | null }>(() =>
        db().from('fitcircles').select('id, visibility, status').in('id', part).order('id', { ascending: true })
      );
      for (const c of circles) if (c.visibility !== 'public' && !PUBLIC_CIRCLE_IDS.has(c.id) && !DEAD_CIRCLE_STATUSES.has(String(c.status ?? ''))) live.add(c.id);
    }
    const out: PmfMembership[] = [];
    for (const m of rows) {
      if (!live.has(m.fitcircle_id) || !isReal(m.user_id)) continue;
      const [start, end] = membershipInterval(m);
      if (Number.isFinite(start) && end > start) out.push({ userId: m.user_id, circleId: m.fitcircle_id, start, end });
    }
    return out;
  }
}
