'use client';

import { cn } from '@/lib/utils';

interface UnitBadgeProps {
  unit: string;
  className?: string;
}

export function UnitBadge({ unit, className }: UnitBadgeProps) {
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold",
      "bg-purple-500/20 text-purple-300 border border-purple-500/30",
      className
    )}>
      {unit}
    </span>
  );
}
