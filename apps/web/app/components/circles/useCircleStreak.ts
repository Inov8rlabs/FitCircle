'use client';

import { useCallback, useEffect, useState } from 'react';

import { getCircleStreakStatus } from './api';
import type { CircleStreakStatus } from './types';

/**
 * GET /api/mobile/circles/[id]/streak (cookie or Bearer auth). `null` while
 * loading; `undefined` when the request failed (cards then hide the live bits).
 */
export function useCircleStreak(circleId: string | null | undefined) {
  const [status, setStatus] = useState<CircleStreakStatus | null | undefined>(null);

  const load = useCallback(async () => {
    if (!circleId) return;
    try {
      const s = await getCircleStreakStatus(circleId);
      setStatus(s);
    } catch {
      setStatus(undefined);
    }
  }, [circleId]);

  useEffect(() => {
    setStatus(null);
    void load();
  }, [load]);

  return { status, setStatus, reload: load };
}
