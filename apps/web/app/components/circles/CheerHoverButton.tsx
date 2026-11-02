'use client';

import { HandHeart } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Desktop affordance for the cheer sheet (no long-press with a mouse): shown
 * on row hover / keyboard focus; also the accessible "Cheer <name>" action.
 */
export function CheerHoverButton({ name, onCheer, className }: { name: string; onCheer: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onCheer}
      aria-label={`Cheer ${name}`}
      data-testid="leaderboard-cheer-button"
      className={cn(
        'absolute top-1/2 inline-flex h-9 -translate-y-1/2 items-center gap-1 rounded-full border border-glass bg-surface/95 px-3 text-caption font-semibold text-white opacity-0 shadow-ios transition-opacity focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 group-hover:opacity-100',
        className
      )}
    >
      <HandHeart className="h-3.5 w-3.5 text-brand-orange" aria-hidden />
      Cheer
    </button>
  );
}
