/**
 * App Store Connect In-App Events (docs/CAMPAIGNS_SPEC.md §7).
 *
 * - Auth: ES256 JWT (jose) from ASC_KEY_ID / ASC_ISSUER_ID / ASC_PRIVATE_KEY
 *   (p8 text; literal "\n" sequences are accepted), app ASC_APP_ID.
 * - sync: create/update `appEvents` + the en-US `appEventLocalizations`, then
 *   upload `appEventScreenshots` (EVENT_CARD 1920×1080, EVENT_DETAILS_PAGE
 *   1080×1920) via reservation → PUT parts → commit with an MD5 checksum.
 * - submit: `reviewSubmissions` (+ `reviewSubmissionItems`) then submitted=true.
 * Missing env → CampaignError 409 APP_STORE_NOT_CONNECTED.
 */

import { SignJWT, importPKCS8 } from 'jose';

import { CampaignError } from './http';
import type { CampaignRow } from './model';
import { rowToAdmin } from './model';
import { appStoreIssues, appStoreSchedule } from './schema';
import type { ArtSlot } from './types';
import { campaignPageUrl } from './unsubscribe';

export const ASC_BASE = 'https://api.appstoreconnect.apple.com';
export const DEFAULT_ASC_APP_ID = '6811432467';

export interface AscConfig {
  keyId: string;
  issuerId: string;
  privateKey: string;
  appId: string;
}

export function ascConfig(): AscConfig | null {
  const keyId = process.env.ASC_KEY_ID?.trim();
  const issuerId = process.env.ASC_ISSUER_ID?.trim();
  const privateKey = process.env.ASC_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  if (!keyId || !issuerId || !privateKey) return null;
  return { keyId, issuerId, privateKey, appId: process.env.ASC_APP_ID?.trim() || DEFAULT_ASC_APP_ID };
}

export function requireAscConfig(): AscConfig {
  const cfg = ascConfig();
  if (!cfg) throw new CampaignError(409, 'APP_STORE_NOT_CONNECTED', 'App Store Connect is not connected (ASC_* env vars missing)');
  return cfg;
}

export async function ascToken(cfg: AscConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<string> {
  const key = await importPKCS8(cfg.privateKey, 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: cfg.keyId, typ: 'JWT' })
    .setIssuer(cfg.issuerId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 19 * 60)
    .setAudience('appstoreconnect-v1')
    .sign(key);
}

export class AscClient {
  private token: string | null = null;
  constructor(
    private readonly cfg: AscConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))
  ) {}

  get appId() {
    return this.cfg.appId;
  }

  async call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    this.token ??= await ascToken(this.cfg);
    // App Store Connect returns sporadic 500s. Retry idempotent calls (never POST,
    // which can succeed server-side and still answer 500 — see adoptExistingEvent).
    const retries = method === 'POST' ? 0 : 3;
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await this.fetchImpl(`${ASC_BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!(res.status >= 500 || res.status === 429) || attempt >= retries) break;
      await this.sleep(1000 * 2 ** attempt);
    }
    if (res.status === 204) return null as T;
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const detail = json?.errors?.map((e: any) => e.detail || e.title).filter(Boolean).join('; ') || `HTTP ${res.status}`;
      throw new CampaignError(502, 'APP_STORE_ERROR', `App Store Connect: ${detail}`, { status: res.status, path, errors: json?.errors ?? null });
    }
    return json as T;
  }

  async upload(op: { method: string; url: string; offset: number; length: number; requestHeaders?: Array<{ name: string; value: string }> }, bytes: Uint8Array) {
    const headers: Record<string, string> = {};
    for (const h of op.requestHeaders ?? []) headers[h.name] = h.value;
    const res = await this.fetchImpl(op.url, { method: op.method || 'PUT', headers, body: bytes.slice(op.offset, op.offset + op.length) as any });
    if (!res.ok) throw new CampaignError(502, 'APP_STORE_ERROR', `Screenshot upload failed (HTTP ${res.status})`);
  }
}

const SLOT_ASSET_TYPE: Partial<Record<ArtSlot, 'EVENT_CARD' | 'EVENT_DETAILS_PAGE'>> = {
  appStoreCard: 'EVENT_CARD',
  appStoreDetails: 'EVENT_DETAILS_PAGE',
};

let territoryCache: string[] | null = null;
async function allTerritories(client: AscClient): Promise<string[]> {
  if (territoryCache) return territoryCache;
  const res = await client.call<{ data: Array<{ id: string }> }>('GET', '/v1/territories?limit=200');
  territoryCache = (res?.data ?? []).map((t) => t.id);
  return territoryCache;
}
export function resetTerritoryCache() {
  territoryCache = null;
}

export function eventAttributes(row: CampaignRow, territories: string[]) {
  const a = row.app_store ?? {};
  const s = appStoreSchedule({ featuredFrom: row.featured_from, startsAt: row.starts_at, endsAt: row.ends_at });
  return {
    referenceName: row.slug,
    badge: a.badge,
    deepLink: campaignPageUrl(row.slug),
    purchaseRequirement: 'NO_COST_ASSOCIATED',
    primaryLocale: 'en-US',
    priority: a.priority ?? 'NORMAL',
    purpose: a.purpose ?? 'APPROPRIATE_FOR_ALL_USERS',
    territorySchedules: [{ territories, publishStart: s.publishStart, eventStart: s.eventStart, eventEnd: s.eventEnd }],
  };
}

export interface AppStoreStatus {
  connected: boolean;
  eventId: string | null;
  state: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  issues: string[];
  schedule: ReturnType<typeof appStoreSchedule>;
  exportPack: { name: string; shortDescription: string; longDescription: string; badge: string | null; card: string | null; details: string | null };
}

export function exportPack(row: CampaignRow): AppStoreStatus['exportPack'] {
  const a = row.app_store ?? {};
  return {
    name: a.name ?? '',
    shortDescription: a.shortDescription ?? '',
    longDescription: a.longDescription ?? '',
    badge: a.badge ?? null,
    card: row.art?.appStoreCard?.url ?? null,
    details: row.art?.appStoreDetails?.url ?? null,
  };
}

/** GET /{id}/app-store — local status; refreshes the event state when connected. */
export async function appStoreStatus(row: CampaignRow, today: string, fetchImpl?: typeof fetch): Promise<AppStoreStatus> {
  const cfg = ascConfig();
  const a = row.app_store ?? {};
  let state = (a.state as string | null) ?? null;
  if (cfg && a.eventId) {
    try {
      const res = await new AscClient(cfg, fetchImpl).call('GET', `/v1/appEvents/${a.eventId}`);
      state = res?.data?.attributes?.eventState ?? state;
    } catch {
      // keep the stored state
    }
  }
  return {
    connected: !!cfg,
    eventId: (a.eventId as string | null) ?? null,
    state,
    lastSyncedAt: (a.lastSyncedAt as string | null) ?? null,
    lastError: (a.lastError as string | null) ?? null,
    issues: appStoreIssues(rowToAdmin(row, today)),
    schedule: appStoreSchedule({ featuredFrom: row.featured_from, startsAt: row.starts_at, endsAt: row.ends_at }),
    exportPack: exportPack(row),
  };
}

/**
 * Create/update the event, its en-US localization and screenshots.
 * Returns the new `app_store` jsonb to persist (eventId, state, …).
 */
export async function syncAppEvent(row: CampaignRow, today: string, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const cfg = requireAscConfig();
  const issues = appStoreIssues(rowToAdmin(row, today));
  if (issues.length) throw new CampaignError(422, 'APP_STORE_INVALID', 'Fix the App Store event details first', { issues });
  const client = new AscClient(cfg, fetchImpl);
  const a = { ...(row.app_store ?? {}) } as Record<string, any>;

  const attributes = eventAttributes(row, await allTerritories(client));
  let event: any;
  if (a.eventId) {
    event = await client.call('PATCH', `/v1/appEvents/${a.eventId}`, {
      data: { type: 'appEvents', id: a.eventId, attributes },
    });
  } else if ((a.eventId = await adoptExistingEvent(client, row.slug))) {
    event = await client.call('PATCH', `/v1/appEvents/${a.eventId}`, {
      data: { type: 'appEvents', id: a.eventId, attributes },
    });
  } else {
    event = await client.call('POST', '/v1/appEvents', {
      data: { type: 'appEvents', attributes, relationships: { app: { data: { type: 'apps', id: client.appId } } } },
    });
  }
  const eventId: string = event?.data?.id ?? a.eventId;
  a.eventId = eventId;
  a.state = event?.data?.attributes?.eventState ?? a.state ?? null;

  // en-US localization
  const loc = { locale: 'en-US', name: a.name, shortDescription: a.shortDescription, longDescription: a.longDescription };
  const existing = await client.call('GET', `/v1/appEvents/${eventId}/localizations`);
  const enUs = (existing?.data ?? []).find((l: any) => l?.attributes?.locale === 'en-US');
  let localizationId: string;
  if (enUs) {
    localizationId = enUs.id;
    await client.call('PATCH', `/v1/appEventLocalizations/${enUs.id}`, {
      data: { type: 'appEventLocalizations', id: enUs.id, attributes: { name: loc.name, shortDescription: loc.shortDescription, longDescription: loc.longDescription } },
    });
  } else {
    const created = await client.call('POST', '/v1/appEventLocalizations', {
      data: { type: 'appEventLocalizations', attributes: loc, relationships: { appEvent: { data: { type: 'appEvents', id: eventId } } } },
    });
    localizationId = created?.data?.id;
  }
  a.localizationId = localizationId;

  // Screenshots: (re)upload a slot when its art changed since the last upload.
  const synced: Record<string, { id: string; artUpdatedAt: string }> = { ...(a.screenshots ?? {}) };
  const slots = (Object.keys(SLOT_ASSET_TYPE) as ArtSlot[]).filter((s) => row.art?.[s]?.url);
  if (slots.length) {
    const current = await client.call('GET', `/v1/appEventLocalizations/${localizationId}/appEventScreenshots`);
    for (const slot of slots) {
      const art = row.art![slot]!;
      const assetType = SLOT_ASSET_TYPE[slot]!;
      const onAsc = (current?.data ?? []).find((s: any) => s?.attributes?.appEventAssetType === assetType);
      if (onAsc && synced[slot]?.id === onAsc.id && synced[slot]?.artUpdatedAt === art.updatedAt) continue;
      if (onAsc) await client.call('DELETE', `/v1/appEventScreenshots/${onAsc.id}`);
      const id = await uploadScreenshot(client, localizationId, assetType, art.url, fetchImpl);
      synced[slot] = { id, artUpdatedAt: art.updatedAt };
    }
  }
  a.screenshots = synced;
  a.lastSyncedAt = new Date().toISOString();
  a.lastError = null;
  return a;
}

/** A POST that answered 500 may still have created the event: reuse a draft with our reference name. */
async function adoptExistingEvent(client: AscClient, slug: string): Promise<string | null> {
  try {
    const res = await client.call('GET', `/v1/apps/${client.appId}/appEvents?limit=200`);
    const hit = (res?.data ?? []).find((e: any) => e?.attributes?.referenceName === slug);
    return hit?.id ?? null;
  } catch {
    return null;
  }
}

async function uploadScreenshot(client: AscClient, localizationId: string, assetType: string, url: string, fetchImpl: typeof fetch): Promise<string> {
  const img = await fetchImpl(url);
  if (!img.ok) throw new CampaignError(502, 'ART_FETCH_FAILED', `Could not download ${assetType} art (HTTP ${img.status})`);
  const bytes = new Uint8Array(await img.arrayBuffer());
  const fileName = url.split('/').pop()?.split('?')[0] || `${assetType.toLowerCase()}.png`;
  const reservation = await client.call('POST', '/v1/appEventScreenshots', {
    data: {
      type: 'appEventScreenshots',
      attributes: { fileName, fileSize: bytes.byteLength, appEventAssetType: assetType },
      relationships: { appEventLocalization: { data: { type: 'appEventLocalizations', id: localizationId } } },
    },
  });
  const id: string = reservation?.data?.id;
  for (const op of reservation?.data?.attributes?.uploadOperations ?? []) await client.upload(op, bytes);
  await client.call('PATCH', `/v1/appEventScreenshots/${id}`, {
    data: {
      type: 'appEventScreenshots',
      id,
      // appEventScreenshots only accept `uploaded` (no sourceFileChecksum, unlike app screenshots).
      attributes: { uploaded: true },
    },
  });
  return id;
}

/** Submit the synced event for review. Returns the new `app_store` jsonb. */
export async function submitAppEvent(row: CampaignRow, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const cfg = requireAscConfig();
  const a = { ...(row.app_store ?? {}) } as Record<string, any>;
  if (!a.eventId) throw new CampaignError(409, 'APP_STORE_NOT_SYNCED', 'Sync the event to App Store Connect before submitting');
  const client = new AscClient(cfg, fetchImpl);

  // Reuse an open (not yet submitted) submission if there is one.
  const open = await client.call(
    'GET',
    `/v1/reviewSubmissions?filter[app]=${client.appId}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW&limit=1`
  );
  let submissionId: string | undefined = open?.data?.[0]?.id;
  if (!submissionId) {
    const created = await client.call('POST', '/v1/reviewSubmissions', {
      data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: client.appId } } } },
    });
    submissionId = created?.data?.id;
  }
  await client.call('POST', '/v1/reviewSubmissionItems', {
    data: {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
        appEvent: { data: { type: 'appEvents', id: a.eventId } },
      },
    },
  });
  await client.call('PATCH', `/v1/reviewSubmissions/${submissionId}`, {
    data: { type: 'reviewSubmissions', id: submissionId, attributes: { submitted: true } },
  });
  const ev = await client.call('GET', `/v1/appEvents/${a.eventId}`);
  a.state = ev?.data?.attributes?.eventState ?? 'WAITING_FOR_REVIEW';
  a.submissionId = submissionId;
  a.lastError = null;
  return a;
}
