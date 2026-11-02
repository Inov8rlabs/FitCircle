#!/usr/bin/env node
// Production smoke check for the FitCircle backend (www.fitcircle.ai).
//
// Calls the real API as a signed-in user, the same way the iOS and Android apps
// do (Authorization: Bearer <mobile access token>), and checks the endpoints
// behind the main mobile screens: HTTP 2xx, `success === true` on envelope
// routes, and the fields the app models require (decode-shape drift crashes or
// blanks screens in the apps).
//
// Run before every App Store / Play Store submission and after every backend deploy.
//
//   npm run smoke:prod                                   # prod, read-only
//   npm run smoke:prod -- --base https://<deploy>.vercel.app
//   npm run smoke:prod -- --json                         # one JSON document on stdout (CI)
//   npm run smoke:prod -- --writes                       # + safe round trips on the smoke account
//   npm run smoke:prod -- --junit out/smoke.xml
//
// Auth (no password is ever read or sent):
//   With SUPABASE_SERVICE_ROLE_KEY + JWT_SECRET available, the script signs in the
//   dedicated smoke account server-side: auth.admin.generateLink({ type: 'magiclink' })
//   (never sends an email), auth.verifyOtp({ type: 'magiclink', token_hash }), then
//   issues the same HS256 mobile access token /api/mobile/auth/login issues (the API
//   rejects raw Supabase tokens). 15-min expiry; the Supabase session is signed out
//   at the end. The smoke account, circle, steps + kcal challenges and a little
//   history are created idempotently if missing (docs/RELEASE_CHECKLIST.md).
//
//   Legacy fallback (always-on Mac runner, which has no service-role key): a
//   SMOKE_ACCESS_TOKEN / QA_ACCESS_TOKEN, or the QA account's cached refresh token
//   (scripts/qa-account). Release gates pass --require-service-role so they never
//   fall back.
//
// Env:
//   SMOKE_BASE_URL            default https://www.fitcircle.ai (or --base)
//   SMOKE_ENV_FILE            env file for Supabase keys if not in the environment
//                             (default <repo>/apps/web/.env.local). Values are never printed.
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY, JWT_SECRET
//   SMOKE_DUMP_DIR            debug: write every authenticated response body to this directory
//   SMOKE_EMAIL               default smoke-test+prod@fitcircle.ai
//   SMOKE_TIMEOUT_MS          per-request timeout (default 20000)
//   SMOKE_MAX_LATENCY_MS      warn (not fail) above this (default 5000)
//   VERCEL_AUTOMATION_BYPASS_SECRET  sent as x-vercel-protection-bypass for protected previews
//
// Flags:
//   --base <url>  --json  --junit <path>  --writes  --require-service-role
//   --skip-public  --setup-only (ensure fixtures and exit)  -h/--help
//
// Exit code: 0 when every check passed (skips allowed), 1 on any failure, 2 on usage/config error.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------- args / env

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (flag('-h') || flag('--help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 48).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

const BASE = (arg('--base') || process.env.SMOKE_BASE_URL || 'https://www.fitcircle.ai').replace(/\/$/, '');
const JSON_OUT = flag('--json');
const JUNIT = arg('--junit') || (process.env.FC_REPORT_DIR ? join(process.env.FC_REPORT_DIR, 'backend-smoke.junit.xml') : undefined);
const WRITES = flag('--writes') || process.env.SMOKE_WRITES === '1';
const REQUIRE_SR = flag('--require-service-role') || process.env.SMOKE_REQUIRE_SERVICE_ROLE === '1';
const SKIP_PUBLIC = flag('--skip-public');
const SETUP_ONLY = flag('--setup-only');
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20000);
const SLOW_MS = Number(process.env.SMOKE_MAX_LATENCY_MS || 5000);
const TZ = 'America/Los_Angeles';
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const DUMP_DIR = process.env.SMOKE_DUMP_DIR; // debug: write every authenticated response body here (contains smoke-account data only)

// Supabase keys: environment first, then the env file (only these keys are read).
const ENV_FILE = process.env.SMOKE_ENV_FILE || join(REPO_ROOT, 'apps', 'web', '.env.local');
const fileEnv = {};
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && /^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY|JWT_SECRET|VERCEL_AUTOMATION_BYPASS_SECRET)$/.test(m[1])) {
      fileEnv[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}
const envv = (k) => process.env[k] || fileEnv[k] || '';
const SUPABASE_URL = (envv('NEXT_PUBLIC_SUPABASE_URL') || envv('SUPABASE_URL')).replace(/\/$/, '');
const SERVICE_KEY = envv('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = envv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const MOBILE_JWT_SECRET = envv('JWT_SECRET'); // the backend's mobile-token signing secret (MobileAPIService)
const BYPASS_SECRET = BYPASS || fileEnv.VERCEL_AUTOMATION_BYPASS_SECRET;

// ---------------------------------------------------------------- smoke fixtures

const SMOKE_EMAIL = (process.env.SMOKE_EMAIL || 'smoke-test+prod@fitcircle.ai').trim().toLowerCase();
const SMOKE_USERNAME = 'fc_smoke_test';
const SMOKE_NAME = 'FitCircle Smoke Test';
const SMOKE_CIRCLE = 'FitCircle Smoke Circle';
const SMOKE_CHALLENGE = 'Smoke Steps Challenge';
const SMOKE_CAL_CHALLENGE = 'Smoke Calorie Challenge';
const SMOKE_CALORIE_TARGET = 2100; // daily kcal goal; plate score must use it as its target
const TEST_MARK = { smoke_test: true, test_account: true, managed_by: 'scripts/smoke/prod-smoke.mjs' };
// Accounts the smoke must never sign in as or write to.
const DEMO_EMAIL = 'fitcircle.user@gmail.com';
const DEMO_USER_ID = '47476150-a984-4431-a89a-7cc8085adfe6';
const DEMO_CIRCLE_ID = 'dc69b1b5-9fb6-4f50-8f5f-0f1776af82be';

if (!SMOKE_EMAIL.endsWith('@fitcircle.ai') || SMOKE_EMAIL === DEMO_EMAIL || !/^smoke/.test(SMOKE_EMAIL)) {
  console.error(`prod-smoke: refusing SMOKE_EMAIL=${SMOKE_EMAIL} (must be smoke*@fitcircle.ai, an internal-domain test account)`);
  process.exit(2);
}

// ---------------------------------------------------------------- output

const results = [];
const notes = [];
const say = (...a) => {
  if (!JSON_OUT) console.log(...a);
};
const note = (msg) => {
  notes.push(msg);
  if (JSON_OUT) console.error(msg);
  else console.log(`  · ${msg}`);
};
class Skip extends Error {}

let currentSuite = 'smoke';
function suite(name, title) {
  currentSuite = name;
  say(`\n${title}`);
}

async function check(name, fn) {
  const t0 = Date.now();
  const s = currentSuite;
  const pad = (x) => String(x).padStart(5);
  try {
    const out = (await fn()) || {};
    const ms = out.ms ?? Date.now() - t0;
    const slow = ms > SLOW_MS;
    results.push({ suite: s, name, status: 'passed', ms, detail: out.detail || '', slow, httpStatus: out.status });
    say(`  PASS ${pad(ms)}ms  ${name}${out.detail ? ` — ${out.detail}` : ''}${slow ? `  [slow > ${SLOW_MS}ms]` : ''}`);
    return out;
  } catch (e) {
    const ms = e.ms ?? Date.now() - t0;
    if (e instanceof Skip) {
      results.push({ suite: s, name, status: 'skipped', ms: 0, detail: e.message });
      say(`  SKIP        ${name} — ${e.message}`);
    } else {
      results.push({ suite: s, name, status: 'failed', ms, detail: e.message, httpStatus: e.status });
      say(`  FAIL ${pad(ms)}ms  ${name} — ${e.message}`);
    }
    return null;
  }
}

function fail(msg, extra = {}) {
  const e = new Error(msg);
  Object.assign(e, extra);
  throw e;
}
const assert = (cond, msg) => {
  if (!cond) fail(msg);
};

// ---------------------------------------------------------------- HTTP

const CLIENT_FEATURES = 'promo@1,icon_keys'; // what current app builds declare
async function http(path, { token, method = 'GET', body, headers = {} } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(path.startsWith('http') ? path : BASE + path, {
      method,
      redirect: 'manual',
      signal: ctl.signal,
      headers: {
        'User-Agent': 'FitCircle-smoke/2.0',
        Accept: 'application/json',
        'x-client-timezone': TZ,
        'X-Client-Features': CLIENT_FEATURES,
        ...(BYPASS_SECRET ? { 'x-vercel-protection-bypass': BYPASS_SECRET } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
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
    return { res, status: res.status, text, json, ms: Date.now() - t0, cc: res.headers.get('cache-control') || '' };
  } catch (e) {
    const msg = e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : e.message;
    fail(`${method} ${path}: ${msg}`, { ms: Date.now() - t0 });
  } finally {
    clearTimeout(timer);
  }
}

const errSummary = (r) => {
  const e = r.json?.error;
  const msg = typeof e === 'string' ? e : e ? `${e.code || ''} ${e.message || ''}`.trim() : r.text?.slice(0, 160);
  return `HTTP ${r.status}${msg ? ` ${msg}` : ''}`;
};

// ---------------------------------------------------------------- shape helpers

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

/**
 * Assert required keys on an object. Spec: { key: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any' | 'string?' ... }
 * A trailing '?' means "may be null/absent but, if present, has this type".
 * 'string|number' style unions are allowed.
 */
function shape(obj, spec, where) {
  assert(isObj(obj), `${where}: expected object, got ${typeOf(obj)}`);
  const problems = [];
  for (const [key, want] of Object.entries(spec)) {
    const optional = want.endsWith('?');
    const types = want.replace(/\?$/, '').split('|');
    const v = obj[key];
    if (v === undefined || v === null) {
      if (!optional) problems.push(`${key} missing${v === null ? ' (null)' : ''}`);
      continue;
    }
    if (!types.includes('any') && !types.includes(typeOf(v))) problems.push(`${key} is ${typeOf(v)}, want ${types.join('|')}`);
  }
  assert(problems.length === 0, `${where}: ${problems.join('; ')}`);
}
function eachShape(arr, spec, where, max = 5) {
  assert(Array.isArray(arr), `${where}: expected array, got ${typeOf(arr)}`);
  arr.slice(0, max).forEach((item, i) => shape(item, spec, `${where}[${i}]`));
  return arr.length;
}

// ---------------------------------------------------------------- Supabase (service role)

let sb = null; // admin client
let sbAnon = null; // for verifyOtp
async function supabaseClients() {
  if (sb) return;
  let createClient;
  try {
    ({ createClient } = await import('@supabase/supabase-js'));
  } catch {
    fail('@supabase/supabase-js is not installed (run npm install in FitCircleBE)');
  }
  const opts = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
  sb = createClient(SUPABASE_URL, SERVICE_KEY, opts);
  sbAnon = createClient(SUPABASE_URL, ANON_KEY || SERVICE_KEY, opts);
}

const todayIn = (tz) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (d, n) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function guardUser(id) {
  if (id === DEMO_USER_ID) fail('refusing: resolved smoke user is the App Review demo account');
}

async function findSmokeUser() {
  const { data: rows, error } = await sb.from('profiles').select('id,email').eq('email', SMOKE_EMAIL).limit(2);
  if (error) fail(`profiles lookup: ${error.message}`);
  if (rows?.length) return rows[0].id;
  for (let page = 1; page <= 50; page++) {
    const { data, error: e } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (e) fail(`auth admin listUsers: ${e.message}`);
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === SMOKE_EMAIL);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

/** Create the smoke user if missing and make sure its profile is an onboarded, marked test profile. */
async function ensureSmokeUser() {
  let uid = await findSmokeUser();
  let created = false;
  if (!uid) {
    const { data, error } = await sb.auth.admin.createUser({
      email: SMOKE_EMAIL,
      email_confirm: true, // no confirmation email; no password is set
      user_metadata: { display_name: SMOKE_NAME, ...TEST_MARK },
      app_metadata: { ...TEST_MARK },
    });
    if (error) fail(`create smoke user: ${error.message}`);
    uid = data.user.id;
    created = true;
    note(`created smoke auth user ${uid} (${SMOKE_EMAIL})`);
  }
  guardUser(uid);

  const { data: prof, error: pErr } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (pErr) fail(`profile read: ${pErr.message}`);
  const want = {
    email: SMOKE_EMAIL,
    username: SMOKE_USERNAME,
    display_name: SMOKE_NAME,
    timezone: TZ,
    onboarding_completed: true,
    has_completed_assessment: true,
    is_active: true,
  };
  const prefs = { ...(prof?.preferences || {}), marketingEmails: false };
  const meta = { ...(prof?.metadata || {}), ...TEST_MARK };
  const patch = {};
  for (const [k, v] of Object.entries(want)) if (prof?.[k] !== v) patch[k] = v;
  if (prof?.preferences?.marketingEmails !== false) patch.preferences = prefs;
  if (!prof?.metadata?.smoke_test || !prof?.metadata?.test_account) patch.metadata = meta;
  if (!prof) {
    const { error } = await sb.from('profiles').insert({
      id: uid, ...want, onboarding_completed_at: new Date().toISOString(), subscription_tier: 'free',
      height_cm: 175, weight_kg: 75, weight_unit_preference: 'kg', fitness_level: 'intermediate', preferences: prefs, metadata: meta,
    });
    if (error) fail(`profile insert: ${error.message}`);
    note('created smoke profile');
  } else if (Object.keys(patch).length) {
    if (patch.onboarding_completed) patch.onboarding_completed_at = new Date().toISOString();
    if (created && prof.height_cm == null) Object.assign(patch, { height_cm: 175, weight_kg: 75, weight_unit_preference: 'kg', fitness_level: 'intermediate' });
    const { error } = await sb.from('profiles').update(patch).eq('id', uid);
    if (error) fail(`profile update: ${error.message}`);
    note(`updated smoke profile fields: ${Object.keys(patch).join(', ')}`);
  }
  return uid;
}

let minted = null; // { access_token, user_id, supabase_access_token }

/**
 * Mobile API token, exactly as MobileAPIService.generateTokens issues it after a
 * successful sign-in: HS256 JWT { userId, email, type: 'access' } signed with the
 * backend's JWT_SECRET. The apps send this as the Bearer token; the API does not
 * accept raw Supabase access tokens. Short-lived (15 min) and access-only (no
 * refresh token is minted).
 */
function signMobileAccessToken(userId, email) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ userId, email, type: 'access', iat: now, exp: now + 15 * 60 });
  const sig = createHmac('sha256', MOBILE_JWT_SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/**
 * Sign in the smoke account without any password:
 *  1. auth.admin.generateLink({ type: 'magiclink' }) — service role, sends no email
 *  2. auth.verifyOtp({ type: 'magiclink', token_hash }) — a real Supabase sign-in
 *     (proves the auth user exists, is confirmed and not banned; yields its id/email)
 *  3. issue the mobile API token for that verified user (what /api/mobile/auth/login
 *     does after its own Supabase sign-in).
 */
async function mintSession() {
  const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email: SMOKE_EMAIL });
  if (error) fail(`generateLink: ${error.message}`);
  const token_hash = data?.properties?.hashed_token;
  if (!token_hash) fail('generateLink returned no hashed_token');
  const { data: v, error: vErr } = await sbAnon.auth.verifyOtp({ type: 'magiclink', token_hash });
  if (vErr) fail(`verifyOtp: ${vErr.message}`);
  if (!v?.session?.access_token || !v.user?.id) fail('verifyOtp returned no session');
  guardUser(v.user.id);
  if ((v.user.email || '').toLowerCase() !== SMOKE_EMAIL) fail(`verifyOtp signed in ${v.user.email}, expected ${SMOKE_EMAIL}`);
  minted = {
    supabase_access_token: v.session.access_token,
    access_token: signMobileAccessToken(v.user.id, SMOKE_EMAIL),
    user_id: v.user.id,
  };
  return minted;
}

async function signOutMinted() {
  if (!minted) return;
  try {
    // Revoke the Supabase session created by verifyOtp (scope=local: only this session).
    await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: ANON_KEY || SERVICE_KEY, Authorization: `Bearer ${minted.supabase_access_token}` },
    });
  } catch {
    /* best effort; the mobile token expires in 15 min on its own */
  }
}

/** Circle (created through the real API so server defaults apply), steps challenge, a little history. */
async function ensureFixtures(uid, token) {
  const today = todayIn(TZ);
  const fx = { userId: uid };

  // Circle
  const { data: circles, error: cErr } = await sb
    .from('fitcircles')
    .select('id,name,creator_id,end_date,visibility')
    .eq('creator_id', uid)
    .eq('name', SMOKE_CIRCLE);
  if (cErr) fail(`fitcircles lookup: ${cErr.message}`);
  let circle = circles?.[0];
  if (circle?.id === DEMO_CIRCLE_ID) fail('refusing: smoke circle resolved to the demo circle');
  if (!circle) {
    const r = await http('/api/mobile/circles', {
      token,
      method: 'POST',
      body: {
        name: SMOKE_CIRCLE,
        description: 'Automated production smoke test circle. Test data — do not join.',
        type: 'custom',
        startDate: addDays(today, -3),
        endDate: addDays(today, 365),
        visibility: 'invite_only',
        allowLateJoin: false,
      },
    });
    if (r.status >= 300) fail(`create smoke circle: ${errSummary(r)}`);
    circle = r.json?.data?.circle || r.json?.data;
    if (!circle?.id) fail('create smoke circle: no id in response');
    if (circle.id === DEMO_CIRCLE_ID) fail('refusing: created circle id equals the demo circle');
    note(`created smoke circle ${circle.id}`);
  } else {
    const end = circle.end_date ? String(circle.end_date).slice(0, 10) : null;
    if (!end || end < addDays(today, 30) || circle.visibility !== 'invite_only') {
      const { error } = await sb
        .from('fitcircles')
        .update({ visibility: 'invite_only', end_date: `${addDays(today, 365)}T23:59:59Z` })
        .eq('id', circle.id)
        .eq('creator_id', uid);
      if (error) fail(`extend smoke circle: ${error.message}`);
      note(`extended smoke circle end_date to ${addDays(today, 365)}`);
    }
  }
  fx.circleId = circle.id;
  // Mark the circle as test data where the schema allows it (metadata jsonb, if present).
  {
    const { data: row, error } = await sb.from('fitcircles').select('metadata').eq('id', fx.circleId).maybeSingle();
    if (!error && row && !row.metadata?.smoke_test) {
      await sb.from('fitcircles').update({ metadata: { ...(row.metadata || {}), ...TEST_MARK } }).eq('id', fx.circleId).eq('creator_id', uid);
    }
  }

  // Steps challenge (active, ends well in the future)
  const { data: chs, error: chErr } = await sb
    .from('challenges')
    .select('id,name,unit,status,ends_at,goal_amount')
    .eq('fitcircle_id', fx.circleId)
    .eq('creator_id', uid)
    .neq('status', 'cancelled');
  if (chErr) fail(`challenges lookup: ${chErr.message}`);
  let ch = (chs || []).find((c) => c.name === SMOKE_CHALLENGE && (c.unit || '').toLowerCase() === 'steps' && c.status === 'active' && new Date(c.ends_at) > new Date(Date.now() + 7 * 864e5));
  if (!ch) {
    const r = await http(`/api/fitcircles/${fx.circleId}/challenges`, {
      token,
      method: 'POST',
      body: {
        name: SMOKE_CHALLENGE,
        description: 'Automated smoke test challenge (test data).',
        category: 'cardio',
        goal_amount: 3000000,
        unit: 'steps',
        is_open: true,
        starts_at: `${addDays(today, -1)}T00:00:00`,
        ends_at: `${addDays(today, 364)}T23:59:59`,
      },
    });
    if (r.status >= 300 || r.json?.success === false) fail(`create smoke steps challenge: ${errSummary(r)}`);
    ch = r.json?.data;
    if (!ch?.id) fail('create smoke steps challenge: no id');
    note(`created smoke steps challenge ${ch.id}`);
  }
  fx.challengeId = ch.id;

  // Calorie challenge: plate score's goal-fit must pick up an active kcal challenge target.
  let cal = (chs || []).find((c) => c.name === SMOKE_CAL_CHALLENGE && c.status === 'active' && new Date(c.ends_at) > new Date(Date.now() + 7 * 864e5));
  if (!cal) {
    const r = await http(`/api/fitcircles/${fx.circleId}/challenges`, {
      token,
      method: 'POST',
      body: {
        name: SMOKE_CAL_CHALLENGE,
        description: 'Automated smoke test challenge (test data).',
        category: 'wellness',
        goal_amount: SMOKE_CALORIE_TARGET,
        unit: 'kcal',
        is_open: true,
        starts_at: `${addDays(today, -1)}T00:00:00`,
        ends_at: `${addDays(today, 364)}T23:59:59`,
      },
    });
    if (r.status >= 300 || r.json?.success === false) fail(`create smoke calorie challenge: ${errSummary(r)}`);
    cal = r.json?.data;
    if (!cal?.id) fail('create smoke calorie challenge: no id');
    note(`created smoke calorie challenge ${cal.id}`);
  }
  fx.calorieChallengeId = cal.id;

  // A little history so lists and leaderboards have rows (written once, never touches other users).
  const { count: trackCount } = await sb.from('daily_tracking').select('id', { count: 'exact', head: true }).eq('user_id', uid);
  if (!trackCount) {
    const rows = [1, 2, 3].map((off) => ({
      user_id: uid, tracking_date: addDays(today, -off), steps: 7000 + off * 900, steps_source: 'manual', weight_kg: 75 - off * 0.1, is_public: false,
    }));
    const { error } = await sb.from('daily_tracking').insert(rows);
    if (error) note(`could not seed daily_tracking: ${error.message}`);
    else note('seeded 3 days of daily_tracking for the smoke user');
  }
  const { count: foodCount } = await sb.from('food_log_entries').select('id', { count: 'exact', head: true }).eq('user_id', uid);
  if (!foodCount) {
    const d = addDays(today, -1);
    const { error } = await sb.from('food_log_entries').insert([
      {
        user_id: uid, entry_type: 'food', logged_at: `${d}T15:30:00Z`, entry_date: d, meal_type: 'lunch', title: 'Smoke test salad',
        nutrition_data: { calories: 450, protein_g: 30, carbs_g: 40, fat_g: 15 }, calories: 450, protein_g: 30, carbs_g: 40, fat_g: 15,
        is_private: true, visibility: 'private', source: 'manual', input_method: 'manual', nutrition_source: 'user', metadata: { ...TEST_MARK },
      },
    ]);
    if (error) note(`could not seed food_log_entries: ${error.message}`);
    else note('seeded 1 food log entry for the smoke user');
  }
  // One chat message so the messages endpoint returns a user-authored row.
  const { count: msgCount } = await sb.from('circle_messages').select('id', { count: 'exact', head: true }).eq('fitcircle_id', fx.circleId).eq('sender_id', uid);
  if (msgCount === 0) {
    const r = await http(`/api/mobile/circles/${fx.circleId}/messages`, {
      token, method: 'POST', body: { kind: 'user_text', body: 'Smoke test circle — automated test data.', clientId: randomUUID() },
    });
    if (r.status >= 300) note(`could not seed chat message: ${errSummary(r)}`);
    else note('seeded 1 chat message in the smoke circle');
  }
  return fx;
}

// ---------------------------------------------------------------- legacy auth (runner without service role)

async function legacyToken() {
  const direct = process.env.SMOKE_ACCESS_TOKEN || process.env.QA_ACCESS_TOKEN;
  if (direct) return { token: direct, how: 'SMOKE_ACCESS_TOKEN' };
  const cacheFile = process.env.FC_QA_TOKEN_CACHE || join(homedir(), 'FitCircleCI', '.qa-token-cache.json');
  try {
    const c = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (c.base !== BASE || !c.refresh_token) return null;
    const r = await http('/api/mobile/auth/refresh', { method: 'POST', body: { refresh_token: c.refresh_token } });
    const s = r.json?.session || r.json?.data?.session || r.json?.data;
    if (r.status === 200 && s?.access_token) {
      if (s.refresh_token) writeFileSync(cacheFile, JSON.stringify({ ...c, refresh_token: s.refresh_token, saved_at: new Date().toISOString() }), { mode: 0o600 });
      return { token: s.access_token, how: 'QA account cached refresh token (legacy)' };
    }
  } catch {
    /* no cache */
  }
  return null;
}

// ---------------------------------------------------------------- checks

const noStore = (cc) => /no-store/.test(cc);

/** GET an authenticated route; envelope routes must have success === true. Returns { data, json }. */
function api(token) {
  return async (path, { envelope = true, allow = [200] } = {}) => {
    const r = await http(path, { token });
    if (DUMP_DIR) {
      mkdirSync(DUMP_DIR, { recursive: true });
      writeFileSync(join(DUMP_DIR, `${path.replace(/[^a-z0-9]+/gi, '_').slice(0, 120)}.json`), r.text);
    }
    if (!allow.includes(r.status)) fail(errSummary(r), { status: r.status, ms: r.ms });
    if (r.json === undefined) fail(`non-JSON body (${r.text.slice(0, 80)})`, { ms: r.ms });
    if (envelope && r.json.success !== true) fail(`success=${r.json.success} ${errSummary(r)}`, { ms: r.ms });
    if (!noStore(r.cc)) fail(`cache-control "${r.cc}" lacks no-store on an authenticated response`, { ms: r.ms });
    return { data: envelope ? r.json.data : r.json, json: r.json, ms: r.ms, status: r.status };
  };
}

async function publicChecks() {
  suite('public', 'Public');
  await check('GET /api/health is healthy (db + auth operational)', async () => {
    const r = await http('/api/health');
    assert(r.status === 200, errSummary(r));
    assert(r.json?.status === 'healthy', `status=${r.json?.status}`);
    assert(r.json?.checks?.database === 'operational', `database=${r.json?.checks?.database}`);
    assert(r.json?.checks?.auth === 'operational', `auth=${r.json?.checks?.auth}`);
    return { ms: r.ms, detail: `env=${r.json?.environment}` };
  });
  await check('GET /.well-known/apple-app-site-association', async () => {
    const r = await http('/.well-known/apple-app-site-association');
    assert(r.status === 200, errSummary(r));
    assert(Array.isArray(r.json?.applinks?.details) && r.json.applinks.details.length, 'no applinks.details');
    return { ms: r.ms };
  });
  await check('GET /.well-known/assetlinks.json', async () => {
    const r = await http('/.well-known/assetlinks.json');
    assert(r.status === 200, errSummary(r));
    assert(Array.isArray(r.json) && r.json.some((s) => s.target?.package_name), 'no package_name');
    return { ms: r.ms };
  });

  suite('auth-boundary', 'Auth boundary (401 JSON + no-store, never 5xx)');
  for (const path of ['/api/mobile/profile', '/api/mobile/circles', '/api/mobile/food-log']) {
    await check(`GET ${path} without a token → 401`, async () => {
      const r = await http(path);
      assert(r.status === 401, `HTTP ${r.status}`);
      assert(r.json !== undefined, 'body is not JSON');
      assert(noStore(r.cc), `cache-control "${r.cc}" lacks no-store`);
      return { ms: r.ms };
    });
  }
}

async function authenticate() {
  suite('auth', 'Auth');
  if (SUPABASE_URL && SERVICE_KEY && MOBILE_JWT_SECRET) {
    let uid;
    const ok = await check(`mint session for ${SMOKE_EMAIL} (generateLink magiclink → verifyOtp → mobile token)`, async () => {
      await supabaseClients();
      uid = await ensureSmokeUser();
      const t0 = Date.now();
      const s = await mintSession();
      assert(s.user_id === uid, `minted session is for ${s.user_id}, expected ${uid}`);
      return { ms: Date.now() - t0, detail: `user ${uid}` };
    });
    if (!ok) return null;
    authMode = 'magic link (service role) + mobile JWT';
    const fx = await check('ensure smoke fixtures (circle, steps challenge, history)', async () => {
      const f = await ensureFixtures(uid, minted.access_token);
      fixtures = f;
      return { detail: `circle ${f.circleId}, steps challenge ${f.challengeId}, calorie challenge ${f.calorieChallengeId}` };
    });
    if (!fx) return null;
    return { token: minted.access_token, fx: fixtures };
  }
  if (REQUIRE_SR) {
    await check('service-role credentials available', async () =>
      fail(`NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET not all found in env or ${ENV_FILE}`));
    return null;
  }
  const legacy = await legacyToken();
  if (!legacy) {
    await check('authenticated checks', async () => {
      throw new Skip(`no SUPABASE_SERVICE_ROLE_KEY (env or ${ENV_FILE}) and no legacy token; use --require-service-role to make this fatal`);
    });
    return null;
  }
  authMode = legacy.how;
  note(`legacy auth: ${legacy.how} — fixture ids are discovered from the account's circles`);
  return { token: legacy.token, fx: null };
}

async function main() {
  if (!JSON_OUT) console.log(`FitCircle prod smoke → ${BASE}${WRITES ? '  (+ writes)' : '  (read-only)'}`);
  if (!SKIP_PUBLIC && !SETUP_ONLY) await publicChecks();
  const auth = await authenticate();
  if (SETUP_ONLY || !auth) return;
  await authedChecks(auth.token, auth.fx);
  if (WRITES) await writeChecks(auth.token, auth.fx);
}

// Required-field specs mirror the iOS Codable models and Android kotlinx DTOs
// (union of both: a field either app requires is required here). Refs are to
// FitCircle-iOS/FitCircle and Fitcircle-Android/.../com/fitcircle/app.
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/; // Android kotlinx Instant
const YMD = /^\d{4}-\d{2}-\d{2}$/; // Android LocalDate
const isoTs = (v, where) => assert(typeof v === 'string' && ISO_TS.test(v), `${where}: "${v}" is not an ISO timestamp with offset (Android Instant)`);
const ymd = (v, where) => assert(typeof v === 'string' && YMD.test(v), `${where}: "${v}" is not YYYY-MM-DD (Android LocalDate)`);
const oneOf = (v, allowed, where) => assert(allowed.includes(v), `${where}: "${v}" not in ${allowed.join('|')} (iOS enum decode throws)`);

const HOME_FEED_QUERY =
  'cards=offline_banner@1,header@1,health_sync_banner@1,campaign@1,hydration@1,referral@1,pro_upsell@1,streak_warning@1,daily_goals@1,fitzy_focus@1,progress@1,vitals@1,body_comp@1,past_date_log@1,native_ad@1,charts@1,promo@1,circle_chat@1' +
  '&actions=open_screen@1,paywall@1,invite@1,start_circle@1,enable_notifications@1,open_url@1,dismiss@1&promoLayouts=hero,banner,compact';

/** Legacy mode (no fixtures): use the account's first circle and its first challenge. */
async function discoverFixtures(get) {
  const fx = { userId: null, circleId: null, challengeId: null };
  try {
    const { data: me } = await get('/api/mobile/profile');
    fx.userId = me?.user?.id ?? null;
    const { data: circles } = await get('/api/mobile/circles');
    fx.circleId = Array.isArray(circles) && circles[0]?.id;
    if (fx.circleId) {
      const { data: chs } = await get(`/api/fitcircles/${fx.circleId}/challenges`);
      fx.challengeId = (chs?.active || [])[0]?.id || null;
    }
  } catch {
    /* individual checks will report */
  }
  return fx;
}

async function authedChecks(token, fxIn) {
  const get = api(token);
  const fx = fxIn || (await discoverFixtures(get));
  const today = todayIn(TZ);
  const C = fx.circleId;
  const CH = fx.challengeId;
  const needCircle = () => {
    if (!C) throw new Skip('no circle for this account');
  };
  const needChallenge = () => {
    needCircle();
    if (!CH) throw new Skip('no active challenge in the circle');
  };
  const run = (name, path, verify, opts) =>
    check(`GET ${name}`, async () => {
      const p = typeof path === 'function' ? path() : path;
      const r = await get(p, opts);
      const detail = verify ? await verify(r.data, r.json) : undefined;
      return { ms: r.ms, status: r.status, detail };
    });

  // ------------------------------------------------------------ profile / home
  suite('profile', 'Profile & home');
  await run('/api/mobile/profile', '/api/mobile/profile', (d) => {
    // iOS ProfileResponseWrapper reads data.user (only id strict); Android User.kt needs id, username, display_name, email.
    shape(d, { user: 'object' }, 'data');
    shape(d.user, { id: 'string', username: 'string', display_name: 'string', email: 'string', onboarding_completed: 'boolean' }, 'data.user');
    if (fx.userId) assert(d.user.id === fx.userId, `data.user.id ${d.user.id} is not the smoke user`);
    assert(d.user.onboarding_completed === true, 'smoke profile is not onboarding_completed');
    return d.user.username;
  });
  await run('/api/mobile/profile/streak (circle streaks with names)', '/api/mobile/profile/streak', (d) => {
    shape(d, { personal_streak: 'number', circle_streaks: 'array', total_active_circles: 'number' }, 'data');
    eachShape(d.circle_streaks, { circle_id: 'string', circle_name: 'string', streak_days: 'number' }, 'circle_streaks');
    if (C && fxIn) {
      // The smoke user is an active member of the smoke circle: it must be listed, by name.
      const mine = d.circle_streaks.find((c) => c.circle_id === C);
      assert(mine, `smoke circle ${C} missing from circle_streaks (got ${d.circle_streaks.length}; total_active_circles=${d.total_active_circles})`);
      assert(mine.circle_name === SMOKE_CIRCLE, `circle_name "${mine.circle_name}", expected "${SMOKE_CIRCLE}"`);
    }
    return `${d.circle_streaks.length} circle streak(s)`;
  });
  await check('GET /api/mobile/home-feed (schema 1, renderable cards)', async () => {
    const r = await http(`/api/mobile/home-feed?${HOME_FEED_QUERY}`, { token, headers: { 'X-Feed-Schema': '1' } });
    if (r.status !== 200) fail(errSummary(r), { ms: r.ms });
    assert(noStore(r.cc), `cache-control "${r.cc}" lacks no-store`);
    const layout = r.json?.data ?? r.json; // both apps accept { data } or a bare layout
    shape(layout, { schema: 'number', cards: 'array' }, 'layout');
    assert(layout.schema === 1, `schema ${layout.schema}, apps support 1`);
    assert(layout.cards.length > 0, 'no cards (apps need at least one renderable card)');
    eachShape(layout.cards, { id: 'string', type: 'string' }, 'cards', 50);
    const bad = layout.cards.filter((c) => (c.version ?? 1) > 1);
    assert(!bad.length, `cards with version > 1: ${bad.map((c) => c.type).join(', ')}`);
    return { ms: r.ms, detail: layout.cards.map((c) => c.type).join(',') };
  });
  await run('/api/mobile/app-update (policy)', '/api/mobile/app-update?platform=ios&version=1.1.0&build=75', (d) => {
    if (d == null) return 'no policy';
    shape(d, { status: 'string' }, 'data');
    return `status=${d.status} latest=${d.latest_version ?? '-'}`;
  });
  await run('/api/mobile/entitlements (subscription status)', '/api/mobile/entitlements', (d) => {
    shape(d, { tier: 'string', features: 'object' }, 'data');
    for (const [k, v] of Object.entries(d.features)) shape(v, { allowed: 'boolean', requiredTier: 'string' }, `features.${k}`);
    return `tier=${d.tier}, ${Object.keys(d.features).length} features`;
  });
  await run('/api/mobile/notifications/preferences', '/api/mobile/notifications/preferences', (d) =>
    shape(d, { journey_enabled: 'boolean', momentum_enabled: 'boolean', circle_enabled: 'boolean', challenge_enabled: 'boolean', social_enabled: 'boolean', celebration_enabled: 'boolean' }, 'data'),
  );
  await run('/api/mobile/campaigns', '/api/mobile/campaigns', (d) => {
    if (d == null) return 'none';
    shape(d, { campaigns: 'array' }, 'data');
    eachShape(d.campaigns, { slug: 'string', template: 'string', phase: 'string', startsAt: 'string', endsAt: 'string' }, 'campaigns');
    return `${d.campaigns.length} campaign(s)`;
  });
  await run('/api/mobile/fitzy/today', '/api/mobile/fitzy/today', (d) => {
    shape(d, { headline: 'string' }, 'data');
    return d.kind;
  });

  // ------------------------------------------------------------ daily goals / tracking
  suite('goals', 'Daily goals, tracking, vitals, streaks');
  const goalSpec = { id: 'string', user_id: 'string', goal_type: 'string', frequency: 'string', start_date: 'string', is_active: 'boolean', is_primary: 'boolean', auto_adjust_enabled: 'boolean', created_at: 'string', updated_at: 'string' };
  const checkGoal = (g, w) => {
    shape(g, goalSpec, w);
    oneOf(g.goal_type, ['steps', 'weight_log', 'workout', 'custom'], `${w}.goal_type`);
    oneOf(g.frequency, ['daily', 'weekdays', 'weekends', 'custom'], `${w}.frequency`);
    ymd(g.start_date, `${w}.start_date`);
    isoTs(g.created_at, `${w}.created_at`);
  };
  await run('/api/mobile/daily-goals', '/api/mobile/daily-goals', (d) => {
    assert(Array.isArray(d), `data is ${typeOf(d)}, want array`);
    d.slice(0, 5).forEach((g, i) => checkGoal(g, `[${i}]`));
    return `${d.length} goal(s)`;
  });
  await run('/api/mobile/daily-goals/progress', `/api/mobile/daily-goals/progress?date=${today}`, (d) => {
    // iOS DailyGoalSummary has no CodingKeys: camelCase on the wire.
    shape(d, { date: 'string', goals: 'array', overallProgress: 'number', completedCount: 'number', totalCount: 'number', allCompleted: 'boolean', streak: 'number' }, 'data');
    d.goals.slice(0, 5).forEach((g, i) => {
      shape(g, { goal: 'object', completion_percentage: 'number', is_completed: 'boolean' }, `goals[${i}]`);
      checkGoal(g.goal, `goals[${i}].goal`);
    });
    return `${d.completedCount}/${d.totalCount}`;
  });
  await run('/api/mobile/daily-goals/streak', '/api/mobile/daily-goals/streak', (d) => {
    // iOS DailyGoal.swift StreakInfo. (Android StreakInfo wants a different key set — see report.)
    shape(d, { current_streak: 'number', longest_streak: 'number', next_milestone: 'number', days_until_next_milestone: 'number' }, 'data');
    const androidMissing = ['best_streak', 'total_completions', 'seven_day_completion_rate', 'thirty_day_completion_rate'].filter((k) => d[k] == null);
    if (androidMissing.length) note(`daily-goals/streak lacks Android StreakInfo fields (${androidMissing.join(', ')}); Android ignores the failure`);
    return `current=${d.current_streak}`;
  });
  await run('/api/mobile/daily-goals/recommendations (from active circles)', '/api/mobile/daily-goals/recommendations', (d) => {
    shape(d, { recommendations: 'array' }, 'data');
    // Android's list is not lossy: every item must decode.
    d.recommendations.forEach((r, i) => {
      shape(r, { goal_type: 'string', target_value: 'number', unit: 'string', reason: 'string' }, `recommendations[${i}]`);
      oneOf(r.goal_type, ['steps', 'weight_log', 'workout', 'custom'], `recommendations[${i}].goal_type`);
    });
    if (C && fxIn) {
      // The smoke user is in an active circle, so recommendations must be circle-based, not the generic fallback.
      const fromCircle = d.recommendations.filter((r) => r.challenge_name === SMOKE_CIRCLE);
      assert(fromCircle.length > 0, `no recommendation from the active smoke circle (got generic: ${d.recommendations.map((r) => r.goal_type).join(',')})`);
    }
    return `${d.recommendations.length} recommendation(s)`;
  });
  await run('/api/mobile/tracking/daily', `/api/mobile/tracking/daily?startDate=${addDays(today, -7)}&endDate=${today}`, (d, json) => {
    // Android TrackingApiResponse decodes the top level and requires success (checked by api()).
    assert(Array.isArray(d), `data is ${typeOf(d)}, want array`);
    d.slice(0, 5).forEach((t, i) => {
      shape(t, { id: 'string', user_id: 'string', tracking_date: 'string', is_public: 'boolean', created_at: 'string', updated_at: 'string' }, `[${i}]`);
      ymd(t.tracking_date, `[${i}].tracking_date`);
      isoTs(t.created_at, `[${i}].created_at`);
    });
    if (fxIn) assert(d.length > 0, 'no tracking rows in the last 7 days for the smoke user (seeded history missing?)');
    return `${d.length} day(s)`;
  });
  await run('/api/mobile/tracking/missing-days', '/api/mobile/tracking/missing-days', (d) => {
    shape(d, { missing_dates: 'array' }, 'data');
    return `${d.missing_dates.length} missing`;
  });
  await run('/api/mobile/vitals/summary', '/api/mobile/vitals/summary?days=7', (d) => {
    shape(d, { period: 'object', units: 'string', bmi: 'object', water: 'object', weight: 'object?' }, 'data');
    shape(d.period, { days: 'number', start: 'string', end: 'string', timezone: 'string' }, 'period');
    shape(d.bmi, { scale: 'object' }, 'bmi');
    shape(d.bmi.scale, { min: 'number', max: 'number', bands: 'array' }, 'bmi.scale');
    eachShape(d.bmi.scale.bands, { key: 'string', label: 'string', from: 'number', to: 'number' }, 'bmi.scale.bands');
    shape(d.water, { goal_ml: 'number', goal_source: 'string', days: 'array', total_ml: 'number', total_goal_ml: 'number', pct: 'number', days_met: 'number', today_ml: 'number' }, 'water');
    eachShape(d.water.days, { date: 'string', ml: 'number', goal_met: 'boolean' }, 'water.days');
    if (d.weight) {
      shape(d.weight, { current_kg: 'number', current_date: 'string', series: 'array' }, 'weight');
      eachShape(d.weight.series, { date: 'string', kg: 'number' }, 'weight.series');
    }
    return `${d.period.start}..${d.period.end}`;
  });
  await run('/api/mobile/streaks/status', '/api/mobile/streaks/status', (d) => {
    // iOS StreakCheckIn: no CodingKeys, camelCase.
    shape(d, { currentStreak: 'number', longestStreak: 'number', freezesAvailable: 'number', hasCheckedInToday: 'boolean', canCheckInAgain: 'boolean' }, 'data');
    return `current=${d.currentStreak}`;
  });
  await run('/api/mobile/streaks/engagement', '/api/mobile/streaks/engagement', (d) => {
    shape(d, { current_streak: 'number', longest_streak: 'number', freezes_available: 'number', paused: 'boolean' }, 'data');
    if (d.last_engagement_date) ymd(d.last_engagement_date, 'last_engagement_date');
    if (d.pause_end_date) ymd(d.pause_end_date, 'pause_end_date');
    return `current=${d.current_streak}`;
  });

  // ------------------------------------------------------------ circles
  suite('circles', 'Circles & challenges');
  const circleSpec = { id: 'string', creator_id: 'string', name: 'string', status: 'string', start_date: 'string', end_date: 'string', participant_count: 'number' };
  const checkCircle = (c, w) => {
    shape(c, circleSpec, w);
    oneOf(c.status, ['draft', 'upcoming', 'active', 'completed', 'cancelled'], `${w}.status`);
    if (c.type != null) oneOf(c.type, ['weight_loss', 'step_count', 'workout_frequency', 'custom'], `${w}.type`);
    if (c.visibility != null) oneOf(c.visibility, ['public', 'private', 'invite_only'], `${w}.visibility`);
    isoTs(c.start_date, `${w}.start_date`);
    isoTs(c.end_date, `${w}.end_date`);
  };
  await run('/api/mobile/circles', '/api/mobile/circles', (d) => {
    assert(Array.isArray(d), `data is ${typeOf(d)}, want array`);
    d.slice(0, 10).forEach((c, i) => checkCircle(c, `[${i}]`));
    if (C) assert(d.some((c) => c.id === C), `smoke circle ${C} not in list (${d.length})`);
    return `${d.length} circle(s)`;
  });
  await run('/api/mobile/circles/{id}', () => (needCircle(), `/api/mobile/circles/${C}`), (d) => {
    checkCircle(d, 'data');
    return d.name;
  });
  await run('/api/mobile/circles/{id}/leaderboard', () => (needCircle(), `/api/mobile/circles/${C}/leaderboard`), (d) => {
    const n = eachShape(d, { user_id: 'string', display_name: 'string', rank: 'number' }, 'data');
    assert(n > 0, 'empty leaderboard (smoke user is a member)');
    return `${n} row(s)`;
  });
  await run('/api/mobile/circles/{id}/steps-leaderboard', () => (needCircle(), `/api/mobile/circles/${C.toLowerCase()}/steps-leaderboard`), (d) => {
    assert(isObj(d), `data is ${typeOf(d)}, want object`);
    const n = eachShape(d.members ?? [], { user_id: 'string' }, 'members', 50);
    if (fxIn) assert(d.challenge?.id === CH, `steps leaderboard challenge ${d.challenge?.id}, expected smoke steps challenge ${CH}`);
    return `${n} member(s), metric=${d.default_metric}`;
  });
  await run('/api/mobile/circles/{id}/members (Android)', () => (needCircle(), `/api/mobile/circles/${C}/members`), (d) => {
    shape(d, { members: 'array', total_count: 'number' }, 'data');
    eachShape(d.members, { user_id: 'string', display_name: 'string', joined_at: 'string' }, 'members');
    d.members.slice(0, 5).forEach((m, i) => isoTs(m.joined_at, `members[${i}].joined_at`));
    return `${d.total_count} member(s)`;
  });
  await run('/api/mobile/circles/{id} with uppercase id (iOS path casing)', () => (needCircle(), `/api/mobile/circles/${C.toUpperCase()}`), (d) => {
    assert(String(d?.id).toLowerCase() === C.toLowerCase(), 'wrong circle');
  });

  const challengeSpec = { id: 'string', fitcircle_id: 'string', creator_id: 'string', name: 'string', category: 'string', goal_amount: 'number', unit: 'string', is_open: 'boolean', status: 'string', starts_at: 'string', ends_at: 'string', participant_count: 'number' };
  const checkChallenge = (c, w) => {
    shape(c, challengeSpec, w);
    oneOf(c.category, ['strength', 'cardio', 'flexibility', 'wellness', 'custom'], `${w}.category`);
    oneOf(c.status, ['scheduled', 'active', 'completed', 'cancelled'], `${w}.status`);
    isoTs(c.starts_at, `${w}.starts_at`);
    isoTs(c.ends_at, `${w}.ends_at`);
    if (c.my_participation) {
      shape(c.my_participation, { id: 'string', challenge_id: 'string', user_id: 'string', fitcircle_id: 'string', status: 'string', cumulative_total: 'number', today_total: 'number', current_streak: 'number', longest_streak: 'number', log_count: 'number', goal_completion_pct: 'number' }, `${w}.my_participation`);
      oneOf(c.my_participation.status, ['invited', 'active', 'withdrawn'], `${w}.my_participation.status`);
    }
  };
  await run('/api/fitcircles/{id}/challenges', () => (needCircle(), `/api/fitcircles/${C}/challenges`), (d) => {
    shape(d, { active: 'array', scheduled: 'array', completed: 'array' }, 'data');
    [...d.active, ...d.scheduled, ...d.completed].slice(0, 10).forEach((c, i) => checkChallenge(c, `challenge[${i}]`));
    if (CH) assert(d.active.some((c) => c.id === CH), `smoke challenge ${CH} not active`);
    return `${d.active.length} active, ${d.scheduled.length} scheduled, ${d.completed.length} completed`;
  });
  await run('/api/fitcircles/{id}/challenges/{challengeId}', () => (needChallenge(), `/api/fitcircles/${C}/challenges/${CH}`), (d) => {
    checkChallenge(d, 'data');
    return `${d.name} (${d.unit})`;
  });
  await run('/api/fitcircles/{id}/challenges/{challengeId}/leaderboard (broke 2026-11-02)', () => (needChallenge(), `/api/fitcircles/${C}/challenges/${CH}/leaderboard`), (d) => {
    const n = eachShape(d, { rank: 'number', user_id: 'string', display_name: 'string', cumulative_total: 'number', today_total: 'number', current_streak: 'number', goal_completion_pct: 'number', is_current_user: 'boolean' }, 'data');
    assert(n > 0, 'empty leaderboard (smoke user participates)');
    if (fxIn) assert(d.some((e) => e.is_current_user && e.display_name === SMOKE_NAME), 'smoke user row with its display_name missing');
    return `${n} row(s)`;
  });

  // ------------------------------------------------------------ chat
  suite('chat', 'Chat');
  await run('/api/mobile/chats (inbox)', '/api/mobile/chats', (d) => {
    shape(d, { chats: 'array', total_unread: 'number', muted_unread: 'number' }, 'data');
    eachShape(d.chats, { circle_id: 'string' }, 'chats');
    if (C) assert(d.chats.some((c) => c.circle_id === C), 'smoke circle missing from inbox');
    return `${d.chats.length} chat(s), ${d.total_unread} unread`;
  });
  const checkMessages = (d) => {
    // iOS ChatMessagePage / ChatMessage: camelCase, and the list is NOT lossy (one bad message fails the page).
    shape(d, { messages: 'array', hasMore: 'boolean' }, 'data');
    d.messages.forEach((m, i) => {
      shape(m, { id: 'string', circleId: 'string', kind: 'string', createdAt: 'string', reactions: 'array', sender: 'object?', system: 'object?' }, `messages[${i}]`);
      isoTs(m.createdAt, `messages[${i}].createdAt`);
      if (m.sender) shape(m.sender, { id: 'string', name: 'string' }, `messages[${i}].sender`);
      if (m.system) shape(m.system, { eventType: 'string' }, `messages[${i}].system`);
      m.reactions.forEach((r, j) => shape(r, { reaction: 'string', count: 'number', reactedByMe: 'boolean' }, `messages[${i}].reactions[${j}]`));
    });
    return d.messages;
  };
  await run('/api/mobile/circles/{id}/messages', () => (needCircle(), `/api/mobile/circles/${C}/messages?limit=50`), (d) => {
    const msgs = checkMessages(d);
    if (fxIn) assert(msgs.length > 0, 'no messages in the smoke circle (seed message missing?)');
    return `${msgs.length} message(s), hasMore=${d.hasMore}`;
  });

  // ------------------------------------------------------------ food / nutrition
  suite('food', 'Food log & nutrition');
  await run('/api/mobile/food-log', '/api/mobile/food-log?page=1&limit=100&entry_type=all', (d, json) => {
    // iOS FoodLogListResponse decodes the top level: success, data, pagination{page,limit,total,hasMore}.
    shape(json, { data: 'array', pagination: 'object' }, 'body');
    shape(json.pagination, { page: 'number', limit: 'number', total: 'number', hasMore: 'boolean' }, 'pagination');
    d.slice(0, 10).forEach((e, i) => {
      shape(e, { id: 'string', user_id: 'string', entry_type: 'string', is_private: 'boolean', logged_at: 'string', created_at: 'string' }, `[${i}]`);
      oneOf(e.entry_type, ['food', 'snack', 'water', 'supplement'], `[${i}].entry_type`);
      if (e.meal_type != null) oneOf(e.meal_type, ['breakfast', 'lunch', 'dinner', 'snack', 'other'], `[${i}].meal_type`);
      isoTs(e.logged_at, `[${i}].logged_at`);
      isoTs(e.created_at, `[${i}].created_at`);
    });
    return `${d.length} entr${d.length === 1 ? 'y' : 'ies'} (total ${json.pagination.total})`;
  });
  await run('/api/mobile/food-log/stats (nutrition summary, Android)', `/api/mobile/food-log/stats?start_date=${addDays(today, -7)}&end_date=${today}`, (d) => {
    assert(isObj(d), `data is ${typeOf(d)}, want object`);
    return Object.keys(d).slice(0, 6).join(',');
  });
  await run('/api/mobile/plate-score (uses the calorie challenge target)', `/api/mobile/plate-score?date=${addDays(today, -1)}`, (d) => {
    shape(d, { score: 'number', date: 'string' }, 'data');
    assert(Number.isInteger(d.score), `score ${d.score} is not an integer (iOS Int)`);
    if (fxIn && fx.calorieChallengeId) {
      const basis = d.breakdown?.basis;
      assert(basis?.usedChallengeTarget === true, `calorie challenge target not used (targetSource=${basis?.targetSource}, calorieTarget=${d.calorieTarget})`);
      assert(d.calorieTarget === SMOKE_CALORIE_TARGET, `calorieTarget ${d.calorieTarget}, expected the smoke calorie challenge's ${SMOKE_CALORIE_TARGET}`);
    }
    return `score=${d.score} target=${d.calorieTarget}`;
  });
  await run('/api/mobile/targets', '/api/mobile/targets', (d) => shape(d, { calories: 'number' }, 'data'));
}

async function writeChecks(token, fxIn) {
  suite('writes', 'Writes (--writes: smoke account + smoke circle only)');
  const get = api(token);
  const C = fxIn?.circleId;
  if (!C || !fxIn) {
    await check('chat message round trip', async () => {
      throw new Skip('writes run only with the service-role smoke fixtures');
    });
    return;
  }
  let msgId;
  const clientId = randomUUID();
  await check('POST /api/mobile/circles/{id}/messages (user_text)', async () => {
    const r = await http(`/api/mobile/circles/${C}/messages`, {
      token, method: 'POST', body: { kind: 'user_text', body: `smoke write check ${new Date().toISOString()}`, clientId },
    });
    if (r.status !== 201 && r.status !== 200) fail(errSummary(r), { ms: r.ms });
    assert(r.json?.success === true, `success=${r.json?.success}`);
    msgId = r.json?.data?.id;
    assert(msgId, 'no message id');
    return { ms: r.ms, detail: msgId };
  });
  await check('GET messages shows the new message', async () => {
    if (!msgId) throw new Skip('post failed');
    const r = await get(`/api/mobile/circles/${C}/messages?limit=20`);
    assert(r.data.messages.some((m) => m.id === msgId), 'posted message not returned');
    return { ms: r.ms };
  });
  await check('DELETE /api/mobile/messages/{id}', async () => {
    if (!msgId) throw new Skip('post failed');
    const r = await http(`/api/mobile/messages/${msgId}`, { token, method: 'DELETE' });
    if (r.status !== 200) fail(errSummary(r), { ms: r.ms });
    assert(r.json?.success === true, `success=${r.json?.success}`);
    return { ms: r.ms };
  });
  await check('GET messages shows it deleted', async () => {
    if (!msgId) throw new Skip('post failed');
    const r = await get(`/api/mobile/circles/${C}/messages?limit=20`);
    const m = r.data.messages.find((x) => x.id === msgId);
    assert(!m || m.deletedAt, 'message still present and not marked deleted');
    return { ms: r.ms, detail: m ? 'tombstoned' : 'removed' };
  });
}



// ---------------------------------------------------------------- reporting

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
          const inner = r.status === 'failed' ? `<failure message="${xmlEscape(r.detail)}"/>` : r.status === 'skipped' ? `<skipped message="${xmlEscape(r.detail)}"/>` : '';
          return `    <testcase classname="backend-smoke.${s}" name="${xmlEscape(r.name)}" time="${(r.ms / 1000).toFixed(3)}">${inner}</testcase>`;
        })
        .join('\n');
      return `  <testsuite name="backend-smoke.${s}" tests="${rs.length}" failures="${rs.filter((r) => r.status === 'failed').length}" skipped="${rs.filter((r) => r.status === 'skipped').length}">\n${cases}\n  </testsuite>`;
    })
    .join('\n');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="backend-smoke">\n${body}\n</testsuites>\n`);
}

let authMode = 'none';
let fixtures = null;
const started = Date.now();

main()
  .catch((e) => {
    results.push({ suite: 'runner', name: 'smoke runner', status: 'failed', ms: 0, detail: e.message });
    say(`  FAIL        smoke runner — ${e.message}`);
  })
  .finally(async () => {
    await signOutMinted();
    const passed = results.filter((r) => r.status === 'passed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    if (JUNIT) writeJUnit(JUNIT);
    if (JSON_OUT) {
      process.stdout.write(
        JSON.stringify(
          {
            base: BASE, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, auth: authMode, writes: WRITES,
            fixtures: fixtures && { userId: fixtures.userId, circleId: fixtures.circleId, challengeId: fixtures.challengeId, calorieChallengeId: fixtures.calorieChallengeId },
            summary: { passed, failed, skipped, total: results.length }, ok: failed === 0, notes, results,
          },
          null,
          2,
        ) + '\n',
      );
    } else {
      if (JUNIT) console.log(`\nJUnit: ${JUNIT}`);
      const failures = results.filter((r) => r.status === 'failed');
      if (failures.length) {
        console.log('\nFailures:');
        for (const f of failures) console.log(`  - [${f.suite}] ${f.name}: ${f.detail}`);
      }
      console.log(`\nSUMMARY suite=smoke result=${failed ? 'FAILED' : 'OK'} base=${BASE} auth=${authMode} passed=${passed} failed=${failed} skipped=${skipped} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    }
    process.exit(failed ? 1 : 0);
  });
