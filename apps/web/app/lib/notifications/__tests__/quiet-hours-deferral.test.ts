import { describe, expect, it } from 'vitest';

import { DEFERRABLE_TYPES, planDeferral, planRelease, quietHoursEndAt, type DeferredRow } from '../quiet-hours-deferral';

const CHI = 'America/Chicago';

describe('quietHoursEndAt', () => {
  it('overnight window: 23:30 local → 07:00 next morning local', () => {
    // 05:30Z = 23:30 Chicago (CST, UTC-6)
    expect(quietHoursEndAt(new Date('2026-11-10T05:30:00Z'), CHI, '07:00:00').toISOString()).toBe('2026-11-10T13:00:00.000Z');
  });
  it('after midnight: 02:15 local → 07:00 the same morning', () => {
    expect(quietHoursEndAt(new Date('2026-11-10T08:15:42Z'), CHI, '07:00').toISOString()).toBe('2026-11-10T13:00:00.000Z');
  });
});

describe('planDeferral', () => {
  const night = new Date('2026-11-10T05:30:00Z'); // 23:30 Chicago
  it('only setup / meal / Day-1 nudges are deferrable', () => {
    expect([...DEFERRABLE_TYPES].sort()).toEqual(
      ['day1_morning', 'meal_reminder_breakfast', 'meal_reminder_dinner', 'meal_reminder_lunch', 'meal_reminder_snack', 'onboarding_finish_reminder'].sort()
    );
    expect(planDeferral('chat_message', night, CHI, '07:00')).toBeNull();
    expect(planDeferral('momentum_at_risk', night, CHI, '07:00')).toBeNull();
  });
  it('the setup nudge is held until 07:00 local, and expires 6 h later', () => {
    expect(planDeferral('onboarding_finish_reminder', night, CHI, '07:00')).toEqual({
      deferUntil: '2026-11-10T13:00:00.000Z',
      deferExpiresAt: '2026-11-10T19:00:00.000Z',
    });
  });
  it('a meal reminder is never carried into the next local day', () => {
    expect(planDeferral('meal_reminder_dinner', night, CHI, '07:00')).toBeNull();
    // 06:30 local, quiet until 09:00 (custom window): breakfast held to 09:00 the same day
    const early = new Date('2026-11-10T12:30:00Z');
    expect(planDeferral('meal_reminder_breakfast', early, CHI, '09:00')).toEqual({
      deferUntil: '2026-11-10T15:00:00.000Z',
      deferExpiresAt: '2026-11-10T17:00:00.000Z',
    });
  });
});

describe('planRelease', () => {
  const at = (iso: string) => new Date(iso);
  const row = (id: string, type: string, sent: string, until: string, expires: string): DeferredRow => ({
    id,
    user_id: 'u1',
    notification_type: type as any,
    sent_at: sent,
    data: { deferUntil: until, deferExpiresAt: expires },
  });
  const setupA = row('a', 'onboarding_finish_reminder', '2026-11-10T05:00:00Z', '2026-11-10T13:00:00Z', '2026-11-10T19:00:00Z');
  const setupB = row('b', 'onboarding_finish_reminder', '2026-11-10T06:00:00Z', '2026-11-10T13:00:00Z', '2026-11-10T19:00:00Z');
  const day1 = row('c', 'day1_morning', '2026-11-10T06:30:00Z', '2026-11-10T13:00:00Z', '2026-11-10T16:00:00Z');

  it('nothing before quiet hours end', () => {
    const p = planRelease([setupA], at('2026-11-10T12:45:00Z'), false);
    expect(p.release).toBeNull();
    expect(p.waiting.map((r) => r.id)).toEqual(['a']);
    expect(p.close).toEqual([]);
  });
  it('at most one per user: highest priority released, the rest superseded (no stack)', () => {
    const p = planRelease([setupA, setupB, day1], at('2026-11-10T13:05:00Z'), false);
    expect(p.release?.id).toBe('c');
    expect(p.close.map((c) => [c.row.id, c.outcome]).sort()).toEqual([
      ['a', 'deferred_superseded'],
      ['b', 'deferred_superseded'],
    ]);
  });
  it('the most recent of the same type wins', () => {
    expect(planRelease([setupA, setupB], at('2026-11-10T13:05:00Z'), false).release?.id).toBe('b');
  });
  it('already released one this morning → everything due is superseded', () => {
    const p = planRelease([setupA], at('2026-11-10T13:05:00Z'), true);
    expect(p.release).toBeNull();
    expect(p.close).toEqual([{ row: setupA, outcome: 'deferred_superseded' }]);
  });
  it('past the release window → expired, never sent late', () => {
    const p = planRelease([day1], at('2026-11-10T16:00:00Z'), false);
    expect(p.release).toBeNull();
    expect(p.close).toEqual([{ row: day1, outcome: 'deferred_expired' }]);
  });
  it('malformed hold → expired', () => {
    const bad: DeferredRow = { ...setupA, id: 'x', data: {} };
    expect(planRelease([bad], at('2026-11-10T13:05:00Z'), false).close[0].outcome).toBe('deferred_expired');
  });
});
