import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { insights: [] as any[] };

vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async () => ({ id: 'user-1' }),
}));
vi.mock('@/lib/services/usage-service', () => ({
  UsageService: { historyWindowDays: async () => Infinity },
}));
vi.mock('@/lib/services/cross-signal-service', () => ({
  CrossSignalService: { getInsights: async () => state.insights },
}));

import { GET } from '../route';

const get = () => GET(new Request('http://localhost/api/mobile/insights?lookbackDays=30') as any);

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

/** Non-optional fields per client model. */
const IOS_REQUIRED = ['id', 'headline', 'detail', 'confidence']; // Nutrition.swift Insight
const ANDROID_OLD_REQUIRED = ['id', 'headline', 'detail', 'signalA', 'signalB']; // NutritionModels.kt @ f39f4b3

describe('GET /api/mobile/insights', () => {
  beforeEach(() => {
    state.insights = [];
  });

  it('returns what the service produced, unchanged, in the same envelope', async () => {
    state.insights = [good];
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.error).toBeNull();
    expect(body.data).toEqual([good]);
    expect(body.meta.count).toBe(1);
  });

  it('never sends null / missing values for fields a client treats as required', async () => {
    state.insights = [
      good,
      { ...good, id: 'calories__mood', signalA: null, signalB: undefined, correlation: NaN, sampleDays: null, confidence: null },
    ];
    const body = await (await get()).json();
    expect(body.data).toHaveLength(2);
    for (const insight of body.data) {
      for (const key of [...IOS_REQUIRED, ...ANDROID_OLD_REQUIRED]) {
        expect(insight[key]).not.toBeNull();
        expect(insight[key]).not.toBeUndefined();
      }
      expect(typeof insight.correlation).toBe('number');
      expect(typeof insight.sampleDays).toBe('number');
    }
    expect(body.data[1]).toMatchObject({
      signalA: 'calories',
      signalB: 'mood',
      correlation: 0,
      sampleDays: 0,
      confidence: 'low',
    });
  });

  it('drops an undecodable insight instead of failing the whole list on the client', async () => {
    state.insights = [{ ...good, headline: null }, good];
    const body = await (await get()).json();
    expect(body.data).toEqual([good]);
    expect(body.meta.count).toBe(1);
  });

  it('an empty result is an empty array', async () => {
    const body = await (await get()).json();
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
  });
});
