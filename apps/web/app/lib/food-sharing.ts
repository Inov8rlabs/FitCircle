'use client';

/**
 * Food entry privacy on the web client (docs/FOOD_ENTRY_PRIVACY_SPEC.md §6.3).
 *
 * - `isEntryShared` — the one read rule: shared only if `is_private === false`
 *   AND `visibility` is circle/shared. Anything else (missing fields included)
 *   is private.
 * - The user's "Share new meals with my circles" default, cached in memory per
 *   signed-in user so every logging surface starts from the same value. While
 *   it is unknown, new meals start PRIVATE.
 */
import { useEffect, useRef, useState } from 'react';

import { nutritionClient } from '@/lib/api/nutrition-client';
import { useAuthStore } from '@/stores/auth-store';

export function isEntryShared(entry: Record<string, any> | null | undefined): boolean {
  if (!entry) return false;
  return entry.is_private === false && (entry.visibility === 'circle' || entry.visibility === 'shared');
}

/** Food entries are the only kind that can be shared (water / supplements never are). */
export function canShareEntry(entry: Record<string, any> | null | undefined): boolean {
  return entry?.entry_type === 'food';
}

// ---------------------------------------------------------------- default cache

type Listener = (value: boolean) => void;

let cacheUser: string | null = null;
let cacheValue: boolean | null = null;
let inflight: Promise<boolean> | null = null;
const listeners = new Set<Listener>();

function currentUserKey(): string {
  const state = useAuthStore.getState();
  return state.user?.id ?? state.token ?? 'anon';
}

function resetIfUserChanged() {
  const key = currentUserKey();
  if (cacheUser !== key) {
    cacheUser = key;
    cacheValue = null;
    inflight = null;
  }
}

/** The cached default for the signed-in user, or null when not loaded yet. */
export function cachedMealSharingDefault(): boolean | null {
  resetIfUserChanged();
  return cacheValue;
}

/** Store a value the server confirmed (e.g. after PUT) and notify open surfaces. */
export function setCachedMealSharingDefault(value: boolean) {
  resetIfUserChanged();
  cacheValue = value;
  inflight = null;
  listeners.forEach((l) => l(value));
}

/** Load the default once per user. Failures resolve to `false` (private) without caching. */
export function loadMealSharingDefault(): Promise<boolean> {
  resetIfUserChanged();
  if (cacheValue !== null) return Promise.resolve(cacheValue);
  if (!inflight) {
    const key = cacheUser;
    inflight = nutritionClient
      .getMealSharingDefault()
      .then((d) => {
        const v = d?.share_meals_with_circles === true;
        if (cacheUser === key) setCachedMealSharingDefault(v);
        return v;
      })
      .catch(() => {
        if (cacheUser === key) inflight = null;
        return false;
      });
  }
  return inflight;
}

/** Test hook: forget the cached default. */
export function __resetMealSharingDefaultCache() {
  cacheUser = null;
  cacheValue = null;
  inflight = null;
  listeners.clear();
}

/** The user's default for new meals; `null` while loading. */
export function useMealSharingDefault(enabled = true): boolean | null {
  const [value, setValue] = useState<boolean | null>(() => (enabled ? cachedMealSharingDefault() : null));
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const listener: Listener = (v) => live && setValue(v);
    listeners.add(listener);
    void loadMealSharingDefault().then((v) => live && setValue(v));
    return () => {
      live = false;
      listeners.delete(listener);
    };
  }, [enabled]);
  return value;
}

/**
 * The chip state for a NEW meal: starts private, follows the user's default
 * until the user touches the control, then keeps their choice.
 */
export function useNewMealShareChoice(enabled = true): [boolean, (v: boolean) => void] {
  const def = useMealSharingDefault(enabled);
  const touched = useRef(false);
  const [shared, setShared] = useState<boolean>(def ?? false);
  useEffect(() => {
    if (!touched.current && def !== null) setShared(def);
  }, [def]);
  const choose = (v: boolean) => {
    touched.current = true;
    setShared(v);
  };
  return [shared, choose];
}
