'use client';

import { Lock } from 'lucide-react';

/**
 * Entitlement lock state (BODY_COMP_BUILD_CONTRACT.md §3). Everything ships
 * FREE today, so this renders only after a server-side gate flips — the copy
 * is a simple "coming soon" card with no purchase flow.
 */
export function LockCard({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur-xl p-8 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-800/80">
        <Lock className="h-5 w-5 text-gray-400" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-1 text-sm text-gray-400">Premium feature — coming to your plan soon.</p>
    </div>
  );
}
