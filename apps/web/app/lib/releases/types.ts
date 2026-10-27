/**
 * Releases tracker contract (docs/RELEASES_TRACKER_SPEC.md). The admin API
 * (/api/admin/releases/*) returns these camelCase shapes inside the standard
 * `{ success, data, error, meta }` envelope.
 */

export const RELEASE_PLATFORMS = ['ios', 'android', 'backend', 'web'] as const;
export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];

export const RELEASE_STATUSES = [
  'draft',
  'processing',
  'in_testing',
  'waiting_for_review',
  'in_review',
  'pending_release',
  'rejected',
  'developer_rejected',
  'rolling_out',
  'live',
  'halted',
  'superseded',
  'expired',
  'removed',
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

/** Statuses that mean "a store is reviewing / about to ship this". */
export const REVIEW_STATUSES: readonly ReleaseStatus[] = ['waiting_for_review', 'in_review', 'pending_release'];
/** Statuses that mean "users can get this now". */
export const LIVE_STATUSES: readonly ReleaseStatus[] = ['live', 'rolling_out'];

export type ReleaseSource = 'app_store_connect' | 'google_play' | 'git' | 'manual' | 'backfill';
export type ReleaseEventSource = 'sync' | 'backfill' | 'manual';
export type SyncSource = 'app_store_connect' | 'google_play';

/** Store-facing tracks (what users get); everything else is a testing track. */
export const STORE_TRACKS = ['app_store', 'play_production', 'production'] as const;
export const isStoreTrack = (track: string) => (STORE_TRACKS as readonly string[]).includes(track);

export interface ReleaseCommit {
  sha: string;
  subject: string;
  repo?: string | null;
  date?: string | null;
}

export interface Release {
  id: string;
  releaseKey: string;
  platform: ReleasePlatform;
  track: string;
  version: string;
  build: string | null;
  status: ReleaseStatus;
  storeStatus: string | null;
  releaseType: 'manual' | 'auto' | 'scheduled' | null;
  rolloutFraction: number | null;
  countries: string[] | null;
  whatsNew: string | null;
  internalNotes: string | null;
  knownIssues: string | null;
  commits: ReleaseCommit[];
  migrations: string[];
  links: Record<string, string>;
  source: ReleaseSource;
  sourceId: string | null;
  storeCreatedAt: string | null;
  uploadedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  releasedAt: string | null;
  supersededAt: string | null;
  syncedAt: string | null;
  notesUpdatedBy: string | null;
  notesUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseEvent {
  id: string;
  releaseId: string;
  fromStatus: ReleaseStatus | null;
  toStatus: ReleaseStatus;
  storeStatus: string | null;
  occurredAt: string;
  source: ReleaseEventSource;
  actor: string | null;
  note: string | null;
}

/** Per platform: what users have, what a store is reviewing, the newest testing build. */
export interface LiveNow {
  platform: ReleasePlatform;
  live: Release | null;
  inReview: Release | null;
  inTesting: Release | null;
}

export interface ReleaseSyncStatus {
  source: SyncSource;
  configured: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  error: string | null;
}

/** GET /api/admin/releases */
export interface ReleasesList {
  releases: Release[];
  liveNow: LiveNow[];
  sync: ReleaseSyncStatus[];
}

/** GET /api/admin/releases/:id */
export interface ReleaseDetail {
  release: Release;
  events: ReleaseEvent[];
}

export interface SyncSourceResult {
  source: SyncSource;
  ok: boolean;
  skipped?: 'not_configured' | 'debounced';
  rowsReleases: number;
  rowsEvents: number;
  error: string | null;
  runId: string | null;
}
