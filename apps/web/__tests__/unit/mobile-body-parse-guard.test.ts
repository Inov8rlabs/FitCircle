/**
 * Mobile request bodies must go through the guarded parse path.
 *
 * `parseLenient` / `safeParseLenient` (app/lib/validation/lenient-parse.ts) report keys a
 * schema silently strips (`[api-dropped-keys]` log + Sentry). A plain `schema.parse(body)`
 * strips the same keys with no trace — that is how iOS's `"date"` (the server read
 * `trackingDate`) saved every past-day entry as today for 10 months, unnoticed.
 *
 * This is a static scan of app/api/mobile (like db-contract.test.ts):
 *  1. no plain zod `.parse(` / `.safeParse(` in mobile route code, except allowlisted
 *     calls on query strings, path params or per-item salvage (each with a reason);
 *  2. every mobile route that reads a JSON body calls the guarded path, or is
 *     allowlisted with a reason (hand-validated bodies, delegation).
 * Both allowlists must stay exact: a stale entry fails too.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const MOBILE_DIR = join(__dirname, '..', '..', 'app', 'api', 'mobile');

/** `file::receiver` → why a plain parse is fine there. File paths relative to app/api/mobile. */
const PLAIN_PARSE_ALLOWLIST: Record<string, string> = {
  'beverages/route.ts::BeverageLogQuerySchema': 'GET query string, not a body',
  'beverages/stats/route.ts::BeverageStatsQuerySchema': 'GET query string, not a body',
  'body-comp/route.ts::bodyCompListQuerySchema': 'GET query string, not a body',
  'body-comp/trends/route.ts::bodyCompTrendsQuerySchema': 'GET query string, not a body',
  'body-comp/[id]/route.ts::idSchema': 'path param',
  'body-comp/import/route.ts::bodyCompImportItemSchema':
    'per-item salvage after the guarded envelope parse; item keys reported via reportDroppedKeys',
  'body-comp/import/route.ts::importItemIdentitySchema': 'per-item salvage (identity check), see above',
  'body-comp/import/route.ts::bodyCompImportItemSchema.shape[key]': 'per-field salvage, see above',
  'challenges/daily/[id]/join/route.ts::idSchema': 'path param',
  'challenges/daily/[id]/leaderboard/route.ts::idSchema': 'path param',
  'challenges/daily/[id]/progress/route.ts::idSchema': 'path param',
  'circles/[id]/join/route.ts::idSchema': 'path param',
  'food-log/route.ts::FoodLogQuerySchema': 'GET query string, not a body',
};

/** Files that read a JSON body without calling the guarded path, and why that is fine. */
const UNGUARDED_BODY_ALLOWLIST: Record<string, string> = {
  'auth/apple/route.ts': 'body parsed by parseAppleAuthRequest (apple-request.ts), which uses parseLenient',
  'challenges/validate/route.ts': 'dry-run validator: the service reports every problem with the raw body itself',
  'circles/[id]/streak/save/route.ts': 'two hand-read fields (coveredUserId, date) with explicit 400s',
  'profile/avatar/route.ts': 'multipart upload; the .json() read is the delegated response, not the request',
  'profile/preferences/route.ts': 'adapts the body and delegates to settings/preferences, which parses it guarded',
};

const NOT_ZOD = new Set(['JSON', 'Date', 'Number', 'URL', 'path', 'qs', 'querystring', 'Intl']);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : routeFiles(full);
    return name === 'route.ts' ? [full] : [];
  });
}

/** Strip // and block comments so documentation does not count as code. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = routeFiles(MOBILE_DIR).map((file) => ({
  rel: relative(MOBILE_DIR, file).split('\\').join('/'),
  src: code(readFileSync(file, 'utf8')),
}));

describe('mobile body parse guard', () => {
  it('finds the mobile routes', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('uses parseLenient / safeParseLenient instead of plain schema.parse / safeParse', () => {
    const found = new Set<string>();
    const violations: string[] = [];
    const re = /([A-Za-z_$][\w$]*(?:\.shape\[[^\]]+\])?)\s*\.\s*(safeParseAsync|parseAsync|safeParse|parse)\s*\(/g;
    for (const { rel, src } of files) {
      for (let m = re.exec(src); m; m = re.exec(src)) {
        const receiver = m[1];
        if (NOT_ZOD.has(receiver)) continue;
        const key = `${rel}::${receiver}`;
        found.add(key);
        if (!(key in PLAIN_PARSE_ALLOWLIST)) {
          const line = src.slice(0, m.index).split('\n').length;
          violations.push(`${rel}:${line} ${receiver}.${m[2]}(…) — use parseLenient/safeParseLenient`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
    const stale = Object.keys(PLAIN_PARSE_ALLOWLIST).filter((key) => !found.has(key));
    expect(stale, `stale PLAIN_PARSE_ALLOWLIST entries:\n${stale.join('\n')}`).toEqual([]);
  });

  it('routes that read a JSON body parse it through the guarded path', () => {
    const readsBody = /\b(?:request|req)\s*\.\s*json\s*\(|\breadJson\s*\(|\.json\(\)\.catch/;
    const guarded = /\b(?:parseLenient|safeParseLenient|reportDroppedKeys)\s*\(/;
    const unguarded = files.filter(({ src }) => readsBody.test(src) && !guarded.test(src)).map(({ rel }) => rel);

    const violations = unguarded.filter((rel) => !(rel in UNGUARDED_BODY_ALLOWLIST));
    expect(violations, `read a body without the guarded parse:\n${violations.join('\n')}`).toEqual([]);
    const stale = Object.keys(UNGUARDED_BODY_ALLOWLIST).filter((rel) => !unguarded.includes(rel));
    expect(stale, `stale UNGUARDED_BODY_ALLOWLIST entries:\n${stale.join('\n')}`).toEqual([]);
  });
});
