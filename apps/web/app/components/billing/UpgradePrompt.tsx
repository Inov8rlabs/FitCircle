'use client';

import { Sparkles } from 'lucide-react';
import Link from 'next/link';

import { useEntitlements } from '@/hooks/useEntitlements';

/**
 * Reusable contextual paywall prompt — render wherever an API response comes
 * back with error.code === 'UPGRADE_REQUIRED' (details: {feature, used, limit})
 * or meta.clamped === true (history soft-gate).
 * Renders nothing while the subscriptions master flag is off.
 */
export function UpgradePrompt({
  message,
  compact = false,
}: {
  message: string;
  compact?: boolean;
}) {
  const { entitlements } = useEntitlements();
  if (entitlements?.subscriptionsEnabled !== true) return null;

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-purple-500/40 bg-purple-500/10 ${
        compact ? 'px-3 py-2' : 'px-4 py-3'
      }`}
    >
      <Sparkles className="h-5 w-5 shrink-0 text-purple-400" />
      <p className="flex-1 text-sm">{message}</p>
      <Link
        href="/upgrade"
        className="shrink-0 rounded-lg bg-purple-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-purple-600"
      >
        Go Pro
      </Link>
    </div>
  );
}
