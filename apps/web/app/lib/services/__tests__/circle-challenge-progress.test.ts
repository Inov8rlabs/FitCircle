import { describe, expect, it } from 'vitest';

import {
  completionPct,
  computeProgress,
  normalizeLogAmount,
  normalizeLogNote,
  presentCategory,
  reconcileMilestones,
  utcDay,
} from '../circle-challenge-progress';

const log = (amount: number | string, loggedAt: string) => ({
  amount,
  logged_at: loggedAt,
  log_date: loggedAt.slice(0, 10),
});

describe('normalizeLogAmount', () => {
  it('keeps amounts inside 0.01 … 10000 and rounds to the 2 decimals the column stores', () => {
    expect(normalizeLogAmount(25)).toBe(25);
    expect(normalizeLogAmount(0.01)).toBe(0.01);
    expect(normalizeLogAmount(10000)).toBe(10000);
    expect(normalizeLogAmount(2.345)).toBe(2.35);
    expect(normalizeLogAmount(1.005)).toBe(1.01);
  });

  it('rejects zero, negatives, amounts that round to zero, too large and non-numbers', () => {
    expect(normalizeLogAmount(0)).toBeNull();
    expect(normalizeLogAmount(-5)).toBeNull();
    expect(normalizeLogAmount(0.004)).toBeNull();
    expect(normalizeLogAmount(10000.01)).toBeNull();
    expect(normalizeLogAmount(Number.NaN)).toBeNull();
    expect(normalizeLogAmount(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeLogAmount('25')).toBeNull();
    expect(normalizeLogAmount(null)).toBeNull();
    expect(normalizeLogAmount(undefined)).toBeNull();
  });
});

describe('normalizeLogNote', () => {
  it('trims, cuts to 80 characters and turns empty into null', () => {
    expect(normalizeLogNote('  morning set  ')).toBe('morning set');
    expect(normalizeLogNote('x'.repeat(200))).toHaveLength(80);
    expect(normalizeLogNote('   ')).toBeNull();
    expect(normalizeLogNote('')).toBeNull();
    expect(normalizeLogNote(null)).toBeNull();
    expect(normalizeLogNote(undefined)).toBeNull();
    expect(normalizeLogNote(42)).toBeNull();
  });
});

describe('completionPct', () => {
  it('is a 0–100 percentage with 2 decimals, capped at 100', () => {
    expect(completionPct(0, 500)).toBe(0);
    expect(completionPct(125, 500)).toBe(25);
    expect(completionPct(1, 3)).toBe(33.33);
    expect(completionPct(2, 3)).toBe(66.67);
    expect(completionPct(900, 500)).toBe(100);
  });

  it('never divides by a zero or missing goal', () => {
    expect(completionPct(10, 0)).toBe(0);
    expect(completionPct(10, Number.NaN)).toBe(0);
  });
});

describe('computeProgress', () => {
  it('is all zeros with no logs', () => {
    expect(computeProgress([], 500, '2026-09-28')).toEqual({
      cumulative_total: 0,
      today_total: 0,
      log_count: 0,
      goal_completion_pct: 0,
      current_streak: 0,
      longest_streak: 0,
      last_logged_at: null,
    });
  });

  it('sums every log into the total and only today (UTC) into today_total', () => {
    const progress = computeProgress(
      [
        log(100, '2026-09-27T09:00:00.000Z'),
        log(25.5, '2026-09-28T08:00:00.000Z'),
        log(24.5, '2026-09-28T20:00:00.000Z'),
      ],
      500,
      '2026-09-28'
    );
    expect(progress.cumulative_total).toBe(150);
    expect(progress.today_total).toBe(50);
    expect(progress.log_count).toBe(3);
    expect(progress.goal_completion_pct).toBe(30);
    expect(progress.last_logged_at).toBe('2026-09-28T20:00:00.000Z');
  });

  it('does not accumulate floating point noise', () => {
    const progress = computeProgress(
      [log(0.1, '2026-09-28T08:00:00.000Z'), log(0.2, '2026-09-28T09:00:00.000Z')],
      10,
      '2026-09-28'
    );
    expect(progress.cumulative_total).toBe(0.3);
    expect(progress.today_total).toBe(0.3);
    expect(progress.goal_completion_pct).toBe(3);
  });

  it('accepts numeric strings (PostgREST can return numeric as text) and any input order', () => {
    const progress = computeProgress(
      [log('30.00', '2026-09-28T10:00:00+00:00'), log('20.00', '2026-09-27T10:00:00+00:00')],
      100,
      '2026-09-28'
    );
    expect(progress.cumulative_total).toBe(50);
    expect(progress.today_total).toBe(30);
    expect(progress.last_logged_at).toBe('2026-09-28T10:00:00+00:00');
  });

  it('caps the percentage at 100 when the goal is exceeded', () => {
    expect(computeProgress([log(800, '2026-09-28T10:00:00Z')], 500, '2026-09-28').goal_completion_pct).toBe(100);
  });

  describe('streak', () => {
    it('starts at 1 and does not grow with more logs on the same day', () => {
      const progress = computeProgress(
        [log(10, '2026-09-28T08:00:00Z'), log(10, '2026-09-28T12:00:00Z'), log(10, '2026-09-28T18:00:00Z')],
        500,
        '2026-09-28'
      );
      expect(progress.current_streak).toBe(1);
      expect(progress.longest_streak).toBe(1);
    });

    it('grows by one per consecutive day', () => {
      const progress = computeProgress(
        [log(10, '2026-09-26T08:00:00Z'), log(10, '2026-09-27T08:00:00Z'), log(10, '2026-09-28T08:00:00Z')],
        500,
        '2026-09-28'
      );
      expect(progress.current_streak).toBe(3);
      expect(progress.longest_streak).toBe(3);
    });

    it('survives a gap of up to 36 hours and restarts after a longer one', () => {
      // 23:00 → 01:00 two days later is 26 h: kept (PRD grace period).
      const kept = computeProgress(
        [log(10, '2026-09-25T23:00:00Z'), log(10, '2026-09-27T01:00:00Z')],
        500,
        '2026-09-27'
      );
      expect(kept.current_streak).toBe(2);

      const broken = computeProgress(
        [
          log(10, '2026-09-20T08:00:00Z'),
          log(10, '2026-09-21T08:00:00Z'),
          log(10, '2026-09-22T08:00:00Z'),
          log(10, '2026-09-28T08:00:00Z'),
        ],
        500,
        '2026-09-28'
      );
      expect(broken.current_streak).toBe(1);
      expect(broken.longest_streak).toBe(3);
    });
  });
});

describe('reconcileMilestones', () => {
  it('reports a milestone when a threshold is crossed and flags it', () => {
    expect(reconcileMilestones({}, 20, 30)).toEqual({ milestones: { milestone_25: true }, reached: 25 });
  });

  it('reports nothing when no threshold is crossed', () => {
    expect(reconcileMilestones({ milestone_25: true }, 30, 40)).toEqual({
      milestones: { milestone_25: true },
      reached: null,
    });
  });

  it('flags every threshold a big log jumps over and reports the highest one', () => {
    expect(reconcileMilestones({}, 0, 80)).toEqual({
      milestones: { milestone_25: true, milestone_50: true, milestone_75: true },
      reached: 75,
    });
    expect(reconcileMilestones(null, 90, 100).reached).toBe(100);
  });

  it('does not celebrate the same milestone twice', () => {
    expect(reconcileMilestones({ milestone_25: true, milestone_50: true }, 49, 55).reached).toBeNull();
  });

  it('clears flags above the new percentage so they can be earned again after a delete', () => {
    const afterDelete = reconcileMilestones({ milestone_25: true, milestone_50: true }, 60, 30);
    expect(afterDelete).toEqual({ milestones: { milestone_25: true }, reached: null });
    expect(reconcileMilestones(afterDelete.milestones, 30, 55).reached).toBe(50);
  });
});

describe('presentCategory', () => {
  it('passes the five values the iOS enum knows through unchanged', () => {
    for (const category of ['strength', 'cardio', 'flexibility', 'wellness', 'custom']) {
      expect(presentCategory(category)).toBe(category);
    }
  });

  it('presents anything else as custom', () => {
    expect(presentCategory('mixed')).toBe('custom');
    expect(presentCategory('weight_loss')).toBe('custom');
    expect(presentCategory('Strength')).toBe('custom');
    expect(presentCategory('')).toBe('custom');
    expect(presentCategory(null)).toBe('custom');
    expect(presentCategory(undefined)).toBe('custom');
  });
});

describe('utcDay', () => {
  it('is the UTC calendar day, whatever the server time zone', () => {
    expect(utcDay(new Date('2026-09-28T23:59:59.999Z'))).toBe('2026-09-28');
    expect(utcDay(new Date('2026-09-29T00:00:00.000Z'))).toBe('2026-09-29');
  });
});
