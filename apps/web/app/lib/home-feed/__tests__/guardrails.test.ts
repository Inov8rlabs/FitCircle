import { describe, expect, it } from 'vitest';

import { DEFAULT_ORDER } from '../catalog';
import { applyGuardrails, dedupe, headerFirst, hydrationAboveReferral, nativeAdNotInFirst3, promoSpacing, violations } from '../guardrails';

const c = (...types: string[]) => types.map((type) => ({ id: type, type }));
const t = (cards: { type: string }[]) => cards.map((x) => x.type);
const guard = (...types: string[]) => t(applyGuardrails(c(...types)).cards);

/** Seeded PRNG so the property test is reproducible. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
function shuffle<T>(xs: T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe('G1 header first', () => {
  it('moves header to the top', () => {
    expect(t(headerFirst(c('charts', 'header', 'vitals')))).toEqual(['header', 'charts', 'vitals']);
    expect(guard('charts', 'vitals', 'header')).toEqual(['header', 'charts', 'vitals']);
  });

  it('offline_banner stays at index 0, header right after it', () => {
    expect(guard('charts', 'header', 'offline_banner', 'vitals')).toEqual(['offline_banner', 'header', 'charts', 'vitals']);
  });

  it('no header → nothing to pin', () => {
    expect(guard('charts', 'vitals')).toEqual(['charts', 'vitals']);
  });
});

describe('G2 no adjacent promos', () => {
  it('splits adjacent promos with the next utility card', () => {
    expect(guard('header', 'campaign', 'pro_upsell', 'vitals', 'charts')).toEqual(['header', 'campaign', 'vitals', 'pro_upsell', 'charts']);
  });

  it('three promos in a row', () => {
    expect(guard('header', 'campaign', 'pro_upsell', 'referral', 'vitals', 'charts', 'progress', 'body_comp', 'daily_goals')).toEqual([
      // referral at index 5 would be the 3rd promo in the first 6 (G3) → after progress
      'header', 'campaign', 'vitals', 'pro_upsell', 'charts', 'progress', 'referral', 'body_comp', 'daily_goals',
    ]);
  });

  it('re-inserts a trailing promo at the latest valid slot', () => {
    expect(guard('header', 'vitals', 'charts', 'campaign', 'pro_upsell')).toEqual(['header', 'vitals', 'pro_upsell', 'charts', 'campaign']);
  });

  it('drops a promo that can never be separated', () => {
    expect(guard('header', 'campaign', 'pro_upsell')).toEqual(['header', 'campaign']);
  });
});

describe('G3 max 2 promos in the first 6', () => {
  it('defers the third promo past position 6', () => {
    const out = guard('header', 'campaign', 'vitals', 'pro_upsell', 'charts', 'referral', 'progress', 'body_comp');
    expect(out.slice(0, 6).filter((x) => ['campaign', 'pro_upsell', 'referral'].includes(x))).toHaveLength(2);
    expect(out).toContain('referral');
    expect(violations(c(...out))).toEqual([]);
  });

  it('offline_banner does not count as a position', () => {
    const out = guard('offline_banner', 'header', 'campaign', 'vitals', 'pro_upsell', 'charts', 'progress', 'body_comp');
    expect(out).toEqual(['offline_banner', 'header', 'campaign', 'vitals', 'pro_upsell', 'charts', 'progress', 'body_comp']);
  });
});

describe('G4 hydration directly above referral', () => {
  it('pulls hydration to just above referral', () => {
    expect(t(hydrationAboveReferral(c('header', 'hydration', 'vitals', 'charts', 'referral')))).toEqual(['header', 'vitals', 'charts', 'hydration', 'referral']);
    expect(t(hydrationAboveReferral(c('header', 'referral', 'vitals', 'hydration')))).toEqual(['header', 'hydration', 'referral', 'vitals']);
  });

  it('is a no-op when either is absent or already paired', () => {
    expect(guard('header', 'hydration', 'vitals')).toEqual(['header', 'hydration', 'vitals']);
    expect(guard('header', 'vitals', 'referral')).toEqual(['header', 'vitals', 'referral']);
    expect(guard('header', 'hydration', 'referral', 'vitals')).toEqual(['header', 'hydration', 'referral', 'vitals']);
  });

  it('the hydration→referral pair moves as a unit when promos are spaced', () => {
    const out = guard('header', 'campaign', 'hydration', 'referral', 'pro_upsell', 'vitals', 'charts', 'progress');
    const h = out.indexOf('hydration');
    expect(out[h + 1]).toBe('referral');
    expect(violations(c(...out))).toEqual([]);
  });

  it('hydration directly above referral holds after a referral-after-progress layout (campaign leads)', () => {
    const out = guard('header', 'health_sync_banner', 'campaign', 'hydration', 'pro_upsell', 'streak_warning', 'daily_goals', 'fitzy_focus', 'progress', 'referral', 'vitals');
    expect(out).toEqual(['header', 'health_sync_banner', 'campaign', 'streak_warning', 'pro_upsell', 'daily_goals', 'fitzy_focus', 'progress', 'hydration', 'referral', 'vitals']);
  });
});

describe('G5 native_ad never in the first 3', () => {
  it('moves the ad to index 3', () => {
    expect(t(nativeAdNotInFirst3(c('native_ad', 'header', 'vitals', 'charts', 'progress')))).toEqual(['header', 'vitals', 'charts', 'native_ad', 'progress']);
    expect(guard('header', 'native_ad', 'vitals', 'charts', 'progress')).toEqual(['header', 'vitals', 'charts', 'native_ad', 'progress']);
  });

  it('never splits hydration→referral', () => {
    expect(t(nativeAdNotInFirst3(c('header', 'native_ad', 'vitals', 'hydration', 'referral')))).toEqual(['header', 'vitals', 'hydration', 'referral', 'native_ad']);
  });

  it('drops the ad when the feed is too short to place it at index ≥ 3', () => {
    expect(guard('header', 'native_ad', 'vitals')).toEqual(['header', 'vitals']);
  });

  it('counts positions without offline_banner', () => {
    expect(guard('offline_banner', 'header', 'vitals', 'native_ad', 'charts')).toEqual(['offline_banner', 'header', 'vitals', 'charts', 'native_ad']);
  });
});

describe('G6 dedupe', () => {
  it('keeps the first occurrence of an id', () => {
    expect(t(dedupe(c('header', 'vitals', 'header')))).toEqual(['header', 'vitals']);
    const r = applyGuardrails(c('header', 'vitals', 'vitals'));
    expect(t(r.cards)).toEqual(['header', 'vitals']);
    expect(r.adjustments).toContain('removed duplicate ids');
  });
});

describe('applyGuardrails', () => {
  it('a valid layout passes through unchanged with no adjustments', () => {
    const r = applyGuardrails(c('offline_banner', 'header', 'health_sync_banner', 'hydration', 'referral', 'streak_warning', 'pro_upsell', 'daily_goals', 'native_ad'));
    expect(r.adjustments).toEqual([]);
    expect(t(r.cards)).toEqual(['offline_banner', 'header', 'health_sync_banner', 'hydration', 'referral', 'streak_warning', 'pro_upsell', 'daily_goals', 'native_ad']);
  });

  it('records what it changed', () => {
    expect(applyGuardrails(c('vitals', 'header')).adjustments).toEqual(['header moved first']);
  });

  it('preserves the card objects (props/variant untouched)', () => {
    const cards = [
      { id: 'header', type: 'header' },
      { id: 'campaign:x', type: 'campaign', props: { slug: 'x' } },
      { id: 'referral', type: 'referral', variant: 'compact' },
      { id: 'vitals', type: 'vitals' },
    ];
    const out = applyGuardrails(cards).cards;
    expect(out).toContainEqual({ id: 'campaign:x', type: 'campaign', props: { slug: 'x' } });
    expect(out).toContainEqual({ id: 'referral', type: 'referral', variant: 'compact' });
  });

  it('empty input → empty output', () => {
    expect(applyGuardrails([]).cards).toEqual([]);
  });

  it('PROPERTY: every permutation/subset of the catalog comes out valid, keeping every utility card', () => {
    const rand = rng(42);
    for (let i = 0; i < 2000; i++) {
      const subset = shuffle([...DEFAULT_ORDER], rand).filter(() => rand() > 0.25);
      const out = applyGuardrails(c(...subset)).cards;
      const body = out.filter((x) => x.type !== 'offline_banner');
      expect(violations(body), subset.join(',')).toEqual([]);
      if (subset.includes('offline_banner')) expect(out[0].type).toBe('offline_banner');
      if (subset.includes('header')) expect(body[0].type).toBe('header');
      // Guardrails may only drop promos / the ad — never a utility or chrome card.
      for (const type of subset) {
        if (!['campaign', 'referral', 'pro_upsell', 'native_ad'].includes(type)) expect(t(out), subset.join(',')).toContain(type);
      }
    }
  });

  it('PROPERTY: the full catalog in any order keeps every card (there is always room)', () => {
    const rand = rng(7);
    for (let i = 0; i < 500; i++) {
      const r = applyGuardrails(c(...shuffle([...DEFAULT_ORDER], rand)));
      expect(r.cards).toHaveLength(DEFAULT_ORDER.length);
      expect(r.adjustments.some((a) => a.startsWith('fallback'))).toBe(false);
    }
  });

  it('promoSpacing alone never reorders non-promo cards relative to each other', () => {
    const input = c('header', 'campaign', 'referral', 'vitals', 'pro_upsell', 'charts', 'progress');
    const utilities = (xs: string[]) => xs.filter((x) => !['campaign', 'referral', 'pro_upsell'].includes(x));
    expect(utilities(t(promoSpacing(input)))).toEqual(utilities(t(input)));
  });
});
