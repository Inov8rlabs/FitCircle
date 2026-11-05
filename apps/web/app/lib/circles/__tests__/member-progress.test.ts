import { describe, expect, it } from 'vitest';

import {
  buildMemberEntries,
  buildMemberSummary,
  dayOf,
  memberProgressVisibility,
  parsePrivacyPrefs,
  resolveCircleMetric,
  toLegacyWeightEntries,
  type RawMetricRow,
} from '../member-progress';

const PERIOD = { start: '2026-11-02', end: '2026-11-30' };

/**
 * Anki in "Nov steps challenge" as prod had it on Nov 3 (member-local): a real
 * Nov 2 total, Nov 3 so far, and the 0-step Nov 4 row an old iOS build wrote
 * for "tomorrow". The old route sent these as `weight` → 22,286.5 / 3,498.7 /
 * 0.0 lbs.
 */
const ANKI_ON_NOV_3: RawMetricRow[] = [
  { id: 'nov4', date: '2026-11-04', value: 0, is_public: true },
  { id: 'nov3', date: '2026-11-03', value: 1587, is_public: true },
  { id: 'nov2', date: '2026-11-02', value: 10109, is_public: true },
  { id: 'oct31', date: '2026-10-31', value: 9380, is_public: true },
];

describe('resolveCircleMetric', () => {
  it('maps each circle type to its own metric and unit', () => {
    expect(resolveCircleMetric('step_count', null)).toMatchObject({ metric: 'steps', unit: 'steps', aggregation: 'daily_total' });
    expect(resolveCircleMetric('weight_loss', null)).toMatchObject({ metric: 'weight', unit: 'kg', aggregation: 'measurement' });
    expect(resolveCircleMetric('workout_minutes', null)).toMatchObject({ metric: 'workout_minutes', unit: 'min' });
  });

  it('a custom circle follows its challenge', () => {
    const reps = resolveCircleMetric('custom', { id: 'c1', name: 'Pushups', unit: 'reps', goal_amount: 1000 });
    expect(reps).toMatchObject({ metric: 'custom', unit: 'reps', label: 'Pushups', source: { table: 'challenge_logs', challengeId: 'c1' } });
    expect(resolveCircleMetric('custom', { id: 'c2', name: 'Walk', unit: 'steps', goal_amount: 1 }).metric).toBe('steps');
    expect(resolveCircleMetric('custom', { id: 'c3', name: 'Cut', unit: 'lbs', goal_amount: 1 }).metric).toBe('weight');
  });

  it('a custom circle without a challenge (or an unknown type) tracks nothing — never weight by default', () => {
    expect(resolveCircleMetric('custom', null)).toMatchObject({ metric: 'none', source: null });
    expect(resolveCircleMetric('workout_frequency', null).metric).toBe('none');
    expect(resolveCircleMetric(null, null).metric).toBe('none');
  });
});

describe('buildMemberEntries — steps circle', () => {
  const entries = buildMemberEntries(ANKI_ON_NOV_3, {
    metric: 'steps',
    aggregation: 'daily_total',
    today: '2026-11-03',
    period: PERIOD,
    isOwner: false,
  });

  it('drops the 0-step placeholder, future days and days before the circle', () => {
    expect(entries.map((e) => e.date)).toEqual(['2026-11-03', '2026-11-02']);
  });

  it('keeps the step totals as steps, newest first, change against the OLDER day', () => {
    expect(entries).toEqual([
      { id: 'nov3', date: '2026-11-03', value: 1587, change: 1587 - 10109, is_public: true, note: null },
      { id: 'nov2', date: '2026-11-02', value: 10109, change: null, is_public: true, note: null },
    ]);
  });

  it('dates are date-only strings (no time to render)', () => {
    for (const e of entries) expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('sums several rows of the same day for daily totals', () => {
    const out = buildMemberEntries(
      [
        { id: 'a', date: '2026-11-03', value: 20 },
        { id: 'b', date: '2026-11-03', value: '25' },
      ],
      { metric: 'workout_minutes', aggregation: 'daily_total', today: '2026-11-05', period: PERIOD, isOwner: true }
    );
    expect(out).toEqual([{ id: 'a', date: '2026-11-03', value: 45, change: null, is_public: true, note: null }]);
  });
});

describe('buildMemberEntries — weight circle, delta sign', () => {
  const rows: RawMetricRow[] = [
    { id: 'w1', date: '2026-11-01', value: 94 },
    { id: 'w3', date: '2026-11-05', value: '89.4' },
    { id: 'w2', date: '2026-11-03', value: 89 },
  ];
  const entries = buildMemberEntries(rows, {
    metric: 'weight',
    aggregation: 'measurement',
    today: '2026-11-05',
    period: { start: '2026-11-01', end: '2026-11-30' },
    isOwner: false,
  });

  it('sorts newest first whatever the row order', () => {
    expect(entries.map((e) => e.id)).toEqual(['w3', 'w2', 'w1']);
  });

  it('change = newer − older: a loss is negative, a gain positive', () => {
    expect(entries.find((e) => e.id === 'w2')!.change).toBe(-5); // 94 → 89: lost 5
    expect(entries.find((e) => e.id === 'w3')!.change).toBe(0.4); // 89 → 89.4: gained 0.4
    expect(entries.find((e) => e.id === 'w1')!.change).toBeNull();
  });
});

describe('buildMemberEntries — privacy per row', () => {
  const rows: RawMetricRow[] = [
    { id: 'pub', date: '2026-11-02', value: 5000, is_public: true },
    { id: 'priv', date: '2026-11-03', value: 7000, is_public: false },
  ];
  const opts = { metric: 'steps' as const, aggregation: 'daily_total' as const, today: '2026-11-05', period: PERIOD };

  it('a row the member made private is left out for others', () => {
    expect(buildMemberEntries(rows, { ...opts, isOwner: false }).map((e) => e.id)).toEqual(['pub']);
  });

  it('the member still sees it', () => {
    expect(buildMemberEntries(rows, { ...opts, isOwner: true }).map((e) => e.id)).toEqual(['priv', 'pub']);
  });
});

describe('buildMemberSummary', () => {
  it('steps: total, average, best day, today, and the stored goal %', () => {
    const entries = buildMemberEntries(
      [
        { id: '1', date: '2026-11-02', value: 10109 },
        { id: '2', date: '2026-11-03', value: 6551 },
        { id: '3', date: '2026-11-04', value: 9130 },
        { id: '4', date: '2026-11-05', value: 3007 },
      ],
      { metric: 'steps', aggregation: 'daily_total', today: '2026-11-05', period: PERIOD, isOwner: false }
    );
    const summary = buildMemberSummary(entries, {
      metric: 'steps',
      aggregation: 'daily_total',
      today: '2026-11-05',
      goal: '224000.00',
      storedProgressPct: '12.86',
    });
    expect(summary).toMatchObject({
      total: 28797,
      daily_average: 7199,
      days_logged: 4,
      best_day: { date: '2026-11-02', value: 10109 },
      today_value: 3007,
      goal: 224000,
      progress_percentage: 12.9,
      starting: null,
      current: null,
      target: null,
      change: null,
    });
  });

  it('steps without a stored % derive it from the goal; nothing logged today → null', () => {
    const entries = buildMemberEntries([{ id: '1', date: '2026-11-02', value: 11200 }], {
      metric: 'steps',
      aggregation: 'daily_total',
      today: '2026-11-05',
      period: PERIOD,
      isOwner: true,
    });
    const s = buildMemberSummary(entries, { metric: 'steps', aggregation: 'daily_total', today: '2026-11-05', goal: 224000 });
    expect(s.progress_percentage).toBe(5);
    expect(s.today_value).toBeNull();
  });

  it('weight: start / current / target in kg and change = current − start (negative = lost)', () => {
    const entries = buildMemberEntries(
      [
        { id: 'a', date: '2026-11-01', value: 94 },
        { id: 'b', date: '2026-11-05', value: 89 },
      ],
      { metric: 'weight', aggregation: 'measurement', today: '2026-11-05', period: PERIOD, isOwner: true }
    );
    const s = buildMemberSummary(entries, {
      metric: 'weight',
      aggregation: 'measurement',
      today: '2026-11-05',
      weight: { startKg: 94, currentKg: 89, targetKg: 84, progressPct: 50 },
    });
    expect(s).toMatchObject({ starting: 94, current: 89, target: 84, change: -5, progress_percentage: 50, total: null });
  });

  it('no entries: zero total, no average / best day', () => {
    const s = buildMemberSummary([], { metric: 'steps', aggregation: 'daily_total', today: '2026-11-05' });
    expect(s).toMatchObject({ total: 0, daily_average: null, days_logged: 0, best_day: null, progress_percentage: null });
  });
});

describe('memberProgressVisibility', () => {
  const visible = parsePrivacyPrefs({});
  const base = { isOwner: false, viewerInCircle: true, privacy: visible };

  it('defaults are visible (a member who never chose)', () => {
    expect(parsePrivacyPrefs(null)).toEqual({ profile_visibility: 'public', show_weight: true, show_progress: true });
    expect(memberProgressVisibility({ ...base, metric: 'steps' })).toEqual({ can_view: true, hidden_reason: null });
  });

  it('show_weight off hides a weight circle but not a steps circle', () => {
    const privacy = parsePrivacyPrefs({ show_weight: false });
    expect(memberProgressVisibility({ ...base, privacy, metric: 'weight' })).toEqual({ can_view: false, hidden_reason: 'weight_private' });
    expect(memberProgressVisibility({ ...base, privacy, metric: 'steps' }).can_view).toBe(true);
  });

  it('show_progress off hides every metric', () => {
    const privacy = parsePrivacyPrefs({ show_progress: false });
    for (const metric of ['steps', 'weight', 'workout_minutes', 'custom'] as const) {
      expect(memberProgressVisibility({ ...base, privacy, metric }).can_view).toBe(false);
    }
  });

  it('a private profile and a viewer outside the circle see nothing; the owner always sees', () => {
    const privacy = parsePrivacyPrefs({ profile_visibility: 'private', show_weight: false, show_progress: false });
    expect(memberProgressVisibility({ ...base, privacy, metric: 'steps' }).hidden_reason).toBe('profile_private');
    expect(memberProgressVisibility({ ...base, viewerInCircle: false, metric: 'steps' }).hidden_reason).toBe('not_in_circle');
    expect(memberProgressVisibility({ isOwner: true, viewerInCircle: false, privacy, metric: 'weight' }).can_view).toBe(true);
  });
});

describe('helpers', () => {
  it('dayOf reads the date part of the formats fitcircles / challenges use', () => {
    expect(dayOf('2026-11-02 00:00:00+00')).toBe('2026-11-02');
    expect(dayOf('2026-11-30T05:00:00Z')).toBe('2026-11-30');
    expect(dayOf(null)).toBeNull();
  });

  it('legacy entries carry the weight in `weight` and the note under both keys', () => {
    expect(
      toLegacyWeightEntries([{ id: 'x', date: '2026-11-05', value: 89, change: -0.5, is_public: true, note: 'ok' }])
    ).toEqual([{ id: 'x', date: '2026-11-05', weight: 89, weight_change: -0.5, is_public: true, note: 'ok', notes: 'ok' }]);
  });
});
