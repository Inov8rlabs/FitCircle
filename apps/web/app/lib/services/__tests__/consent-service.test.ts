/** Server-side consent records + the AI rule (docs/PRIVACY_COMPLIANCE_SPEC.md §2–4). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => getReferralDb().client() }));

import { hasAiConsentEvidence, usersWithAiConsentEvidence } from '../../fitzy/ai-consent';
import {
  ConsentService,
  ConsentStoreUnavailableError,
  MIN_GRANTED_AT,
  clampGrantedAt,
  consentSourceFor,
  declaresConsentsV1,
  decideAi,
  reduceConsentRows,
} from '../consent-service';

import { ReferralFakeDb, getReferralDb, setReferralDb } from './referral-fake-db';

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const V = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-11-06T12:00:00Z');
let db: ReferralFakeDb;

const hdr = (h: Record<string, string> = {}) => ({ headers: new Headers(h) });
const granted = { granted: true, policyVersion: '2026-11', grantedAt: '', recordedAt: '', source: 'ios' as const, appVersion: null };
const withdrawn = { ...granted, granted: false };

beforeEach(() => {
  db = new ReferralFakeDb();
  setReferralDb(db);
  db.addProfile({ id: U, created_at: '2026-01-15T00:00:00Z', preferences: { units: 'metric' } });
  db.addProfile({ id: V, created_at: '2026-02-01T00:00:00Z' });
  db.rows('user_consents');
  db.rows('fitzy_conversations');
  db.rows('fitzy_daily');
});

describe('decideAi (the one rule)', () => {
  const ev = (v: boolean) => () => v;
  it('a record decides: granted → allow, withdrawn → deny (beats legacy client and chat evidence)', () => {
    for (const initiator of ['user', 'server'] as const) {
      expect(decideAi(granted, { initiator, clientDeclaresConsents: true, hasChatEvidence: ev(false) })).toEqual({ allowed: true, basis: 'record' });
      expect(decideAi(withdrawn, { initiator, clientDeclaresConsents: false, hasChatEvidence: ev(true) })).toEqual({ allowed: false, basis: 'withdrawn' });
    }
  });
  it('no record, user-initiated: consents_v1 clients are refused; shipped clients pass (legacy_client)', () => {
    expect(decideAi(null, { initiator: 'user', clientDeclaresConsents: true, hasChatEvidence: ev(true) })).toEqual({ allowed: false, basis: 'missing' });
    expect(decideAi(null, { initiator: 'user', clientDeclaresConsents: false, hasChatEvidence: ev(false) })).toEqual({ allowed: true, basis: 'legacy_client' });
  });
  it("no record, user-initiated, legacyFallback 'evidence' (Plan my week): shipped clients need the chat evidence", () => {
    expect(decideAi(null, { initiator: 'user', clientDeclaresConsents: false, hasChatEvidence: ev(false), legacyFallback: 'evidence' }).allowed).toBe(false);
    expect(decideAi(null, { initiator: 'user', clientDeclaresConsents: false, hasChatEvidence: ev(true), legacyFallback: 'evidence' })).toEqual({ allowed: true, basis: 'chat_evidence' });
  });
  it('no record, server-initiated: only with chat evidence', () => {
    expect(decideAi(null, { initiator: 'server', clientDeclaresConsents: false, hasChatEvidence: ev(false) })).toEqual({ allowed: false, basis: 'missing' });
    expect(decideAi(null, { initiator: 'server', clientDeclaresConsents: false, hasChatEvidence: ev(true) })).toEqual({ allowed: true, basis: 'chat_evidence' });
  });
});

describe('pure helpers', () => {
  it('declaresConsentsV1 reads the comma list case-insensitively', () => {
    expect(declaresConsentsV1('icon_keys, Consents_V1')).toBe(true);
    expect(declaresConsentsV1('icon_keys')).toBe(false);
    expect(declaresConsentsV1(null)).toBe(false);
  });
  it('consentSourceFor: X-App-Platform (or X-Platform), else web', () => {
    expect(consentSourceFor(hdr({ 'x-app-platform': 'iOS' }))).toBe('ios');
    expect(consentSourceFor(hdr({ 'x-platform': 'android' }))).toBe('android');
    expect(consentSourceFor(hdr())).toBe('web');
  });
  it('clampGrantedAt: within [max(2025-01-01, account created), now]; junk → now', () => {
    expect(clampGrantedAt('2026-06-01T10:00:00Z', NOW, '2026-01-15T00:00:00Z')).toBe('2026-06-01T10:00:00.000Z');
    expect(clampGrantedAt('2030-01-01T00:00:00Z', NOW, null)).toBe(NOW.toISOString());
    expect(clampGrantedAt('2020-01-01T00:00:00Z', NOW, null)).toBe(new Date(MIN_GRANTED_AT).toISOString());
    expect(clampGrantedAt('2025-06-01T00:00:00Z', NOW, '2026-01-15T00:00:00Z')).toBe('2026-01-15T00:00:00.000Z');
    expect(clampGrantedAt('nope', NOW, null)).toBe(NOW.toISOString());
    expect(clampGrantedAt(undefined, NOW, null)).toBe(NOW.toISOString());
  });
  it('reduceConsentRows: newest by grantedAt, ties by created_at; unknown types ignored', () => {
    const s = reduceConsentRows([
      { consent_type: 'ai_processing', granted: true, policy_version: 'a', source: 'ios', granted_at: '2026-10-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z' },
      { consent_type: 'ai_processing', granted: false, policy_version: 'b', source: 'web', granted_at: '2026-10-05T00:00:00Z', created_at: '2026-10-05T00:00:00Z' },
      { consent_type: 'bogus', granted: true, granted_at: '2026-10-05T00:00:00Z' },
    ]);
    expect(s.ai_processing).toMatchObject({ granted: false, policyVersion: 'b', source: 'web' });
    expect(s.health_data).toBeNull();
    expect(s.marketing_email).toBeNull();
  });
});

describe('ConsentService.record / current', () => {
  it('appends rows (never updates), returns the new snapshot, keeps history', async () => {
    await ConsentService.record(U, [{ type: 'ai_processing', granted: true, policyVersion: '2026-11' }], { source: 'ios', appVersion: '1.1.3', now: NOW });
    const later = new Date(NOW.getTime() + 60_000);
    const snap = await ConsentService.record(U, [{ type: 'ai_processing', granted: false, policyVersion: '2026-11' }], { source: 'web', appVersion: null, now: later });
    expect(snap.ai_processing).toMatchObject({ granted: false, source: 'web' });
    expect(db.rows('user_consents')).toHaveLength(2);
    expect(db.rows('user_consents')[0]).toMatchObject({ user_id: U, consent_type: 'ai_processing', granted: true, source: 'ios', app_version: '1.1.3' });
  });

  it('migrating an on-device consent keeps its original time (clamped to account creation)', async () => {
    const snap = await ConsentService.record(U, [{ type: 'ai_processing', granted: true, policyVersion: 'ios-1', grantedAt: '2025-03-01T00:00:00Z' }], { source: 'ios', appVersion: null, now: NOW });
    expect(snap.ai_processing!.grantedAt).toBe('2026-01-15T00:00:00.000Z');
    expect(snap.ai_processing!.recordedAt).toBe(NOW.toISOString());
  });

  it('marketing_email mirrors into profiles.preferences.marketingEmails (other prefs kept)', async () => {
    await ConsentService.record(U, [{ type: 'marketing_email', granted: false, policyVersion: '2026-11' }], { source: 'web', appVersion: null, now: NOW });
    expect(db.profile(U)!.preferences).toEqual({ units: 'metric', marketingEmails: false });
    expect(await ConsentService.effective(U)).toEqual({ marketingEmail: false });
    expect(await ConsentService.effective(V)).toEqual({ marketingEmail: true }); // opt-out model today
  });

  it('withdrawing AI drops cached AI daily-focus rows', async () => {
    db.rows('fitzy_daily').push({ user_id: U, date: '2026-11-06', payload: { kind: 'tip' } }, { user_id: V, date: '2026-11-06', payload: {} });
    await ConsentService.record(U, [{ type: 'ai_processing', granted: false, policyVersion: '2026-11' }], { source: 'ios', appVersion: null, now: NOW });
    expect(db.rows('fitzy_daily').map((r) => r.user_id)).toEqual([V]);
  });

  it('write failure → ConsentStoreUnavailableError (route: 503)', async () => {
    const client = db.client();
    const failing = { ...client, from: (t: string) => (t === 'user_consents' ? { insert: async () => ({ error: { code: '42P01', message: 'relation does not exist' } }) } : client.from(t)) };
    vi.spyOn(db, 'client').mockReturnValue(failing as any);
    await expect(ConsentService.record(U, [{ type: 'health_data', granted: true, policyVersion: '2026-11' }], { source: 'web', appVersion: null })).rejects.toBeInstanceOf(ConsentStoreUnavailableError);
  });
});

describe('server-initiated AI (lib/fitzy/ai-consent.ts — the hotfix entry points)', () => {
  it('record OR chat evidence; a withdrawal beats the evidence', async () => {
    expect(await hasAiConsentEvidence(U)).toBe(false);
    db.rows('fitzy_conversations').push({ id: 'c1', user_id: U });
    expect(await hasAiConsentEvidence(U)).toBe(true); // hotfix evidence
    await ConsentService.record(U, [{ type: 'ai_processing', granted: false, policyVersion: '2026-11' }], { source: 'web', appVersion: null, now: NOW });
    expect(await hasAiConsentEvidence(U)).toBe(false); // record wins
    await ConsentService.record(V, [{ type: 'ai_processing', granted: true, policyVersion: '2026-11' }], { source: 'android', appVersion: null, now: NOW });
    expect(await hasAiConsentEvidence(V)).toBe(true); // record without any chat
  });

  it('batched (push cron) applies the same rule', async () => {
    const W = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    db.rows('fitzy_conversations').push({ id: 'c1', user_id: U }, { id: 'c2', user_id: W });
    await ConsentService.record(W, [{ type: 'ai_processing', granted: false, policyVersion: '2026-11' }], { source: 'ios', appVersion: null, now: NOW });
    await ConsentService.record(V, [{ type: 'ai_processing', granted: true, policyVersion: '2026-11' }], { source: 'ios', appVersion: null, now: NOW });
    expect([...(await usersWithAiConsentEvidence([U, V, W]))].sort()).toEqual([U, V].sort());
  });

  it('unreadable consent store (not a missing table) fails closed even with chat evidence', async () => {
    db.rows('fitzy_conversations').push({ id: 'c1', user_id: U });
    const client = db.client();
    const broken = {
      ...client,
      from: (t: string) => {
        if (t !== 'user_consents') return client.from(t);
        const q: any = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: async () => ({ data: null, error: { code: '57014', message: 'timeout' } }) };
        return q;
      },
    };
    vi.spyOn(db, 'client').mockReturnValue(broken as any);
    expect(await hasAiConsentEvidence(U)).toBe(false);
    expect((await usersWithAiConsentEvidence([U])).size).toBe(0);
  });

  it('migration 130 not applied (missing table): the hotfix evidence still decides', async () => {
    db.rows('fitzy_conversations').push({ id: 'c1', user_id: U });
    const client = db.client();
    const missing = {
      ...client,
      from: (t: string) => {
        if (t !== 'user_consents') return client.from(t);
        const q: any = { select: () => q, eq: () => q, in: () => q, order: () => q, limit: async () => ({ data: null, error: { code: '42P01', message: 'relation "user_consents" does not exist' } }) };
        return q;
      },
    };
    vi.spyOn(db, 'client').mockReturnValue(missing as any);
    expect(await hasAiConsentEvidence(U)).toBe(true);
    expect(await hasAiConsentEvidence(V)).toBe(false);
  });
});

describe('user-initiated decisions through the service', () => {
  it('legacy client allowed (and logged), consents_v1 client refused, record honoured', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect((await ConsentService.aiDecision(U, { feature: 'food_photo', initiator: 'user', request: hdr({ 'x-app-platform': 'ios', 'x-app-version': '1.1.2' }) })).basis).toBe('legacy_client');
    expect(info.mock.calls.some((c) => String(c[0]).includes('legacy_client'))).toBe(true);
    await expect(ConsentService.assertUserAi(U, hdr({ 'x-client-features': 'consents_v1' }), 'food_photo')).rejects.toMatchObject({ code: 'AI_CONSENT_REQUIRED', status: 403 });
    await ConsentService.record(U, [{ type: 'ai_processing', granted: true, policyVersion: '2026-11' }], { source: 'ios', appVersion: null, now: NOW });
    await expect(ConsentService.assertUserAi(U, hdr({ 'x-client-features': 'consents_v1' }), 'food_photo')).resolves.toBeUndefined();
    info.mockRestore();
  });
});
