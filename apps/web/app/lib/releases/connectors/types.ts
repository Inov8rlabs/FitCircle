import type { ObservedRelease } from '../status';
import type { SyncSource } from '../types';

export interface StoreSnapshot {
  releases: ObservedRelease[];
  /**
   * `platform:track` pairs the store listed completely (Google Play tracks):
   * a stored live / in-testing row of such a track that is no longer listed has
   * been replaced and is marked superseded.
   */
  completeTracks: string[];
}

/** One store, read-only (docs/RELEASES_TRACKER_SPEC.md §5). */
export interface ReleaseConnector {
  source: SyncSource;
  isConfigured(): boolean;
  fetchSnapshot(): Promise<StoreSnapshot>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
