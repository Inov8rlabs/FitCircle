import type { SyncSource } from '../types';

import { AppStoreReleasesConnector } from './app-store';
import { GooglePlayReleasesConnector } from './google-play';
import type { ReleaseConnector } from './types';

let override: Partial<Record<SyncSource, ReleaseConnector>> | null = null;

/** Tests: replace connectors (pass null to restore). */
export function setReleaseConnectorsForTest(map: Partial<Record<SyncSource, ReleaseConnector>> | null) {
  override = map;
}

export function getReleaseConnector(source: SyncSource): ReleaseConnector | null {
  if (override) return override[source] ?? null;
  if (source === 'app_store_connect') return new AppStoreReleasesConnector();
  if (source === 'google_play') return new GooglePlayReleasesConnector();
  return null;
}

export const SYNC_SOURCES: SyncSource[] = ['app_store_connect', 'google_play'];

export type { ReleaseConnector, StoreSnapshot } from './types';
