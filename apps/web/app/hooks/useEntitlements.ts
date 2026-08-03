'use client';

import { useCallback, useEffect, useState } from 'react';

import type { EntitlementsResponse } from '@/lib/types/body-composition';

/**
 * Client cache of GET /api/entitlements (server truth; cosmetic only — every
 * gated action is enforced server-side). `refresh` supports the post-checkout
 * poll on /upgrade/success.
 */
export function useEntitlements() {
  const [entitlements, setEntitlements] = useState<EntitlementsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async (): Promise<EntitlementsResponse | null> => {
    try {
      const res = await fetch('/api/entitlements', { cache: 'no-store' });
      if (!res.ok) return null;
      const body = await res.json();
      const data: EntitlementsResponse | null = body?.data ?? null;
      if (data) setEntitlements(data);
      return data;
    } catch {
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isPro = entitlements?.tier === 'premium';
  return { entitlements, isPro, isLoading, refresh };
}
