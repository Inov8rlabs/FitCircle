'use client';

import { Crown } from 'lucide-react';

/** Small "PRO" chip shown beside names/headers for premium members. */
export function ProBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-400 ${className}`}
    >
      <Crown className="h-3 w-3" /> Pro
    </span>
  );
}
