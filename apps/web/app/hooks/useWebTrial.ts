'use client';

import { useEffect, useState } from 'react';

/**
 * Does a web (Stripe) checkout started now include the free trial? GET /api/billing/trial.
 * `trialDays` is 0 until known and whenever no trial applies — callers show trial-first copy
 * only when it is > 0 (never promise a trial checkout won't give).
 */
export function useWebTrial(enabled = true): { trialDays: number; loading: boolean } {
  const [trialDays, setTrialDays] = useState(0);
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.resolve()
      .then(() => fetch('/api/billing/trial', { cache: 'no-store' }))
      .then((r) => (r?.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled) setTrialDays(typeof body?.trialDays === 'number' && body.eligible ? body.trialDays : 0);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return { trialDays, loading };
}
