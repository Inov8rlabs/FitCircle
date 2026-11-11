import { describe, expect, it, vi } from 'vitest';

import {
  GA4_EVENT,
  MAX_ATTEMPTS,
  SEND_WINDOW_MS,
  buildMpPayload,
  ga4MpConfig,
  mapRevenueCatEvent,
  mpUrl,
  reclaimDecision,
  sendTimestampMs,
  userEligibility,
  type Ga4UserFacts,
} from '../ga4/conversions';
import type { RevenueEvent } from '../metrics';
import {
  Ga4ConversionService,
  type ClaimResult,
  type Ga4SendStore,
} from '../services/ga4-conversion-service';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const USER = '11111111-2222-3333-4444-555555555555';
const AIID = '0123456789abcdef0123456789abcdef';

function ev(over: Partial<RevenueEvent> = {}, raw: Record<string, any> = {}): RevenueEvent {
  const ts = NOW - 60_000;
  return {
    id: 'evt_1',
    user_id: USER,
    type: 'INITIAL_PURCHASE',
    store: 'PLAY_STORE',
    environment: 'PRODUCTION',
    event_timestamp: new Date(ts).toISOString(),
    ...over,
    raw: {
      environment: over.environment ?? 'PRODUCTION',
      period_type: 'NORMAL',
      price: 9.99,
      price_in_purchased_currency: 899,
      currency: 'INR',
      product_id: 'fitcircle_pro_monthly:monthly',
      transaction_id: 'GPA.1234-5678-9012-34567',
      event_timestamp_ms: ts,
      ...raw,
    },
  };
}

// ---------------------------------------------------------------------------
// Mapping: each RevenueCat type → GA4 event or none
// ---------------------------------------------------------------------------

describe('mapRevenueCatEvent', () => {
  it('trial start → trial_started_server, value 0 USD', () => {
    const m = mapRevenueCatEvent(ev({}, { period_type: 'TRIAL', price: 0 }));
    expect(m.send && m.conversion).toMatchObject({ name: GA4_EVENT.trialStarted, value: 0, currency: 'USD', plan: 'monthly', periodType: 'TRIAL' });
  });

  it('paid INITIAL_PURCHASE → purchase_server with USD gross + transaction id', () => {
    const m = mapRevenueCatEvent(ev());
    expect(m.send && m.conversion).toMatchObject({ name: GA4_EVENT.purchase, value: 9.99, currency: 'USD', transactionId: 'GPA.1234-5678-9012-34567', store: 'play_store' });
  });

  it('INTRO purchase with a price → purchase_server', () => {
    const m = mapRevenueCatEvent(ev({}, { period_type: 'INTRO', price: 4.99 }));
    expect(m.send && m.conversion.name).toBe(GA4_EVENT.purchase);
  });

  it('NON_RENEWING_PURCHASE → purchase_server', () => {
    const m = mapRevenueCatEvent(ev({ type: 'NON_RENEWING_PURCHASE' }, { product_id: 'lifetime' }));
    expect(m.send && m.conversion).toMatchObject({ name: GA4_EVENT.purchase, plan: 'other' });
  });

  it('RENEWAL with is_trial_conversion → trial_converted (annual plan)', () => {
    const m = mapRevenueCatEvent(ev({ type: 'RENEWAL' }, { is_trial_conversion: true, price: 59.99, product_id: 'fitcircle_pro_annual' }));
    expect(m.send && m.conversion).toMatchObject({ name: GA4_EVENT.trialConverted, value: 59.99, plan: 'annual' });
  });

  it('plain RENEWAL → subscription_renewed', () => {
    const m = mapRevenueCatEvent(ev({ type: 'RENEWAL' }, { is_trial_conversion: false }));
    expect(m.send && m.conversion.name).toBe(GA4_EVENT.renewed);
  });

  it('refund CANCELLATION → refund with positive value', () => {
    const m = mapRevenueCatEvent(ev({ type: 'CANCELLATION' }, { price: -9.99, cancel_reason: 'CUSTOMER_SUPPORT' }));
    expect(m.send && m.conversion).toMatchObject({ name: 'refund', value: 9.99, currency: 'USD', transactionId: 'GPA.1234-5678-9012-34567' });
  });

  it('refund without a transaction id → none', () => {
    expect(mapRevenueCatEvent(ev({ type: 'CANCELLATION' }, { price: -9.99, transaction_id: null }))).toEqual({ send: false, reason: 'no_transaction_id' });
  });

  it.each(['CANCELLATION', 'EXPIRATION', 'BILLING_ISSUE', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'TRANSFER', 'SUBSCRIPTION_PAUSED', 'REFUND_REVERSED', 'TEST'])(
    '%s (non-refund) → none',
    (type) => {
      const m = mapRevenueCatEvent(ev({ type }, { price: 0, cancel_reason: 'UNSUBSCRIBE' }));
      expect(m.send).toBe(false);
    }
  );

  it('sandbox / stripe-native / family share / promotional → none', () => {
    expect(mapRevenueCatEvent(ev({ environment: 'SANDBOX' }))).toEqual({ send: false, reason: 'sandbox' });
    expect(mapRevenueCatEvent(ev({ id: 'stripe:evt_x' }))).toEqual({ send: false, reason: 'stripe_native' });
    expect(mapRevenueCatEvent(ev({}, { is_family_share: true }))).toEqual({ send: false, reason: 'family_share' });
    expect(mapRevenueCatEvent(ev({ store: 'PROMOTIONAL' }))).toEqual({ send: false, reason: 'promotional' });
  });

  it('known zero-price charge → none; unknown USD price falls back to local currency', () => {
    expect(mapRevenueCatEvent(ev({}, { price: 0 }))).toEqual({ send: false, reason: 'zero_value' });
    const m = mapRevenueCatEvent(ev({}, { price: null, price_in_purchased_currency: 899, currency: 'inr' }));
    expect(m.send && m.conversion).toMatchObject({ value: 899, currency: 'INR' });
  });
});

// ---------------------------------------------------------------------------
// Timing, eligibility, config, payload, reclaim
// ---------------------------------------------------------------------------

describe('sendTimestampMs', () => {
  it('inside the window → event time; future → now; too old → null', () => {
    expect(sendTimestampMs(NOW - 3_600_000, NOW)).toBe(NOW - 3_600_000);
    expect(sendTimestampMs(NOW + 60_000, NOW)).toBe(NOW);
    expect(sendTimestampMs(NOW - SEND_WINDOW_MS - 1, NOW)).toBeNull();
    expect(sendTimestampMs(NOW - 73 * 3_600_000, NOW)).toBeNull();
    expect(sendTimestampMs(null, NOW)).toBe(NOW);
  });
});

const realUser: Ga4UserFacts = { email: 'jane@gmail.com', isAdmin: false, appInstanceId: AIID, platform: 'android', mockAttribution: false };

describe('userEligibility', () => {
  it('real Android user with an app instance id → ok', () => {
    expect(userEligibility(realUser, {})).toEqual({ ok: true, appInstanceId: AIID });
  });
  it('test users are never sent', () => {
    expect(userEligibility({ ...realUser, email: 'ani@fitcircle.ai' }, {})).toMatchObject({ ok: false, reason: 'test_user', testReason: 'internal' });
    expect(userEligibility({ ...realUser, isAdmin: true }, {})).toMatchObject({ ok: false, reason: 'test_user' });
    expect(userEligibility({ ...realUser, email: 'robot@cloudtestlabaccounts.com' }, {})).toMatchObject({ ok: false, reason: 'test_user', testReason: 'test_lab' });
    expect(userEligibility({ ...realUser, email: 'janedoe.12345@gmail.com' }, {})).toMatchObject({ ok: false, reason: 'test_user', testReason: 'play_testers' });
    expect(userEligibility({ ...realUser, email: 'x@y.com' }, { ADS_TEST_EMAILS: 'x@y.com' })).toMatchObject({ ok: false, reason: 'test_user' });
  });
  it('missing / malformed app instance id → no_app_instance_id; iOS → ios_user; no profile → no_user', () => {
    expect(userEligibility({ ...realUser, appInstanceId: null }, {})).toEqual({ ok: false, reason: 'no_app_instance_id' });
    expect(userEligibility({ ...realUser, appInstanceId: 'bad id!' }, {})).toEqual({ ok: false, reason: 'no_app_instance_id' });
    expect(userEligibility({ ...realUser, platform: 'ios' }, {})).toEqual({ ok: false, reason: 'ios_user' });
    expect(userEligibility(null, {})).toEqual({ ok: false, reason: 'no_user' });
  });
});

describe('ga4MpConfig', () => {
  const full = { GA4_SERVER_CONVERSIONS_ENABLED: 'true', GA4_MP_FIREBASE_APP_ID: '1:1:android:abc', GA4_MP_API_SECRET: 's3cr3t' };
  it('default off, needs both values', () => {
    expect(ga4MpConfig({})).toMatchObject({ enabled: false, reason: 'disabled' });
    expect(ga4MpConfig({ ...full, GA4_SERVER_CONVERSIONS_ENABLED: 'false' })).toMatchObject({ enabled: false, reason: 'disabled' });
    expect(ga4MpConfig({ ...full, GA4_MP_API_SECRET: '' })).toMatchObject({ enabled: false, reason: 'not_configured' });
    expect(ga4MpConfig(full)).toEqual({ enabled: true, config: { firebaseAppId: '1:1:android:abc', apiSecret: 's3cr3t' } });
  });
  it('builds collect / debug URLs', () => {
    const cfg = { firebaseAppId: '1:1:android:abc', apiSecret: 's' };
    expect(mpUrl(cfg)).toBe('https://www.google-analytics.com/mp/collect?firebase_app_id=1%3A1%3Aandroid%3Aabc&api_secret=s');
    expect(mpUrl(cfg, true)).toContain('/debug/mp/collect?');
  });
});

describe('buildMpPayload', () => {
  it('has the Measurement Protocol app-stream shape', () => {
    const m = mapRevenueCatEvent(ev({ type: 'RENEWAL' }, { is_trial_conversion: true }));
    if (!m.send) throw new Error('expected a conversion');
    const p = buildMpPayload({ appInstanceId: AIID, userId: USER, eventId: 'evt_1', conversion: m.conversion, timestampMs: NOW - 60_000.4 });
    expect(p).toEqual({
      app_instance_id: AIID,
      user_id: USER,
      timestamp_micros: (NOW - 60_001) * 1000,
      events: [
        {
          name: 'trial_converted',
          params: {
            value: 9.99,
            currency: 'USD',
            transaction_id: 'GPA.1234-5678-9012-34567',
            plan: 'monthly',
            store: 'play_store',
            product_id: 'fitcircle_pro_monthly:monthly',
            period_type: 'NORMAL',
            source: 'server',
            rc_event_id: 'evt_1',
          },
        },
      ],
    });
    expect('consent' in p).toBe(false);
    expect(Number.isInteger(p.timestamp_micros)).toBe(true);
    // GA4 limits: name ≤ 40, ≤ 25 params, values ≤ 100 chars, names not reserved-prefixed.
    expect(p.events[0].name.length).toBeLessThanOrEqual(40);
    expect(Object.keys(p.events[0].params).length).toBeLessThanOrEqual(25);
    for (const [k, v] of Object.entries(p.events[0].params)) {
      expect(k).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
      expect(k).not.toMatch(/^(_|firebase_|ga_|google_)/);
      expect(String(v).length).toBeLessThanOrEqual(100);
    }
  });
  it('omits value/currency when unknown and clips long strings', () => {
    const p = buildMpPayload({
      appInstanceId: AIID,
      userId: USER,
      eventId: 'x'.repeat(150),
      conversion: { name: 'purchase_server', atMs: NOW, value: null, currency: null, transactionId: null, plan: 'monthly', store: 'play_store', productId: null, periodType: null },
      timestampMs: NOW,
    });
    expect(p.events[0].params).not.toHaveProperty('value');
    expect(p.events[0].params).not.toHaveProperty('currency');
    expect(String(p.events[0].params.rc_event_id).length).toBe(100);
  });
});

describe('reclaimDecision', () => {
  const at = new Date(NOW - 60_000).toISOString();
  it('sent is final; failed retries until MAX_ATTEMPTS; only no_app_instance_id skips retry', () => {
    expect(reclaimDecision({ status: 'sent', skip_reason: null, attempts: 1, updated_at: at }, NOW)).toBe('sent');
    expect(reclaimDecision({ status: 'sending', skip_reason: null, attempts: 1, updated_at: at }, NOW)).toBe('in_progress');
    expect(reclaimDecision({ status: 'sending', skip_reason: null, attempts: 1, updated_at: new Date(NOW - 11 * 60_000).toISOString() }, NOW)).toBe('reclaim');
    expect(reclaimDecision({ status: 'failed', skip_reason: null, attempts: 1, updated_at: at }, NOW)).toBe('reclaim');
    expect(reclaimDecision({ status: 'failed', skip_reason: null, attempts: MAX_ATTEMPTS, updated_at: at }, NOW)).toBe('final');
    expect(reclaimDecision({ status: 'skipped', skip_reason: 'no_app_instance_id', attempts: 1, updated_at: at }, NOW)).toBe('reclaim');
    expect(reclaimDecision({ status: 'skipped', skip_reason: 'test_user', attempts: 1, updated_at: at }, NOW)).toBe('final');
  });
});

// ---------------------------------------------------------------------------
// Service with an in-memory store
// ---------------------------------------------------------------------------

type Row = { status: string; skip_reason: string | null; attempts: number; updated_at: string | null; value?: number | null };

class MemStore implements Ga4SendStore {
  events = new Map<string, RevenueEvent>();
  users = new Map<string, Ga4UserFacts>();
  rows = new Map<string, Row>();
  unavailable = false;
  async loadEvent(id: string) {
    return this.events.get(id) ?? null;
  }
  async loadUser(id: string) {
    return this.users.get(id) ?? null;
  }
  async claim(id: string, _meta: unknown, nowMs: number): Promise<ClaimResult> {
    if (this.unavailable) return 'unavailable';
    const at = new Date(nowMs).toISOString();
    const row = this.rows.get(id);
    if (!row) {
      this.rows.set(id, { status: 'sending', skip_reason: null, attempts: 1, updated_at: at });
      return 'claimed';
    }
    const d = reclaimDecision(row as any, nowMs);
    if (d !== 'reclaim') return d;
    this.rows.set(id, { ...row, status: 'sending', attempts: row.attempts + 1, updated_at: at });
    return 'claimed';
  }
  async finish(id: string, patch: any, nowMs: number) {
    const row = this.rows.get(id)!;
    this.rows.set(id, { ...row, status: patch.status, skip_reason: patch.skipReason ?? null, value: patch.value, updated_at: new Date(nowMs).toISOString() });
  }
  async recentEvents(sinceIso: string) {
    return [...this.events.values()].filter((e) => (e.event_timestamp ?? '') >= sinceIso);
  }
  async sendRows(ids: string[]) {
    return new Map(ids.filter((i) => this.rows.has(i)).map((i) => [i, this.rows.get(i)! as any]));
  }
}

const ENV = { GA4_SERVER_CONVERSIONS_ENABLED: 'true', GA4_MP_FIREBASE_APP_ID: '1:1:android:abc', GA4_MP_API_SECRET: 'not-a-real-secret' };

function setup(status = 204) {
  const store = new MemStore();
  store.events.set('evt_1', ev());
  store.users.set(USER, realUser);
  const fetchImpl = vi.fn(async () => new Response(null, { status })) as unknown as typeof fetch;
  return { store, fetchImpl, deps: { store, fetchImpl, env: ENV, now: () => NOW } };
}

describe('Ga4ConversionService', () => {
  it('config off → no-op without touching the store or network', async () => {
    const { store, fetchImpl } = setup();
    const spy = vi.spyOn(store, 'loadEvent');
    const r = await Ga4ConversionService.sendForEventId('evt_1', { store, fetchImpl, env: {}, now: () => NOW });
    expect(r.outcome).toBe('disabled');
    const r2 = await Ga4ConversionService.sendForEventId('evt_1', { store, fetchImpl, env: { GA4_SERVER_CONVERSIONS_ENABLED: 'true' }, now: () => NOW });
    expect(r2.outcome).toBe('not_configured');
    expect(spy).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(Ga4ConversionService.enabled({})).toBe(false);
  });

  it('sends once: retries / re-deliveries do not send again', async () => {
    const { store, fetchImpl, deps } = setup();
    const r = await Ga4ConversionService.sendForEventId('evt_1', deps);
    expect(r).toMatchObject({ outcome: 'sent', eventName: 'purchase_server', value: 9.99, currency: 'USD' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toContain('/mp/collect?firebase_app_id=');
    expect(url).not.toContain('/debug/');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ app_instance_id: AIID, user_id: USER, events: [{ name: 'purchase_server' }] });
    expect(store.rows.get('evt_1')).toMatchObject({ status: 'sent', value: 9.99 });

    expect((await Ga4ConversionService.sendForEventId('evt_1', deps)).outcome).toBe('already_sent');
    const sweep = await Ga4ConversionService.sweep({ mode: 'apply' }, deps);
    expect(sweep.counts).toEqual({ already_sent: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never sends test users (recorded as a final skip)', async () => {
    const { store, fetchImpl, deps } = setup();
    store.users.set(USER, { ...realUser, email: 'qa@example.com' });
    expect(await Ga4ConversionService.sendForEventId('evt_1', deps)).toMatchObject({ outcome: 'skipped', reason: 'test_user' });
    expect(fetchImpl).not.toHaveBeenCalled();
    store.users.set(USER, realUser);
    expect((await Ga4ConversionService.sendForEventId('evt_1', deps)).outcome).toBe('final');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('missing app instance id is counted, not faked, and retried once the id appears', async () => {
    const { store, fetchImpl, deps } = setup();
    store.users.set(USER, { ...realUser, appInstanceId: null });
    expect(await Ga4ConversionService.sendForEventId('evt_1', deps)).toMatchObject({ outcome: 'skipped', reason: 'no_app_instance_id' });
    expect(fetchImpl).not.toHaveBeenCalled();
    const dry = await Ga4ConversionService.sweep({}, deps);
    expect(dry.missingAppInstanceId).toBe(1);
    expect(dry.counts).toEqual({ 'skipped:no_app_instance_id': 1 });

    store.users.set(USER, realUser);
    const applied = await Ga4ConversionService.sweep({ mode: 'apply' }, deps);
    expect(applied.counts).toEqual({ sent: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('failed sends are recorded and retried by the sweep', async () => {
    const { store, deps } = setup(500);
    expect(await Ga4ConversionService.sendForEventId('evt_1', deps)).toMatchObject({ outcome: 'failed', reason: 'http_500' });
    expect(store.rows.get('evt_1')).toMatchObject({ status: 'failed', attempts: 1 });
    const fetchOk = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const r = await Ga4ConversionService.sweep({ mode: 'apply' }, { ...deps, fetchImpl: fetchOk });
    expect(r.counts).toEqual({ sent: 1 });
    expect(store.rows.get('evt_1')).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('network errors never throw and never leak the URL', async () => {
    const { deps } = setup();
    const boom = vi.fn(async () => {
      throw new TypeError('fetch failed https://www.google-analytics.com/mp/collect?api_secret=not-a-real-secret');
    }) as unknown as typeof fetch;
    const r = await Ga4ConversionService.sendForEventId('evt_1', { ...deps, fetchImpl: boom });
    expect(r.outcome).toBe('failed');
    expect(JSON.stringify(r)).not.toContain('not-a-real-secret');
  });

  it('without the idempotency table nothing is sent', async () => {
    const { store, fetchImpl, deps } = setup();
    store.unavailable = true;
    expect((await Ga4ConversionService.sendForEventId('evt_1', deps)).outcome).toBe('store_unavailable');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('non-conversion and too-old events are not sent', async () => {
    const { store, fetchImpl, deps } = setup();
    store.events.set('evt_1', ev({ type: 'EXPIRATION' }));
    expect(await Ga4ConversionService.sendForEventId('evt_1', deps)).toMatchObject({ outcome: 'no_conversion', reason: 'not_a_conversion' });
    const old = NOW - 73 * 3_600_000;
    store.events.set('evt_1', ev({ event_timestamp: new Date(old).toISOString() }, { event_timestamp_ms: old }));
    expect((await Ga4ConversionService.sendForEventId('evt_1', deps)).outcome).toBe('too_old');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.rows.size).toBe(0);
  });

  it('sweep is dry-run by default (no writes, no network) and works without config', async () => {
    const { store, fetchImpl } = setup();
    const r = await Ga4ConversionService.sweep({}, { store, fetchImpl, env: {}, now: () => NOW });
    expect(r.mode).toBe('dry_run');
    expect(r.counts).toEqual({ would_send: 1 });
    expect(r.results[0]).toMatchObject({ eventId: 'evt_1', eventName: 'purchase_server', value: 9.99 });
    expect(store.rows.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    // apply without config is refused
    expect((await Ga4ConversionService.sweep({ mode: 'apply' }, { store, fetchImpl, env: {}, now: () => NOW })).skipped).toBe('disabled');
  });

  it('validate posts to /debug/mp/collect with ENFORCE_RECOMMENDATIONS and records nothing', async () => {
    const { store, deps } = setup();
    const fetchDebug = vi.fn(async () => Response.json({ validationMessages: [] })) as unknown as typeof fetch;
    const r = await Ga4ConversionService.sweep({ mode: 'validate' }, { ...deps, fetchImpl: fetchDebug });
    expect(r.counts).toEqual({ validated: 1 });
    const [url, init] = (fetchDebug as any).mock.calls[0];
    expect(url).toContain('/debug/mp/collect?');
    expect(JSON.parse(init.body).validation_behavior).toBe('ENFORCE_RECOMMENDATIONS');
    expect(store.rows.size).toBe(0);
  });
});
