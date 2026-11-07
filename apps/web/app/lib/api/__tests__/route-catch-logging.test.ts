/**
 * Lint-style guard: every `catch` in an API route.ts must leave a trace.
 *
 * 2026-11-02: a route caught a PostgREST error and returned `error.message` to
 * the client without logging, so the failure never reached Vercel logs or
 * Sentry. A catch block passes when it (directly, or through a function it
 * calls) does one of:
 *   - `reportRouteError(...)` (app/lib/api/route-errors.ts) — preferred
 *   - `console.error` / `console.warn` / Sentry
 *   - calls a shared error mapper that reports (LOGGING_MAPPERS below)
 *   - rethrows (`throw`) so an outer catch handles it
 *
 * Intentionally silent catches (unparseable JSON body → default, closed
 * stream controller, auth probe that falls back to "anonymous") go in
 * ALLOWLIST with the number of such catches in that file and why.
 */
import fs from 'fs';
import path from 'path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = path.resolve(__dirname, '../../../..');
const API_ROOT = path.join(WEB_ROOT, 'app/api');

/** Shared mappers that call reportRouteError (or console.error) for unexpected errors. Verified below. */
const LOGGING_MAPPERS: Record<string, string> = {
  failFrom: 'app/lib/referrals/http.ts',
  campaignFailFrom: 'app/lib/campaigns/http.ts',
  adsFailFrom: 'app/lib/ads/http.ts',
  securityFailFrom: 'app/lib/security/http.ts',
  releasesFailFrom: 'app/lib/releases/http.ts',
  experimentsFailFrom: 'app/lib/experiments/http.ts',
  mobileFailFrom: 'app/lib/experiments/http.ts',
  feedFailFrom: 'app/lib/home-feed/http.ts',
  remoteConfigFailFrom: 'app/lib/remote-config/http.ts',
  fitzyFail: 'app/lib/fitzy/http.ts',
  describeFitzyError: 'app/lib/fitzy/http.ts',
  challengeErrorResponse: 'app/lib/http/circle-challenge-errors.ts',
  unhandledChallengeError: 'app/lib/http/circle-challenge-errors.ts',
  groupMealErrorResponse: 'app/lib/http/group-meal-errors.ts',
  mapReactionError: 'app/api/mobile/food-log/[id]/reactions/reaction-errors.ts',
  mapChatReactionError: 'app/api/mobile/messages/[id]/reactions/reaction-route-helpers.ts',
};

/**
 * route.ts (relative to app/api) → number of intentionally silent catches + why.
 * Keep the count exact: a new silent catch in a listed file still fails.
 */
const ALLOWLIST: Record<string, { count: number; reason: string }> = {
  'billing/checkout/route.ts': { count: 1, reason: 'optional JSON body; falls through to validation' },
  'check-ins/[id]/route.ts': { count: 1, reason: 'Bearer auth probe; failure means "no bearer user" (cookie auth tried first)' },
  'mobile/attribution/route.ts': { count: 1, reason: 'requireMobileAuth only throws Unauthorized → 401' },
  'mobile/circles/[id]/join/route.ts': { count: 1, reason: 'optional JSON body; no body = public join' },
  'mobile/dietary-preferences/route.ts': { count: 1, reason: 'unparseable JSON body → null, then validated' },
  'mobile/fitzy/chat/route.ts': { count: 1, reason: 'unparseable JSON body → null, then validated' },
  'mobile/fitzy/chat/stream/route.ts': { count: 2, reason: 'enqueue/close on an already-closed stream controller' },
  'mobile/food/estimate-item/route.ts': { count: 1, reason: 'invalid JSON body → 400 VALIDATION_ERROR' },
  'mobile/food/feedback/route.ts': { count: 1, reason: 'unparseable JSON body → null, then validated' },
  'mobile/food/training-sample/route.ts': { count: 1, reason: 'invalid sample JSON → 400 VALIDATION_ERROR' },
  'mobile/food/voice-parse/route.ts': { count: 1, reason: 'invalid JSON body → 400 VALIDATION_ERROR' },
  'mobile/food-log/[id]/route.ts': { count: 1, reason: 'invalid JSON body → 400 INVALID_JSON' },
  'mobile/me/journey/events/route.ts': { count: 1, reason: 'unparseable JSON body → undefined, then validated' },
  'mobile/me/journey/route.ts': { count: 1, reason: 'unparseable JSON body → undefined, then validated' },
  'mobile/messages/[id]/reactions/[reaction]/route.ts': { count: 1, reason: 'decodeURIComponent of the path segment; falls back to the raw segment' },
  'mobile/nutrition-coach/route.ts': { count: 1, reason: 'unparseable JSON body → null, then validated' },
  'mobile/onboarding/complete/route.ts': { count: 1, reason: 'unparseable JSON body → {}' },
  'mobile/profile/avatar/route.ts': { count: 1, reason: 'non-multipart body → 400 VALIDATION_ERROR' },
  'mobile/profile/preferences/route.ts': { count: 1, reason: 'invalid JSON body → 400 VALIDATION_ERROR' },
  'mobile/rating-prompt/requested/route.ts': { count: 2, reason: 'requireMobileAuth only throws Unauthorized → 401; unparseable JSON body → undefined, then validated' },
  'mobile/rating-prompt/route.ts': { count: 1, reason: 'requireMobileAuth only throws Unauthorized → 401' },
  'mobile/streaks/apply-freeze/route.ts': { count: 1, reason: 'malformed JSON → default missedDate (yesterday)' },
  'og/share-card/route.ts': { count: 1, reason: 'invalid data query param → 400' },
  'webhooks/revenuecat/route.ts': { count: 1, reason: 'invalid JSON body → 400' },
};

/**
 * Silent in this worktree but already fixed elsewhere; exempt from the
 * stale-entry check. Remove once merged.
 */
const PENDING_ELSEWHERE: Record<string, { count: number; reason: string }> = {};

const LOGS = /\b(reportRouteError|captureException)\s*\(|console\.(error|warn)\s*\(|\bSentry\./;
const MAPPER_CALL = new RegExp(`\\b(${Object.keys(LOGGING_MAPPERS).join('|')})\\s*\\(`);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(p, out);
    } else if (entry.name === 'route.ts') {
      out.push(p);
    }
  }
  return out;
}

function isFunctionLike(node: ts.Node): boolean {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}

/** A `throw` directly in the catch block (not inside a nested function). */
function rethrows(block: ts.Block): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found || isFunctionLike(node)) return;
    if (ts.isThrowStatement(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(block, visit);
  return found;
}

/** Names of functions declared in the file (declarations and `const x = () => …`) whose body logs. */
function loggingLocalFunctions(sf: ts.SourceFile): Set<string> {
  const bodies = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) bodies.set(node.name.text, node.body.getText(sf));
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      bodies.set(node.name.text, node.initializer.body.getText(sf));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  const logging = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, body] of bodies) {
      if (logging.has(name)) continue;
      const callsLogging = [...logging].some((n) => new RegExp(`\\b${n}\\s*\\(`).test(body));
      if (LOGS.test(body) || MAPPER_CALL.test(body) || callsLogging) {
        logging.add(name);
        changed = true;
      }
    }
  }
  return logging;
}

function silentCatches(file: string): number[] {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const local = loggingLocalFunctions(sf);
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCatchClause(node)) {
      const text = node.block.getText(sf);
      const ok =
        LOGS.test(text) ||
        MAPPER_CALL.test(text) ||
        rethrows(node.block) ||
        [...local].some((n) => new RegExp(`\\b${n}\\s*\\(`).test(text));
      if (!ok) lines.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}

describe('API route catch blocks', () => {
  const files = walk(API_ROOT);
  const silent = new Map<string, number[]>();
  for (const file of files) {
    const lines = silentCatches(file);
    if (lines.length) silent.set(path.relative(API_ROOT, file).split(path.sep).join('/'), lines);
  }

  it('scans the route tree', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('every catch block logs, reports, rethrows, or is allowlisted', () => {
    const offenders: string[] = [];
    for (const [rel, lines] of silent) {
      const allowed = ALLOWLIST[rel]?.count ?? PENDING_ELSEWHERE[rel]?.count ?? 0;
      if (lines.length > allowed) {
        offenders.push(`${rel}: silent catch at line(s) ${lines.join(', ')} (allowlisted: ${allowed})`);
      }
    }
    // Fix: call reportRouteError(route, error, { status }) from '@/lib/api/route-errors'
    // in the catch (or a mapper that does). Only allowlist genuinely expected fallbacks.
    expect(offenders).toEqual([]);
  });

  it('allowlist has no stale entries', () => {
    const stale = Object.entries(ALLOWLIST)
      .filter(([rel, { count }]) => (silent.get(rel)?.length ?? 0) < count)
      .map(([rel, { count }]) => `${rel}: allowlisted ${count}, found ${silent.get(rel)?.length ?? 0}`);
    expect(stale).toEqual([]);
  });

  it('every LOGGING_MAPPER really reports', () => {
    const notLogging = Object.entries(LOGGING_MAPPERS).filter(([name, rel]) => {
      const src = fs.readFileSync(path.join(WEB_ROOT, rel), 'utf8');
      if (!new RegExp(`function ${name}\\b`).test(src)) return true;
      return !/reportRouteError\s*\(/.test(src) && !MAPPER_CALL.test(src.replace(new RegExp(`function ${name}\\b`), ''));
    });
    expect(notLogging.map(([n]) => n)).toEqual([]);
  });
});
