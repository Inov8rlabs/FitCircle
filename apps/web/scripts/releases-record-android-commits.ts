/**
 * Record Android release commits into the releases tracker (docs/RELEASES_TRACKER_SPEC.md §3.2.1).
 *   bun scripts/releases-record-android-commits.ts --env .env.local --releases-dir ../../../Fitcircle-Android/releases [--dry-run]
 * Reads every <releases-dir>/<versionCode>/COMMIT (written by Fitcircle-Android
 * scripts/play-release.sh) and fills `commits` on android rows with that build
 * where it is empty. Never overwrites, never touches notes. Re-runnable.
 * Needs prod SUPABASE_* in --env. Never prints secrets.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const envFile = arg('--env');
if (envFile) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const dir = arg('--releases-dir');
if (!dir || !existsSync(dir)) {
  console.error('Usage: bun scripts/releases-record-android-commits.ts --env <.env.local> --releases-dir <Fitcircle-Android/releases> [--dry-run]');
  process.exit(2);
}

const { parseAndroidCommitFile, recordAndroidCommits } = await import('../app/lib/releases/services/android-commits');

const entries = readdirSync(dir)
  .filter((n) => /^\d+$/.test(n) && existsSync(join(dir, n, 'COMMIT')))
  .map((build) => ({ build, commit: parseAndroidCommitFile(readFileSync(join(dir, build, 'COMMIT'), 'utf8')) }))
  .filter((e): e is { build: string; commit: NonNullable<typeof e.commit> } => !!e.commit);

if (args.includes('--dry-run')) {
  for (const e of entries) console.log(`${e.build}\t${e.commit.sha.slice(0, 7)}\t${e.commit.subject}`);
  process.exit(0);
}
const results = await recordAndroidCommits(entries);
for (const r of results) console.log(`vc${r.build}: filled ${r.filled.join(', ') || '-'}; kept ${r.kept.join(', ') || '-'}`);
