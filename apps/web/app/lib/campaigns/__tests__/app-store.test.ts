import { generateKeyPairSync } from 'node:crypto';

import type * as Jose from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { advent } from '../../services/__tests__/campaign-fixtures';
import type * as AppStore from '../app-store';

// Under jsdom, TextEncoder output and the global Uint8Array come from different
// realms, which jose's `instanceof Uint8Array` check rejects. Load jose (via
// app-store) only after installing an encoder that builds global Uint8Arrays.
let asc: typeof AppStore;
let jose: typeof Jose;
beforeAll(async () => {
  (globalThis as any).TextEncoder = class {
    readonly encoding = 'utf-8';
    encode(input = '') {
      return new Uint8Array(Buffer.from(input, 'utf8'));
    }
  };
  jose = await import('jose');
  asc = await import('../app-store');
});
const ascConfig = () => asc.ascConfig();
const ascToken = (...a: Parameters<typeof asc.ascToken>) => asc.ascToken(...a);
const resetTerritoryCache = () => asc?.resetTerritoryCache();
const syncAppEvent = (...a: Parameters<typeof asc.syncAppEvent>) => asc.syncAppEvent(...a);
const submitAppEvent = (...a: Parameters<typeof asc.submitAppEvent>) => asc.submitAppEvent(...a);

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

type Call = { method: string; url: string; body: any };
function mockFetch(routes: Array<[RegExp, (c: Call) => any]>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: any = {}) => {
    const call: Call = { method: init.method ?? 'GET', url: String(url), body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
    calls.push(call);
    const hit = routes.find(([re]) => re.test(`${call.method} ${call.url}`));
    const out = hit ? hit[1](call) : {};
    if (out instanceof Uint8Array) return new Response(out as unknown as BodyInit, { status: 200 });
    if (out && out.__status) return new Response(JSON.stringify(out.body ?? {}), { status: out.__status });
    return new Response(JSON.stringify(out ?? {}), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const row = () =>
  advent({
    app_store: { name: 'Advent Circle', shortDescription: 'A small healthy win behind every door.', longDescription: 'Open one door a day from Dec 1 to 24.', badge: 'SPECIAL_EVENT', purpose: 'APPROPRIATE_FOR_ALL_USERS', priority: 'HIGH' },
    art: { appStoreCard: { url: 'https://cdn.test/campaign-art/x/appStoreCard-1.png', width: 1920, height: 1080, generated: true, updatedAt: '2026-11-01T00:00:00Z' } },
  });

beforeEach(() => {
  process.env.ASC_KEY_ID = 'KEY123';
  process.env.ASC_ISSUER_ID = 'issuer-uuid';
  process.env.ASC_PRIVATE_KEY = PEM.replace(/\n/g, '\\n'); // env-style escaped newlines
  delete process.env.ASC_APP_ID;
  resetTerritoryCache();
});
afterEach(() => {
  delete process.env.ASC_KEY_ID;
  delete process.env.ASC_ISSUER_ID;
  delete process.env.ASC_PRIVATE_KEY;
});

describe('App Store Connect', () => {
  it('signs an ES256 JWT with the ASC claims', async () => {
    const cfg = ascConfig()!;
    expect(cfg.appId).toBe('6811432467');
    const jwt = await ascToken(cfg, 1_800_000_000);
    expect(jose.decodeProtectedHeader(jwt)).toEqual({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
    expect(jose.decodeJwt(jwt)).toEqual({ iss: 'issuer-uuid', iat: 1_800_000_000, exp: 1_800_000_000 + 1140, aud: 'appstoreconnect-v1' });
  });

  it('is not connected without env', async () => {
    delete process.env.ASC_KEY_ID;
    expect(ascConfig()).toBeNull();
    await expect(syncAppEvent(row(), '2026-11-01')).rejects.toMatchObject({ status: 409, code: 'APP_STORE_NOT_CONNECTED' });
  });

  it('sync: creates the event, en-US localization and uploads the card screenshot with a checksum', async () => {
    const image = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const { impl, calls } = mockFetch([
      [/GET .*\/v1\/territories/, () => ({ data: [{ id: 'USA' }, { id: 'GBR' }] })],
      [/POST .*\/v1\/appEvents$/, () => ({ data: { id: 'ev1', attributes: { eventState: 'DRAFT' } } })],
      [/GET .*\/v1\/appEvents\/ev1\/localizations/, () => ({ data: [] })],
      [/POST .*\/v1\/appEventLocalizations$/, () => ({ data: { id: 'loc1' } })],
      [/GET .*\/v1\/appEventLocalizations\/loc1\/appEventScreenshots/, () => ({ data: [] })],
      [/GET https:\/\/cdn\.test/, () => image],
      [/POST .*\/v1\/appEventScreenshots$/, () => ({
        data: { id: 'shot1', attributes: { uploadOperations: [
          { method: 'PUT', url: 'https://upload.test/part1', offset: 0, length: 4, requestHeaders: [{ name: 'Content-Type', value: 'image/png' }] },
          { method: 'PUT', url: 'https://upload.test/part2', offset: 4, length: 2, requestHeaders: [] },
        ] } },
      })],
      [/PUT https:\/\/upload\.test/, () => ({})],
      [/PATCH .*\/v1\/appEventScreenshots\/shot1/, () => ({ data: { id: 'shot1' } })],
    ]);
    const out = await syncAppEvent(row(), '2026-11-01', impl);
    expect(out).toMatchObject({ eventId: 'ev1', state: 'DRAFT', localizationId: 'loc1', lastError: null, screenshots: { appStoreCard: { id: 'shot1', artUpdatedAt: '2026-11-01T00:00:00Z' } } });

    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/appEvents'))!;
    expect(create.body.data.relationships.app.data).toEqual({ type: 'apps', id: '6811432467' });
    expect(create.body.data.attributes).toMatchObject({
      referenceName: 'advent_2026',
      badge: 'SPECIAL_EVENT',
      deepLink: 'https://www.fitcircle.ai/c/advent_2026',
      primaryLocale: 'en-US',
      territorySchedules: [{ territories: ['USA', 'GBR'], publishStart: '2026-11-17T08:00:00.000Z', eventStart: '2026-12-01T08:00:00.000Z', eventEnd: '2026-12-25T07:59:00.000Z' }],
    });
    const loc = calls.find((c) => c.url.endsWith('/v1/appEventLocalizations'))!;
    expect(loc.body.data.attributes).toEqual({ locale: 'en-US', name: 'Advent Circle', shortDescription: 'A small healthy win behind every door.', longDescription: 'Open one door a day from Dec 1 to 24.' });
    const reserve = calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/appEventScreenshots'))!;
    expect(reserve.body.data.attributes).toEqual({ fileName: 'appStoreCard-1.png', fileSize: 6, appEventAssetType: 'EVENT_CARD' });
    const parts = calls.filter((c) => c.url.startsWith('https://upload.test'));
    expect(parts.map((p) => Array.from(p.body as Uint8Array))).toEqual([[1, 2, 3, 4], [5, 6]]);
    const commit = calls.find((c) => c.method === 'PATCH' && c.url.includes('/appEventScreenshots/shot1'))!;
    expect(commit.body.data.attributes).toEqual({ uploaded: true, sourceFileChecksum: '6ac1e56bc78f031059be7be854522c4c' });

    // Second sync with unchanged art: PATCHes the event, no re-upload.
    const again = mockFetch([
      [/GET .*\/v1\/territories/, () => ({ data: [{ id: 'USA' }] })],
      [/PATCH .*\/v1\/appEvents\/ev1/, () => ({ data: { id: 'ev1', attributes: { eventState: 'DRAFT' } } })],
      [/GET .*\/v1\/appEvents\/ev1\/localizations/, () => ({ data: [{ id: 'loc1', attributes: { locale: 'en-US' } }] })],
      [/GET .*\/appEventScreenshots/, () => ({ data: [{ id: 'shot1', attributes: { appEventAssetType: 'EVENT_CARD' } }] })],
    ]);
    await syncAppEvent({ ...row(), app_store: { ...row().app_store, ...out } }, '2026-11-01', again.impl);
    expect(again.calls.some((c) => c.method === 'POST')).toBe(false);
    expect(again.calls.some((c) => c.method === 'PATCH' && c.url.includes('/v1/appEventLocalizations/loc1'))).toBe(true);
  });

  it('sync rejects events longer than 31 days before calling Apple', async () => {
    const { impl, calls } = mockFetch([]);
    await expect(syncAppEvent({ ...row(), starts_at: '2026-11-01', featured_from: '2026-11-01' }, '2026-10-01', impl)).rejects.toMatchObject({ code: 'APP_STORE_INVALID' });
    expect(calls).toHaveLength(0);
  });

  it('submit: review submission + item + submitted=true; surfaces Apple errors', async () => {
    const { impl, calls } = mockFetch([
      [/GET .*\/v1\/reviewSubmissions\?/, () => ({ data: [] })],
      [/POST .*\/v1\/reviewSubmissions$/, () => ({ data: { id: 'rs1' } })],
      [/POST .*\/v1\/reviewSubmissionItems$/, () => ({ data: { id: 'item1' } })],
      [/PATCH .*\/v1\/reviewSubmissions\/rs1/, () => ({ data: { id: 'rs1' } })],
      [/GET .*\/v1\/appEvents\/ev1$/, () => ({ data: { id: 'ev1', attributes: { eventState: 'WAITING_FOR_REVIEW' } } })],
    ]);
    const out = await submitAppEvent({ ...row(), app_store: { ...row().app_store, eventId: 'ev1' } }, impl);
    expect(out).toMatchObject({ state: 'WAITING_FOR_REVIEW', submissionId: 'rs1' });
    const item = calls.find((c) => c.url.endsWith('/v1/reviewSubmissionItems'))!;
    expect(item.body.data.relationships.appEvent.data).toEqual({ type: 'appEvents', id: 'ev1' });
    expect(calls.find((c) => c.method === 'PATCH')!.body.data.attributes).toEqual({ submitted: true });

    await expect(submitAppEvent(row(), impl)).rejects.toMatchObject({ code: 'APP_STORE_NOT_SYNCED' });
    const failing = mockFetch([[/.*/, () => ({ __status: 409, body: { errors: [{ detail: 'Event already submitted' }] } })]]);
    await expect(submitAppEvent({ ...row(), app_store: { eventId: 'ev1' } }, failing.impl)).rejects.toMatchObject({ code: 'APP_STORE_ERROR', message: 'App Store Connect: Event already submitted' });
  });
});
