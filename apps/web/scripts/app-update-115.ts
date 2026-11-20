/**
 * Release 1.1.5 soft update prompt for older apps (docs/ENGAGEMENT_115_SPEC.md §13.6):
 * "Update to get free daily scans", soft and dismissible (status `recommended`, never `required`),
 * through the existing app-update system (feature_flags row `app_update_policy`, migration 121,
 * GET /api/mobile/app-update).
 *
 * PREPARED, NOT ENABLED: run it only once 1.1.5 is live in the store for that platform.
 * DRY RUN by default: prints the current and the planned policy. --apply writes it.
 *
 *   bun scripts/app-update-115.ts --env .env.local [--platform ios|android|both] [--apply]
 *
 * Keeps every other key of the stored policy (min_supported_version is never touched) and only
 * raises latest / recommended to 1.1.5 (never lowers them). Needs prod SUPABASE_* in --env.
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
const platformArg = (arg('--platform') ?? 'both').toLowerCase();
if (!['ios', 'android', 'both'].includes(platformArg)) {
  console.error('Usage: bun scripts/app-update-115.ts --env <.env.local> [--platform ios|android|both] [--apply]');
  process.exit(2);
}
const platforms = platformArg === 'both' ? (['ios', 'android'] as const) : ([platformArg] as const);
const apply = args.includes('--apply');

const TARGET = '1.1.5';
/** Every line is true for 1.1.5 with the deploy-time remote config (§2.2, §3.2). No invented numbers. */
export const RELEASE_NOTES_115 = {
  title: 'Update to get free daily scans',
  subtitle: 'The new FitCircle keeps you logging after your starter scans.',
  highlights: [
    { icon: 'camera', title: 'Free AI scans every day', body: 'After your starter scans, you get free scans every day.' },
    { icon: 'chat', title: 'Free Fitzy messages every week', body: 'Ask Fitzy a few questions each week for free.' },
    { icon: 'community', title: 'Share meals with your circles', body: 'Pick which circles see a meal, in one tap.' },
    { icon: 'shield', title: 'Save a missed streak', body: 'Missed a day? You can still keep your streak.' },
  ],
};

const { createAdminSupabase } = await import('../app/lib/supabase-admin');
const { APP_UPDATE_FLAG, compareVersions, parseVersion } = await import('../app/lib/services/app-update-service');

const db = createAdminSupabase();
const { data: row, error } = await db.from('feature_flags').select('name, is_enabled, metadata').eq('name', APP_UPDATE_FLAG).maybeSingle();
if (error) {
  console.error('feature_flags read failed:', error.message);
  process.exit(1);
}
const current = (row?.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, any>;
const raise = (v: unknown) => {
  const cur = parseVersion(typeof v === 'string' ? v : null);
  const target = parseVersion(TARGET)!;
  return cur && compareVersions(cur, target) >= 0 ? (v as string) : TARGET;
};
const next: Record<string, any> = { ...current };
for (const p of platforms) {
  const prev = (current[p] && typeof current[p] === 'object' ? current[p] : {}) as Record<string, any>;
  next[p] = {
    ...prev,
    enabled: true,
    latest_version: raise(prev.latest_version),
    recommended_version: raise(prev.recommended_version),
    release_notes: RELEASE_NOTES_115,
  };
}

console.log(`feature_flags.${APP_UPDATE_FLAG}: is_enabled=${row?.is_enabled ?? '(no row)'}`);
console.log('current metadata:', JSON.stringify(current, null, 2));
console.log('planned metadata:', JSON.stringify(next, null, 2));
if (!apply) {
  console.log('Dry run: nothing written. Re-run with --apply once 1.1.5 is live in the store.');
  process.exit(0);
}
const write = row
  ? db.from('feature_flags').update({ metadata: next, is_enabled: true }).eq('name', APP_UPDATE_FLAG)
  : db.from('feature_flags').insert({ name: APP_UPDATE_FLAG, is_enabled: true, metadata: next });
const { error: writeError } = await write;
if (writeError) {
  console.error('feature_flags write failed:', writeError.message);
  process.exit(1);
}
console.log('Applied. Old builds now get status "recommended" (soft, dismissible). Clients cache for a short while.');
