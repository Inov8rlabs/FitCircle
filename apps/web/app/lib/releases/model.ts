/** DB row ↔ API shape for releases / release_events. */
import { compareReleases, releaseSortAt } from './status';
import {
  isStoreTrack,
  LIVE_STATUSES,
  REVIEW_STATUSES,
  type LiveNow,
  type Release,
  type ReleaseCommit,
  type ReleaseEvent,
  type ReleasePlatform,
} from './types';

type Row = Record<string, any>;

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function rowToRelease(r: Row): Release {
  return {
    id: r.id,
    releaseKey: r.release_key,
    platform: r.platform,
    track: r.track,
    version: r.version,
    build: r.build ?? null,
    status: r.status,
    storeStatus: r.store_status ?? null,
    releaseType: r.release_type ?? null,
    rolloutFraction: num(r.rollout_fraction),
    countries: r.countries ?? null,
    whatsNew: r.whats_new ?? null,
    internalNotes: r.internal_notes ?? null,
    knownIssues: r.known_issues ?? null,
    commits: Array.isArray(r.commits) ? (r.commits as ReleaseCommit[]) : [],
    migrations: Array.isArray(r.migrations) ? r.migrations : [],
    links: r.links && typeof r.links === 'object' && !Array.isArray(r.links) ? r.links : {},
    source: r.source,
    sourceId: r.source_id ?? null,
    storeCreatedAt: r.store_created_at ?? null,
    uploadedAt: r.uploaded_at ?? null,
    submittedAt: r.submitted_at ?? null,
    approvedAt: r.approved_at ?? null,
    releasedAt: r.released_at ?? null,
    supersededAt: r.superseded_at ?? null,
    syncedAt: r.synced_at ?? null,
    notesUpdatedBy: r.notes_updated_by ?? null,
    notesUpdatedAt: r.notes_updated_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function rowToEvent(r: Row): ReleaseEvent {
  return {
    id: r.id,
    releaseId: r.release_id,
    fromStatus: r.from_status ?? null,
    toStatus: r.to_status,
    storeStatus: r.store_status ?? null,
    occurredAt: r.occurred_at,
    source: r.source,
    actor: r.actor ?? null,
    note: r.note ?? null,
  };
}

/** Newest first on the timeline (ties: higher version/build first). */
export function sortTimeline(list: Release[]): Release[] {
  return [...list].sort((a, b) => {
    const ka = releaseSortAt(a);
    const kb = releaseSortAt(b);
    if (ka !== kb) return ka < kb ? 1 : -1;
    return compareReleases(b, a);
  });
}

const newest = (list: Release[]) => list.reduce<Release | null>((best, r) => (!best || compareReleases(r, best) > 0 || (compareReleases(r, best) === 0 && releaseSortAt(r) > releaseSortAt(best)) ? r : best), null);

/**
 * Per platform: the newest live store release, the newest one a store is
 * reviewing / about to release, and the newest testing build that is ahead of
 * what is live.
 */
export function computeLiveNow(all: Release[], platforms: ReleasePlatform[] = ['ios', 'android', 'backend']): LiveNow[] {
  const extra = all.some((r) => r.platform === 'web') && !platforms.includes('web') ? (['web'] as ReleasePlatform[]) : [];
  return [...platforms, ...extra].map((platform) => {
    const mine = all.filter((r) => r.platform === platform);
    const store = mine.filter((r) => isStoreTrack(r.track));
    const live = newest(store.filter((r) => LIVE_STATUSES.includes(r.status)));
    const reviewCandidate = newest(store.filter((r) => REVIEW_STATUSES.includes(r.status)));
    const inReview = reviewCandidate && (!live || compareReleases(reviewCandidate, live) > 0) ? reviewCandidate : null;
    const testing = newest(mine.filter((r) => !isStoreTrack(r.track) && r.status === 'in_testing'));
    const ahead = (r: Release | null) => !!r && (!live || compareReleases(r, live) > 0);
    return { platform, live, inReview, inTesting: ahead(testing) ? testing : null };
  });
}
