/** Timezone windows, ISO weeks, UTM link building and holdout assignment. */
import { afterEach, describe, expect, it } from 'vitest';

import { holdoutPct, isHoldout } from '../config';
import { appScreenUrl, campaignUrl, ctaIdFromUrl, trackedUrl } from '../links';
import { isoWeekBounds, isoWeekKey, isoWeekStart, localClock, userTimezone } from '../time';

import { USER } from './fixtures';

describe('time', () => {
  it('ISO week keys (incl. year boundaries) round-trip', () => {
    expect(isoWeekKey('2026-10-31')).toBe('2026-W44');
    expect(isoWeekKey('2026-11-01')).toBe('2026-W44'); // Sunday belongs to the week it ends
    expect(isoWeekKey('2026-11-02')).toBe('2026-W45');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
    expect(isoWeekKey('2021-01-03')).toBe('2020-W53');
    expect(isoWeekStart('2026-W44')).toBe('2026-10-26');
    expect(isoWeekStart('2026-W53')).toBe('2026-12-28');
    expect(isoWeekStart('2025-W53')).toBeNull();
    expect(isoWeekBounds('2026-11-01')).toEqual({ start: '2026-10-26', end: '2026-11-01' });
  });

  it('local Sunday 6pm differs per timezone for the same instant', () => {
    const now = new Date('2026-11-01T23:30:00Z'); // after US DST ends
    expect(localClock('America/New_York', now)).toMatchObject({ date: '2026-11-01', hour: 18, isoWeekday: 7 });
    expect(localClock('America/Los_Angeles', now)).toMatchObject({ date: '2026-11-01', hour: 15, isoWeekday: 7 });
    expect(localClock('Asia/Kolkata', now)).toMatchObject({ date: '2026-11-02', hour: 5, isoWeekday: 1 });
  });

  it('unset / UTC timezones fall back to the default zone', () => {
    expect(userTimezone(null)).toBe('America/Los_Angeles');
    expect(userTimezone('UTC')).toBe('America/Los_Angeles');
    expect(userTimezone('Not/AZone')).toBe('America/Los_Angeles');
    expect(userTimezone('Europe/London')).toBe('Europe/London');
  });
});

describe('links', () => {
  it('adds UTM + msg params to FitCircle links', () => {
    const u = new URL(
      trackedUrl(appScreenUrl('food_log'), { messageKey: 'weekly_report', medium: 'lifecycle', content: 'best_week', ctaId: 'primary', sendId: '00000000-0000-4000-8000-000000000001' })
    );
    expect(u.origin).toBe('https://fitcircle.ai');
    expect(u.pathname).toBe('/open');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      screen: 'food_log',
      utm_source: 'email',
      utm_medium: 'lifecycle',
      utm_campaign: 'weekly_report',
      utm_content: 'best_week',
      utm_term: 'primary',
      msg: 'weekly_report',
      msg_id: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('leaves third-party links alone and drops a malformed send id', () => {
    expect(trackedUrl('https://example.com/x', { messageKey: 'welcome', medium: 'transactional' })).toBe('https://example.com/x');
    expect(trackedUrl(campaignUrl('hold_the_line'), { messageKey: 'weekly_report', medium: 'lifecycle', sendId: 'nope' })).not.toContain('msg_id');
  });

  it('reads the CTA id back from a clicked link', () => {
    expect(ctaIdFromUrl(trackedUrl(appScreenUrl('dashboard'), { messageKey: 'weekly_report', medium: 'lifecycle', ctaId: 'growth' }))).toBe('growth');
    expect(ctaIdFromUrl('https://www.fitcircle.ai/api/engagement/unsubscribe?t=x')).toBe('unsubscribe');
    expect(ctaIdFromUrl('not a url')).toBeNull();
  });
});

describe('holdout', () => {
  afterEach(() => {
    delete process.env.ENGAGEMENT_HOLDOUTS;
  });

  it('defaults: weekly report 5 %, everything else 0', () => {
    expect(holdoutPct('weekly_report')).toBe(5);
    expect(holdoutPct('onboarding_first_meal')).toBe(0);
  });

  it('env override, clamped to 0–50', () => {
    process.env.ENGAGEMENT_HOLDOUTS = 'weekly_report:10,onboarding_first_meal:99';
    expect(holdoutPct('weekly_report')).toBe(10);
    expect(holdoutPct('onboarding_first_meal')).toBe(50);
  });

  it('is sticky per user and close to the configured share', () => {
    expect(isHoldout(USER, 'weekly_report', 5)).toBe(isHoldout(USER, 'weekly_report', 5));
    expect(isHoldout(USER, 'weekly_report', 0)).toBe(false);
    let n = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) if (isHoldout(`user-${i}`, 'weekly_report', 5)) n++;
    expect(n / N).toBeGreaterThan(0.04);
    expect(n / N).toBeLessThan(0.06);
  });

  it('different messages hold out different people', () => {
    let both = 0;
    for (let i = 0; i < 20_000; i++) if (isHoldout(`u${i}`, 'weekly_report', 10) && isHoldout(`u${i}`, 'reengage_comeback', 10)) both++;
    expect(both / 20_000).toBeLessThan(0.02);
  });
});
