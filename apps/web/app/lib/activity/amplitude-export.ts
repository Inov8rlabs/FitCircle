/**
 * Amplitude Export API client + parser (server only).
 *   GET https://amplitude.com/api/2/export?start=YYYYMMDDTHH&end=YYYYMMDDTHH  (both hours inclusive, UTC)
 *   Basic auth API key : secret key. Response = zip of gzipped JSON-lines files; 404 = no data.
 * Keys: AMPLITUDE_API_KEY (defaults to the FitCircle 746168 production project key) and
 * AMPLITUDE_SECRET_KEY (the same secret the processor-deletion service uses).
 * PURE except fetchAmplitudeExportHour.
 */
import { gunzipSync } from 'node:zlib';

import { unzipSync } from 'fflate';

import { AMPLITUDE_PROJECT_KEYS } from '../analytics/amplitude-server';

export const AMPLITUDE_EXPORT_URL = 'https://amplitude.com/api/2/export';

export class AmplitudeNotConfiguredError extends Error {
  readonly code = 'AMPLITUDE_NOT_CONFIGURED';
  constructor() {
    super('Amplitude export is not configured (AMPLITUDE_SECRET_KEY missing).');
    this.name = 'AmplitudeNotConfiguredError';
  }
}

export function amplitudeExportCredentials(env: NodeJS.ProcessEnv = process.env): { apiKey: string; secret: string } {
  const apiKey = (env.AMPLITUDE_API_KEY ?? '').trim() || AMPLITUDE_PROJECT_KEYS.production;
  const secret = (env.AMPLITUDE_SECRET_KEY ?? '').trim();
  if (!apiKey || !secret) throw new AmplitudeNotConfiguredError();
  return { apiKey, secret };
}

/**
 * Event types that are not a user using the app, even though a client sent them:
 *  - Push Sent: server / delivery bookkeeping;
 *  - Health Sync Completed: HealthKit / Health Connect background sync (runs without the user);
 *  - [Amplitude] Application Backgrounded: the user leaving, often from a background wake;
 *  - Security Summary, Integrity Checked, Integrity Blocked, Signup Blocked: security telemetry;
 *  - $identify / $groupidentify: user-property updates, not events (the server also sends them);
 *  - session_start / session_end: the SDK opens a session whenever the app process starts, including
 *    background wakes (Health Connect / HealthKit sync, push delivery). On Android about half of the
 *    "active" users each day had only these (2026-11-12 check: _active ≈ 60/day vs Screen Viewed ≈ 16/day);
 *  - [Amplitude] Application Installed / Updated: lifecycle bookkeeping, also fired from background starts;
 *  - every '[Experiment] …' event (exposures / assignments fire on fetch, not on use).
 * Events with platform 'server' or no platform are skipped separately (isActiveAmplitudeEvent).
 */
export const AMPLITUDE_INACTIVE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'Push Sent',
  'Health Sync Completed',
  '[Amplitude] Application Backgrounded',
  'Security Summary',
  'Integrity Checked',
  'Integrity Blocked',
  'Signup Blocked',
  '$identify',
  '$groupidentify',
  'session_start',
  'session_end',
  '[Amplitude] Application Installed',
  '[Amplitude] Application Updated',
]);
export const AMPLITUDE_INACTIVE_EVENT_PREFIXES: readonly string[] = ['[Experiment]'];

export interface AmplitudeRawEvent {
  user_id?: string | null;
  event_type?: string | null;
  event_time?: string | null;
  platform?: string | null;
  [k: string]: unknown;
}

export type ActivePlatform = 'ios' | 'android' | 'web';

export interface ActiveEvent {
  userId: string; // lower-case uuid
  at: string; // ISO UTC
  platform: ActivePlatform;
  eventType: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function normalizeAmplitudePlatform(v: unknown): ActivePlatform | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'ios' || s === 'android' || s === 'web') return s;
  return null;
}

/** 'YYYY-MM-DD HH:MM:SS.ffffff' (UTC) → ISO instant, or null. */
export function parseAmplitudeTime(v: unknown): string | null {
  const m = String(v ?? '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?/);
  if (!m) return null;
  const ms = (m[3] ?? '').padEnd(3, '0').slice(0, 3);
  const t = Date.parse(`${m[1]}T${m[2]}.${ms}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** The user-action event this raw event represents, or null (inactive / server / no user). */
export function toActiveEvent(e: AmplitudeRawEvent): ActiveEvent | null {
  const eventType = String(e.event_type ?? '');
  if (!eventType || AMPLITUDE_INACTIVE_EVENT_TYPES.has(eventType)) return null;
  if (AMPLITUDE_INACTIVE_EVENT_PREFIXES.some((p) => eventType.startsWith(p))) return null;
  const platform = normalizeAmplitudePlatform(e.platform);
  if (!platform) return null;
  // iOS sends UUID().uuidString (upper case); profile ids are lower case.
  const userId = String(e.user_id ?? '').trim().toLowerCase();
  if (!UUID_RE.test(userId)) return null;
  const at = parseAmplitudeTime(e.event_time);
  if (!at) return null;
  return { userId, at, platform, eventType };
}

/** Zip (of .gz JSON-lines files, or plain .json) → raw events. Bad lines are skipped and counted. */
export function parseAmplitudeExportZip(zip: Uint8Array): { events: AmplitudeRawEvent[]; badLines: number } {
  const files = unzipSync(zip);
  const events: AmplitudeRawEvent[] = [];
  let badLines = 0;
  for (const name of Object.keys(files).sort()) {
    const data = files[name];
    if (!data || data.length === 0 || name.endsWith('/')) continue;
    // gunzip with node:zlib (fflate only reads the zip container).
    const text = new TextDecoder().decode(name.endsWith('.gz') ? gunzipSync(data) : data);
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        badLines++;
      }
    }
  }
  return { events, badLines };
}

/** 'YYYYMMDDTHH' for the UTC hour containing `t`. */
export function hourKey(t: number | Date): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}`;
}

/** 'YYYYMMDDTHH' → epoch ms of the hour start, or NaN. */
export function hourStartMs(hour: string): number {
  const m = hour.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})$/);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]));
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Raw events for one UTC hour; [] when Amplitude has no data (404). */
export async function fetchAmplitudeExportHour(
  hour: string,
  opts: { env?: NodeJS.ProcessEnv; fetchImpl?: FetchLike } = {}
): Promise<{ events: AmplitudeRawEvent[]; badLines: number }> {
  const { apiKey, secret } = amplitudeExportCredentials(opts.env);
  const f = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const url = `${AMPLITUDE_EXPORT_URL}?start=${hour}&end=${hour}`;
  const res = await f(url, { headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${secret}`).toString('base64')}` } });
  if (res.status === 404) return { events: [], badLines: 0 };
  if (!res.ok) throw new Error(`Amplitude export ${hour}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length === 0) return { events: [], badLines: 0 };
  return parseAmplitudeExportZip(buf);
}
