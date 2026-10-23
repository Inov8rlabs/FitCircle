import { describe, expect, it, vi } from 'vitest';

import { swrCache } from '../cache';

const clock = () => {
  let t = 0;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
};

describe('swrCache', () => {
  it('serves fresh values from memory', async () => {
    const c = clock();
    const load = vi.fn(async () => 'v1');
    const cache = swrCache(load, { ttlMs: 100, maxStaleMs: 1000, label: 't', now: c.now });
    expect(await cache.get()).toBe('v1');
    c.advance(50);
    expect(await cache.get()).toBe('v1');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves a stale value immediately and refreshes once in the background', async () => {
    const c = clock();
    let n = 0;
    const load = vi.fn(async () => `v${++n}`);
    const cache = swrCache(load, { ttlMs: 100, maxStaleMs: 1000, label: 't', now: c.now });
    await cache.get();
    c.advance(200);
    const [a, b] = await Promise.all([cache.get(), cache.get()]);
    expect([a, b]).toEqual(['v1', 'v1']);
    expect(load).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(await cache.get()).toBe('v2');
  });

  it('blocks only when missing or too stale; concurrent cold callers share one load', async () => {
    const c = clock();
    const load = vi.fn(async () => 'v');
    const cache = swrCache(load, { ttlMs: 100, maxStaleMs: 1000, label: 't', now: c.now });
    await Promise.all([cache.get(), cache.get(), cache.get()]);
    expect(load).toHaveBeenCalledTimes(1);
    c.advance(5000);
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a failed background refresh keeps the previous value', async () => {
    const c = clock();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fail = false;
    const cache = swrCache(async () => {
      if (fail) throw new Error('db down');
      return 'good';
    }, { ttlMs: 100, maxStaleMs: 1000, label: 't', now: c.now });
    await cache.get();
    fail = true;
    c.advance(200);
    expect(await cache.get()).toBe('good');
    await new Promise((r) => setTimeout(r, 0));
    expect(await cache.get()).toBe('good');
    warn.mockRestore();
  });

  it('clear() forces the next get to load', async () => {
    const load = vi.fn(async () => 'v');
    const cache = swrCache(load, { ttlMs: 100, maxStaleMs: 1000, label: 't' });
    await cache.get();
    cache.clear();
    expect(cache.peek()).toBeUndefined();
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
