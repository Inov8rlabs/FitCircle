/**
 * Google Play Developer API (androidpublisher v3) releases connector — READ-ONLY
 * (docs/RELEASES_TRACKER_SPEC.md §5.2). Off until GOOGLE_PLAY_SA_KEY is set.
 *
 * Auth: a service account key (GOOGLE_PLAY_SA_KEY = key JSON, raw or base64)
 * invited to Play Console with read-only app access; OAuth JWT-bearer grant for
 * scope androidpublisher (same flow as the Google Ads connector).
 *
 * Tracks can only be read inside an edit, so each sync does:
 *   POST edits (insert) → GET edits/{id}/tracks → DELETE edits/{id}.
 * The edit is never committed, so nothing on Play changes. The delete runs in
 * a finally block; an abandoned edit also expires on its own.
 */
import { createSign } from 'node:crypto';

import { parseServiceAccountKey, type GoogleServiceAccountKey } from '@/lib/ads/connectors/google-ads';

import { playStatus, playTrackName, playVersionFromName, releaseKey, type ObservedRelease } from '../status';

import type { FetchLike, ReleaseConnector, StoreSnapshot } from './types';

export const PLAY_API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
export const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const DEFAULT_PLAY_PACKAGE = 'com.inov8rlabs.apps.fitcircle';

type Json = Record<string, any>;

export interface PlayCredentials {
  key: GoogleServiceAccountKey;
  packageName: string;
}

export function playCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): PlayCredentials | null {
  const key = parseServiceAccountKey(env.GOOGLE_PLAY_SA_KEY);
  if (!key) return null;
  return { key, packageName: env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || DEFAULT_PLAY_PACKAGE };
}

export function playJwtAssertion(key: GoogleServiceAccountKey, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = { alg: 'RS256', typ: 'JWT', ...(key.private_key_id ? { kid: key.private_key_id } : {}) };
  const claims = { iss: key.client_email, scope: PLAY_SCOPE, aud: key.token_uri || GOOGLE_TOKEN_URL, iat: nowSec, exp: nowSec + 3600 };
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${enc(header)}.${enc(claims)}`;
  return `${input}.${createSign('RSA-SHA256').update(input).sign(key.private_key).toString('base64url')}`;
}

const pickNotes = (notes: Json[] | undefined): string | null => {
  const list = notes ?? [];
  const en = list.find((n) => n.language === 'en-US') ?? list.find((n) => String(n.language ?? '').startsWith('en')) ?? list[0];
  return typeof en?.text === 'string' && en.text.trim() ? en.text : null;
};

/** edits.tracks.list response → releases (one per track release, keyed by its highest versionCode). */
export function mapPlayTracks(body: { tracks?: Json[] }): StoreSnapshot {
  const releases: ObservedRelease[] = [];
  const completeTracks: string[] = [];
  for (const t of body.tracks ?? []) {
    const trackId = String(t.track ?? '');
    if (!trackId) continue;
    const track = playTrackName(trackId);
    completeTracks.push(`android:${track}`);
    for (const r of t.releases ?? []) {
      const codes: string[] = (r.versionCodes ?? []).map(String).filter((c: string) => /^\d+$/.test(c));
      if (!codes.length) continue; // e.g. a draft with no bundle yet
      const build = codes.reduce((a, b) => (Number(b) > Number(a) ? b : a));
      const version = playVersionFromName(r.name, build);
      const status = playStatus(r.status, trackId);
      const fraction = typeof r.userFraction === 'number' ? r.userFraction : status === 'live' ? 1 : null;
      const ct = r.countryTargeting;
      releases.push({
        releaseKey: releaseKey({ platform: 'android', track, version, build }),
        platform: 'android',
        track,
        version,
        build,
        status,
        storeStatus: r.status ?? null,
        rolloutFraction: fraction,
        countries: Array.isArray(ct?.countries) && ct.countries.length ? ct.countries.map(String) : null,
        whatsNew: pickNotes(r.releaseNotes),
        sourceId: `${trackId}:${build}`,
        raw: { track: trackId, name: r.name ?? null, versionCodes: codes, status: r.status ?? null, userFraction: r.userFraction ?? null, countryTargeting: ct ?? null, inAppUpdatePriority: r.inAppUpdatePriority ?? null },
      });
    }
  }
  return { releases, completeTracks };
}

export class GooglePlayReleasesConnector implements ReleaseConnector {
  source = 'google_play' as const;
  constructor(
    private readonly creds: PlayCredentials | null = playCredentialsFromEnv(),
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  isConfigured(): boolean {
    return !!this.creds;
  }

  private async token(): Promise<string> {
    const key = this.creds!.key;
    const res = await this.fetchImpl(key.token_uri || GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: playJwtAssertion(key) }).toString(),
    });
    const json: Json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw new Error(`Google token: ${json.error_description ?? json.error ?? `HTTP ${res.status}`}`);
    return json.access_token;
  }

  private async call(token: string, method: 'GET' | 'POST' | 'DELETE', path: string): Promise<Json | null> {
    const res = await this.fetchImpl(`${PLAY_API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, body: method === 'POST' ? '{}' : undefined });
    const text = await res.text();
    let json: Json | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) throw new Error(`Google Play ${method} ${path.split('?')[0]}: ${json?.error?.message ?? `HTTP ${res.status}`}`);
    return json;
  }

  async fetchSnapshot(): Promise<StoreSnapshot> {
    if (!this.creds) throw new Error('Google Play not configured');
    const pkg = encodeURIComponent(this.creds.packageName);
    const token = await this.token();
    const edit = await this.call(token, 'POST', `/applications/${pkg}/edits`);
    const editId = edit?.id ? encodeURIComponent(String(edit.id)) : null;
    if (!editId) throw new Error('Google Play: edits.insert returned no id');
    try {
      const tracks = await this.call(token, 'GET', `/applications/${pkg}/edits/${editId}/tracks`);
      return mapPlayTracks(tracks ?? {});
    } finally {
      // Read-only: never commit. Discard the edit; failures here don't fail the sync.
      await this.call(token, 'DELETE', `/applications/${pkg}/edits/${editId}`).catch((e) => console.warn('[releases/play] edit delete failed:', e?.message));
    }
  }
}
