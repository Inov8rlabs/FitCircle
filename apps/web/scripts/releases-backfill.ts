/**
 * One-off / re-runnable releases backfill (docs/RELEASES_TRACKER_SPEC.md §8).
 *
 *   bun scripts/releases-backfill.ts <backfill.json> [--env path/to/.env.local] [--dry-run]
 *
 * Input: { releases: BackfillRelease[] } (see type below). Writes ONLY to
 * public.releases and public.release_events with the service role:
 *  - new release_key → insert the row (source 'backfill') + its events;
 *  - existing row    → fill admin-owned fields that are empty (internal notes,
 *    known issues, commits, migrations, links, whatsNew) and milestone dates
 *    that are null; status is left to the store sync / admin;
 *  - events are upserted on (release_id, to_status, occurred_at), so a re-run
 *    adds nothing.
 */
import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { releaseKey } from '../app/lib/releases/status';
import { RELEASE_PLATFORMS, RELEASE_STATUSES, type ReleaseCommit, type ReleasePlatform, type ReleaseStatus } from '../app/lib/releases/types';

interface BackfillRelease {
  releaseKey?: string;
  platform: ReleasePlatform;
  track: string;
  version: string;
  build: string | null;
  status: ReleaseStatus;
  storeStatus?: string | null;
  releaseType?: 'manual' | 'auto' | 'scheduled' | null;
  rolloutFraction?: number | null;
  countries?: string[] | null;
  whatsNew?: string | null;
  internalNotes?: string | null;
  knownIssues?: string | null;
  commits?: ReleaseCommit[];
  migrations?: string[];
  links?: Record<string, string>;
  uploadedAt?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  releasedAt?: string | null;
  supersededAt?: string | null;
  events?: Array<{ toStatus: ReleaseStatus; occurredAt: string; note?: string | null }>;
}

function loadEnv(path: string) {
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null);
const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

function validate(r: BackfillRelease) {
  if (!(RELEASE_PLATFORMS as readonly string[]).includes(r.platform)) throw new Error(`bad platform ${r.platform}`);
  if (!(RELEASE_STATUSES as readonly string[]).includes(r.status)) throw new Error(`bad status ${r.status}`);
  for (const e of r.events ?? []) {
    if (!(RELEASE_STATUSES as readonly string[]).includes(e.toStatus)) throw new Error(`bad event status ${e.toStatus}`);
    if (!Number.isFinite(Date.parse(e.occurredAt))) throw new Error(`bad event date ${e.occurredAt}`);
  }
  const key = releaseKey(r);
  if (r.releaseKey && r.releaseKey !== key) throw new Error(`releaseKey ${r.releaseKey} != computed ${key}`);
  return key;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const envIdx = args.indexOf('--env');
  const dryRun = args.includes('--dry-run');
  if (!file) throw new Error('usage: bun scripts/releases-backfill.ts <backfill.json> [--env .env.local] [--dry-run]');
  if (envIdx >= 0) loadEnv(args[envIdx + 1]);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const input = JSON.parse(readFileSync(file, 'utf8')) as { releases: BackfillRelease[] };
  const now = new Date().toISOString();
  const counts = { inserted: 0, filled: 0, events: 0 };

  for (const r of input.releases) {
    const rk = validate(r);
    const { data: existing, error } = await supabase.from('releases').select('*').eq('release_key', rk).maybeSingle();
    if (error) throw new Error(error.message);
    let id: string;
    if (!existing) {
      const row = {
        release_key: rk,
        platform: r.platform,
        track: r.track,
        version: r.version,
        build: r.build,
        status: r.status,
        store_status: r.storeStatus ?? null,
        release_type: r.releaseType ?? null,
        rollout_fraction: r.rolloutFraction ?? null,
        countries: r.countries ?? null,
        whats_new: r.whatsNew ?? null,
        internal_notes: r.internalNotes ?? null,
        known_issues: r.knownIssues ?? null,
        commits: r.commits ?? [],
        migrations: r.migrations ?? [],
        links: r.links ?? {},
        source: r.platform === 'backend' || r.platform === 'web' ? 'git' : 'backfill',
        uploaded_at: iso(r.uploadedAt),
        submitted_at: iso(r.submittedAt),
        approved_at: iso(r.approvedAt),
        released_at: iso(r.releasedAt),
        superseded_at: iso(r.supersededAt),
        notes_updated_by: r.internalNotes ? 'backfill' : null,
        notes_updated_at: r.internalNotes ? now : null,
        created_at: now,
        updated_at: now,
      };
      if (dryRun) {
        console.log('insert', rk);
        continue;
      }
      const { data, error: insErr } = await supabase.from('releases').insert(row).select('id').single();
      if (insErr || !data) throw new Error(`${rk}: ${insErr?.message}`);
      id = data.id;
      counts.inserted++;
    } else {
      id = existing.id;
      const fill: Record<string, unknown> = {};
      const want: Record<string, unknown> = {
        internal_notes: r.internalNotes,
        known_issues: r.knownIssues,
        commits: r.commits,
        migrations: r.migrations,
        links: r.links,
        whats_new: r.whatsNew,
        release_type: r.releaseType,
        countries: r.countries,
        uploaded_at: iso(r.uploadedAt),
        submitted_at: iso(r.submittedAt),
        approved_at: iso(r.approvedAt),
        released_at: iso(r.releasedAt),
        superseded_at: iso(r.supersededAt),
      };
      for (const [col, v] of Object.entries(want)) if (!empty(v) && empty(existing[col])) fill[col] = v;
      if (fill.internal_notes) Object.assign(fill, { notes_updated_by: 'backfill', notes_updated_at: now });
      if (Object.keys(fill).length) {
        if (dryRun) console.log('fill', rk, Object.keys(fill).join(','));
        else {
          const { error: upErr } = await supabase.from('releases').update({ ...fill, updated_at: now }).eq('id', id);
          if (upErr) throw new Error(`${rk}: ${upErr.message}`);
          counts.filled++;
        }
      }
    }
    const events = [...(r.events ?? [])].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    if (!events.length || dryRun) continue;
    const rows = events.map((e, i) => ({
      release_id: id,
      from_status: i > 0 ? events[i - 1].toStatus : null,
      to_status: e.toStatus,
      occurred_at: iso(e.occurredAt),
      source: 'backfill',
      actor: 'backfill',
      note: e.note ?? null,
    }));
    const { error: evErr, count } = await supabase.from('release_events').upsert(rows, { onConflict: 'release_id,to_status,occurred_at', ignoreDuplicates: true, count: 'exact' });
    if (evErr) throw new Error(`${rk} events: ${evErr.message}`);
    counts.events += count ?? 0;
  }
  console.log(JSON.stringify({ input: input.releases.length, ...counts, dryRun }));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
