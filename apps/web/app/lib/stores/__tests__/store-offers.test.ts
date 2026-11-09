/** lib/stores: trial durations, App Store intro offers and Google Play offers (read, plan, apply, verify) against HTTP fakes. */
import { describe, expect, it, vi } from 'vitest';

// jsdom's TextEncoder returns Uint8Arrays from another realm, which jose (ASC JWT) rejects.
// Install a same-realm encoder before jose is imported (vi.hoisted runs before the imports).
vi.hoisted(() => {
  (globalThis as any).TextEncoder = class {
    readonly encoding = 'utf-8';
    encode(input = '') {
      return new Uint8Array(Buffer.from(input, 'utf8'));
    }
  };
});

import { ascCreateBody, mapIntroOffers, offerTiming, planAscOps, verifyAsc } from '../asc-offers';
import { mapPlayOffer, planPlayOps, playOffersConfigFromEnv, targetOfferId, verifyPlay } from '../play-offers';
import { SUPPORTED_TRIAL_DAYS, ascDurationDays, ascDurationFor, isSupportedTrialDays, isoDurationDays, playDurationFor } from '../trial-durations';

import { FakeAsc, FakePlay, PKG, REGIONS, SUBS, TERRITORIES, playTrialOffer } from './fake-stores';

const NOW = new Date('2026-11-09T18:00:00Z');

describe('trial durations', () => {
  it('only lengths both stores express in whole days', () => {
    expect([...SUPPORTED_TRIAL_DAYS]).toEqual([3, 7, 14]);
    expect(isSupportedTrialDays(7)).toBe(true);
    for (const d of [0, 1, 5, 30, 31, '7', null]) expect(isSupportedTrialDays(d)).toBe(false);
    expect(ascDurationFor(7)).toBe('ONE_WEEK');
    expect(playDurationFor(14)).toBe('P14D');
    expect(ascDurationDays('TWO_WEEKS')).toBe(14);
    expect(ascDurationDays('ONE_MONTH')).toBeNull();
  });

  it('parses Play ISO durations, including the P1W echo', () => {
    expect(isoDurationDays('P3D')).toBe(3);
    expect(isoDurationDays('P1W')).toBe(7);
    expect(isoDurationDays('P2W')).toBe(14);
    expect(isoDurationDays('P1M')).toBeNull();
    expect(isoDurationDays('')).toBeNull();
  });
});

describe('App Store intro offers', () => {
  it('classifies offer timing by date', () => {
    expect(offerTiming('2026-10-28', null, '2026-11-09')).toBe('current');
    expect(offerTiming('2026-12-01', null, '2026-11-09')).toBe('future');
    expect(offerTiming('2026-10-01', '2026-11-01', '2026-11-09')).toBe('ended');
    const offers = mapIntroOffers({ data: [{ id: 'x', attributes: { duration: 'ONE_WEEK', offerMode: 'FREE_TRIAL', startDate: null }, relationships: { territory: { data: { id: 'USA' } } } }] }, '2026-11-09');
    expect(offers[0]).toMatchObject({ territory: 'USA', days: 7, timing: 'current' });
  });

  it('snapshot reads every subscription and its offers with GETs only', async () => {
    const fake = new FakeAsc();
    const snap = await fake.client().snapshot(NOW);
    expect(snap.subscriptions.map((s) => s.productId)).toEqual([SUBS[1].productId, SUBS[0].productId]);
    expect(snap.subscriptions[0].offers.map((o) => o.territory)).toEqual(TERRITORIES);
    expect(fake.writes()).toEqual([]);
  });

  it('plans nothing when already at the target, delete + create per territory otherwise', async () => {
    const fake = new FakeAsc();
    const snap = await fake.client().snapshot(NOW);
    expect(planAscOps(snap, 3).ops).toEqual([]);
    const { ops } = planAscOps(snap, 7);
    expect(ops).toHaveLength(SUBS.length * TERRITORIES.length * 2);
    expect(ops[0]).toMatchObject({ kind: 'asc.delete', territory: 'CAN' });
    expect(ops[1]).toMatchObject({ kind: 'asc.create', territory: 'CAN', duration: 'ONE_WEEK', targetSubscriptionPlanType: 'UPFRONT' });
  });

  it('also deletes a queued future offer and fills a territory missing on one subscription', async () => {
    const fake = new FakeAsc();
    fake.add(SUBS[0].id, 'USA', 'TWO_WEEKS', { startDate: '2026-12-01' });
    fake.offers = fake.offers.filter((o) => !(o.subscriptionId === SUBS[1].id && o.territory === 'IND'));
    const snap = await fake.client().snapshot(NOW);
    const { ops, warnings } = planAscOps(snap, 3);
    expect(ops.filter((o) => o.kind === 'asc.delete').map((o) => o.territory)).toEqual(['USA', 'USA']);
    expect(ops.filter((o) => o.kind === 'asc.create').map((o) => `${o.productId}:${o.territory}`)).toEqual([`${SUBS[1].productId}:IND`, `${SUBS[0].productId}:USA`]);
    expect(warnings.join(' ')).toMatch(/scheduled offer starting 2026-12-01/);
  });

  it('apply runs the ops; a repeated delete (404) is a no-op; verify reads back', async () => {
    const fake = new FakeAsc();
    const client = fake.client();
    const { ops } = planAscOps(await client.snapshot(NOW), 7);
    for (const op of ops) await client.apply(op);
    expect(fake.offers.every((o) => o.duration === 'ONE_WEEK')).toBe(true);
    await expect(client.apply(ops[0])).resolves.toEqual({});
    expect(verifyAsc(await client.snapshot(NOW), 7, TERRITORIES)).toEqual([]);
    expect(verifyAsc(await client.snapshot(NOW), 3, TERRITORIES)).toHaveLength(10);
    const create = fake.writes().find((c) => c.method === 'POST')!;
    expect(create.body.data.attributes).not.toHaveProperty('startDate');
  });

  it('create body carries plan type and territory', () => {
    expect(ascCreateBody('s1', 'USA', 'ONE_WEEK', 'UPFRONT')).toEqual({
      data: {
        type: 'subscriptionIntroductoryOffers',
        attributes: { duration: 'ONE_WEEK', offerMode: 'FREE_TRIAL', numberOfPeriods: 1, targetSubscriptionPlanType: 'UPFRONT' },
        relationships: { subscription: { data: { type: 'subscriptions', id: 's1' } }, territory: { data: { type: 'territories', id: 'USA' } } },
      },
    });
  });
});

describe('Google Play offers', () => {
  it('maps offers: free phase days, regions, tags', () => {
    const o = mapPlayOffer({ ...playTrialOffer('p', 'monthly', 7), phases: [{ duration: 'P1W', regionalConfigs: [{ regionCode: 'US', free: {} }] }], offerTags: [{ tag: 'x' }] });
    expect(o).toMatchObject({ trialDays: 7, trialDuration: 'P1W', regions: REGIONS, tags: ['x'] });
    expect(mapPlayOffer({ offerId: 'paid', phases: [{ duration: 'P1M', regionalConfigs: [{ regionCode: 'US', price: {} }] }] }).trialDuration).toBeNull();
  });

  it('reads the env: monetization key writes, read-only key only reads', () => {
    const sa = JSON.stringify({ client_email: 'a@b', private_key: 'k' });
    expect(playOffersConfigFromEnv({ GOOGLE_PLAY_SA_KEY: sa } as any)).toMatchObject({ writeKey: null, readKey: { client_email: 'a@b' }, packageName: PKG, regionsVersion: '2022/02' });
    expect(playOffersConfigFromEnv({ GOOGLE_PLAY_MONETIZATION_SA_KEY: sa } as any).writeKey).not.toBeNull();
  });

  it('plans create → activate → deactivate per base plan, copying the template', async () => {
    const fake = new FakePlay();
    const snap = await fake.client().snapshot();
    expect(planPlayOps(snap, 3).ops).toEqual([]);
    const { ops, errors } = planPlayOps(snap, 7);
    expect(errors).toEqual([]);
    expect(ops.map((o) => `${o.kind}:${o.offerId}`)).toEqual([
      'play.create:annual-trial7d',
      'play.activate:annual-trial7d',
      'play.deactivate:annual-trial3d',
      'play.create:monthly-trial7d',
      'play.activate:monthly-trial7d',
      'play.deactivate:monthly-trial3d',
    ]);
    const create = ops[0] as any;
    expect(create.offer.phases[0].duration).toBe('P7D');
    expect(create.offer.targeting).toEqual({ acquisitionRule: { scope: { anySubscriptionInApp: {} } } });
    expect(create.offer.regionalConfigs.map((r: any) => r.regionCode)).toEqual(REGIONS);
    expect(fake.writes()).toEqual([]);
  });

  it('switching back re-activates the old offer instead of creating one (ids are never reusable)', async () => {
    const fake = new FakePlay(7);
    fake.offers.push(playTrialOffer(SUBS[1].productId, 'annual', 3, 'INACTIVE'), playTrialOffer(SUBS[0].productId, 'monthly', 3, 'INACTIVE'));
    const { ops } = planPlayOps(await fake.client().snapshot(), 3);
    expect(ops.map((o) => `${o.kind}:${o.offerId}`)).toEqual(['play.activate:annual-trial3d', 'play.deactivate:annual-trial7d', 'play.activate:monthly-trial3d', 'play.deactivate:monthly-trial7d']);
  });

  it('picks a fresh id when the natural one exists with other regions', async () => {
    const fake = new FakePlay();
    fake.offers.push({ ...playTrialOffer(SUBS[0].productId, 'monthly', 7, 'INACTIVE'), regionalConfigs: [{ regionCode: 'US', newSubscriberAvailability: true }] });
    const { ops, warnings } = planPlayOps(await fake.client().snapshot(), 7);
    expect(ops.find((o) => o.kind === 'play.create' && o.basePlanId === 'monthly')!.offerId).toBe('monthly-trial7d-v2');
    expect(warnings.join(' ')).toMatch(/can't be reused/);
    expect(targetOfferId('Annual', 14)).toBe('annual-trial14d');
  });

  it('refuses a template tagged rc-ignore-offer (RevenueCat would skip it)', async () => {
    const fake = new FakePlay();
    fake.offers[0].offerTags = [{ tag: 'rc-ignore-offer' }];
    expect(planPlayOps(await fake.client().snapshot(), 7).errors[0]).toMatch(/rc-ignore-offer/);
  });

  it('apply hits the documented endpoints with regionsVersion; verify reads back (P1W = 7)', async () => {
    const fake = new FakePlay();
    const client = fake.client();
    const { ops } = planPlayOps(await client.snapshot(), 7);
    for (const op of ops) await client.apply(op);
    const writes = fake.writes().map((c) => `${c.method} ${decodeURIComponent(new URL(c.url).pathname).split('/basePlans/')[1]}${new URL(c.url).search}`);
    expect(writes[0]).toBe('POST annual/offers?offerId=annual-trial7d&regionsVersion.version=2022%2F02');
    expect(writes[1]).toBe('POST annual/offers/annual-trial7d:activate');
    expect(writes[2]).toBe('POST annual/offers/annual-trial3d:deactivate');
    const after = await client.snapshot();
    expect(verifyPlay(after, 7, [{ productId: SUBS[0].productId, basePlanId: 'monthly' }, { productId: SUBS[1].productId, basePlanId: 'annual' }])).toEqual([]);
    expect(verifyPlay(after, 3, [{ productId: SUBS[0].productId, basePlanId: 'monthly' }])).toHaveLength(1);
  });

  it('writes without the monetization key fail before any HTTP write', async () => {
    const fake = new FakePlay();
    const client = fake.client({ canWrite: false });
    const { ops } = planPlayOps(await client.snapshot(), 7);
    await expect(client.apply(ops[0])).rejects.toThrow(/GOOGLE_PLAY_MONETIZATION_SA_KEY/);
    expect(fake.writes()).toEqual([]);
  });
});
