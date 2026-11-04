#!/usr/bin/env node
/**
 * One-time AdMob API consent → refresh token → Vercel env (docs/ADS_METRICS_METHODOLOGY.md §9.4).
 *
 * The AdMob API does not accept service accounts, so the Ads Console holds a
 * refresh token for a Google account that can see the AdMob publisher account,
 * with the read-only scope admob.readonly. This script runs the OAuth
 * "installed app" loopback flow on this Mac, then:
 *   1. checks access with accounts.list and a 7-day read-only network report,
 *   2. pipes the client id, client secret and refresh token straight into
 *      `vercel env add … production --sensitive` (stdin; never printed).
 *
 * Usage (from the repo root, logged in to Vercel and linked to fit-circle-web):
 *   node scripts/admob-oauth.mjs --client ~/Downloads/client_secret_XXXX.json [--no-vercel] [--env production]
 *
 * --client   the OAuth client JSON downloaded from Google Cloud (type "Desktop app")
 * --no-vercel  only test access; store nothing
 *
 * Nothing secret is written to disk or stdout. Delete the client JSON afterwards.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/admob.readonly';
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const clientPath = arg('--client');
const vercelEnv = arg('--env') ?? 'production';
const storeInVercel = !args.includes('--no-vercel');
if (!clientPath) {
  console.error('Usage: node scripts/admob-oauth.mjs --client <client_secret.json> [--no-vercel] [--env production]');
  process.exit(2);
}

const raw = JSON.parse(readFileSync(clientPath.replace(/^~/, process.env.HOME ?? '~'), 'utf8'));
const client = raw.installed ?? raw.web;
if (!client?.client_id || !client?.client_secret) {
  console.error('That file is not an OAuth client JSON (expected an "installed" Desktop app client).');
  process.exit(2);
}

const b64url = (b) => b.toString('base64url');
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash('sha256').update(verifier).digest());
const state = b64url(randomBytes(16));

const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const redirectUri = `http://127.0.0.1:${server.address().port}`;

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.search = new URLSearchParams({
  client_id: client.client_id,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state,
}).toString();

console.log('\nOpen this URL, sign in with the Google account that owns the AdMob account, and allow "View your AdMob data":\n');
console.log(authUrl.toString());
console.log('\nWaiting for Google to redirect back to this Mac…');
spawn('open', [authUrl.toString()], { stdio: 'ignore', detached: true }).on('error', () => {});

const code = await new Promise((resolve, reject) => {
  server.on('request', (req, res) => {
    const u = new URL(req.url ?? '/', redirectUri);
    const err = u.searchParams.get('error');
    const got = u.searchParams.get('code');
    res.writeHead(200, { 'content-type': 'text/plain' });
    if (err || !got || u.searchParams.get('state') !== state) {
      res.end('AdMob consent failed. You can close this tab.');
      reject(new Error(err ?? 'missing code / state mismatch'));
    } else {
      res.end('AdMob consent received. You can close this tab and return to the terminal.');
      resolve(got);
    }
    server.close();
  });
});

const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: client.client_id, client_secret: client.client_secret, redirect_uri: redirectUri, code_verifier: verifier }),
});
const token = await tokenRes.json();
if (!tokenRes.ok || !token.refresh_token) {
  console.error(`Token exchange failed (HTTP ${tokenRes.status}${token.error ? `, ${token.error}` : ''}). If no refresh token came back, remove the app's access at myaccount.google.com/permissions and run again.`);
  process.exit(1);
}

// Read-only access check: accounts + a 7-day network report.
const auth = { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' };
const accountsRes = await fetch('https://admob.googleapis.com/v1/accounts', { headers: auth });
const accounts = await accountsRes.json();
if (!accountsRes.ok) {
  console.error(`accounts.list failed: HTTP ${accountsRes.status} ${accounts?.error?.status ?? ''} ${accounts?.error?.message ?? ''}`);
  console.error('Most likely the AdMob API is not enabled in the OAuth client\'s Cloud project (APIs & Services → Library → AdMob API → Enable).');
  process.exit(1);
}
const pubs = (accounts.account ?? []).map((a) => a.publisherId);
console.log(`\nAdMob publisher account(s) visible: ${pubs.join(', ') || '(none)'}`);
const pub = pubs[0];
if (pub) {
  const day = (offset) => {
    const d = new Date(Date.now() - offset * 86_400_000);
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d).map((x) => [x.type, x.value]));
    return { year: +p.year, month: +p.month, day: +p.day };
  };
  const reportRes = await fetch(`https://admob.googleapis.com/v1/accounts/${pub}/networkReport:generate`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ reportSpec: { dateRange: { startDate: day(6), endDate: day(0) }, dimensions: ['PLATFORM'], metrics: ['ESTIMATED_EARNINGS', 'AD_REQUESTS', 'MATCHED_REQUESTS', 'IMPRESSIONS', 'CLICKS'], localizationSettings: { currencyCode: 'USD' }, timeZone: 'America/Los_Angeles' } }),
  });
  const report = await reportRes.json();
  if (!reportRes.ok) console.error(`networkReport failed: HTTP ${reportRes.status}`);
  else {
    console.log('Last 7 days (Pacific), estimated:');
    for (const item of report) {
      if (!item.row) continue;
      const d = item.row.dimensionValues;
      const m = item.row.metricValues;
      const usd = (Number(m.ESTIMATED_EARNINGS?.microsValue ?? 0) / 1e6).toFixed(4);
      console.log(`  ${d.PLATFORM?.value ?? '?'}: $${usd} · ${m.IMPRESSIONS?.integerValue ?? 0} impressions · ${m.AD_REQUESTS?.integerValue ?? 0} requests · ${m.MATCHED_REQUESTS?.integerValue ?? 0} matched · ${m.CLICKS?.integerValue ?? 0} clicks`);
    }
  }
}

if (!storeInVercel) {
  console.log('\n--no-vercel: nothing stored.');
  process.exit(0);
}

const addEnv = (name, value) =>
  new Promise((resolve, reject) => {
    const p = spawn('vercel', ['env', 'add', name, vercelEnv, '--sensitive', '--force'], { stdio: ['pipe', 'ignore', 'inherit'] });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`vercel env add ${name} exited ${c}`))));
    p.stdin.end(value);
  });

await addEnv('ADMOB_OAUTH_CLIENT_ID', client.client_id);
await addEnv('ADMOB_OAUTH_CLIENT_SECRET', client.client_secret);
await addEnv('ADMOB_OAUTH_REFRESH_TOKEN', token.refresh_token);
if (pub) await addEnv('ADMOB_PUBLISHER_ID', pub);
console.log(`\nStored ADMOB_OAUTH_CLIENT_ID, ADMOB_OAUTH_CLIENT_SECRET, ADMOB_OAUTH_REFRESH_TOKEN${pub ? ', ADMOB_PUBLISHER_ID' : ''} in Vercel (${vercelEnv}, sensitive). Redeploy to pick them up. Delete ${clientPath} now.`);
