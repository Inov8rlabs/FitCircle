/**
 * Draft meals (ENGAGEMENT_115_SPEC §14.6): drafts must never count. Every app-code READ of
 * food_log_entries goes through `confirmedOnly(...)` unless it is listed below with the reason
 * it may see drafts, or carries a `drafts-included` comment right above it. A new reader that forgets the filter fails here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP_DIR = join(__dirname, '..', '..', 'app');

/** file → why its unfiltered food_log_entries reads are correct. */
const ALLOWED: Record<string, string> = {
  'lib/services/food-log-service.ts':
    'owner CRUD: create/retry, ownership reads for update/delete/share lists; getEntries/ForDay/ById filter unless includeDrafts; confirmDraft reads the draft',
  'lib/services/meal-draft-service.ts': 'the draft lifecycle itself (filters entry_status explicitly)',
  'lib/services/meal-share-service.ts': 'single-entry owner read; refuses drafts explicitly (isDraftEntry)',
  'lib/services/food-log-image-service.ts': 'ownership + image_count bookkeeping on one entry',
  'lib/services/food-entry-privacy-service.ts': 'bulk "make my meals private" (drafts are private already)',
  'lib/services/health-nutrition-service.ts': 'dedupe of imported Health rows by external id (never drafts)',
  'lib/services/nutrition-intelligence-service.ts': 'ownership check / unparsed-photo fallback dedupe',
  'lib/services/nutrition-training-service.ts': 'provenance stamp on the entry just saved',
  'lib/services/group-meal-service.ts': 'insert only',
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('every food_log_entries reader excludes Draft meals', () => {
  it('reads are wrapped in confirmedOnly() or allow-listed with a reason', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(APP_DIR)) {
      const rel = relative(APP_DIR, file);
      if (rel in ALLOWED) continue;
      const src = readFileSync(file, 'utf8');
      const re = /\.from\(\s*['"`]food_log_entries['"`]\s*\)\s*\.(select|insert|update|delete|upsert)\(/g;
      for (let m = re.exec(src); m; m = re.exec(src)) {
        if (m[1] !== 'select') continue;
        const before = src.slice(Math.max(0, m.index - 120), m.index);
        // A read that must see drafts too says so in a comment right above it.
        if (/drafts-included/.test(src.slice(Math.max(0, m.index - 300), m.index))) continue;
        if (/confirmedOnly\(\s*[\w.()]*$/.test(before.replace(/\s+/g, ' ').trimEnd() + '') || /confirmedOnly\([^)]*$/.test(before)) continue;
        offenders.push(`${rel}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('generic table readers that may hit food_log_entries filter it too', () => {
    const audience = readFileSync(join(APP_DIR, 'lib/services/user-audience-service.ts'), 'utf8');
    expect(audience).toMatch(/table === 'food_log_entries' \? confirmedOnly\(/);
  });
});
