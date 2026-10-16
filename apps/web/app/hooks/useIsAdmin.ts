'use client';

import { useEffect, useState } from 'react';

import { campaignsAdmin } from '@/lib/campaigns/admin-client';
import { useAuthStore } from '@/stores/auth-store';

// One lookup per signed-in user per page load.
const cache = new Map<string, Promise<boolean>>();

/** Whether the signed-in user is an admin (GET /api/admin/me). False while loading or on any error. */
export function useIsAdmin(): boolean {
  const userId = useAuthStore((s) => s.user?.id);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!userId) {
      setIsAdmin(false);
      return;
    }
    let alive = true;
    let p = cache.get(userId);
    if (!p) {
      p = campaignsAdmin
        .me()
        .then((r) => r?.isAdmin === true)
        .catch(() => false);
      cache.set(userId, p);
    }
    void p.then((v) => alive && setIsAdmin(v));
    return () => {
      alive = false;
    };
  }, [userId]);

  return isAdmin;
}
