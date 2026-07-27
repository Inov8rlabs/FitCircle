'use client';

import type { BodyCompTrendState } from '@/lib/types/body-composition';
import { cn } from '@/lib/utils';

import { TREND_STATE_CHIP } from './format';

/** Small pill showing the server-computed trend state (body-neutral labels). */
export function StateChip({ state, className }: { state: BodyCompTrendState; className?: string }) {
  const chip = TREND_STATE_CHIP[state];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        chip.className,
        className
      )}
    >
      {chip.label}
    </span>
  );
}
