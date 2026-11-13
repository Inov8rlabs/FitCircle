/**
 * Backfill user_active_days from the Amplitude Export API (migration 136), day by day (UTC).
 *   bun scripts/activity-backfill-amplitude.ts --env .env.local --from 2026-10-01 [--to 2026-11-11] [--force]
 * --to defaults to yesterday (UTC). Hours already in amplitude_export_sync are skipped unless --force
 * (a forced re-sync re-adds event_count). Needs prod SUPABASE_* and AMPLITUDE_SECRET_KEY
 * (AMPLITUDE_API_KEY optional: defaults to the FitCircle 746168 key) in --env. Never prints secrets.
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
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const from = arg('--from');
const to = arg('--to') ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
if (!from || !DAY.test(from) || !DAY.test(to) || from > to) {
  console.error('Usage: bun scripts/activity-backfill-amplitude.ts --env <.env.local> --from YYYY-MM-DD [--to YYYY-MM-DD] [--force]');
  process.exit(2);
}
const force = args.includes('--force');

const { AmplitudeSyncService } = await import('../app/lib/activity/amplitude-sync-service');

const compact = (d: string) => d.replace(/-/g, '');
for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
  const day = new Date(t).toISOString().slice(0, 10);
  const hours = await AmplitudeSyncService.syncRange(`${compact(day)}T00`, `${compact(day)}T23`, { force });
  const done = hours.filter((h) => !h.skipped);
  const events = done.reduce((s, h) => s + h.activeEvents, 0);
  const users = Math.max(0, ...done.map((h) => h.users));
  console.log(`${day}: ${done.length} hours synced, ${hours.length - done.length} skipped, ${events} active events, max ${users} users/hour`);
}
