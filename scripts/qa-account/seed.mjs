#!/usr/bin/env node
// Seed (or remove) the dedicated QA automation account used by Maestro, the
// post-deploy smoke test and the launchd runner.
//
// It is NOT the App Review demo account (scripts/demo-account/) and refuses to
// touch that account or its circle.
//
//   node scripts/qa-account/seed.mjs                 # dry run: prints the plan, writes nothing
//   node scripts/qa-account/seed.mjs --apply         # create/refresh the account, circle and baseline data
//   node scripts/qa-account/seed.mjs --apply --rotate-password
//   node scripts/qa-account/seed.mjs --delete --apply  # remove the QA account, its circle and its rows
//
// Env (never printed):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required
//   FITCIRCLE_API_BASE      default https://www.fitcircle.ai (used to create the circle through the real API)
//   QA_EMAIL                default qa.automation@fitcircle.ai
//   FC_QA_ENV_FILE          default ~/FitCircleCI/secrets.env (QA_EMAIL / QA_PASSWORD are read from and written to it)
//
// No dependencies: plain fetch against GoTrue admin + PostgREST.

import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DEMO_EMAIL = 'fitcircle.user@gmail.com';
const DEMO_USER_ID = '47476150-a984-4431-a89a-7cc8085adfe6';
const DEMO_CIRCLE_ID = 'dc69b1b5-9fb6-4f50-8f5f-0f1776af82be';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const DELETE = args.has('--delete');
const ROTATE = args.has('--rotate-password');
if (args.has('--help') || args.has('-h')) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 20).join('\n'));
  process.exit(0);
}

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const API_BASE = (process.env.FITCIRCLE_API_BASE || 'https://www.fitcircle.ai').replace(/\/$/, '');
const SECRETS_FILE = process.env.FC_QA_ENV_FILE || join(homedir(), 'FitCircleCI', 'secrets.env');
const QA_EMAIL = (process.env.QA_EMAIL || 'qa.automation@fitcircle.ai').trim().toLowerCase();
const QA_USERNAME = 'qa_automation';
const QA_NAME = 'QA Automation';
const CIRCLE_NAME = 'QA Automation Circle';
const TZ = 'America/Los_Angeles';
const HISTORY_DAYS = 3; // complete days before today; today stays empty for the smoke flows

function die(msg) {
  console.error(`qa-account: ${msg}`);
  process.exit(1);
}

if (!SUPABASE_URL || !SERVICE_KEY) die('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
if (QA_EMAIL === DEMO_EMAIL) die('refusing: QA_EMAIL is the App Review demo account');
if (!/^qa[.+_-]/.test(QA_EMAIL)) die(`refusing: QA_EMAIL must start with "qa." (got ${QA_EMAIL})`);

const log = (...a) => console.log(...a);
const plan = [];
const step = (msg) => {
  plan.push(msg);
  log(`${APPLY ? '•' : '[dry-run]'} ${msg}`);
};

// ---------------------------------------------------------------- HTTP helpers

async function http(method, url, { body, headers = {}, okStatuses } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  const ok = okStatuses ? okStatuses.includes(res.status) : res.ok;
  if (!ok) {
    const detail = typeof json === 'string' ? json.slice(0, 300) : JSON.stringify(json).slice(0, 300);
    throw new Error(`${method} ${url.replace(SUPABASE_URL, '<supabase>')} -> ${res.status} ${detail}`);
  }
  return json;
}

const adminHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const rest = (method, path, opts = {}) =>
  http(method, `${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { ...adminHeaders, Prefer: 'return=representation', ...(opts.headers || {}) },
  });
const gotrue = (method, path, opts = {}) =>
  http(method, `${SUPABASE_URL}/auth/v1/${path}`, { ...opts, headers: { ...adminHeaders, ...(opts.headers || {}) } });

// ---------------------------------------------------------------- secrets file

function readSecrets() {
  const out = {};
  if (!existsSync(SECRETS_FILE)) return out;
  for (const line of readFileSync(SECRETS_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function writeSecrets(updates) {
  const current = readSecrets();
  const merged = { ...current, ...updates };
  mkdirSync(dirname(SECRETS_FILE), { recursive: true });
  const body =
    '# FitCircle CI secrets — local only, never commit. Written by scripts/qa-account/seed.mjs\n' +
    Object.entries(merged)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') +
    '\n';
  writeFileSync(SECRETS_FILE, body, { mode: 0o600 });
  chmodSync(SECRETS_FILE, 0o600);
}

// ---------------------------------------------------------------- time helpers

function todayIn(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** ISO instant for a wall-clock time in `tz` on `dateStr`. */
function zoned(dateStr, hhmm, tz = TZ) {
  const guess = new Date(`${dateStr}T${hhmm}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(guess).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess.getTime() - (asUtc - guess.getTime())).toISOString();
}

// ---------------------------------------------------------------- lookups

async function findUser() {
  const profiles = await rest('GET', `profiles?select=id,email,username,onboarding_completed&email=eq.${encodeURIComponent(QA_EMAIL)}`);
  if (profiles.length) return { id: profiles[0].id, profile: profiles[0] };
  // Profile missing: page through auth users (small project; bounded).
  for (let page = 1; page <= 50; page++) {
    const res = await gotrue('GET', `admin/users?page=${page}&per_page=200`);
    const users = res.users || [];
    const hit = users.find((u) => (u.email || '').toLowerCase() === QA_EMAIL);
    if (hit) return { id: hit.id, profile: null };
    if (users.length < 200) break;
  }
  return null;
}

function guardId(id) {
  if (id === DEMO_USER_ID) die('refusing: resolved user is the App Review demo account');
}

const ACTIVITY_TABLES = [
  'engagement_activities',
  'streak_claims',
  'plate_scores',
  'exercise_logs',
  'daily_tracking',
  'food_log_entries',
];

async function clearActivity(uid) {
  guardId(uid);
  for (const t of ACTIVITY_TABLES) {
    step(`delete ${t} rows where user_id = QA user`);
    if (APPLY) {
      try {
        await rest('DELETE', `${t}?user_id=eq.${uid}`, { headers: { Prefer: 'return=minimal' } });
      } catch (e) {
        if (/42P01|does not exist|PGRST205/.test(String(e.message))) log(`  (table ${t} not present — skipped)`);
        else throw e;
      }
    }
  }
}

async function findCircle(uid) {
  const rows = await rest('GET', `fitcircles?select=id,name,invite_code,visibility,end_date,creator_id&creator_id=eq.${uid}&name=eq.${encodeURIComponent(CIRCLE_NAME)}`);
  for (const r of rows) if (r.id === DEMO_CIRCLE_ID) die('refusing: QA circle resolved to the demo circle');
  return rows[0] || null;
}

async function mobileLogin(password) {
  const res = await http('POST', `${API_BASE}/api/mobile/auth/login`, { body: { email: QA_EMAIL, password } });
  const token = res?.data?.access_token;
  if (!token) throw new Error('mobile login returned no access_token');
  return { token, user: res.data.user };
}

// ---------------------------------------------------------------- delete

async function runDelete() {
  const found = await findUser();
  if (!found) {
    log('QA account not found — nothing to delete');
    return;
  }
  guardId(found.id);
  const circle = await findCircle(found.id);
  if (circle) {
    step(`delete circle ${circle.id} (${CIRCLE_NAME}) and its memberships`);
    if (APPLY) {
      await rest('DELETE', `fitcircle_members?fitcircle_id=eq.${circle.id}`, { headers: { Prefer: 'return=minimal' } });
      await rest('DELETE', `fitcircles?id=eq.${circle.id}&creator_id=eq.${found.id}`, { headers: { Prefer: 'return=minimal' } });
    }
  }
  await clearActivity(found.id);
  step(`delete auth user ${found.id} (${QA_EMAIL}); profile rows cascade`);
  if (APPLY) {
    await gotrue('DELETE', `admin/users/${found.id}`);
    await rest('DELETE', `profiles?id=eq.${found.id}`, { headers: { Prefer: 'return=minimal' } }).catch(() => {});
  }
  log(APPLY ? 'QA account deleted.' : 'Dry run only. Re-run with --apply to delete.');
}

// ---------------------------------------------------------------- seed

async function runSeed() {
  const secrets = readSecrets();
  let password = !ROTATE && secrets.QA_EMAIL === QA_EMAIL ? secrets.QA_PASSWORD : undefined;
  const newPassword = !password;
  if (!password) password = `Qa-${randomBytes(18).toString('base64url')}-9`;

  // 1. Auth user.
  let found = await findUser();
  let uid = found?.id;
  if (uid) guardId(uid);
  if (!uid) {
    step(`create auth user ${QA_EMAIL} (email_confirm: true — no email is sent)`);
    if (APPLY) {
      const created = await gotrue('POST', 'admin/users', {
        body: { email: QA_EMAIL, password, email_confirm: true, user_metadata: { display_name: QA_NAME, qa_automation: true } },
      });
      uid = created.id || created.user?.id;
      guardId(uid);
    }
  } else if (newPassword) {
    step(`set a new password on existing auth user ${uid}`);
    if (APPLY) await gotrue('PUT', `admin/users/${uid}`, { body: { password, email_confirm: true } });
  } else {
    step(`auth user exists (${uid}); keeping the password in ${SECRETS_FILE}`);
  }

  if (APPLY && newPassword) {
    writeSecrets({ QA_EMAIL, QA_PASSWORD: password });
    log(`  wrote QA_EMAIL/QA_PASSWORD to ${SECRETS_FILE} (chmod 600)`);
  }

  // 2. Profile: a returning, onboarded, free-tier user.
  const today = todayIn(TZ);
  const profile = {
    email: QA_EMAIL,
    username: QA_USERNAME,
    display_name: QA_NAME,
    timezone: TZ,
    onboarding_completed: true,
    onboarding_completed_at: new Date().toISOString(),
    has_completed_assessment: true,
    subscription_tier: 'free',
    height_cm: 175,
    weight_kg: 75,
    weight_unit_preference: 'kg',
    fitness_level: 'intermediate',
    current_streak: 0,
    longest_streak: 0,
    is_active: true,
    metadata: { qa_automation: true, seeded_by: 'scripts/qa-account/seed.mjs' },
  };
  step(`upsert profile: onboarding_completed=true, free tier, timezone ${TZ}, username ${QA_USERNAME}`);
  if (APPLY) {
    const existing = await rest('GET', `profiles?select=id&id=eq.${uid}`);
    if (existing.length) await rest('PATCH', `profiles?id=eq.${uid}`, { body: profile });
    else await rest('POST', 'profiles', { body: { id: uid, ...profile } });
  }

  // 3. Activity baseline: HISTORY_DAYS complete days before today, nothing today or later.
  if (uid) await clearActivity(uid);
  else step('(new user) no activity rows to clear');

  const meals = [
    ['breakfast', '07:45', 'Greek yogurt with berries and granola', 380, 22, 48, 10],
    ['lunch', '12:30', 'Grilled chicken salad with quinoa', 540, 42, 45, 18],
    ['dinner', '19:00', 'Salmon, roasted vegetables and brown rice', 620, 38, 55, 24],
  ];
  const foodRows = [];
  const trackingRows = [];
  for (let off = HISTORY_DAYS; off >= 1; off--) {
    const dd = addDays(today, -off);
    for (const [meal, at, title, kcal, p, c, f] of meals) {
      foodRows.push({
        user_id: uid, entry_type: 'food', logged_at: zoned(dd, at), entry_date: dd, meal_type: meal, title,
        nutrition_data: { calories: kcal, protein_g: p, carbs_g: c, fat_g: f },
        calories: kcal, protein_g: p, carbs_g: c, fat_g: f,
        is_private: true, visibility: 'private', source: 'manual', input_method: 'manual', nutrition_source: 'user',
        metadata: { qa_seed: true },
      });
    }
    for (const at of ['09:00', '14:00']) {
      foodRows.push({
        user_id: uid, entry_type: 'water', logged_at: zoned(dd, at), entry_date: dd, water_ml: 500,
        nutrition_data: {}, is_private: true, visibility: 'private', source: 'manual', metadata: { qa_seed: true },
      });
    }
    trackingRows.push({ user_id: uid, tracking_date: dd, steps: 8000 + off * 500, steps_source: 'manual', weight_kg: 75 + off * 0.1, is_public: false });
  }
  step(`insert ${foodRows.length} food_log_entries (meals + water) and ${trackingRows.length} daily_tracking rows for ${addDays(today, -HISTORY_DAYS)}..${addDays(today, -1)} (${TZ}); today is left empty`);
  if (APPLY) {
    // PostgREST bulk inserts need identical keys per batch: meals and water separately.
    for (const type of ['food', 'water']) {
      const batch = foodRows.filter((r) => r.entry_type === type);
      await rest('POST', 'food_log_entries', { body: batch, headers: { Prefer: 'return=minimal' } });
    }
    await rest('POST', 'daily_tracking', { body: trackingRows, headers: { Prefer: 'return=minimal' } });
  }

  step('reset engagement_streaks summary to zero (no claims seeded)');
  if (APPLY) {
    await rest('PATCH', `engagement_streaks?user_id=eq.${uid}`, {
      body: { current_streak: 0, longest_streak: 0, total_claims: 0, last_claim_date: null, last_engagement_date: null, paused: false, pause_start_date: null, pause_end_date: null },
      headers: { Prefer: 'return=minimal' },
    });
  }

  // 4. Private QA circle, created through the real API so every server-side default applies.
  let circle = uid ? await findCircle(uid) : null;
  const endDate = addDays(today, 365);
  if (!circle) {
    step(`create invite_only circle "${CIRCLE_NAME}" via POST ${API_BASE}/api/mobile/circles as the QA user`);
    if (APPLY) {
      const { token } = await mobileLogin(password);
      const res = await http('POST', `${API_BASE}/api/mobile/circles`, {
        headers: { Authorization: `Bearer ${token}`, 'x-client-timezone': TZ },
        body: {
          name: CIRCLE_NAME,
          description: 'Automation-only circle for the QA account. Do not join.',
          type: 'custom',
          startDate: addDays(today, -HISTORY_DAYS),
          endDate,
          visibility: 'invite_only',
          allowLateJoin: false,
        },
        okStatuses: [200, 201],
      });
      circle = res?.data?.circle || res?.data;
      if (circle?.id === DEMO_CIRCLE_ID) die('refusing: created circle id equals demo circle');
    }
  } else {
    step(`circle exists (${circle.id}); keep it invite_only and running until ${endDate}`);
    if (APPLY) {
      await rest('PATCH', `fitcircles?id=eq.${circle.id}&creator_id=eq.${uid}`, {
        body: { visibility: 'invite_only', end_date: `${endDate}T23:59:59Z` },
        headers: { Prefer: 'return=minimal' },
      });
    }
  }

  // 5. Verify through the production API exactly as the apps do.
  if (APPLY) {
    const { token, user } = await mobileLogin(password);
    const prof = await http('GET', `${API_BASE}/api/mobile/profile`, { headers: { Authorization: `Bearer ${token}` } });
    const me = prof?.data?.user ?? prof?.data ?? {};
    if (me.id !== uid) die(`verification failed: /api/mobile/profile returned ${me.id}`);
    const onboarded = me.onboarding_completed ?? me.onboardingCompleted;
    if (onboarded !== true) die('verification failed: profile is not onboarding_completed');
    const summary = {
      api: API_BASE,
      user_id: uid,
      email: QA_EMAIL,
      username: user?.username,
      onboarding_completed: onboarded,
      subscription_tier: me.subscription_tier ?? me.subscriptionTier ?? me.subscription?.tier,
      circle_id: circle?.id,
      circle_invite_code: circle?.invite_code ?? circle?.inviteCode,
      history: `${addDays(today, -HISTORY_DAYS)}..${addDays(today, -1)}`,
      secrets_file: SECRETS_FILE,
    };
    log('\nQA account ready:');
    log(JSON.stringify(summary, null, 2));
  } else {
    log('\nDry run only — nothing was written. Re-run with --apply.');
  }
}

(DELETE ? runDelete() : runSeed()).catch((e) => die(e.message));
