'use client';

/**
 * Shared in-memory asset cache for the tool: the library page, pickers and the
 * composer preview all read from it, so a freshly uploaded image shows up in
 * the preview immediately.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

import type { EngageAsset } from '../types';

import { engageAdmin } from './admin-client';

const assets = new Map<string, EngageAsset>();
const listeners = new Set<() => void>();
let version = 0;
let loaded: Promise<void> | null = null;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export const assetStore = {
  get: (id: string | null | undefined) => (id ? assets.get(id) : undefined),
  all: () => Array.from(assets.values()),
  put: (...list: EngageAsset[]) => {
    for (const a of list) if (a?.id) assets.set(a.id, a);
    emit();
  },
  remove: (id: string) => {
    assets.delete(id);
    emit();
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Loads the library once (first pages). */
  ensureLoaded: (): Promise<void> => {
    loaded ??= (async () => {
      let cursor: string | null | undefined;
      for (let page = 0; page < 5; page++) {
        const r = await engageAdmin.listAssets(cursor ? { cursor } : {});
        assetStore.put(...r.assets);
        cursor = r.nextCursor;
        if (!cursor) break;
      }
    })().catch((e) => {
      loaded = null;
      throw e;
    });
    return loaded;
  },
};

/** Re-renders when the cache changes; returns a version number. */
export function useAssetStoreVersion(): number {
  return useSyncExternalStore(assetStore.subscribe, () => version, () => 0);
}

export function useAssetLibrary(): { assets: EngageAsset[]; loading: boolean; error: string | null; reload: () => void } {
  useAssetStoreVersion();
  const [loading, setLoading] = useState(assets.size === 0);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    if (nonce > 0) loaded = null;
    assetStore
      .ensureLoaded()
      .then(() => alive && setError(null))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Could not load assets'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [nonce]);
  return {
    assets: assetStore.all().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    loading,
    error,
    reload: () => setNonce((n) => n + 1),
  };
}
