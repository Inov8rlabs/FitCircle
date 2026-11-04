/**
 * Cron passes (FitCircle-agnostic: adapters in, summary out).
 *
 *  runWeeklyReports — hourly; each person gets their report once per ISO week,
 *    in their local Sunday 18:00–21:59 window (period_key = ISO week).
 *  runLifecycle     — hourly; at most one onboarding / re-engagement message per
 *    person per run, between 09:00 and 19:59 local.
 *
 * Both honour a per-run send budget, `dryRun` (report who would get what,
 * write nothing, send nothing) and an optional user allowlist.
 */
import type { EngagementAdapters } from './adapters/types';
import { disabledKeys, holdoutPct } from './config';
import { dispatch, type DispatchOutcome } from './dispatcher';
import { selectLifecycleMessage, LIFECYCLE_SEND_HOURS } from './messages/lifecycle';
import { WEEKLY_REPORT_WINDOW, buildWeeklyReport } from './messages/weekly-report';
import { isoWeekBounds, isoWeekKey, localClock, userTimezone } from './time';

export interface RunOptions {
  now?: Date;
  dryRun?: boolean;
  /** Send budget for this run (sent + would_send). */
  max: number;
  onlyUserIds?: string[] | null;
  channels: { email: boolean; push: boolean };
  postalAddress?: string | null;
  /** Dry runs / admin: ignore the local-time window. */
  ignoreWindow?: boolean;
  /** Page size for candidate scans. */
  pageSize?: number;
}

export interface RunSummary {
  dryRun: boolean;
  considered: number;
  inWindow: number;
  due: number;
  budgetExhausted: boolean;
  outcomes: Record<string, number>;
  /** Dry runs (and the first 50 of real runs): per-user decisions. */
  decisions: DispatchOutcome[];
  errors: string[];
}

const newSummary = (dryRun: boolean): RunSummary => ({
  dryRun,
  considered: 0,
  inWindow: 0,
  due: 0,
  budgetExhausted: false,
  outcomes: {},
  decisions: [],
  errors: [],
});

const count = (s: RunSummary, key: string) => {
  s.outcomes[key] = (s.outcomes[key] ?? 0) + 1;
};

function record(s: RunSummary, d: DispatchOutcome) {
  if (d.email) count(s, `email:${d.email}`);
  if (d.push) count(s, `push:${d.push}`);
  if (s.dryRun || s.decisions.length < 50) s.decisions.push(d);
}

const consumed = (d: DispatchOutcome) =>
  [d.email, d.push].some((x) => x === 'sent' || x === 'would_send' || x === 'failed');

export async function runWeeklyReports(a: EngagementAdapters, o: RunOptions): Promise<RunSummary> {
  const now = o.now ?? new Date();
  const s = newSummary(!!o.dryRun);
  let budget = o.max;
  let after: string | null = null;
  const pct = holdoutPct('weekly_report');
  if (disabledKeys().has('weekly_report')) return { ...s, errors: ['weekly_report is in ENGAGEMENT_DISABLED_KEYS'] };
  for (;;) {
    const page = await a.facts.weeklyReportCandidates({ afterUserId: after, limit: o.pageSize ?? 500, onlyUserIds: o.onlyUserIds });
    if (page.length === 0) break;
    after = page[page.length - 1].userId;
    for (const u of page) {
      s.considered++;
      const clock = localClock(userTimezone(u.timezone), now);
      const inWindow =
        clock.isoWeekday === WEEKLY_REPORT_WINDOW.isoWeekday &&
        clock.hour >= WEEKLY_REPORT_WINDOW.fromHour &&
        clock.hour <= WEEKLY_REPORT_WINDOW.toHour;
      if (!inWindow && !o.ignoreWindow) continue;
      s.inWindow++;
      if (budget <= 0) {
        s.budgetExhausted = true;
        continue;
      }
      const weekKey = isoWeekKey(clock.date);
      try {
        if (!o.dryRun && (await a.ledger.exists(u.userId, 'weekly_report', weekKey, 'email'))) {
          count(s, 'already_sent');
          continue;
        }
        const facts = await a.facts.weeklyReportFacts(u.userId, isoWeekBounds(clock.date).start, now);
        if (!facts) {
          count(s, 'no_profile');
          continue;
        }
        const plan = buildWeeklyReport(facts);
        if ('skip' in plan) {
          count(s, `skip:${plan.skip}`);
          // One analytics event per person and week: only in the window's first hour.
          if (!o.dryRun && clock.hour === WEEKLY_REPORT_WINDOW.fromHour) {
            a.analytics.track(u.userId, 'Lifecycle Message Skipped', {
              message_key: 'weekly_report',
              period_key: weekKey,
              channel: 'email',
              reason: plan.skip,
            });
          }
          continue;
        }
        s.due++;
        if (!o.channels.push) delete plan.push;
        const d = await dispatch(a, u.userId, plan, {
          dryRun: !!o.dryRun,
          channels: o.channels,
          holdoutPct: pct,
          stream: 'weekly_report',
          postalAddress: o.postalAddress,
        });
        record(s, d);
        if (consumed(d)) budget--;
      } catch (err: any) {
        s.errors.push(`${u.userId}: ${err?.message ?? err}`);
        if (s.errors.length > 20) return s;
      }
    }
  }
  return s;
}

export async function runLifecycle(a: EngagementAdapters, o: RunOptions): Promise<RunSummary> {
  const now = o.now ?? new Date();
  const s = newSummary(!!o.dryRun);
  const paused = disabledKeys();
  let budget = o.max;
  let after: string | null = null;
  for (;;) {
    const page = await a.facts.lifecycleCandidates({ afterUserId: after, limit: o.pageSize ?? 500, onlyUserIds: o.onlyUserIds });
    if (page.length === 0) break;
    after = page[page.length - 1].userId;
    for (const u of page) {
      s.considered++;
      const clock = localClock(userTimezone(u.timezone), now);
      if (!o.ignoreWindow && (clock.hour < LIFECYCLE_SEND_HOURS.from || clock.hour > LIFECYCLE_SEND_HOURS.to)) continue;
      s.inWindow++;
      if (budget <= 0) {
        s.budgetExhausted = true;
        continue;
      }
      try {
        const facts = await a.facts.lifecycleFacts(u.userId, now);
        if (!facts) continue;
        if (o.ignoreWindow) facts.localHour = LIFECYCLE_SEND_HOURS.from;
        const decision = selectLifecycleMessage(facts, now);
        if (!decision) continue;
        if (paused.has('plan' in decision ? decision.plan.messageKey : decision.key)) {
          count(s, 'paused');
          continue;
        }
        if ('skip' in decision) {
          count(s, `skip:${decision.skip}`);
          if (!o.dryRun && clock.hour === LIFECYCLE_SEND_HOURS.from) {
            a.analytics.track(u.userId, 'Lifecycle Message Skipped', {
              message_key: decision.key,
              period_key: decision.periodKey,
              reason: decision.skip,
            });
          }
          if (o.dryRun) s.decisions.push({ userId: u.userId, messageKey: decision.key, periodKey: decision.periodKey, variant: '', email: decision.skip });
          continue;
        }
        s.due++;
        const d = await dispatch(a, u.userId, decision.plan, {
          dryRun: !!o.dryRun,
          channels: o.channels,
          holdoutPct: holdoutPct(decision.plan.messageKey),
          stream: 'tips',
          postalAddress: o.postalAddress,
        });
        record(s, d);
        if (consumed(d)) budget--;
      } catch (err: any) {
        s.errors.push(`${u.userId}: ${err?.message ?? err}`);
        if (s.errors.length > 20) return s;
      }
    }
  }
  return s;
}
