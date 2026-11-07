/**
 * DB contract: every Supabase query in app code must name things that exist in the
 * real schema. Unit tests use fake DBs, which accept any table or embed — that is how
 * `profiles!challenge_participants_user_id_fkey` (a FK name that never existed on that
 * table) reached production and broke every circle challenge leaderboard (2026-11-02).
 *
 * Checked against __tests__/fixtures/db-schema-snapshot.json, a read-only dump of the
 * production schema. After applying a migration, refresh it:
 *   node scripts/db-contract/refresh-snapshot.mjs
 * A brand-new table used in the same PR as its migration: add the migration's tables to
 * PENDING_RELATIONS below until the snapshot is refreshed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import snapshot from '../fixtures/db-schema-snapshot.json';

type ForeignKey = { name: string; table: string; ref: string; columns: string[] };
const relations = snapshot.relations as Record<string, string[]>;
const foreignKeys = snapshot.foreign_keys as ForeignKey[];

/** Tables created by migrations not yet applied when the snapshot was taken. */
const PENDING_RELATIONS: string[] = [
  // 129_remote_config.sql (TRIAL_FIRST_SPEC §6) — written, not applied yet.
  'remote_config_defaults',
  'remote_config_rules',
  'remote_config_changes',
  // 130_user_consents.sql (docs/PRIVACY_COMPLIANCE_SPEC.md §2) — written, not applied yet.
  'user_consents',
  // 132_app_integrity.sql (docs/INTEGRITY_CONTRACT.md) — written, not applied yet.
  'integrity_nonces',
  'device_attestations',
  'security_events',
  'security_alert_state',
];

const APP_DIR = join(__dirname, '..', '..', 'app');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

type Query = { file: string; line: number; table: string; select: string | null };

/** `.from('table')` calls (not `storage.from('bucket')`) and the select string that follows. */
function queries(): Query[] {
  const out: Query[] = [];
  for (const file of sourceFiles(APP_DIR)) {
    const src = readFileSync(file, 'utf8');
    const fromRe = /(?<!storage\s*)(?<!storage\??)\.from\(\s*['"`]([a-z_][a-z0-9_]*)['"`]\s*\)/g;
    for (let m = fromRe.exec(src); m; m = fromRe.exec(src)) {
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      if (/storage\s*\??\s*$/.test(before) || /\.storage\s*$/.test(before)) continue;
      const after = src.slice(m.index + m[0].length, m.index + m[0].length + 2000);
      const sel = /^\s*\.select\(\s*(['"`])([\s\S]*?)\1/.exec(after);
      out.push({
        file: relative(APP_DIR, file),
        line: src.slice(0, m.index).split('\n').length,
        table: m[1],
        select: sel && !sel[2].includes('${') ? sel[2] : null,
      });
    }
  }
  return out;
}

const known = (name: string) => name in relations || PENDING_RELATIONS.includes(name);

/** Embedded resources in a select: `alias:target!hint(` or `target!hint(` or `target(`. */
function embeds(select: string): { target: string; hint: string | null }[] {
  const re = /(?:([a-z_][a-z0-9_]*)\s*:\s*)?([a-z_][a-z0-9_]*)(?:!([a-z_][a-z0-9_]*))?\s*\(/g;
  const found: { target: string; hint: string | null }[] = [];
  for (let m = re.exec(select); m; m = re.exec(select)) {
    // Aggregates / casts like count(), sum(x) are not embeds.
    if (['count', 'sum', 'avg', 'min', 'max'].includes(m[2]) && !m[3]) continue;
    found.push({ target: m[2], hint: m[3] ?? null });
  }
  return found;
}

/** A `!hint` must be inner/left, a FK between the two tables, or a FK column on either side. */
function hintProblem(table: string, target: string, hint: string): string | null {
  if (hint === 'inner' || hint === 'left') return null;
  const between = foreignKeys.filter(
    (fk) => (fk.table === table && fk.ref === target) || (fk.table === target && fk.ref === table),
  );
  if (between.some((fk) => fk.name === hint)) return null;
  if (between.some((fk) => fk.columns.length === 1 && fk.columns[0] === hint)) return null;
  const real = between.map((fk) => `${fk.name} (${fk.columns.join(',')})`).join('; ') || 'none';
  return `${target}!${hint}: no such FK/column between ${table} and ${target} (real: ${real})`;
}

describe('DB contract (app queries vs production schema)', () => {
  const all = queries();

  it('finds the queries it is meant to check', () => {
    expect(all.length).toBeGreaterThan(200);
  });

  it('every .from() table exists', () => {
    const missing = all.filter((q) => !known(q.table)).map((q) => `${q.file}:${q.line} ${q.table}`);
    expect(missing).toEqual([]);
  });

  it('every embedded table exists and every !hint resolves', () => {
    const problems: string[] = [];
    for (const q of all) {
      if (!q.select || !known(q.table)) continue;
      for (const e of embeds(q.select)) {
        // `alias:fk_column(...)` embeds through a single-column FK on the queried table.
        const viaColumn = foreignKeys.find(
          (fk) => fk.table === q.table && fk.columns.length === 1 && fk.columns[0] === e.target,
        );
        if (viaColumn && !e.hint) continue;
        if (!known(e.target)) {
          problems.push(`${q.file}:${q.line} ${q.table} embeds unknown table ${e.target}`);
          continue;
        }
        const p = e.hint ? hintProblem(q.table, e.target, e.hint) : null;
        if (p) problems.push(`${q.file}:${q.line} ${q.table} → ${p}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
