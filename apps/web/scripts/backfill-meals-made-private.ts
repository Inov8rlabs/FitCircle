/**
 * One-off backfill (docs/ENGAGEMENT_115_SPEC.md §4.6): users who used the bulk "Make all past
 * meals private" between Nov 4 (ee9722c) and the 1.1.5 release get
 * preferences.privacy.meals_made_private_at, so the 1.1.5 success sheet starts every circle
 * toggle OFF for them (share-targets reason `made_private`).
 *
 * Source: Amplitude `Meal Privacy Changed {surface: settings_bulk}` (Export API, hour by hour, UTC).
 * Writes only when the key is absent. DRY RUN by default; --apply writes.
 *
 *   bun scripts/backfill-meals-made-private.ts --env .env.local [--from 2026-11-04] [--to YYYY-MM-DD] [--apply]
 *
 * Needs prod SUPABASE_* and AMPLITUDE_SECRET_KEY (AMPLITUDE_API_KEY optional) in --env.
 * Never prints secrets; prints user ids and the event time only.
 * Run once before enabling meal_share_prompt in prod.
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
const from = arg('--from') ?? '2026-11-04';
const to = arg('--to') ?? new Date().toISOString().slice(0, 10);
if (!DAY.test(from) || !DAY.test(to) || from > to) {
  console.error('Usage: bun scripts/backfill-meals-made-private.ts --env <.env.local> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--apply]');
  process.exit(2);
}
const apply = args.includes('--apply');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const { fetchAmplitudeExportHour } = await import('../app/lib/activity/amplitude-export');
const { FoodEntryPrivacyService } = await import('../app/lib/services/food-entry-privacy-service');

/** First bulk make-private per user (event time, ISO). */
const firstBulk = new Map<string, string>();
const pad = (n: number) => String(n).padStart(2, '0');
const lastHour = Math.min(Date.parse(`${to}T23:00:00Z`), Date.now() - 3 * 3_600_000); // export lags ~2 h
for (let t = Date.parse(`${from}T00:00:00Z`); t <= lastHour; t += 3_600_000) {
  const d = new Date(t);
  const hour = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`;
  const { events } = await fetchAmplitudeExportHour(hour);
  for (const e of events) {
    if (e.event_type !== 'Meal Privacy Changed') continue;
    const props = (e.event_properties ?? {}) as Record<string, unknown>;
    if (props.surface !== 'settings_bulk') continue;
    const userId = typeof e.user_id === 'string' ? e.user_id.toLowerCase() : '';
    if (!UUID.test(userId)) continue;
    const at = typeof e.event_time === 'string' ? new Date(`${e.event_time.replace(' ', 'T')}Z`).toISOString() : new Date(t).toISOString();
    if (!firstBulk.has(userId) || at < (firstBulk.get(userId) as string)) firstBulk.set(userId, at);
  }
}

console.log(`${firstBulk.size} user(s) used "Make all past meals private" between ${from} and ${to}.`);
let written = 0;
let skipped = 0;
for (const [userId, at] of firstBulk) {
  if (!apply) {
    console.log(`  would set meals_made_private_at=${at} for ${userId} (if absent)`);
    continue;
  }
  const changed = await FoodEntryPrivacyService.markMealsMadePrivate(userId, { at, onlyIfAbsent: true });
  if (changed) written++;
  else skipped++;
  console.log(`  ${changed ? 'set' : 'kept existing'} ${userId}`);
}
console.log(apply ? `Done: ${written} written, ${skipped} already set.` : 'Dry run: nothing written. Re-run with --apply.');
