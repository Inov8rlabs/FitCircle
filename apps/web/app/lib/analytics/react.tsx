'use client';

import { useEffect, useRef } from 'react';

import { useAuthStore } from '@/stores/auth-store';

import type { AnalyticsEventPayload } from './events.generated';
import { userPropertiesFor } from './user-properties';

import { AnalyticsEvents, analytics } from './index';

/** Access the facade from components (same singleton as `import { analytics }`). */
export function useAnalytics() {
  return analytics;
}

/**
 * Tracks `payload` once per mount when `enabled` becomes true. Pass a stable
 * `key` to re-fire when it changes (e.g. a different circle id).
 */
export function useTrackOnce(payload: AnalyticsEventPayload | null, enabled = true, key: string = ''): void {
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !payload || fired.current === key) return;
    fired.current = key;
    analytics.track(payload);
    // payload is rebuilt each render; `key` controls re-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
}

/**
 * Mounted once in the root layout. Reads the consent cookie on start and keeps
 * the analytics identity in sync with the auth store:
 *  - a persisted / restored session is identified (session restore),
 *  - profile changes update user properties,
 *  - a session that disappears without an explicit logout is tracked as
 *    Logout(session_expired) and reset.
 * Explicit login / sign-up / logout are instrumented in the auth store itself.
 */
export function AnalyticsRoot() {
  const user = useAuthStore((state) => state.user);
  const userId = user?.id ?? null;
  const propsKey = JSON.stringify(userPropertiesFor(user));

  useEffect(() => {
    analytics.init();
  }, []);

  useEffect(() => {
    if (userId) {
      if (analytics.userId !== userId) {
        analytics.identify(userId, userPropertiesFor(user));
      } else {
        analytics.setUserProperties(userPropertiesFor(user));
      }
    } else if (analytics.userId) {
      analytics.track(AnalyticsEvents.logout({ reason: 'session_expired' }));
      analytics.reset();
    }
    // `user` is represented by userId + propsKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, propsKey]);

  return null;
}
