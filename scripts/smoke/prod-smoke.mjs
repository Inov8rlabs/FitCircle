#!/usr/bin/env node
// Post-deploy smoke test for the FitCircle web backend (www.fitcircle.ai).
//
//   node scripts/smoke/prod-smoke.mjs                          # unauthenticated checks only
//   QA_EMAIL=… QA_PASSWORD=… node scripts/smoke/prod-smoke.mjs  # + read-only QA-account flow
//   node scripts/smoke/prod-smoke.mjs --base https://<preview>.vercel.app --junit out/smoke.xml
//
// Env:
//   SMOKE_BASE_URL   default https://www.fitcircle.ai (or --base)
//   FC_REPORT_DIR    if set, JUnit XML is written to $FC_REPORT_DIR/backend-smoke.junit.xml (or --junit <path>)
//   QA_EMAIL / QA_PASSWORD   the QA automation account (scripts/qa-account); signs in through
//                    /api/mobile/auth/login exactly like the apps
//   QA_ACCESS_TOKEN  alternative to email/password: a mobile access token
//   FC_QA_ENV_FILE   default ~/FitCircleCI/secrets.env — read for QA_* if they are not in the env
//   SMOKE_REQUIRE_AUTH=1  fail (instead of skip) when no QA credentials are available
//   SMOKE_BAD_LOGIN=1     also probe a wrong-password login (costs one of the 5 logins / 15 min / IP)
//   FC_QA_TOKEN_CACHE     default ~/FitCircleCI/.qa-token-cache.json (chmod 600)
//
// /api/mobile/auth/login allows only 5 attempts per 15 minutes per IP, and the
// Maestro flows on this Mac share that budget. Smoke therefore caches the QA
// refresh token and renews through /api/mobile/auth/refresh (not rate-limited),
// falling back to a password login only when the cache is missing or rejected.
//
// Every authenticated call is a read (GET); smoke never writes user data.
// Never prints tokens or passwords. Node 18+ (global fetch), no dependencies.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const BASE = (arg('--base') || process.env.SMOKE_BASE_URL || 'https://www.fitcircle.ai').replace(/\/$/, '');
const JUNIT =
  arg('--junit') || (process.env.FC_REPORT_DIR ? join(process.env.FC_REPORT_DIR, 'backend-smoke.junit.xml') : undefined);
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20000);
const TZ = 'America/Los_Angeles';

// QA credentials: env first, then the local secrets file.
const secretsFile = process.env.FC_QA_ENV_FILE || join(homedir(), 'FitCircleCI', 'secrets.env');
const fileEnv = {};
if (existsSync(secretsFile)) {
  for (const line of readFileSync(secretsFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) fileEnv[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const QA_EMAIL = process.env.QA_EMAIL || fileEnv.QA_EMAIL;
const QA_PASSWORD = process.env.QA_PASSWORD || fileEnv.QA_PASSWORD;
const QA_ACCESS_TOKEN = process.env.QA_ACCESS_TOKEN;
const REQUIRE_AUTH = process.env.SMOKE_REQUIRE_AUTH === '1';
const DEMO_EMAIL = 'fitcircle.user@gmail.com';
const BAD_LOGIN = process.env.SMOKE_BAD_LOGIN === '1';
const TOKEN_CACHE = process.env.FC_QA_TOKEN_CACHE || join(homedir(), 'FitCircleCI', '.qa-token-cache.json');

function readCache() {
  try {
    const c = JSON.parse(readFileSync(TOKEN_CACHE, 'utf8'));
    return c.base === BASE && c.email === QA_EMAIL ? c : null;
  } catch {
    return null;
  }
}
function writeCache(refreshToken) {
  try {
    mkdirSync(dirname(TOKEN_CACHE), { recursive: true });
    writeFileSync(TOKEN_CACHE, JSON.stringify({ base: BASE, email: QA_EMAIL, refresh_token: refreshToken, saved_at: new Date().toISOString() }), { mode: 0o600 });
    chmodSync(TOKEN_CACHE, 0o600);
  } catch {
    /* cache is an optimisation only */
  }
}

const results = [];

class Skip extends Error {}

async function check(suite, name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ suite, name, status: 'passed', ms: Date.now() - t0, detail });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''} (${Date.now() - t0} ms)`);
  } catch (e) {
    if (e instanceof Skip) {
      results.push({ suite, name, status: 'skipped', ms: 0, detail: e.message });
      console.log(`  - ${name} (skipped: ${e.message})`);
    } else {
      results.push({ suite, name, status: 'failed', ms: Date.now() - t0, detail: e.message });
      console.log(`  ✗ ${name} — ${e.message}`);
    }
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function get(path, { token, method = 'GET', body, redirect = 'manual' } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      method,
      redirect,
      signal: ctl.signal,
      headers: {
        'User-Agent': 'FitCircle-smoke/1.0',
        'x-client-timezone': TZ,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { res, status: res.status, text, json, cc: res.headers.get('cache-control') || '' };
  } finally {
    clearTimeout(timer);
  }
}

const noStore = (cc) => /no-store/.test(cc);

async function main() {
  console.log(`FitCircle smoke → ${BASE}`);

  console.log('\nPublic');
  await check('public', 'GET /api/health is healthy (db + auth operational)', async () => {
    const r = await get('/api/health');
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json?.status === 'healthy', `status=${r.json?.status}`);
    assert(r.json?.checks?.database === 'operational', `database=${r.json?.checks?.database}`);
    assert(r.json?.checks?.auth === 'operational', `auth=${r.json?.checks?.auth}`);
    assert(noStore(r.cc), `cache-control "${r.cc}" lacks no-store`);
    return `env=${r.json?.environment}`;
  });
  for (const page of ['/', '/privacy', '/terms']) {
    await check('public', `GET ${page} renders`, async () => {
      const r = await get(page);
      assert(r.status === 200, `status ${r.status}`);
      assert(/<html/i.test(r.text), 'not HTML');
      return `${r.text.length} bytes`;
    });
  }
  await check('public', 'Apple universal links: apple-app-site-association', async () => {
    const r = await get('/.well-known/apple-app-site-association');
    assert(r.status === 200, `status ${r.status}`);
    const details = r.json?.applinks?.details;
    assert(Array.isArray(details) && details.length > 0, 'no applinks.details');
    const ids = details.flatMap((d) => d.appIDs || (d.appID ? [d.appID] : []));
    assert(ids.length > 0, 'no appIDs');
    return ids.join(', ');
  });
  await check('public', 'Android app links: assetlinks.json', async () => {
    const r = await get('/.well-known/assetlinks.json');
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json) && r.json.length > 0, 'empty assetlinks');
    const pkgs = r.json.map((s) => s.target?.package_name).filter(Boolean);
    assert(pkgs.length > 0, 'no package_name');
    return [...new Set(pkgs)].join(', ');
  });

  console.log('\nAuth boundary (must be 401 JSON + no-store, never 5xx)');
  for (const path of ['/api/mobile/profile', '/api/mobile/vitals/summary', '/api/mobile/circles', '/api/mobile/food-log', '/api/mobile/entitlements']) {
    await check('auth-boundary', `GET ${path} without a token → 401`, async () => {
      const r = await get(path);
      assert(r.status === 401, `status ${r.status}`);
      assert(r.json !== undefined, 'body is not JSON');
      assert(noStore(r.cc), `cache-control "${r.cc}" lacks no-store`);
    });
  }
  await check('auth-boundary', 'POST /api/mobile/auth/login with a bad password → 401 INVALID_CREDENTIALS', async () => {
    if (!BAD_LOGIN) throw new Skip('opt-in via SMOKE_BAD_LOGIN=1 (login is rate-limited to 5 / 15 min / IP)');
    const r = await get('/api/mobile/auth/login', {
      method: 'POST',
      body: { email: 'smoke.nobody@fitcircle.ai', password: 'definitely-wrong-password' },
    });
    if (r.status === 429) throw new Skip('rate limited');
    assert(r.status === 401, `status ${r.status}`);
    assert(r.json?.error?.code === 'INVALID_CREDENTIALS', `code=${r.json?.error?.code}`);
  });

  console.log('\nQA account (read-only)');
  let token = QA_ACCESS_TOKEN;
  const haveCreds = Boolean(token || (QA_EMAIL && QA_PASSWORD));
  const needCreds = () => {
    if (!haveCreds) {
      if (REQUIRE_AUTH) throw new Error('no QA credentials (QA_EMAIL/QA_PASSWORD or QA_ACCESS_TOKEN)');
      throw new Skip('no QA credentials in env or secrets file');
    }
  };
  let userId;
  await check('qa', 'sign in as the QA account (POST /api/mobile/auth/login)', async () => {
    needCreds();
    if (QA_EMAIL && QA_EMAIL.toLowerCase() === DEMO_EMAIL) throw new Error('refusing: QA_EMAIL is the App Review demo account');
    if (token) return 'using QA_ACCESS_TOKEN';
    const cached = readCache();
    if (cached?.refresh_token) {
      const rr = await get('/api/mobile/auth/refresh', { method: 'POST', body: { refresh_token: cached.refresh_token } });
      const session = rr.json?.session;
      if (rr.status === 200 && session?.access_token) {
        token = session.access_token;
        if (session.refresh_token) writeCache(session.refresh_token);
        return 'renewed via /api/mobile/auth/refresh (cached refresh token)';
      }
    }
    const r = await get('/api/mobile/auth/login', { method: 'POST', body: { email: QA_EMAIL, password: QA_PASSWORD } });
    const retry = r.res.headers.get('retry-after');
    assert(r.status === 200, `status ${r.status} ${r.json?.error?.code || ''}${retry ? ` (retry after ${retry}s)` : ''}`);
    token = r.json?.data?.access_token;
    assert(token, 'no access_token');
    userId = r.json?.data?.user?.id;
    if (r.json?.data?.refresh_token) writeCache(r.json.data.refresh_token);
    return `password login, user ${userId}`;
  });
  const authed = async (name, path, verify) =>
    check('qa', name, async () => {
      needCreds();
      if (!token) throw new Skip('sign-in failed');
      const r = await get(path, { token });
      assert(r.status === 200, `status ${r.status}`);
      assert(noStore(r.cc), `cache-control "${r.cc}" lacks no-store`);
      assert(r.json?.success !== false, `success=false ${r.json?.error?.code || ''}`);
      return verify ? verify(r.json?.data) : undefined;
    });
  await authed('GET /api/mobile/profile returns the QA user, onboarded', '/api/mobile/profile', (d) => {
    const u = d?.user ?? d;
    assert(u?.email?.toLowerCase() === (QA_EMAIL || u?.email)?.toLowerCase(), 'email mismatch');
    if (userId) assert(u.id === userId, 'id mismatch');
    assert((u.onboarding_completed ?? u.onboardingCompleted) === true, 'onboarding not completed');
    return u.username;
  });
  await authed('GET /api/mobile/vitals/summary', '/api/mobile/vitals/summary', (d) => {
    assert(d?.period?.days > 0, 'no period');
    return `${d.period.start}..${d.period.end}`;
  });
  await authed('GET /api/mobile/circles lists the QA circle', '/api/mobile/circles', (d) => {
    const list = Array.isArray(d) ? d : d?.circles || [];
    assert(list.some((c) => c.name === 'QA Automation Circle'), `QA circle missing (${list.length} circles)`);
    return `${list.length} circle(s)`;
  });
  await authed('GET /api/mobile/food-log', '/api/mobile/food-log', (d) => `${(Array.isArray(d) ? d : d?.entries || []).length} entries`);
  await authed('GET /api/mobile/entitlements is free tier', '/api/mobile/entitlements', (d) => {
    assert(d?.tier, 'no tier');
    return `tier=${d.tier}`;
  });
  await authed('GET /api/mobile/campaigns', '/api/mobile/campaigns', (d) => `${(d?.campaigns || []).length} campaign(s)`);
}

function xmlEscape(s) {
  return String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);
}

function writeJUnit(path) {
  const suites = [...new Set(results.map((r) => r.suite))];
  const body = suites
    .map((s) => {
      const rs = results.filter((r) => r.suite === s);
      const cases = rs
        .map((r) => {
          const inner =
            r.status === 'failed'
              ? `<failure message="${xmlEscape(r.detail)}"/>`
              : r.status === 'skipped'
                ? `<skipped message="${xmlEscape(r.detail)}"/>`
                : '';
          return `    <testcase classname="backend-smoke.${s}" name="${xmlEscape(r.name)}" time="${(r.ms / 1000).toFixed(3)}">${inner}</testcase>`;
        })
        .join('\n');
      return `  <testsuite name="backend-smoke.${s}" tests="${rs.length}" failures="${rs.filter((r) => r.status === 'failed').length}" skipped="${rs.filter((r) => r.status === 'skipped').length}">\n${cases}\n  </testsuite>`;
    })
    .join('\n');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="backend-smoke">\n${body}\n</testsuites>\n`);
}

main()
  .catch((e) => results.push({ suite: 'runner', name: 'smoke runner', status: 'failed', ms: 0, detail: e.message }))
  .finally(() => {
    const passed = results.filter((r) => r.status === 'passed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    if (JUNIT) {
      writeJUnit(JUNIT);
      console.log(`\nJUnit: ${JUNIT}`);
    }
    console.log(`\nSUMMARY suite=smoke passed=${passed} failed=${failed} skipped=${skipped}`);
    process.exit(failed ? 1 : 0);
  });
