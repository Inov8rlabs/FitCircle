/**
 * Pure release logic (docs/RELEASES_TRACKER_SPEC.md §4): store state → normalized
 * status, version ordering, release keys, and the "did the status change?"
 * plan the sync applies. No I/O here; everything is unit-tested.
 */
import { LIVE_STATUSES, type ReleasePlatform, type ReleaseStatus } from './types';

// --- store state mapping ------------------------------------------------------

/** App Store Connect appVersionState (or legacy appStoreState) → status. */
export function ascVersionStatus(state: string | null | undefined): ReleaseStatus {
  switch ((state ?? '').toUpperCase()) {
    case 'READY_FOR_DISTRIBUTION':
    case 'READY_FOR_SALE':
      return 'live';
    case 'ACCEPTED':
    case 'PENDING_APPLE_RELEASE':
    case 'PENDING_DEVELOPER_RELEASE':
    case 'PROCESSING_FOR_DISTRIBUTION':
      return 'pending_release';
    case 'IN_REVIEW':
      return 'in_review';
    case 'WAITING_FOR_REVIEW':
      return 'waiting_for_review';
    case 'REJECTED':
    case 'METADATA_REJECTED':
    case 'INVALID_BINARY':
      return 'rejected';
    case 'DEVELOPER_REJECTED':
      return 'developer_rejected';
    case 'REPLACED_WITH_NEW_VERSION':
      return 'superseded';
    case 'REMOVED_FROM_SALE':
    case 'DEVELOPER_REMOVED_FROM_SALE':
      return 'removed';
    default:
      // PREPARE_FOR_SUBMISSION, READY_FOR_REVIEW, WAITING_FOR_EXPORT_COMPLIANCE, unknown
      return 'draft';
  }
}

/** Apple's phased release schedule: share of users by day 1…7. */
export const PHASED_RELEASE_SCHEDULE = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1] as const;

export function phasedFraction(day: number | null | undefined): number | null {
  if (!day || !Number.isFinite(day) || day < 1) return null;
  return PHASED_RELEASE_SCHEDULE[Math.min(day, PHASED_RELEASE_SCHEDULE.length) - 1];
}

/** TestFlight build → status. */
export function testflightStatus(b: { processingState?: string | null; expired?: boolean | null; internalBuildState?: string | null; externalBuildState?: string | null }): ReleaseStatus {
  const p = (b.processingState ?? '').toUpperCase();
  if (p === 'PROCESSING') return 'processing';
  if (p === 'FAILED' || p === 'INVALID') return 'removed';
  if (b.expired) return 'expired';
  const states = [b.internalBuildState, b.externalBuildState].map((s) => (s ?? '').toUpperCase());
  if (states.some((s) => s === 'EXPIRED')) return 'expired';
  if (states.some((s) => s === 'PROCESSING' || s === 'PROCESSING_EXCEPTION')) return 'processing';
  return 'in_testing';
}

/** Google Play track release status → status. */
export function playStatus(status: string | null | undefined, track: string): ReleaseStatus {
  const s = (status ?? '').toLowerCase();
  const production = track === 'production';
  if (s === 'completed') return production ? 'live' : 'in_testing';
  if (s === 'inprogress') return production ? 'rolling_out' : 'in_testing';
  if (s === 'halted') return 'halted';
  return 'draft';
}

/** Play track id → our track name. */
export function playTrackName(track: string): string {
  const t = track.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `play_${t || 'unknown'}`;
}

/** Play release name ("16 (1.0.5)" / "1.0.5" / custom) → version string. */
export function playVersionFromName(name: string | null | undefined, fallback: string): string {
  const n = (name ?? '').trim();
  const paren = n.match(/\((\d+(?:\.\d+)+[^)]*)\)/);
  if (paren) return paren[1].trim();
  const bare = n.match(/^v?(\d+(?:\.\d+)+)/);
  if (bare) return bare[1];
  return n || fallback;
}

// --- ordering + keys ------------------------------------------------------------

const segs = (v: string | null | undefined) => (v ?? '').split(/[^0-9]+/).filter(Boolean).map(Number);

/** Semver-ish compare of dotted numeric versions ("1.0" == "1.0.0"). */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const x = segs(a);
  const y = segs(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Version first, then numeric build. */
export function compareReleases(a: { version: string; build: string | null }, b: { version: string; build: string | null }): number {
  const v = compareVersions(a.version, b.version);
  if (v) return v;
  const ba = Number(a.build);
  const bb = Number(b.build);
  if (Number.isFinite(ba) && Number.isFinite(bb) && ba !== bb) return ba < bb ? -1 : 1;
  return 0;
}

/**
 * Stable identity: 'ios:app_store:1.0.9', 'ios:testflight:1.1.0(72)',
 * 'android:play_production:36', 'backend:production:517d8e1'.
 */
export function releaseKey(r: { platform: ReleasePlatform; track: string; version: string; build?: string | null }): string {
  let id: string;
  if (r.platform === 'ios') id = r.track === 'app_store' || !r.build ? r.version : `${r.version}(${r.build})`;
  else id = r.build || r.version;
  return `${r.platform}:${r.track}:${id}`;
}

/** Best date to sort a release on a timeline. */
export function releaseSortAt(r: { releasedAt?: string | null; submittedAt?: string | null; uploadedAt?: string | null; storeCreatedAt?: string | null; createdAt?: string | null }): string {
  return r.releasedAt ?? r.submittedAt ?? r.uploadedAt ?? r.storeCreatedAt ?? r.createdAt ?? '';
}

// --- sync plan ------------------------------------------------------------------

/** What a store connector reports for one release. */
export interface ObservedRelease {
  releaseKey: string;
  platform: ReleasePlatform;
  track: string;
  version: string;
  build: string | null;
  status: ReleaseStatus;
  storeStatus: string | null;
  releaseType?: 'manual' | 'auto' | 'scheduled' | null;
  rolloutFraction?: number | null;
  countries?: string[] | null;
  whatsNew?: string | null;
  sourceId?: string | null;
  storeCreatedAt?: string | null;
  uploadedAt?: string | null;
  submittedAt?: string | null;
  /** When the store says the current status began (else: observed now). */
  statusAt?: string | null;
  raw?: unknown;
}

/** The subset of a stored row the plan needs. */
export interface ExistingRelease {
  id: string;
  release_key: string;
  status: ReleaseStatus;
  store_created_at: string | null;
  uploaded_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  released_at: string | null;
  superseded_at: string | null;
  whats_new: string | null;
}

export interface PlannedEvent {
  from_status: ReleaseStatus | null;
  to_status: ReleaseStatus;
  store_status: string | null;
  occurred_at: string;
  note: string | null;
}

export interface ReleasePlan {
  /** Store-owned columns only: never internal_notes / commits / migrations / links. */
  row: Record<string, unknown>;
  event: PlannedEvent | null;
}

const APPROVED: readonly ReleaseStatus[] = ['pending_release', 'rolling_out', 'live'];

/**
 * Merge one observation into the stored row. A status event is planned only
 * when the status differs (or the row is new). Milestone timestamps are kept
 * once set; on a status change they are stamped with the change time — but a
 * row seen for the first time does not get invented approved/released dates
 * (the sync can't know them; backfill/admin fill them in).
 */
export function planRelease(existing: ExistingRelease | null, o: ObservedRelease, source: 'app_store_connect' | 'google_play', nowIso: string): ReleasePlan {
  const changed = !existing || existing.status !== o.status;
  const at = o.statusAt ?? nowIso;
  const stamp = (current: string | null | undefined, applies: boolean) => current ?? (existing && changed && applies ? at : null);
  const row: Record<string, unknown> = {
    release_key: o.releaseKey,
    platform: o.platform,
    track: o.track,
    version: o.version,
    build: o.build,
    status: o.status,
    store_status: o.storeStatus,
    release_type: o.releaseType ?? null,
    rollout_fraction: o.rolloutFraction ?? null,
    countries: o.countries ?? null,
    // Keep stored notes when the store returns none (e.g. localization call failed).
    whats_new: o.whatsNew ?? existing?.whats_new ?? null,
    source,
    source_id: o.sourceId ?? null,
    store_created_at: o.storeCreatedAt ?? existing?.store_created_at ?? null,
    uploaded_at: o.uploadedAt ?? existing?.uploaded_at ?? null,
    submitted_at: o.submittedAt ?? existing?.submitted_at ?? null,
    approved_at: stamp(existing?.approved_at, APPROVED.includes(o.status)),
    released_at: stamp(existing?.released_at, (LIVE_STATUSES as readonly string[]).includes(o.status)),
    superseded_at: stamp(existing?.superseded_at, o.status === 'superseded'),
    raw: o.raw ?? null,
    synced_at: nowIso,
    updated_at: nowIso,
  };
  const event: PlannedEvent | null = changed
    ? {
        from_status: existing?.status ?? null,
        to_status: o.status,
        store_status: o.storeStatus,
        occurred_at: at,
        note: existing ? null : 'first seen by sync',
      }
    : null;
  return { row, event };
}

/**
 * Of several App Store versions that all report READY_FOR_SALE, only the
 * highest is actually live — Apple keeps the old ones in that state.
 */
export function supersedeOlderLive<T extends { version: string; build: string | null; status: ReleaseStatus }>(list: T[]): T[] {
  const live = list.filter((r) => r.status === 'live');
  if (live.length < 2) return list;
  const newest = live.reduce((a, b) => (compareReleases(a, b) >= 0 ? a : b));
  return list.map((r) => (r.status === 'live' && r !== newest ? { ...r, status: 'superseded' as const } : r));
}
