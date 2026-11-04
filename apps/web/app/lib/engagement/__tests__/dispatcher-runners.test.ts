/**
 * Dispatcher + cron runners against in-memory adapters: ledger-first
 * idempotency, holdout rows, consent skips, transient retry, push through the
 * orchestrator adapter, analytics events, the Sunday-evening window, dry runs
 * and the per-run budget.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { isHoldout } from '../config';
import { dispatch } from '../dispatcher';
import { buildWeeklyReport } from '../messages/weekly-report';
import { runLifecycle, runWeeklyReports } from '../runners';
import type { MessagePlan } from '../types';
import { verifyUnsubscribeToken } from '../unsubscribe';

import { USER, lifecycleFacts, memoryAdapters, week, weeklyFacts } from './fixtures';

const weeklyPlan = () => buildWeeklyReport(weeklyFacts()) as MessagePlan;
const opts = { dryRun: false, channels: { email: true, push: true }, holdoutPct: 0, stream: 'weekly_report' as const };

beforeEach(() => {
  process.env.CRON_SECRET = 'cron';
});

describe('dispatch', () => {
  it('claims the ledger row first, sends with tags + one-click unsubscribe, records sent + analytics', async () => {
    const a = memoryAdapters();
    const out = await dispatch(a, USER, weeklyPlan(), opts);
    expect(out.email).toBe('sent');
    expect(out.push).toBe('sent');
    const [req] = a.email.sent;
    expect(req.to).toBe('sam@example.com');
    expect(req.tags.message_key).toBe('weekly_report');
    expect(req.tags.send_id).toBe(a.ledger.rows[0].id);
    expect(req.idempotencyKey).toBe(`engagement/${a.ledger.rows[0].id}`);
    expect(verifyUnsubscribeToken(new URL(req.unsubscribeUrl!).searchParams.get('t'))).toEqual({ userId: USER, scope: 'weekly_report' });
    expect(req.email.html).toContain('msg_id=' + a.ledger.rows[0].id);
    expect(a.ledger.rows.map((r) => [r.channel, r.status, r.provider_id])).toEqual([
      ['email', 'sent', 're_1'],
      ['push', 'sent', null],
    ]);
    expect(a.push.sent[0][1].type).toBe('weekly_summary');
    expect(a.analytics.names()).toEqual(['Email Sent', 'Weekly Report Sent', 'Push Sent']);
    expect(a.analytics.events[0].props).toMatchObject({ message_key: 'weekly_report', period_key: '2026-W44', channel: 'email', template_version: 'weekly_report@1' });
  });

  it('is idempotent: a second dispatch for the same period sends nothing', async () => {
    const a = memoryAdapters();
    await dispatch(a, USER, weeklyPlan(), opts);
    const again = await dispatch(a, USER, weeklyPlan(), opts);
    expect(again).toMatchObject({ email: 'already_sent', push: 'already_sent' });
    expect(a.email.sent).toHaveLength(1);
    expect(a.push.sent).toHaveLength(1);
  });

  it('holdout users get ledger rows with status holdout and nothing is sent', async () => {
    const a = memoryAdapters();
    let held = '';
    for (let i = 0; !held; i++) {
      const id = `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`;
      if (isHoldout(id, 'weekly_report', 5)) held = id;
    }
    const out = await dispatch(a, held, weeklyPlan(), { ...opts, holdoutPct: 5 });
    expect(out).toMatchObject({ email: 'holdout', push: 'holdout' });
    expect(a.email.sent).toHaveLength(0);
    expect(a.push.sent).toHaveLength(0);
    expect(a.ledger.rows.map((r) => [r.channel, r.status])).toEqual([
      ['email', 'holdout'],
      ['push', 'holdout'],
    ]);
    expect(a.analytics.events.filter((e) => e.event === 'Lifecycle Message Skipped' && e.props.reason === 'holdout')).toHaveLength(2);
  });

  it('consent off → skipped row + analytics once; never emailed', async () => {
    const a = memoryAdapters();
    a.consent.decision = { allowed: false, reason: 'consent' };
    const plan = weeklyPlan();
    delete plan.push;
    expect((await dispatch(a, USER, plan, opts)).email).toBe('consent');
    expect((await dispatch(a, USER, plan, opts)).email).toBe('consent');
    expect(a.email.sent).toHaveLength(0);
    expect(a.ledger.rows).toHaveLength(1);
    expect(a.ledger.rows[0]).toMatchObject({ status: 'skipped', meta: expect.objectContaining({ reason: 'consent' }) });
    expect(a.analytics.names()).toEqual(['Lifecycle Message Skipped']);
  });

  it('transient provider error releases the claim (retried next run); permanent error marks failed', async () => {
    const a = memoryAdapters();
    const plan = weeklyPlan();
    delete plan.push;
    a.email.next = { ok: false, error: 'rate_limit_exceeded: slow down' };
    expect((await dispatch(a, USER, plan, opts)).email).toBe('retry');
    expect(a.ledger.rows).toHaveLength(0);
    a.email.next = { ok: false, error: 'validation_error: bad address' };
    expect((await dispatch(a, USER, plan, opts)).email).toBe('failed');
    expect(a.ledger.rows[0].status).toBe('failed');
  });

  it('push suppressed by the orchestrator is recorded, not retried', async () => {
    const a = memoryAdapters();
    a.push.next = { sent: false, reason: 'quiet_hours' };
    const out = await dispatch(a, USER, weeklyPlan(), opts);
    expect(out.push).toBe('push_suppressed');
    expect(a.ledger.rows.find((r) => r.channel === 'push')!.status).toBe('suppressed');
  });

  it('dry run writes and sends nothing', async () => {
    const a = memoryAdapters();
    const out = await dispatch(a, USER, weeklyPlan(), { ...opts, dryRun: true });
    expect(out).toMatchObject({ email: 'would_send', push: 'would_send' });
    expect(out.preview!.subject).toBeTruthy();
    expect(a.ledger.rows).toHaveLength(0);
    expect(a.email.sent).toHaveLength(0);
    expect(a.analytics.events).toHaveLength(0);
  });

  it('a channel flag off sends nothing on that channel', async () => {
    const a = memoryAdapters();
    const out = await dispatch(a, USER, weeklyPlan(), { ...opts, channels: { email: true, push: false } });
    expect(out).toMatchObject({ email: 'sent', push: 'flag_off' });
    expect(a.push.sent).toHaveLength(0);
  });
});

describe('runWeeklyReports', () => {
  const candidates = [
    { userId: USER, timezone: 'America/New_York', createdAt: '2026-01-01T00:00:00Z' },
    { userId: '33333333-3333-4333-8333-333333333333', timezone: 'America/Los_Angeles', createdAt: '2026-01-01T00:00:00Z' },
  ];
  const facts = (userId: string) => weeklyFacts({ profile: { ...weeklyFacts().profile, userId } });

  const adapters = () =>
    memoryAdapters({
      weeklyReportCandidates: async ({ afterUserId }) => (afterUserId ? [] : candidates),
      weeklyReportFacts: async (userId: string) => facts(userId),
    });

  it('only people in their local Sunday 18:00–21:59 window get it', async () => {
    const a = adapters();
    const s = await runWeeklyReports(a, { now: new Date('2026-11-01T23:30:00Z'), max: 50, channels: { email: true, push: false } });
    expect(s.inWindow).toBe(1); // 18:30 New York; 15:30 Los Angeles
    expect(a.email.sent).toHaveLength(1);
    expect(a.ledger.rows[0]).toMatchObject({ user_id: USER, period_key: '2026-W44' });
    const again = await runWeeklyReports(a, { now: new Date('2026-11-02T00:30:00Z'), max: 50, channels: { email: true, push: false } });
    expect(again.outcomes.already_sent).toBe(1);
    expect(a.email.sent).toHaveLength(1);
  });

  it('dry run + ignoreWindow previews everyone without sending', async () => {
    const a = adapters();
    const s = await runWeeklyReports(a, { now: new Date('2026-10-28T12:00:00Z'), dryRun: true, ignoreWindow: true, max: 50, channels: { email: true, push: true } });
    expect(s.decisions).toHaveLength(2);
    expect(s.decisions.every((d) => d.email === 'would_send')).toBe(true);
    expect(a.email.sent).toHaveLength(0);
    expect(a.ledger.rows).toHaveLength(0);
  });

  it('respects the per-run budget', async () => {
    const a = adapters();
    const s = await runWeeklyReports(a, { now: new Date('2026-10-28T12:00:00Z'), ignoreWindow: true, max: 1, channels: { email: true, push: false } });
    expect(a.email.sent).toHaveLength(1);
    expect(s.budgetExhausted).toBe(true);
  });

  it('dormant people are skipped, not emailed', async () => {
    const a = memoryAdapters({
      weeklyReportCandidates: async ({ afterUserId }) => (afterUserId ? [] : candidates.slice(0, 1)),
      weeklyReportFacts: async () => weeklyFacts({ thisWeek: week(), activeDaysPrior4Weeks: 0 }),
    });
    const s = await runWeeklyReports(a, { now: new Date('2026-11-01T23:10:00Z'), max: 50, channels: { email: true, push: false } });
    expect(s.outcomes['skip:dormant']).toBe(1);
    expect(a.email.sent).toHaveLength(0);
    expect(a.analytics.events[0]).toMatchObject({ event: 'Lifecycle Message Skipped', props: { reason: 'dormant' } });
  });
});

describe('runLifecycle', () => {
  it('sends at most one due step per person, in local daytime only', async () => {
    const a = memoryAdapters({
      lifecycleCandidates: async ({ afterUserId }) => (afterUserId ? [] : [{ userId: USER, timezone: 'America/New_York', createdAt: '2026-10-30T10:00:00Z' }]),
      lifecycleFacts: async () => lifecycleFacts({ accountAgeHours: 26 }),
    });
    const night = await runLifecycle(a, { now: new Date('2026-10-31T03:00:00Z'), max: 10, channels: { email: true, push: true } });
    expect(night.inWindow).toBe(0);
    const s = await runLifecycle(a, { now: new Date('2026-10-31T15:00:00Z'), max: 10, channels: { email: true, push: true } });
    expect(s.outcomes['email:sent']).toBe(1);
    expect(a.email.sent[0].tags.message_key).toBe('onboarding_first_meal');
    expect(new URL(a.email.sent[0].unsubscribeUrl!).searchParams.get('t')).toContain('.tips.');
  });
});
