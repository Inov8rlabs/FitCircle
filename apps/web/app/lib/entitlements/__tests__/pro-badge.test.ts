import { describe, expect, it } from 'vitest';

import type { CampaignRow } from '@/lib/campaigns/model';

import { activeOffer, campaignOffer, envOffer, memberSinceFrom, proBadgeFor, sandboxCounts } from '../pro-badge';

const NOW = new Date('2026-11-27T15:00:00Z');

function campaign(over: Partial<CampaignRow>): CampaignRow {
  return {
    slug: 'bf2026',
    published: true,
    archived_at: null,
    featured_from: '2026-11-20',
    starts_at: '2026-11-27',
    ends_at: '2026-11-30',
    priority: 0,
    cta: { action: 'paywall' },
    ...over,
  } as CampaignRow;
}

describe('offer resolution', () => {
  it('a live, published paywall campaign is the offer, started at local midnight', () => {
    expect(campaignOffer([campaign({})], NOW, 'UTC')).toEqual({ id: 'campaign:bf2026', startedAt: '2026-11-27T00:00:00.000Z' });
    expect(campaignOffer([campaign({})], NOW, 'America/Los_Angeles')).toEqual({ id: 'campaign:bf2026', startedAt: '2026-11-27T08:00:00.000Z' });
  });

  it('ignores drafts, archived, teaser, ended and non-paywall campaigns', () => {
    for (const c of [
      campaign({ published: false }),
      campaign({ archived_at: '2026-11-01T00:00:00Z' }),
      campaign({ starts_at: '2026-11-28' }),
      campaign({ ends_at: '2026-11-26' }),
      campaign({ cta: { action: 'start_circle' } }),
      campaign({ cta: null }),
    ]) {
      expect(campaignOffer([c], NOW, 'UTC')).toBeNull();
    }
  });

  it('several live: the most recently started, then highest priority', () => {
    const rows = [campaign({ slug: 'old', starts_at: '2026-11-01' }), campaign({ slug: 'a', priority: 1 }), campaign({ slug: 'b', priority: 5 })];
    expect(campaignOffer(rows, NOW, 'UTC')?.id).toBe('campaign:b');
  });

  it('env fallback; campaign wins; junk ids rejected', () => {
    expect(envOffer({})).toBeNull();
    expect(envOffer({ PRO_BADGE_OFFER_ID: 'spring_27' })).toEqual({ id: 'spring_27', startedAt: null });
    expect(envOffer({ PRO_BADGE_OFFER_ID: 'spring_27', PRO_BADGE_OFFER_STARTS_AT: '2026-11-01T00:00:00Z' })).toEqual({ id: 'spring_27', startedAt: '2026-11-01T00:00:00.000Z' });
    expect(envOffer({ PRO_BADGE_OFFER_ID: 'has space' })).toBeNull();
    expect(activeOffer([campaign({})], NOW, 'UTC', { PRO_BADGE_OFFER_ID: 'spring_27' })?.id).toBe('campaign:bf2026');
    expect(activeOffer([], NOW, 'UTC', { PRO_BADGE_OFFER_ID: 'spring_27' })?.id).toBe('spring_27');
    expect(activeOffer([], NOW, 'UTC', {})).toBeNull();
  });
});

describe('proBadgeFor', () => {
  const offer = { id: 'campaign:bf2026', startedAt: '2026-11-27T00:00:00.000Z' };
  const free = { offer, isPro: false, isTrial: false, subscriptionsEnabled: true, paywallLastOpenedAt: null };

  it('no offer → marker false, offerId null (client keeps its own schedule)', () => {
    expect(proBadgeFor({ ...free, offer: null })).toEqual({ marker: false, offerId: null });
  });

  it('free user who has not opened the paywall since the offer started → marker', () => {
    expect(proBadgeFor(free)).toEqual({ marker: true, offerId: 'campaign:bf2026' });
    expect(proBadgeFor({ ...free, paywallLastOpenedAt: '2026-11-26T23:59:59Z' }).marker).toBe(true);
    expect(proBadgeFor({ ...free, paywallLastOpenedAt: '2026-11-27T00:00:00Z' }).marker).toBe(false);
  });

  it('never for Pro, trial, or with subscriptions off (offerId still reported)', () => {
    expect(proBadgeFor({ ...free, isPro: true })).toEqual({ marker: false, offerId: 'campaign:bf2026' });
    expect(proBadgeFor({ ...free, isTrial: true }).marker).toBe(false);
    expect(proBadgeFor({ ...free, subscriptionsEnabled: false }).marker).toBe(false);
  });

  it('offer with unknown start: any recorded open clears it', () => {
    const o = { id: 'spring_27', startedAt: null };
    expect(proBadgeFor({ ...free, offer: o }).marker).toBe(true);
    expect(proBadgeFor({ ...free, offer: o, paywallLastOpenedAt: '2020-01-01T00:00:00Z' }).marker).toBe(false);
  });
});

describe('memberSinceFrom', () => {
  const prod = { NODE_ENV: 'production' };

  it('earliest real purchase or trial start', () => {
    const events = [
      { type: 'RENEWAL', environment: 'PRODUCTION', event_timestamp: '2026-09-01T00:00:00Z', raw: { purchased_at_ms: Date.parse('2026-09-01T00:00:00Z') } },
      { type: 'INITIAL_PURCHASE', environment: 'PRODUCTION', event_timestamp: '2026-08-02T00:00:00Z', raw: { purchased_at_ms: Date.parse('2026-08-01T10:00:00Z') } },
    ];
    expect(memberSinceFrom(events, null, prod)).toBe('2026-08-01T10:00:00.000Z');
    expect(memberSinceFrom(events, '2026-07-15T00:00:00Z', prod)).toBe('2026-07-15T00:00:00.000Z');
    expect(memberSinceFrom([{ type: 'INITIAL_PURCHASE', event_timestamp: '2026-08-02T00:00:00Z', raw: {} }], null, prod)).toBe('2026-08-02T00:00:00.000Z');
  });

  it('ignores TEST, cancellations, promotional, and sandbox in production', () => {
    const noise = [
      { type: 'TEST', event_timestamp: '2026-01-01T00:00:00Z' },
      { type: 'CANCELLATION', event_timestamp: '2026-01-01T00:00:00Z' },
      { type: 'INITIAL_PURCHASE', store: 'PROMOTIONAL', event_timestamp: '2026-01-01T00:00:00Z' },
      { type: 'INITIAL_PURCHASE', environment: 'SANDBOX', event_timestamp: '2026-01-01T00:00:00Z' },
    ];
    expect(memberSinceFrom(noise, null, prod)).toBeNull();
    expect(memberSinceFrom(noise, null, { NODE_ENV: 'development' })).toBe('2026-01-01T00:00:00.000Z');
    expect(sandboxCounts({ NODE_ENV: 'production', ALLOW_SANDBOX_WEBHOOKS: 'true' })).toBe(true);
    expect(memberSinceFrom([], null, prod)).toBeNull();
  });
});
