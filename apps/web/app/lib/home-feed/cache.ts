/**
 * Per-instance, stale-while-revalidate cache for the small, user-independent
 * tables the home feed reads on every request (rules, active campaigns,
 * feature flags). The feed is the first screen the apps load, so these must
 * cost zero round trips on a warm instance:
 *
 *  - fresh (< ttlMs): served from memory.
 *  - stale (< maxStaleMs): served from memory while one background refresh runs.
 *  - missing / too stale: the caller awaits the load (concurrent callers share it).
 *
 * A failed refresh keeps the previous value. Never caches per-user data.
 */

interface Entry<T> {
  at: number;
  value: T;
}

export interface SwrCache<T> {
  get(): Promise<T>;
  /** Drop the value (admin writes); the next get() loads fresh. */
  clear(): void;
  /** Test hook: has a value been loaded? */
  peek(): T | undefined;
}

export function swrCache<T>(
  load: () => Promise<T>,
  opts: { ttlMs: number; maxStaleMs: number; label: string; now?: () => number }
): SwrCache<T> {
  const now = opts.now ?? Date.now;
  let entry: Entry<T> | null = null;
  let inflight: Promise<T> | null = null;

  const refresh = (): Promise<T> => {
    if (inflight) return inflight;
    inflight = load()
      .then((value) => {
        entry = { at: now(), value };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return {
    async get() {
      const age = entry ? now() - entry.at : Infinity;
      if (entry && age < opts.ttlMs) return entry.value;
      if (entry && age < opts.maxStaleMs) {
        refresh().catch((err) => console.warn(`[home-feed] ${opts.label} refresh failed:`, err?.message ?? err));
        return entry.value;
      }
      return refresh();
    },
    clear() {
      entry = null;
    },
    peek() {
      return entry?.value;
    },
  };
}
