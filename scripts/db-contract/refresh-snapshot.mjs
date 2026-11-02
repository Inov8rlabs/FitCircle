#!/usr/bin/env node
// Refreshes apps/web/__tests__/fixtures/db-schema-snapshot.json from the linked (production)
// Supabase project, read-only. Run after every migration is applied:
//   node scripts/db-contract/refresh-snapshot.mjs
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = execFileSync('npx', ['-y', 'supabase@latest', 'db', 'query', '--linked', '--read-only', '-f',
  join(root, 'scripts/db-contract/schema-snapshot.sql')], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const parsed = JSON.parse(out.slice(out.indexOf('{')));
const snap = parsed.rows[0].snapshot;
const target = join(root, 'apps/web/__tests__/fixtures/db-schema-snapshot.json');
writeFileSync(target, JSON.stringify(snap, null, 2) + '\n');
console.log(`wrote ${target}: ${Object.keys(snap.relations).length} relations, ${snap.foreign_keys.length} foreign keys`);
