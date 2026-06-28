#!/usr/bin/env node
/**
 * Patches a crash in @amplitude/analytics-core's internal diagnostics storage.
 *
 * Why this exists
 * ---------------
 * Amplitude's DiagnosticsClient ALWAYS opens an IndexedDB database whenever
 * `indexedDB` merely exists on the global scope — it is gated only on
 * `DiagnosticsStorage.isSupported()` (`globalScope.indexedDB !== undefined`),
 * NOT on the public `enableDiagnostics` option. So diagnostics cannot be turned
 * off from app code.
 *
 * In some WebKit contexts (WKWebView / in-app browsers / private mode on
 * iOS Safari) the `onupgradeneeded` event fires with `event.target.result`
 * undefined. The SDK then calls `createTables(undefined)` and evaluates
 * `db.objectStoreNames`, throwing synchronously inside the IndexedDB event
 * handler. That throw escapes to `window.onerror` and surfaces in Sentry as an
 * unhandled fatal:
 *
 *   TypeError: undefined is not an object (evaluating 'e.objectStoreNames')
 *     at DiagnosticsStorage.createTables (.../diagnostics/diagnostics-storage.js)
 *     at IDBOpenDBRequest.onupgradeneeded (...)
 *
 * The fix
 * -------
 * Guard `createTables` so it no-ops when the db handle is missing. Diagnostics
 * then falls back to its in-memory path (the storage open rejects harmlessly and
 * is already wrapped in try/catch downstream). Real analytics events are
 * unaffected — diagnostics is internal SDK telemetry only.
 *
 * This runs on postinstall and is version-agnostic + idempotent: it walks every
 * copy of analytics-core under node_modules (the monorepo resolves 2.26.x and
 * 2.48.x), patches both the esm and cjs builds, and self-heals across SDK bumps.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MARKER = 'FITCIRCLE_DIAGNOSTICS_GUARD';
const GUARD = `if (!db || typeof db.objectStoreNames === 'undefined') { return; } // ${MARKER}`;

// Matches both builds: `DiagnosticsStorage.prototype.createTables = function (db) {`
const CREATE_TABLES_RE = /(DiagnosticsStorage\.prototype\.createTables\s*=\s*function\s*\(db\)\s*\{)/;

/** Recursively collect every diagnostics-storage.js under a node_modules tree. */
function findTargets(root, found = []) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      // Descend into node_modules trees (including nested ones) but skip noise.
      if (entry.name === '.bin' || entry.name === '.cache') continue;
      findTargets(full, found);
    } else if (
      entry.isFile() &&
      entry.name === 'diagnostics-storage.js' &&
      full.includes(path.join('@amplitude', 'analytics-core'))
    ) {
      found.push(full);
    }
  }
  return found;
}

function patchFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(MARKER)) return 'skipped';
  if (!CREATE_TABLES_RE.test(src)) return 'no-match';
  const patched = src.replace(CREATE_TABLES_RE, `$1\n        ${GUARD}`);
  fs.writeFileSync(file, patched);
  return 'patched';
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  // Search both the hoisted root tree and each workspace's own node_modules.
  const roots = [
    path.join(repoRoot, 'node_modules'),
    path.join(repoRoot, 'apps', 'web', 'node_modules'),
  ];

  const targets = [...new Set(roots.flatMap((r) => findTargets(r)))];
  if (targets.length === 0) {
    console.log('[patch-amplitude] no analytics-core diagnostics files found (nothing to do)');
    return;
  }

  const counts = { patched: 0, skipped: 0, 'no-match': 0 };
  for (const file of targets) {
    const result = patchFile(file);
    counts[result]++;
    if (result === 'patched') {
      console.log(`[patch-amplitude] guarded ${path.relative(repoRoot, file)}`);
    } else if (result === 'no-match') {
      console.warn(`[patch-amplitude] WARNING: createTables not found in ${path.relative(repoRoot, file)} (SDK shape changed?)`);
    }
  }
  console.log(
    `[patch-amplitude] done — patched ${counts.patched}, already-guarded ${counts.skipped}, unmatched ${counts['no-match']}`
  );
}

main();
