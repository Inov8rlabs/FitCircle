/**
 * In-memory App Store Connect + Google Play HTTP fakes for the trial-sync tests. They implement only the
 * endpoints asc-offers.ts / play-offers.ts call, keep state across calls (so read-back verifies real
 * mutations), record every request, and can be told to fail a request.
 */
import { generateKeyPairSync } from 'node:crypto';

import { AscOffersClient } from '../asc-offers';
import { PlayOffersClient } from '../play-offers';

type Json = Record<string, any>;

export const TERRITORIES = ['CAN', 'GBR', 'IND', 'SGP', 'USA'];
export const REGIONS = ['CA', 'GB', 'IN', 'SG', 'US'];
export const SUBS = [
  { id: '6811891004', productId: 'com.inov8rlabs.fitcircle.pro.monthly', name: 'Pro Monthly' },
  { id: '6811894335', productId: 'com.inov8rlabs.fitcircle.pro.annual', name: 'Pro Annual' },
];
export const PKG = 'com.inov8rlabs.apps.fitcircle';

const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface Call {
  method: string;
  url: string;
  body: any;
}

export type FailRule = (c: Call) => { status: number; body?: unknown } | null;

// ------------------------------------------------------------------ App Store Connect

export interface FakeAscOffer {
  id: string;
  subscriptionId: string;
  territory: string;
  duration: string;
  offerMode: string;
  numberOfPeriods: number;
  startDate: string | null;
  endDate: string | null;
  targetSubscriptionPlanType: string | null;
}

export class FakeAsc {
  offers: FakeAscOffer[] = [];
  calls: Call[] = [];
  fail: FailRule[] = [];
  private seq = 0;

  constructor(duration = 'THREE_DAYS') {
    for (const s of SUBS) for (const t of TERRITORIES) this.add(s.id, t, duration);
  }

  add(subscriptionId: string, territory: string, duration: string, extra: Partial<FakeAscOffer> = {}) {
    this.offers.push({ id: `asc-${++this.seq}`, subscriptionId, territory, duration, offerMode: 'FREE_TRIAL', numberOfPeriods: 1, startDate: '2026-10-28', endDate: null, targetSubscriptionPlanType: 'UPFRONT', ...extra });
  }

  writes() {
    return this.calls.filter((c) => c.method !== 'GET');
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const call = { method, url, body };
    this.calls.push(call);
    for (const f of this.fail) {
      const r = f(call);
      if (r) return json(r.status, r.body ?? { errors: [{ status: String(r.status), detail: 'injected failure' }] });
    }
    const path = url.replace('https://api.appstoreconnect.apple.com', '');
    if (method === 'GET' && path.startsWith('/v1/apps/')) {
      return json(200, {
        data: [{ type: 'subscriptionGroups', id: 'g1', attributes: { referenceName: 'FitCircle Pro' } }],
        included: SUBS.map((s) => ({ type: 'subscriptions', id: s.id, attributes: { name: s.name, productId: s.productId, state: 'APPROVED', subscriptionPeriod: 'ONE_MONTH' } })),
      });
    }
    let m = /^\/v1\/subscriptions\/([^/]+)\/introductoryOffers/.exec(path);
    if (method === 'GET' && m) {
      const subId = decodeURIComponent(m[1]);
      return json(200, {
        data: this.offers
          .filter((o) => o.subscriptionId === subId)
          .map((o) => ({
            type: 'subscriptionIntroductoryOffers',
            id: o.id,
            attributes: { startDate: o.startDate, endDate: o.endDate, duration: o.duration, offerMode: o.offerMode, numberOfPeriods: o.numberOfPeriods, targetSubscriptionPlanType: o.targetSubscriptionPlanType },
            relationships: { territory: { data: { type: 'territories', id: o.territory } }, subscriptionPricePoint: { data: null } },
          })),
      });
    }
    m = /^\/v1\/subscriptionIntroductoryOffers\/([^/?]+)$/.exec(path);
    if (method === 'DELETE' && m) {
      const id = decodeURIComponent(m[1]);
      const before = this.offers.length;
      this.offers = this.offers.filter((o) => o.id !== id);
      return before === this.offers.length ? json(404, { errors: [{ status: '404', detail: 'not found' }] }) : new Response(null, { status: 204 });
    }
    if (method === 'POST' && path === '/v1/subscriptionIntroductoryOffers') {
      const a = body.data.attributes;
      const subId = body.data.relationships.subscription.data.id;
      const territory = body.data.relationships.territory.data.id;
      if (this.offers.some((o) => o.subscriptionId === subId && o.territory === territory && !o.endDate)) return json(409, { errors: [{ status: '409', detail: 'overlapping offer' }] });
      const id = `asc-${++this.seq}`;
      this.offers.push({ id, subscriptionId: subId, territory, duration: a.duration, offerMode: a.offerMode, numberOfPeriods: a.numberOfPeriods, startDate: a.startDate ?? '2026-11-09', endDate: a.endDate ?? null, targetSubscriptionPlanType: a.targetSubscriptionPlanType ?? null });
      return json(201, { data: { type: 'subscriptionIntroductoryOffers', id } });
    }
    return json(404, { errors: [{ status: '404', detail: `fake asc: no route ${method} ${path}` }] });
  };

  client() {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    return new AscOffersClient({ keyId: 'KEY', issuerId: 'ISSUER', privateKey: pem, appId: '6811432467' }, this.fetch as typeof fetch, async () => {});
  }
}

// ------------------------------------------------------------------ Google Play

export interface FakePlayOffer {
  productId: string;
  basePlanId: string;
  offerId: string;
  state: string;
  phases: Json[];
  targeting: Json;
  regionalConfigs: Json[];
  otherRegionsConfig: Json;
  offerTags?: Json[];
}

export const playTrialOffer = (productId: string, basePlanId: string, days: number, state = 'ACTIVE', offerId = `${basePlanId}-trial${days}d`): FakePlayOffer => ({
  productId,
  basePlanId,
  offerId,
  state,
  phases: [{ recurrenceCount: 1, duration: `P${days}D`, regionalConfigs: REGIONS.map((regionCode) => ({ regionCode, free: {} })) }],
  targeting: { acquisitionRule: { scope: { anySubscriptionInApp: {} } } },
  regionalConfigs: REGIONS.map((regionCode) => ({ regionCode, newSubscriberAvailability: true })),
  otherRegionsConfig: { otherRegionsNewSubscriberAvailability: false },
});

export class FakePlay {
  offers: FakePlayOffer[] = [];
  calls: Call[] = [];
  fail: FailRule[] = [];
  /** Play echoes a 7-day phase back as P1W. */
  echoWeeks = true;

  constructor(days = 3) {
    this.offers.push(playTrialOffer(SUBS[1].productId, 'annual', days), playTrialOffer(SUBS[0].productId, 'monthly', days));
  }

  writes() {
    return this.calls.filter((c) => c.method !== 'GET' && !c.url.includes('oauth2'));
  }

  private out(o: FakePlayOffer) {
    const phases = o.phases.map((p) => ({ ...p, duration: this.echoWeeks && p.duration === 'P7D' ? 'P1W' : p.duration }));
    return { packageName: PKG, ...o, phases };
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const raw = init?.body ? String(init.body) : null;
    const body = raw && raw.startsWith('{') ? JSON.parse(raw) : raw;
    const call = { method, url, body };
    this.calls.push(call);
    if (url.startsWith('https://oauth2.googleapis.com')) return json(200, { access_token: 'tok' });
    for (const f of this.fail) {
      const r = f(call);
      if (r) return json(r.status, r.body ?? { error: { message: 'injected failure' } });
    }
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace('/androidpublisher/v3', ''));
    if (method === 'GET' && path === `/applications/${PKG}/subscriptions`) {
      return json(200, {
        subscriptions: SUBS.map((s) => ({
          productId: s.productId,
          basePlans: [{ basePlanId: s.productId.endsWith('annual') ? 'annual' : 'monthly', state: 'ACTIVE', autoRenewingBasePlanType: { billingPeriodDuration: 'P1M' } }],
        })),
      });
    }
    if (method === 'GET' && path === `/applications/${PKG}/subscriptions/-/basePlans/-/offers`) {
      return json(200, { subscriptionOffers: this.offers.map((o) => this.out(o)) });
    }
    const m = /^\/applications\/[^/]+\/subscriptions\/([^/]+)\/basePlans\/([^/]+)\/offers(?:\/([^/:]+):(activate|deactivate))?$/.exec(path);
    if (method === 'POST' && m) {
      const [, productId, basePlanId, offerId, verb] = m;
      if (!verb) {
        const id = u.searchParams.get('offerId')!;
        if (!u.searchParams.get('regionsVersion.version')) return json(400, { error: { message: 'regionsVersion required' } });
        if (this.offers.some((o) => o.productId === productId && o.basePlanId === basePlanId && o.offerId === id)) return json(409, { error: { message: 'offer exists' } });
        const o: FakePlayOffer = { ...body, productId, basePlanId, offerId: id, state: 'DRAFT' };
        this.offers.push(o);
        return json(200, this.out(o));
      }
      const o = this.offers.find((x) => x.productId === productId && x.basePlanId === basePlanId && x.offerId === offerId);
      if (!o) return json(404, { error: { message: 'no such offer' } });
      o.state = verb === 'activate' ? 'ACTIVE' : 'INACTIVE';
      return json(200, this.out(o));
    }
    return json(404, { error: { message: `fake play: no route ${method} ${path}` } });
  };

  client(opts: { canWrite?: boolean } = {}) {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = { client_email: 'sa@example.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
    return new PlayOffersClient({ packageName: PKG, readKey: key, writeKey: opts.canWrite === false ? null : key, regionsVersion: '2022/02' }, this.fetch);
  }
}
