/**
 * Backend self-registration (docs/RELEASES_TRACKER_SPEC.md §3.3): the running
 * production deployment makes sure there is a `backend:production:<short sha>`
 * row for itself, from Vercel's system env vars (VERCEL_ENV, VERCEL_GIT_COMMIT_*,
 * VERCEL_DEPLOYMENT_ID; "Automatically expose System Environment Variables" must
 * be on). Runs from the hourly releases cron, admin "Sync now" and once per
 * instance on the first admin releases list. Not from instrumentation/cold
 * start: Vercel sets the same env during `next build`, which would register a
 * deploy that may still fail.
 *
 * - New SHA: insert a `live` row (source 'git', version = UTC deploy date like the
 *   manual rows, released_at = first time this SHA is seen), a status event, and
 *   supersede the previous live backend row.
 * - Known SHA (e.g. added by hand before the deploy finished): only fill an empty
 *   `commits` / missing `links.commit`. Status, dates and notes are left alone.
 *   A rollback to an older SHA is not re-marked live automatically.
 * - Never touches internal_notes / known_issues. Idempotent; concurrent instances
 *   race on the release_key unique constraint and the loser does nothing.
 */
import { db } from '@/lib/ads/services/db';

import { planFill, releaseKey } from '../status';
import type { ReleaseCommit, ReleaseStatus } from '../types';

import { applyFill } from './sync-service';

export const BACKEND_REPO = 'FitCircleBE';
export const BACKEND_GITHUB = 'https://github.com/Inov8rlabs/FitCircleBE';

export interface RunningDeployment {
  sha: string;
  shortSha: string;
  subject: string;
  ref: string | null;
  deploymentId: string | null;
}

/** The production deployment this process belongs to, or null (preview, local, no git metadata). */
export function runningDeploymentFromEnv(env: NodeJS.ProcessEnv = process.env): RunningDeployment | null {
  if (env.VERCEL_ENV !== 'production') return null;
  const sha = (env.VERCEL_GIT_COMMIT_SHA ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) return null;
  const subject = (env.VERCEL_GIT_COMMIT_MESSAGE ?? '').split('\n')[0].trim().slice(0, 500);
  return { sha, shortSha: sha.slice(0, 7), subject, ref: env.VERCEL_GIT_COMMIT_REF?.trim() || null, deploymentId: env.VERCEL_DEPLOYMENT_ID?.trim() || null };
}

export type BackendRegistration = { status: 'skipped' | 'created' | 'exists' | 'filled'; releaseKey: string | null; superseded: number };

const CURRENT: ReleaseStatus[] = ['live', 'rolling_out'];

export async function ensureRunningBackendRelease(opts: { env?: NodeJS.ProcessEnv; now?: Date } = {}): Promise<BackendRegistration> {
  const d = runningDeploymentFromEnv(opts.env);
  if (!d) return { status: 'skipped', releaseKey: null, superseded: 0 };
  const supabase = db();
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const key = releaseKey({ platform: 'backend', track: 'production', version: '', build: d.shortSha });
  const commit: ReleaseCommit = { sha: d.sha, subject: d.subject, repo: BACKEND_REPO, date: nowIso.slice(0, 10) };
  const links = { commit: `${BACKEND_GITHUB}/commit/${d.sha}` };

  const { data: found, error: readErr } = await supabase.from('releases').select('id, commits, links').eq('release_key', key).maybeSingle();
  if (readErr) throw new Error(`releases read: ${readErr.message}`);
  if (found) {
    const fill = planFill(found, { commits: [commit], links });
    if (!fill) return { status: 'exists', releaseKey: key, superseded: 0 };
    await applyFill(found.id, fill, found.links, nowIso);
    return { status: 'filled', releaseKey: key, superseded: 0 };
  }

  const row = {
    release_key: key,
    platform: 'backend',
    track: 'production',
    version: nowIso.slice(0, 10),
    build: d.shortSha,
    status: 'live',
    store_status: d.ref,
    commits: [commit],
    migrations: [],
    links,
    source: 'git',
    source_id: d.deploymentId,
    released_at: nowIso,
    raw: { vercelDeploymentId: d.deploymentId, gitRef: d.ref, sha: d.sha },
    synced_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
  };
  const { data: inserted, error: insErr } = await supabase.from('releases').insert(row).select('id').single();
  if (insErr) {
    // Another instance registered it first.
    if (insErr.code === '23505' || /duplicate key/i.test(insErr.message ?? '')) return { status: 'exists', releaseKey: key, superseded: 0 };
    throw new Error(`releases insert: ${insErr.message}`);
  }
  const events: Array<Record<string, unknown>> = [
    { release_id: inserted.id, from_status: null, to_status: 'live', store_status: d.ref, occurred_at: nowIso, source: 'sync', actor: null, note: `deployment ${d.deploymentId ?? 'unknown'} first seen running` },
  ];

  const { data: others, error: othersErr } = await supabase.from('releases').select('id, status').eq('platform', 'backend').eq('track', 'production').in('status', CURRENT);
  if (othersErr) throw new Error(`releases read live: ${othersErr.message}`);
  let superseded = 0;
  for (const o of (others ?? []) as Array<{ id: string; status: ReleaseStatus }>) {
    if (o.id === inserted.id) continue;
    const { error } = await supabase.from('releases').update({ status: 'superseded', superseded_at: nowIso, updated_at: nowIso }).eq('id', o.id).in('status', CURRENT);
    if (error) throw new Error(`releases supersede: ${error.message}`);
    superseded++;
    events.push({ release_id: o.id, from_status: o.status, to_status: 'superseded', store_status: null, occurred_at: nowIso, source: 'sync', actor: null, note: `replaced by ${d.shortSha}` });
  }
  const { error: evErr } = await supabase.from('release_events').upsert(events, { onConflict: 'release_id,to_status,occurred_at', ignoreDuplicates: true });
  if (evErr) throw new Error(`release_events insert: ${evErr.message}`);
  return { status: 'created', releaseKey: key, superseded };
}

let once: Promise<BackendRegistration> | null = null;

/** At most one registration per server instance (admin list path). Errors are logged, never thrown. */
export function ensureRunningBackendReleaseOnce(): Promise<BackendRegistration | null> {
  once ??= ensureRunningBackendRelease().catch((e) => {
    once = null;
    console.warn('[releases/backend] self-registration failed:', (e as Error)?.message);
    return { status: 'skipped', releaseKey: null, superseded: 0 } as BackendRegistration;
  });
  return once;
}

/** Tests: forget the per-instance memo. */
export function resetBackendRegistrationForTest() {
  once = null;
}
