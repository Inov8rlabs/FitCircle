/** Test fixtures: facts builders and in-memory adapters for lifecycle messaging. */
import { vi } from 'vitest';

import type {
  AnalyticsSink,
  ConsentDecision,
  ConsentProvider,
  EmailSendRequest,
  EmailSender,
  EngagementAdapters,
  LedgerClaim,
  LedgerRow,
  PushSender,
  SendLedger,
  UserFactsProvider,
} from '../adapters/types';
import type { LifecycleFacts, WeekActivity, WeeklyReportFacts } from '../facts';
import type { RenderedPush } from '../render/push';

export const USER = '11111111-1111-4111-8111-111111111111';

export const week = (o: Partial<WeekActivity> = {}): WeekActivity => ({
  activeDays: 0,
  meals: { count: 0, days: 0 },
  photoMeals: 0,
  workouts: { count: 0, minutes: 0 },
  checkIns: 0,
  steps: null,
  water: null,
  weight: null,
  ...o,
});

export function weeklyFacts(o: Partial<WeeklyReportFacts> = {}): WeeklyReportFacts {
  return {
    profile: {
      userId: USER,
      email: 'sam@example.com',
      firstName: 'Sam',
      timezone: 'America/New_York',
      weightUnit: 'lbs',
      createdAt: '2026-09-01T00:00:00Z',
      isAdmin: false,
    },
    weekKey: '2026-W44',
    weekStart: '2026-10-26',
    weekEnd: '2026-11-01',
    thisWeek: week({ activeDays: 4, meals: { count: 9, days: 4 }, checkIns: 4 }),
    lastWeek: week({ activeDays: 3, meals: { count: 6, days: 3 }, checkIns: 3 }),
    bestPriorActiveDays: 5,
    activeDaysPrior4Weeks: 12,
    streak: { current: 3, longest: 9 },
    goals: { dailyStepsTarget: null, dailyWaterMlTarget: null, targetWeightKg: null },
    circles: [],
    referral: { code: 'SAM7K', link: 'https://www.fitcircle.ai/i/SAM7K', rewardDays: 7, qualifyingDays: 3 },
    fitzyUsed: true,
    mealsEver: 40,
    photoMealsEver: 20,
    campaigns: [],
    recentGrowthSlots: [],
    ...o,
  };
}

export function lifecycleFacts(o: Partial<LifecycleFacts> = {}): LifecycleFacts {
  return {
    profile: {
      userId: USER,
      email: 'sam@example.com',
      firstName: 'Sam',
      timezone: 'America/New_York',
      weightUnit: 'kg',
      createdAt: '2026-10-29T12:00:00Z',
      isAdmin: false,
    },
    today: '2026-10-31',
    localHour: 11,
    accountAgeHours: 30,
    mealsEver: 0,
    firstMealAt: null,
    lastActiveDate: null,
    streak: { current: 0, lastEngagementDate: null },
    circles: [],
    referral: null,
    recentSends: [],
    ...o,
  };
}

export class MemoryLedger implements SendLedger {
  rows: Array<LedgerRow & Record<string, any>> = [];
  available = true;
  private n = 0;
  async probe() {
    return this.available;
  }
  async claim(c: LedgerClaim) {
    if (!this.available) throw new Error('relation "engagement_sends" does not exist');
    if (this.rows.some((r) => r.user_id === c.userId && r.message_key === c.messageKey && r.period_key === c.periodKey && r.channel === c.channel)) return null;
    const id = `00000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`;
    this.rows.push({
      id,
      user_id: c.userId,
      message_key: c.messageKey,
      period_key: c.periodKey,
      channel: c.channel,
      status: c.status ?? 'pending',
      variant: c.variant,
      template_version: c.templateVersion,
      provider_id: null,
      goal_key: c.goalKey,
      created_at: new Date().toISOString(),
      sent_at: null,
      meta: { ...(c.meta ?? {}) },
    });
    return id;
  }
  async complete(id: string, o: { status: string; providerId?: string | null; meta?: Record<string, any> }) {
    const r = this.rows.find((x) => x.id === id)!;
    r.status = o.status;
    if (o.providerId) r.provider_id = o.providerId;
    if (o.meta) r.meta = { ...r.meta, ...o.meta };
  }
  async release(id: string) {
    this.rows = this.rows.filter((r) => !(r.id === id && r.status === 'pending'));
  }
  async recentForUser(userId: string) {
    return this.rows.filter((r) => r.user_id === userId);
  }
  async exists(userId: string, key: string, period: string, channel: string) {
    return this.rows.some((r) => r.user_id === userId && r.message_key === key && r.period_key === period && r.channel === channel);
  }
  async stamp(ref: { providerId?: string | null; sendId?: string | null }, field: string, at: string, meta?: Record<string, string>) {
    const r = this.rows.find((x) => (ref.sendId ? x.id === ref.sendId : x.provider_id === ref.providerId));
    if (!r || r[field]) return null;
    r[field] = at;
    if (meta) r.meta = { ...r.meta, ...meta };
    return r;
  }
}

export class MemoryConsent implements ConsentProvider {
  decision: ConsentDecision = { allowed: true, email: 'sam@example.com' };
  unsubscribed: Array<[string, string]> = [];
  suppressed: Array<[string, string]> = [];
  async emailAllowed() {
    return this.decision;
  }
  async unsubscribe(userId: string, scope: string) {
    this.unsubscribed.push([userId, scope]);
    return true;
  }
  async suppressEmail(userId: string, reason: string) {
    this.suppressed.push([userId, reason]);
  }
}

export class MemoryEmail implements EmailSender {
  sent: EmailSendRequest[] = [];
  next: { ok: true; providerId: string } | { ok: false; error: string } = { ok: true, providerId: 're_1' };
  async send(req: EmailSendRequest) {
    this.sent.push(req);
    return this.next;
  }
}

export class MemoryPush implements PushSender {
  sent: Array<[string, RenderedPush]> = [];
  next: { sent: true } | { sent: false; reason: string } = { sent: true };
  async send(userId: string, p: RenderedPush) {
    this.sent.push([userId, p]);
    return this.next;
  }
}

export class MemoryAnalytics implements AnalyticsSink {
  events: Array<{ userId: string; event: string; props: Record<string, any>; insertId?: string }> = [];
  track(userId: string, event: string, props: Record<string, any>, insertId?: string) {
    this.events.push({ userId, event, props, insertId });
  }
  names() {
    return this.events.map((e) => e.event);
  }
}

export function memoryAdapters(facts: Partial<UserFactsProvider> = {}) {
  const a = {
    facts: {
      lifecycleCandidates: vi.fn(async () => []),
      weeklyReportCandidates: vi.fn(async () => []),
      lifecycleFacts: vi.fn(async () => null),
      weeklyReportFacts: vi.fn(async () => null),
      ...facts,
    } as UserFactsProvider,
    consent: new MemoryConsent(),
    email: new MemoryEmail(),
    push: new MemoryPush(),
    ledger: new MemoryLedger(),
    analytics: new MemoryAnalytics(),
  };
  return a satisfies EngagementAdapters;
}
