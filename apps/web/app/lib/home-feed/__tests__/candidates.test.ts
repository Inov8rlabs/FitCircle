import { describe, expect, it } from 'vitest';

import { buildCandidates, clientSupports, ineligibleReason, parseClientCards } from '../candidates';
import { CATALOG, DEFAULT_ORDER, PROMO_TYPES, cardId, catalogEntry, defaultIndex, isPromo } from '../catalog';

import { IOS_SUPPORT, SPEC_SUPPORT, makeCtx, types, withCampaign } from './helpers';

describe('catalog', () => {
  it('has every default-order type at version 1, and the spec promo set', () => {
    expect(DEFAULT_ORDER).toHaveLength(17);
    expect(DEFAULT_ORDER.indexOf('missing_days')).toBe(DEFAULT_ORDER.indexOf('streak_warning') + 1);
    for (const t of DEFAULT_ORDER) expect(CATALOG[t]).toMatchObject({ type: t, version: 1 });
    expect([...PROMO_TYPES].sort()).toEqual(['campaign', 'pro_upsell', 'referral']);
    expect(isPromo('hydration')).toBe(false);
    expect(catalogEntry('toString')).toBeUndefined();
    expect(catalogEntry('future_card')).toBeUndefined();
    expect(defaultIndex('future_card')).toBe(DEFAULT_ORDER.length);
  });

  it('card ids are the type, or campaign:<slug>', () => {
    expect(cardId('hydration')).toBe('hydration');
    expect(cardId('campaign')).toBe('campaign');
    expect(cardId('campaign', { slug: 'hold_the_line' })).toBe('campaign:hold_the_line');
  });
});

describe('parseClientCards', () => {
  it('parses the spec list', () => {
    expect(SPEC_SUPPORT.size).toBe(17);
    for (const t of DEFAULT_ORDER) expect(SPEC_SUPPORT.get(t)).toBe(1);
  });

  it('iOS 1.0.8 does not declare missing_days, so it never gets it', () => {
    expect(IOS_SUPPORT.has('missing_days')).toBe(false);
    expect(types(buildCandidates(makeCtx(), IOS_SUPPORT).eligible)).not.toContain('missing_days');
    expect(types(buildCandidates(makeCtx(), SPEC_SUPPORT).eligible)).toContain('missing_days');
  });

  it('is lenient: whitespace, missing version = 1, duplicates keep max, junk ignored', () => {
    const s = parseClientCards(' header@1 , hydration ,referral@2,referral@1,BAD@1,x@y,a@1@2,,campaign@0,vitals@12345, charts@3');
    expect([...s.entries()]).toEqual([
      ['header', 1],
      ['hydration', 1],
      ['referral', 2],
      ['charts', 3],
    ]);
  });

  it('empty / missing → empty map', () => {
    expect(parseClientCards(null).size).toBe(0);
    expect(parseClientCards('').size).toBe(0);
    expect(parseClientCards(' , ,').size).toBe(0);
  });

  it('caps the number of tokens', () => {
    const many = Array.from({ length: 200 }, (_, i) => `card_${i}@1`).join(',');
    expect(parseClientCards(many).size).toBe(64);
  });

  it('clientSupports = type declared AND server version ≤ client version', () => {
    const s = parseClientCards('header@1,hydration@2');
    expect(clientSupports(s, 'header', 1)).toBe(true);
    expect(clientSupports(s, 'header', 2)).toBe(false);
    expect(clientSupports(s, 'hydration', 1)).toBe(true);
    expect(clientSupports(s, 'hydration', 2)).toBe(true);
    expect(clientSupports(s, 'referral', 1)).toBe(false);
  });
});

describe('buildCandidates', () => {
  it('only client-declared cards, in default order', () => {
    const { eligible, suppressed } = buildCandidates(makeCtx(withCampaign()), parseClientCards('charts@1,header@1,hydration@1'));
    expect(types(eligible)).toEqual(['header', 'hydration', 'charts']);
    expect(suppressed).toEqual([]);
  });

  it('a client declaring a lower version than the server catalog does not get the card', () => {
    const { eligible } = buildCandidates(makeCtx(), parseClientCards('header@1,hydration@0'));
    expect(types(eligible)).toEqual(['header']);
  });

  it('campaign carries props.slug and a slugged id when known', () => {
    const { eligible } = buildCandidates(makeCtx(withCampaign('advent_2026')), SPEC_SUPPORT);
    expect(eligible.find((c) => c.type === 'campaign')).toEqual({
      id: 'campaign:advent_2026',
      type: 'campaign',
      version: 1,
      props: { slug: 'advent_2026' },
    });
  });

  it.each([
    ['campaign', { campaign: { present: false, slug: null, phase: null } }, 'no_campaign'],
    ['referral', { referralProgramEnabled: false }, 'referrals_off'],
    ['pro_upsell', { isPro: true }, 'already_pro'],
    ['pro_upsell', { subscriptionsEnabled: false }, 'subscriptions_off'],
    ['native_ad', { isPro: true }, 'ads_ineligible'],
    ['native_ad', { adsEligible: false }, 'ads_ineligible'],
  ] as const)('hint drops %s when known (%o)', (type, ctx, reason) => {
    const c = makeCtx(ctx as any);
    expect(ineligibleReason(type, c)).toBe(reason);
    const { eligible, suppressed } = buildCandidates(c, SPEC_SUPPORT);
    expect(types(eligible)).not.toContain(type);
    expect(types(suppressed)).toContain(type);
  });

  it('unknown context values never drop a card (fail-soft)', () => {
    const c = makeCtx({ campaign: null, referralProgramEnabled: null, isPro: null, subscriptionsEnabled: null, adsEligible: null });
    const { eligible, suppressed } = buildCandidates(c, SPEC_SUPPORT);
    expect(types(eligible)).toEqual([...DEFAULT_ORDER]);
    expect(suppressed).toEqual([]);
  });

  it('no context (kill switch) → every declared card eligible', () => {
    expect(types(buildCandidates(null, SPEC_SUPPORT).eligible)).toEqual([...DEFAULT_ORDER]);
  });
});
