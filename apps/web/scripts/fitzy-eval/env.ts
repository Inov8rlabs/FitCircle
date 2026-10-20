/**
 * Gateway credentials for the live eval. Never prints a secret value.
 *
 * Order: existing process env → --env=<file> → apps/web/.env.local (same loader as
 * scripts/run-nutrition-eval.mjs; `vercel env pull` placeholders like "[Sensitive]" are skipped).
 * Then: AI_GATEWAY_API_KEY if non-empty, else VERCEL_OIDC_TOKEN. An expired/missing OIDC token is
 * refreshed through @vercel/oidc (the same refresh the AI SDK gateway provider does in dev),
 * which needs a `vercel login` CLI session and apps/web/.vercel/project.json (`vercel link`).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const WEB_DIR = path.resolve(__dirname, '../..');

function loadEnvFile(abs: string) {
  if (!existsSync(abs)) return;
  for (const line of readFileSync(abs, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k] != null && process.env[k] !== '') continue;
    const value = raw.replace(/^(['"])(.*)\1$/, '$2');
    if (/^\[.*\]$/.test(value)) continue;
    process.env[k] = value;
  }
}

function tokenExpiresInMs(token: string): number | null {
  try {
    const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp;
    return typeof exp === 'number' ? exp * 1000 - Date.now() : null;
  } catch {
    return null;
  }
}

export const HOW_TO_AUTH = [
  'No usable AI Gateway credentials. Any one of:',
  '  1. export AI_GATEWAY_API_KEY=…            (Vercel dashboard → AI Gateway → API keys)',
  '  2. cd apps/web && vercel env pull .env.local  (refreshes VERCEL_OIDC_TOKEN, valid ~12 h)',
  '  3. vercel login && (cd apps/web && vercel link)  — the eval then refreshes the OIDC token itself',
].join('\n');

/** Returns a short description of the auth method (never the value), or throws with instructions. */
export async function ensureGatewayAuth(envFile?: string): Promise<string> {
  if (envFile) loadEnvFile(path.resolve(envFile));
  loadEnvFile(path.join(WEB_DIR, '.env.local'));

  if ((process.env.AI_GATEWAY_API_KEY ?? '').trim().length > 10) return 'AI_GATEWAY_API_KEY';
  delete process.env.AI_GATEWAY_API_KEY; // an empty value must not shadow OIDC

  const token = process.env.VERCEL_OIDC_TOKEN ?? '';
  const left = token ? tokenExpiresInMs(token) : null;
  if (left != null && left > 15 * 60_000) return `VERCEL_OIDC_TOKEN (expires in ${Math.round(left / 60_000)} min)`;

  // Missing/expired: refresh like the gateway provider does (CLI session + linked project).
  const projectFile = path.join(WEB_DIR, '.vercel', 'project.json');
  const linked = existsSync(projectFile) ? JSON.parse(readFileSync(projectFile, 'utf8')) : null;
  const project = process.env.VERCEL_PROJECT_ID || linked?.projectId;
  const team = process.env.VERCEL_ORG_ID || linked?.orgId;
  try {
    delete process.env.VERCEL_OIDC_TOKEN;
    const { getVercelOidcToken } = await import('@vercel/oidc');
    await getVercelOidcToken(project ? ({ project, team } as any) : undefined);
    const fresh = process.env.VERCEL_OIDC_TOKEN ?? '';
    const ttl = tokenExpiresInMs(fresh);
    if (!fresh || ttl == null || ttl <= 0) throw new Error('refresh returned no valid token');
    return `VERCEL_OIDC_TOKEN (refreshed via Vercel CLI session, expires in ${Math.round(ttl / 60_000)} min)`;
  } catch (err) {
    throw new Error(`${HOW_TO_AUTH}\n(OIDC refresh failed: ${(err as Error)?.message?.split('\n')[0] ?? err})`);
  }
}
