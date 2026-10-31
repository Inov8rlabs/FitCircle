/**
 * Minimal BigQuery REST client for the GA4 export (docs/ADS_ATTRIBUTION_GA4.md):
 * service-account JWT → access token → jobs.query, polling getQueryResults and
 * following pageToken. Read-only by IAM (BigQuery Data Viewer on the dataset +
 * Job User on the project); no SDK.
 *
 * Env (read at call time):
 *   GA4_BIGQUERY_PROJECT_ID   GCP project that holds the export and runs the job (e.g. fitcircle-fitness-app)
 *   GA4_BIGQUERY_DATASET      export dataset, analytics_<GA4 property id> (e.g. analytics_553928425)
 *   GA4_BIGQUERY_SA_KEY       service-account key JSON (raw / base64); falls back to GOOGLE_ADS_SA_KEY
 *   GA4_BIGQUERY_LOCATION     optional dataset location (US, EU, …)
 *   GA4_ANDROID_APP_ID        optional, default com.inov8rlabs.apps.fitcircle
 */
import { ConnectorError, type FetchLike } from '../connectors/types';
import { GOOGLE_TOKEN_URL, googleJwtAssertion, parseServiceAccountKey, type GoogleServiceAccountKey } from '../connectors/google-ads';

export const BIGQUERY_API = 'https://bigquery.googleapis.com/bigquery/v2';
// Query jobs need the bigquery scope; IAM (Data Viewer + Job User) keeps it read-only.
export const BIGQUERY_SCOPE = 'https://www.googleapis.com/auth/bigquery';
export const DEFAULT_ANDROID_APP_ID = 'com.inov8rlabs.apps.fitcircle';

export interface Ga4BigQueryConfig {
  key: GoogleServiceAccountKey;
  projectId: string;
  dataset: string;
  location: string | null;
  androidAppId: string;
}

const PROJECT_RE = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
const DATASET_RE = /^[A-Za-z0-9_]{1,1024}$/;

/** Null when anything required is missing or malformed (the sync then skips). */
export function ga4BigQueryConfigFromEnv(env: NodeJS.ProcessEnv = process.env): Ga4BigQueryConfig | null {
  const projectId = env.GA4_BIGQUERY_PROJECT_ID?.trim() ?? '';
  const dataset = env.GA4_BIGQUERY_DATASET?.trim() ?? '';
  if (!PROJECT_RE.test(projectId) || !DATASET_RE.test(dataset)) return null;
  const key = parseServiceAccountKey(env.GA4_BIGQUERY_SA_KEY) ?? parseServiceAccountKey(env.GOOGLE_ADS_SA_KEY);
  if (!key) return null;
  const appId = env.GA4_ANDROID_APP_ID?.trim();
  return {
    key,
    projectId,
    dataset,
    location: env.GA4_BIGQUERY_LOCATION?.trim() || null,
    androidAppId: appId && /^[A-Za-z0-9._]+$/.test(appId) ? appId : DEFAULT_ANDROID_APP_ID,
  };
}

export type BqParam = { name: string; value: string };
type Json = Record<string, any>;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
export const clearBigQueryTokenCache = () => tokenCache.clear();

/** BigQuery REST row ({f:[{v}]}) → plain object by schema field name (scalar columns only). */
export function decodeRows(schema: Json | undefined, rows: Json[] | undefined): Array<Record<string, string | null>> {
  const fields: string[] = (schema?.fields ?? []).map((f: Json) => String(f.name));
  return (rows ?? []).map((r) => {
    const out: Record<string, string | null> = {};
    fields.forEach((name, i) => {
      const v = r?.f?.[i]?.v;
      out[name] = v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
    return out;
  });
}

export class BigQueryClient {
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: Ga4BigQueryConfig,
    opts: { fetch?: FetchLike } = {}
  ) {
    this.fetchImpl = opts.fetch ?? ((u, i) => fetch(u, i));
  }

  async accessToken(): Promise<string> {
    const k = this.config.key;
    const cached = tokenCache.get(k.client_email);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    let assertion: string;
    try {
      assertion = googleJwtAssertion(k, Math.floor(Date.now() / 1000), BIGQUERY_SCOPE);
    } catch (e: any) {
      throw new ConnectorError(`BigQuery token: could not sign JWT (${e?.message ?? 'bad private_key'})`);
    }
    const res = await this.fetchImpl(k.token_uri || GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new ConnectorError(`BigQuery token: HTTP ${res.status}`, res.status, text.slice(0, 300));
    let json: Json = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* handled below */
    }
    if (!json.access_token) throw new ConnectorError('BigQuery token: no access_token');
    const ttl = Number(json.expires_in) > 0 ? Number(json.expires_in) * 1000 : 3600_000;
    tokenCache.set(k.client_email, { token: json.access_token, expiresAt: Date.now() + ttl });
    return json.access_token;
  }

  private async call(url: string, init: RequestInit): Promise<Json> {
    const res = await this.fetchImpl(url, init);
    const text = await res.text();
    let json: Json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) tokenCache.delete(this.config.key.client_email);
    if (!res.ok) {
      const reason = json?.error?.errors?.[0]?.reason;
      const msg = json?.error?.message ?? text.slice(0, 200);
      throw new ConnectorError(`BigQuery: HTTP ${res.status}${reason ? ` [${reason}]` : ''}${msg ? ` — ${msg}` : ''}`, res.status, text.slice(0, 500));
    }
    return json;
  }

  /** Standard SQL with named STRING parameters. Polls until done; reads every page (capped). */
  async query(sql: string, params: BqParam[] = [], opts: { maxPages?: number; maxPolls?: number } = {}): Promise<Array<Record<string, string | null>>> {
    const token = await this.accessToken();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const base = `${BIGQUERY_API}/projects/${encodeURIComponent(this.config.projectId)}/queries`;
    let json = await this.call(base, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: sql,
        useLegacySql: false,
        parameterMode: 'NAMED',
        queryParameters: params.map((p) => ({ name: p.name, parameterType: { type: 'STRING' }, parameterValue: { value: p.value } })),
        timeoutMs: 30_000,
        maxResults: 10_000,
        ...(this.config.location ? { location: this.config.location } : {}),
      }),
    });
    const jobId = json.jobReference?.jobId;
    const location = json.jobReference?.location ?? this.config.location;
    const more = (pageToken?: string) => {
      const q = new URLSearchParams({ timeoutMs: '30000', maxResults: '10000' });
      if (location) q.set('location', location);
      if (pageToken) q.set('pageToken', pageToken);
      return `${base}/${encodeURIComponent(jobId)}?${q.toString()}`;
    };
    for (let i = 0; !json.jobComplete; i++) {
      if (!jobId || i >= (opts.maxPolls ?? 10)) throw new ConnectorError('BigQuery: query did not finish in time');
      json = await this.call(more(), { method: 'GET', headers });
    }
    const schema = json.schema;
    const out = decodeRows(schema, json.rows);
    for (let page = 0; json.pageToken; page++) {
      if (page >= (opts.maxPages ?? 20)) throw new ConnectorError('BigQuery: too many result pages; narrow the query');
      json = await this.call(more(json.pageToken), { method: 'GET', headers });
      out.push(...decodeRows(schema ?? json.schema, json.rows));
    }
    return out;
  }
}
