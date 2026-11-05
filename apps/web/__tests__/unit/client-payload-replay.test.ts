/**
 * Shipped-client payload replay.
 *
 * Every JSON file under __tests__/fixtures/client-payloads/{ios,android}/ is a request
 * body EXACTLY as a shipped app encodes it (derived from the client source or captured
 * from the client test suites). Each one is replayed through the REAL route handler
 * (auth and Supabase faked, everything else real) and must be accepted AND understood:
 * the fields that matter must land where the fixture says.
 *
 * Why: iOS sent the tracking day as "date", the server read "trackingDate", zod stripped
 * the unknown key, and every past-day iOS entry was saved as today for 10 months.
 * Server tests only sent `trackingDate`; iOS tests only checked a date was encoded.
 * These fixtures are the contract between the two.
 *
 * ── Fixture format (`<endpoint-slug>.<case>.json`) ────────────────────────────────
 * {
 *   "method": "POST",                          // required
 *   "path": "/api/mobile/tracking/daily",      // required; real ids, e.g. /api/mobile/beverages/<uuid>
 *   "body": { ... },                           // exactly what the client sends (omit for no body)
 *   "description": "...",                      // optional: client file:line / build it came from
 *   "now": "2026-11-05T17:00:00Z",             // optional clock (default below)
 *   "headers": { "x-client-timezone": "America/Los_Angeles" },   // optional, merged over defaults
 *   "seed": { "<table>": [ { ...row } ] },     // optional rows; the user's profile is always seeded
 *   "expect": {
 *     "status": 200,                           // optional number or [numbers]; default: any 2xx
 *     "parsed":   { ... },                     // subset of what the route's guarded parse produced
 *     "stored":   { "<table>": { ... } | [ { ... } ] },  // each subset must match a stored row
 *     "notStored":{ "<table>": { ... } },      // no stored row may match
 *     "response": { ... },                     // subset of the JSON response
 *     "droppedKeys": ["user_id"],              // keys the server may knowingly ignore (default none)
 *     "<anyOtherKey>": ...                     // shorthand: any other key is part of `parsed`
 *   }
 * }
 * Status: with `status` set, exactly that. Otherwise a fixture that asserts `stored` or
 * `response` must get a 2xx; any other fixture must merely be ACCEPTED BY THE CONTRACT —
 * not a validation failure (400 VALIDATION_ERROR / INVALID_JSON, 415, 422) and not a 5xx.
 * Domain answers such as 404 "Goal not found" or a date-window 400 are not contract
 * failures (seed the rows and set `now` to make them 2xx).
 * Subsets match recursively; arrays in a subset must match element-wise by position.
 * The authenticated user is FIXTURE_USER_ID below; use it in seeds and paths. Every key
 * a client sends that the schema strips fails the fixture unless listed in `droppedKeys`
 * or in HARMLESS_DROPS for the route (that list is the reviewed contract).
 * No secrets: fake UUIDs and user@example.com only (this repo is public).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileAPIService } from '@/lib/services/mobile-api-service';
import { NutritionIntelligenceService } from '@/lib/services/nutrition-intelligence-service';

import { createReplaySupabase } from '../helpers/replay-supabase';

const TOKENS = { access_token: 'replay-access', refresh_token: 'replay-refresh', expires_at: 2_000_000_000, expires_in: 3600 };

export const FIXTURE_USER_ID = '11111111-1111-4111-8111-111111111111';
const DEFAULT_NOW = '2026-11-05T17:00:00Z';
const DEFAULT_TIMEZONE = 'America/Toronto';
/** feature_flags rows seeded by default, as in production. */
const ROLLED_OUT_FEATURES = ['food_logging'];

/** Route → keys a shipped client sends that the server knowingly ignores (reviewed). */
const HARMLESS_DROPS: Record<string, string[]> = {
  // Android whole-entry bodies echo client-side columns.
  '/api/mobile/food-log': ['user_id', 'image_urls', 'photo_url', 'created_at', 'sync_status', 'updated_at'],
  // (`id` echoes the path id on Android's whole-entry PATCH.)
  '/api/mobile/food-log/[id]': ['id', 'entry_type', 'user_id', 'image_urls', 'photo_url', 'created_at', 'sync_status', 'updated_at'],
  '/api/mobile/beverages': ['id', 'user_id', 'created_at', 'updated_at', 'sync_status'],
  '/api/mobile/beverages/[id]': ['id', 'user_id', 'created_at', 'updated_at', 'sync_status'],
  // iOS create-circle always sends min_participants (DB default is the same 2).
  '/api/mobile/circles': ['min_participants'],
  // iOS edit echoes platform-owned fields the update never changes.
  '/api/mobile/exercises/[id]': ['source', 'healthkitWorkoutId', 'sourceDeviceName'],
  // iOS create goal: custom_schedule is always nil today.
  '/api/mobile/daily-goals': ['custom_schedule'],
  // iOS fallback chat sends the last message twice (also inside `messages`).
  '/api/mobile/fitzy/chat': ['message'],
  // iOS HealthKit sync repeats autoClaimStreak on every item; the server decides streak
  // credit itself (workout-claim-policy) and ignores it at the top level too.
  '/api/mobile/exercises/sync': ['exercises[].autoClaimStreak'],
};

// ── Harness state ─────────────────────────────────────────────────────────────────
const state = vi.hoisted(() => ({
  fake: null as any,
  parsed: [] as unknown[],
  dropped: [] as { route: string | undefined; keys: string[] }[],
  ai: [] as { method: string; args: unknown[] }[],
}));

vi.mock('@/lib/middleware/mobile-auth', async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'user@example.com' };
  return {
    ...original,
    requireMobileAuth: async () => user,
    verifyMobileAuth: async () => user,
    getUserIdFromToken: async () => user.id,
  };
});
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => state.fake.client }));
vi.mock('@/lib/supabase', async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return { ...original, createAdminSupabase: () => state.fake.client };
});
vi.mock('@/lib/supabase-server', () => ({
  createServerSupabase: async () => state.fake.client,
  createAdminClient: () => state.fake.client,
}));
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return { ...original, createClient: () => state.fake.client };
});
// Side effects after the response are out of scope for a payload contract.
vi.mock('@/lib/utils/after-response', () => ({ runAfterResponse: () => {} }));
vi.mock('next/server', async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return { ...original, after: () => {} };
});
// Routes shared with the web app read cookies(); a mobile request carries none.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }),
  headers: async () => new Headers(),
}));
vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: () => {},
  captureMessage: () => {},
  captureException: () => {},
  withScope: (cb: (scope: unknown) => void) => cb({ setTag() {}, setExtra() {}, setContext() {} }),
}));
// External services, stubbed the way the route tests stub them (auth-route lenient-validation,
// nutrition-null-tolerance): rate limits and email are infrastructure; tokens need secrets.
vi.mock('@/lib/middleware/rate-limit', async (importOriginal) => {
  const original: Record<string, unknown> = await importOriginal();
  return { ...original, applyRateLimit: async () => null };
});
vi.mock('@/lib/services/welcome-email-service', () => ({ triggerWelcomeEmail: () => {} }));
// Record what the guarded parse produced and which keys it saw dropped.
vi.mock('@/lib/validation/lenient-parse', async (importOriginal) => {
  const original: any = await importOriginal();
  return {
    ...original,
    parseLenient: (schema: any, value: unknown, options?: any) => {
      const out = original.parseLenient(schema, value, options);
      state.parsed.push(out);
      return out;
    },
    safeParseLenient: (schema: any, value: unknown, options?: any) => {
      const out = original.safeParseLenient(schema, value, options);
      if (out.success) state.parsed.push(out.data);
      return out;
    },
  };
});
vi.mock('@/lib/validation/dropped-keys', async (importOriginal) => {
  const original: any = await importOriginal();
  return {
    ...original,
    reportDroppedKeys: (schema: any, value: unknown, options?: any) => {
      const keys = original.findDroppedKeys(schema, value).filter((k: string) => !(options?.ignore ?? []).includes(k));
      if (keys.length) state.dropped.push({ route: options?.route, keys });
      return keys;
    },
  };
});

// ── Fixture discovery ─────────────────────────────────────────────────────────────
const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'client-payloads');
const API_DIR = join(__dirname, '..', '..', 'app', 'api');

interface Fixture {
  method: string;
  path: string;
  body?: unknown;
  description?: string;
  now?: string;
  headers?: Record<string, string>;
  seed?: Record<string, Record<string, unknown>[]>;
  /** Field (or "(route)") → why the server does not take it today. Must still reproduce. */
  knownMismatches?: Record<string, string>;
  expect?: {
    status?: number | number[];
    parsed?: unknown;
    stored?: Record<string, unknown>;
    notStored?: Record<string, unknown>;
    response?: unknown;
    droppedKeys?: string[];
  };
}

function fixtures(): { client: string; name: string; file: string }[] {
  const out: { client: string; name: string; file: string }[] = [];
  for (const client of ['ios', 'android']) {
    const dir = join(FIXTURE_DIR, client);
    if (!existsSync(dir)) continue;
    const walk = (d: string) => {
      for (const name of readdirSync(d).sort()) {
        const full = join(d, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.json')) out.push({ client, name: relative(dir, full), file: full });
      }
    };
    walk(dir);
  }
  return out;
}

interface RouteEntry {
  pattern: string; // /api/mobile/beverages/[id]
  file: string;
  regex: RegExp;
  params: string[];
  dynamicCount: number;
}

function routeTable(): RouteEntry[] {
  const entries: RouteEntry[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== '__tests__') walk(full);
      } else if (name === 'route.ts') {
        const segs = relative(API_DIR, dir).split(/[\\/]/).filter(Boolean);
        const params: string[] = [];
        const re = segs
          .map((s) => {
            const catchAll = /^\[\.\.\.(.+)\]$/.exec(s);
            if (catchAll) return params.push(catchAll[1]), '(.+)';
            const dyn = /^\[(.+)\]$/.exec(s);
            if (dyn) return params.push(dyn[1]), '([^/]+)';
            return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('/');
        entries.push({
          pattern: `/api/${segs.join('/')}`,
          file: full,
          regex: new RegExp(`^/api/${re}/?$`),
          params,
          dynamicCount: params.length,
        });
      }
    }
  };
  walk(API_DIR);
  // Static segments win over dynamic ones (Next.js precedence).
  return entries.sort((a, b) => a.dynamicCount - b.dynamicCount);
}

const ROUTES = routeTable();

function resolveRoute(path: string): { route: RouteEntry; params: Record<string, string> } {
  const pathname = path.split('?')[0];
  for (const route of ROUTES) {
    const m = route.regex.exec(pathname);
    if (m) {
      const params: Record<string, string> = {};
      route.params.forEach((name, i) => (params[name] = decodeURIComponent(m[i + 1])));
      return { route, params };
    }
  }
  throw new Error(`No route file matches ${path}`);
}

// ── Matching ──────────────────────────────────────────────────────────────────────
function matches(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') {
    if (typeof expected === 'number' && typeof actual === 'string' && actual.trim() !== '') {
      return Number(actual) === expected; // numeric columns read back as strings
    }
    return Object.is(actual, expected) || (typeof actual === 'string' && typeof expected === 'string' && actual.toLowerCase() === expected.toLowerCase() && /^[0-9a-f-]{36}$/i.test(expected));
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.every((e, i) => matches(actual[i], e));
  }
  if (actual === null || typeof actual !== 'object') return false;
  return Object.entries(expected as Record<string, unknown>).every(([k, v]) =>
    matches((actual as Record<string, unknown>)[k], v)
  );
}

const show = (v: unknown) => JSON.stringify(v, null, 2);

/** `{ "a.0.b": 1 }` → `{ a: [ { b: 1 } ] }` (numeric segments index arrays). */
function expandPaths(flat: Record<string, unknown>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(flat)) {
    const segs = path.split('.');
    let node: any = root;
    segs.forEach((seg, i) => {
      const last = i === segs.length - 1;
      const key: string | number = /^\d+$/.test(seg) && Array.isArray(node) ? Number(seg) : seg;
      if (last) node[key] = value;
      else node = node[key] ??= /^\d+$/.test(segs[i + 1]) ? [] : {};
    });
  }
  return root;
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    out[k] =
      prev && v && typeof prev === 'object' && typeof v === 'object' && !Array.isArray(v)
        ? deepMerge(prev as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}

/** 400 codes that mean "the payload itself was not understood" (vs a domain answer). */
const CONTRACT_REJECTION_CODES = new Set(['VALIDATION_ERROR', 'INVALID_JSON', 'INVALID_REQUEST', 'BAD_REQUEST']);

const EXPECT_KEYS = new Set(['status', 'parsed', 'stored', 'notStored', 'response', 'droppedKeys']);

interface Failure {
  kind: 'no-route' | 'rejected' | 'dropped' | 'missing' | 'value' | 'parsed' | 'response' | 'stored';
  key?: string;
  message: string;
}

/** Not understood (vs a domain answer such as 404 "Goal not found" or a date-window 400). */
function contractRejection(status: number, json: unknown): boolean {
  const body = (json && typeof json === 'object' ? json : {}) as { code?: unknown; error?: unknown };
  const code = body.error && typeof body.error === 'object' ? (body.error as { code?: unknown }).code : body.code;
  return (
    status >= 500 ||
    status === 415 ||
    status === 422 ||
    (status === 400 && (code === undefined || CONTRACT_REJECTION_CODES.has(String(code))))
  );
}

/** "exercises.0.category" → "exercises[].category" (the dropped-key guard's path format). */
function toGuardPath(path: string): string {
  return path.replace(/\.(\d+)(?=\.|$)/g, '[]');
}

function getPath(root: unknown, path: string): { present: boolean; value?: unknown } {
  let node: unknown = root;
  for (const seg of path.split('.')) {
    if (node === null || typeof node !== 'object') return { present: false };
    const key: string | number = Array.isArray(node) && /^\d+$/.test(seg) ? Number(seg) : seg;
    if (!(key in (node as Record<string, unknown>))) return { present: false };
    node = (node as Record<string | number, unknown>)[key];
  }
  return { present: true, value: node };
}

const isPrimitive = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Generated fixtures are named `<method>-<route-slug>.<case>.json` and dated 2026-01-15. */
const GENERATED_NAME = /^(post|put|patch|delete|get)-/;
const GENERATED_NOW = '2026-01-15T17:00:00Z';

type SidecarEntry = Pick<Fixture, 'now' | 'headers' | 'seed' | 'knownMismatches'> & {
  expect?: Partial<NonNullable<Fixture['expect']>>;
  note?: string;
};
/**
 * Harness-side config for fixtures whose bodies are golden copies (client-generated):
 * seeds, clock, headers, knownMismatches. Keyed by "<client>/<file>".
 */
const SIDECAR: Record<string, SidecarEntry> = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'sidecar.json'), 'utf8')
) as Record<string, SidecarEntry>;

function withSidecar(fixture: Fixture, extra: SidecarEntry | undefined): Fixture {
  if (!extra) return fixture;
  return {
    ...fixture,
    now: extra.now ?? fixture.now,
    headers: { ...(fixture.headers ?? {}), ...(extra.headers ?? {}) },
    seed: { ...(fixture.seed ?? {}), ...(extra.seed ?? {}) },
    knownMismatches: { ...(fixture.knownMismatches ?? {}), ...(extra.knownMismatches ?? {}) },
    expect: { ...(fixture.expect ?? {}), ...(extra.expect ?? {}) } as Fixture['expect'],
  };
}

// ── The suite ─────────────────────────────────────────────────────────────────────
const all = fixtures();

describe('client payload replay', () => {
  const realDate = Date;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Tokens are signed with secrets the tests do not have.
    vi.spyOn(MobileAPIService, 'generateTokens').mockResolvedValue(TOKENS as never);
    vi.spyOn(MobileAPIService, 'refreshAccessToken').mockResolvedValue(TOKENS as never);
    // The food AI is a paid model call: record what the route passed it, answer a minimal draft.
    vi.spyOn(NutritionIntelligenceService, 'parseVoice').mockImplementation(async (...args: unknown[]) => {
      state.ai.push({ method: 'parseVoice', args });
      return { items: [{ name: 'Oatmeal', grams: 200, calories: 300 }], totals: { calories: 300 }, confidence: 0.9 } as never;
    });
    vi.spyOn(NutritionIntelligenceService, 'estimateItem').mockImplementation(async (...args: unknown[]) => {
      state.ai.push({ method: 'estimateItem', args });
      return { name: String(args[1]), grams: 100, calories: 120 } as never;
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterAll(() => {
    vi.useRealTimers();
    void realDate;
  });

  it('has fixtures for both shipped clients', () => {
    expect(all.some((f) => f.client === 'ios')).toBe(true);
    expect(all.some((f) => f.client === 'android')).toBe(true);
  });

  // First import of a route module compiles its whole dependency graph: allow for it.
  it.each(all.map((f) => [`${f.client}/${f.name}`, f] as const))('%s', { timeout: 60_000 }, async (label, f) => {
    const fileFixture = JSON.parse(readFileSync(f.file, 'utf8')) as Fixture;
    const fixture = withSidecar(fileFixture, SIDECAR[label]);
    expect(typeof fixture.method, 'fixture.method').toBe('string');
    expect(typeof fixture.path, 'fixture.path').toBe('string');
    const method = fixture.method.toUpperCase();
    const raw = (fixture.expect ?? {}) as Record<string, unknown>;
    const shorthand = Object.fromEntries(Object.entries(raw).filter(([k]) => !EXPECT_KEYS.has(k)));
    const exp: NonNullable<Fixture['expect']> = { ...raw };
    const known = fixture.knownMismatches ?? {};
    const knownKeys = Object.keys(known);

    // Generated fixtures (client test suites) are dated 2026-01-15.
    const now = fixture.now ?? (GENERATED_NAME.test(f.name) ? GENERATED_NOW : DEFAULT_NOW);
    vi.setSystemTime(new Date(now));
    state.parsed = [];
    state.dropped = [];
    state.ai = [];
    const seed: Record<string, Record<string, unknown>[]> = { ...(fixture.seed ?? {}) };
    const profiles = seed.profiles ?? [];
    if (!profiles.some((p) => p.id === FIXTURE_USER_ID)) {
      seed.profiles = [
        {
          id: FIXTURE_USER_ID,
          email: 'user@example.com',
          display_name: 'Replay User',
          timezone: DEFAULT_TIMEZONE,
          subscription_tier: 'free',
        },
        ...profiles,
      ];
    }
    // Features that are fully rolled out in production (a fixture may seed its own rows).
    seed.feature_flags ??= ROLLED_OUT_FEATURES.map((name) => ({ name, is_enabled: true, rollout_percentage: 100 }));
    state.fake = createReplaySupabase(seed);

    // ── A route that does not exist ─────────────────────────────────────────────
    let resolved: ReturnType<typeof resolveRoute> | null = null;
    try {
      resolved = resolveRoute(fixture.path);
    } catch {
      resolved = null;
    }
    const mod = resolved ? await import(/* @vite-ignore */ resolved.route.file) : null;
    const handler = mod?.[method];
    if (!resolved || typeof handler !== 'function') {
      const what = resolved ? `${resolved.route.pattern} exports no ${method}` : `no route file matches ${fixture.path}`;
      expect(
        knownKeys.length,
        `${what}. The app calls an endpoint the server does not have; list it in knownMismatches if that is known.`
      ).toBeGreaterThan(0);
      return; // still missing, exactly as the fixture records
    }
    const { route, params } = resolved;

    const headers: Record<string, string> = {
      authorization: 'Bearer replay-token',
      'x-client-timezone': DEFAULT_TIMEZONE,
      'x-app-platform': f.client,
      ...(fixture.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(fixture.headers ?? {}),
    };
    const request = new NextRequest(new URL(fixture.path, 'http://localhost'), {
      method,
      headers,
      body: fixture.body !== undefined && method !== 'GET' ? JSON.stringify(fixture.body) : undefined,
    });
    const res: Response = await handler(request, { params: Promise.resolve(params) });
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // non-JSON response: compared as text
    }
    const context = `${route.pattern}\nstatus ${res.status}\nresponse ${text.slice(0, 1500)}`;

    // ── Collect every way the server failed to take this payload ───────────────
    const failures: Failure[] = [];
    if (res.status === 404 || res.status === 405) {
      const body = (json && typeof json === 'object' ? json : {}) as { error?: { code?: unknown } };
      if (!body.error || typeof body.error !== 'object') failures.push({ kind: 'no-route', message: context });
    }
    if (exp.status !== undefined) {
      const allowed = Array.isArray(exp.status) ? exp.status : [exp.status];
      if (!allowed.includes(res.status)) failures.push({ kind: 'rejected', message: `expected status ${allowed}\n${context}` });
    } else if (exp.stored || exp.response || exp.notStored) {
      if (res.status < 200 || res.status >= 300) failures.push({ kind: 'rejected', message: `expected 2xx\n${context}` });
    } else if (contractRejection(res.status, json)) {
      failures.push({ kind: 'rejected', message: `the server rejected this client payload\n${context}` });
    }

    const droppedRaw = [...new Set(state.dropped.flatMap((d) => d.keys))];
    const allowedDrops = new Set([...(HARMLESS_DROPS[route.pattern] ?? []), ...(exp.droppedKeys ?? [])]);
    for (const key of droppedRaw) {
      if (!allowedDrops.has(key)) {
        failures.push({
          kind: 'dropped',
          key,
          message:
            `${route.pattern} silently drops "${key}", which this client sends. Either the server must read it ` +
            '(alias), or list it in expect.droppedKeys / HARMLESS_DROPS with a reason.',
        });
      }
    }

    // Shorthand: every listed field must be UNDERSTOOD — not dropped; and where the
    // guarded parse kept it under the same path, with the same value. A field the
    // client does not send (a server-side name) must appear in the parse output.
    const guarded = state.parsed.length > 0;
    for (const [path, value] of Object.entries(shorthand)) {
      const guardPath = toGuardPath(path);
      if (droppedRaw.some((d) => guardPath === d || guardPath.startsWith(`${d}.`) || guardPath.startsWith(`${d}[]`))) {
        if (!failures.some((x) => x.kind === 'dropped' && x.key && guardPath.startsWith(x.key))) {
          failures.push({ kind: 'dropped', key: path, message: `${route.pattern} drops "${path}"` });
        }
        continue;
      }
      if (!guarded) continue; // hand-read route: nothing to inspect (see mobile-body-parse-guard.test.ts)
      const sent = getPath(fixture.body, path);
      const found = state.parsed.map((p) => getPath(p, path)).filter((v) => v.present);
      if (!sent.present && found.length === 0) {
        failures.push({ kind: 'missing', key: path, message: `"${path}" is not understood\nparsed: ${show(state.parsed)}` });
      } else if (
        found.length > 0 &&
        isPrimitive(value) &&
        found.every((v) => typeof v.value === typeof value) &&
        !found.some((v) => matches(v.value, value))
      ) {
        failures.push({
          kind: 'value',
          key: path,
          message: `"${path}" was read as ${show(found.map((v) => v.value))}, expected ${show(value)}`,
        });
      }
    }

    if (exp.parsed !== undefined && !state.parsed.some((p) => matches(p, exp.parsed))) {
      failures.push({ kind: 'parsed', message: `no guarded parse produced ${show(exp.parsed)}\nparsed: ${show(state.parsed)}` });
    }
    if (exp.response !== undefined && !matches(json, exp.response)) {
      failures.push({ kind: 'response', message: `response does not match ${show(exp.response)}\n${context}` });
    }
    for (const [table, want] of Object.entries(exp.stored ?? {})) {
      const rows = state.fake.rows(table);
      for (const subset of Array.isArray(want) ? want : [want]) {
        if (!rows.some((r: unknown) => matches(r, subset))) {
          failures.push({ kind: 'stored', message: `no ${table} row matches ${show(subset)}\nrows: ${show(rows)}\n${context}` });
        }
      }
    }
    for (const [table, unwanted] of Object.entries(exp.notStored ?? {})) {
      const rows = state.fake.rows(table);
      for (const subset of Array.isArray(unwanted) ? unwanted : [unwanted]) {
        if (rows.some((r: unknown) => matches(r, subset))) {
          failures.push({ kind: 'stored', message: `a ${table} row matches ${show(subset)} but must not\nrows: ${show(rows)}` });
        }
      }
    }

    // ── Known mismatches: must still fail exactly that way ─────────────────────
    if (knownKeys.length === 0) {
      expect(failures.map((x) => x.message), `${label}`).toEqual([]);
      return;
    }
    const isKnown = (x: Failure) =>
      x.kind === 'no-route' ||
      x.kind === 'rejected' ||
      (x.key !== undefined && knownKeys.some((k) => k === x.key || toGuardPath(x.key!) === toGuardPath(k)));
    const unknown = failures.filter((x) => !isKnown(x) && !(x.kind === 'parsed' && failures.some(isKnown)));
    expect(unknown.map((x) => x.message), `${label}: failures beyond its knownMismatches`).toEqual([]);

    const knownDropped = knownKeys.filter((k) => droppedRaw.includes(toGuardPath(k)));
    const stillFailing = failures.some(isKnown) || knownDropped.length > 0;
    if (!stillFailing) {
      // Fixed — unless nothing could be observed (hand-read route, keys never reported).
      expect(
        guarded,
        `${label}: knownMismatches ${knownKeys.join(', ')} no longer reproduce — the server now understands this ` +
          'payload. Remove knownMismatches from the fixture (or the sidecar) so it is checked normally.'
      ).toBe(false);
    }
  });

});
