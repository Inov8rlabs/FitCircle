import { describe, expect, it, vi } from 'vitest';

import { isDeferredSentryPath, runWhenIdleOrInteracted } from '../../sentry.client-defer';

describe('isDeferredSentryPath', () => {
  it.each(['/', '/get', '/open', '/welcome/app', '/privacy', '/privacy/delete-account', '/terms', '/i/ANKI7QX', '/join/FITABC123', '/get/'])(
    '%s defers Sentry',
    (p) => expect(isDeferredSentryPath(p)).toBe(true)
  );

  it.each(['/dashboard', '/food-log', '/fitcircles', '/fitcircles/123', '/profile', '/settings/billing', '/upgrade', '/login', '/c/hold-the-line', '/getaway', '/ideas'])(
    '%s initialises Sentry immediately',
    (p) => expect(isDeferredSentryPath(p)).toBe(false)
  );
});

describe('runWhenIdleOrInteracted', () => {
  it('starts once on the first interaction', () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    const start = vi.fn();
    runWhenIdleOrInteracted(start);
    expect(start).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('keydown'));
    window.dispatchEvent(new Event('load'));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('starts after load when the browser goes idle (timeout fallback)', () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
    const start = vi.fn();
    runWhenIdleOrInteracted(start, { idleTimeoutMs: 1000 });
    expect(start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(start).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pointerdown'));
    expect(start).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
