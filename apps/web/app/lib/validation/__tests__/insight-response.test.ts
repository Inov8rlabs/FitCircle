import { describe, expect, it } from 'vitest';

import { toClientInsight, toClientInsights } from '../insight-response';

const good = {
  id: 'protein__energy',
  headline: 'Higher energy tends to show up on higher-protein days',
  detail: 'Just an observation, not a rule.',
  signalA: 'protein',
  signalB: 'energy',
  correlation: 0.42,
  sampleDays: 12,
  confidence: 'low',
};

describe('toClientInsights', () => {
  it('returns a well-formed insight unchanged', () => {
    expect(toClientInsights([good])).toEqual([good]);
  });

  it('keeps body-composition insights (correlation 0) as they are', () => {
    const bodyComp = {
      id: 'bodyComp__scan_cadence',
      headline: 'A steady scan rhythm is building a clear picture',
      detail: 'You have logged 4 scans.',
      signalA: 'bodyComp',
      signalB: 'bodyComp',
      correlation: 0,
      sampleDays: 4,
      confidence: 'medium',
    };
    expect(toClientInsights([bodyComp])).toEqual([bodyComp]);
  });

  it('fills signalA / signalB from the id when they are null or missing (old Android requires them)', () => {
    const { signalA: _a, ...withoutA } = good;
    const out = toClientInsights([{ ...withoutA, signalB: null }]);
    expect(out[0].signalA).toBe('protein');
    expect(out[0].signalB).toBe('energy');
  });

  it('never returns null for signalA / signalB even when the id has no pairing', () => {
    const out = toClientInsight({ ...good, id: 'weekly_summary', signalA: null, signalB: undefined });
    expect(out?.signalA).toBe('weekly_summary');
    expect(out?.signalB).toBe('');
    expect(typeof out?.signalB).toBe('string');
  });

  it('defaults a missing / NaN correlation and sampleDays to 0', () => {
    const out = toClientInsight({ ...good, correlation: NaN, sampleDays: null });
    expect(out?.correlation).toBe(0);
    expect(out?.sampleDays).toBe(0);
    expect(toClientInsight({ ...good, sampleDays: 7.6 })?.sampleDays).toBe(8);
    expect(toClientInsight({ ...good, sampleDays: -3 })?.sampleDays).toBe(0);
  });

  it('defaults an unknown confidence to "low"', () => {
    expect(toClientInsight({ ...good, confidence: 'high' })?.confidence).toBe('low');
    expect(toClientInsight({ ...good, confidence: null })?.confidence).toBe('low');
    expect(toClientInsight({ ...good, confidence: 'medium' })?.confidence).toBe('medium');
  });

  it('drops an insight that has no id, headline or detail instead of failing the list', () => {
    const out = toClientInsights([
      good,
      { ...good, id: null },
      { ...good, headline: '' },
      { ...good, detail: undefined },
      null,
      'nope',
    ]);
    expect(out).toEqual([good]);
  });

  it('always returns an array', () => {
    expect(toClientInsights(null)).toEqual([]);
    expect(toClientInsights(undefined)).toEqual([]);
    expect(toClientInsights({})).toEqual([]);
    expect(toClientInsights([])).toEqual([]);
  });

  it('every returned insight has the required keys with the right types', () => {
    const out = toClientInsights([good, { id: 'a__b', headline: 'h', detail: 'd' }]);
    for (const insight of out) {
      expect(typeof insight.id).toBe('string');
      expect(typeof insight.headline).toBe('string');
      expect(typeof insight.detail).toBe('string');
      expect(typeof insight.signalA).toBe('string');
      expect(typeof insight.signalB).toBe('string');
      expect(Number.isFinite(insight.correlation)).toBe(true);
      expect(Number.isInteger(insight.sampleDays)).toBe(true);
      expect(['low', 'medium']).toContain(insight.confidence);
    }
  });
});
