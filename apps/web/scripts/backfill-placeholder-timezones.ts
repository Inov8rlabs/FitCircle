/**
 * Backfill profiles.timezone for profiles still on a placeholder ('UTC' / empty)
 * from data the device already sent (docs/PUSH_NOTIFICATIONS.md §8.7;
 * lib/notifications/timezone-inference.ts).
 *
 *   bun scripts/backfill-placeholder-timezones.ts [--env path/to/.env.local] [--apply] [--include-inferred]
 *
 * DRY RUN by default: prints counts and one line per profile (id prefix, source,
 * zone), writes nothing. --apply writes the EXACT inferences (streak claim / app
 * open zone). --include-inferred also writes offset-inferred zones (ambiguous
 * across countries; the app corrects them on the next home-feed load).
 * Idempotent: each write is conditional on the profile still being a
 * placeholder, so a re-run (or a concurrent live backfill) never overwrites a
 * real zone. Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { inferTimezone, type TimezoneEvidence } from '../app/lib/notifications/timezone-inference';
import { isPlaceholderTimezone } from '../app/lib/notifications/user-timezone';

const PLACEHOLDERS = ['UTC', 'Etc/UTC', 'GMT', 'Etc/GMT', 'Z', 'Universal', 'Etc/Universal', 'Zulu', ''];

function loadEnv(path: string | undefined) {
  if (!path) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const envIdx = args.indexOf('--env');
  loadEnv(envIdx >= 0 ? args[envIdx + 1] : undefined);
  const apply = args.includes('--apply');
  const includeInferred = args.includes('--include-inferred');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or --env <file>).');
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: all, error } = await db.from('profiles').select('id, timezone').limit(100_000);
  if (error) throw error;
  const rows = (all ?? []) as Array<{ id: string; timezone: string | null }>;
  const targets = rows.filter((p) => isPlaceholderTimezone(p.timezone));
  // Candidate zones for offset inference: the zones real profiles already have, most common first.
  const counts = new Map<string, number>();
  for (const p of rows) if (!isPlaceholderTimezone(p.timezone)) counts.set(p.timezone!, (counts.get(p.timezone!) ?? 0) + 1);
  const candidates = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tz]) => tz);

  const ids = targets.map((t) => t.id);
  const evidence = new Map<string, TimezoneEvidence>(ids.map((id) => [id, { claimTimezones: [], opens: [] }]));
  for (let i = 0; i < ids.length; i += 150) {
    const part = ids.slice(i, i + 150);
    const [claims, opens] = await Promise.all([
      db.from('streak_claims').select('user_id, timezone, claimed_at').in('user_id', part).limit(10_000),
      db.from('app_opens').select('user_id, local_date, first_open_at, timezone').in('user_id', part).limit(10_000),
    ]);
    if (claims.error) throw claims.error;
    for (const c of (claims.data ?? []) as any[]) evidence.get(c.user_id)!.claimTimezones.push({ timezone: c.timezone, at: c.claimed_at });
    if (!opens.error) for (const o of (opens.data ?? []) as any[]) evidence.get(o.user_id)!.opens.push(o);
    else console.warn('app_opens unreadable (migration 133?):', opens.error.message);
  }

  const tally = { placeholder: targets.length, exact: 0, inferred: 0, unresolved: 0, written: 0 };
  for (const t of targets) {
    const inf = inferTimezone(evidence.get(t.id)!, candidates);
    if (!inf) {
      tally.unresolved++;
      continue;
    }
    if (inf.exact) tally.exact++;
    else tally.inferred++;
    console.log(`${t.id.slice(0, 8)}  ${inf.source.padEnd(12)} ${inf.timezone}${inf.exact ? '' : ' (inferred)'}`);
    if (!apply || (!inf.exact && !includeInferred)) continue;
    const { data: upd, error: upErr } = await db
      .from('profiles')
      .update({ timezone: inf.timezone })
      .eq('id', t.id)
      .or(`timezone.is.null,timezone.in.(${PLACEHOLDERS.filter(Boolean).join(',')}),timezone.eq.`)
      .select('id');
    if (upErr) console.warn(`  write failed for ${t.id.slice(0, 8)}: ${upErr.message}`);
    else if ((upd ?? []).length) tally.written++;
  }
  console.log(JSON.stringify({ mode: apply ? (includeInferred ? 'apply+inferred' : 'apply') : 'dry-run', ...tally }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
