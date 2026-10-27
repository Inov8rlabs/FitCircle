/**
 * Run the releases store sync from a laptop (docs/RELEASES_TRACKER_SPEC.md §5.4).
 *   bun scripts/releases-sync-local.ts --env ../../.env.local [--asc-key ~/Downloads/AuthKey_XXXX.p8] [--source app_store_connect]
 * --asc-key sets ASC_PRIVATE_KEY from the .p8 file (ASC_KEY_ID / ASC_ISSUER_ID must be in env).
 * Never prints secrets.
 */
import { readFileSync } from 'node:fs';

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
const ascKey = arg('--asc-key');
if (ascKey) process.env.ASC_PRIVATE_KEY = readFileSync(ascKey, 'utf8');

const { ReleaseSyncService } = await import('../app/lib/releases/services/sync-service');
const source = arg('--source');
const results = await ReleaseSyncService.run({ sources: source ? [source as any] : undefined, trigger: 'manual' });
console.log(JSON.stringify(results, null, 2));
