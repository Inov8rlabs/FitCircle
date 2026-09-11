'use client';

import { cn } from '@/lib/utils';

export const DEFAULT_CALORIE_BUDGET = 2000;

interface CalorieBudgetCardProps {
  consumed: number;
  budget?: number;
}

/**
 * Today's calorie budget ring — consumed vs target, with remaining / overage.
 * Matches the Plate Score card layout so the food log has one glanceable
 * nutrition widget above the list.
 */
export function CalorieBudgetCard({ consumed, budget = DEFAULT_CALORIE_BUDGET }: CalorieBudgetCardProps) {
  const safeBudget = budget > 0 ? budget : DEFAULT_CALORIE_BUDGET;
  const eaten = Math.max(0, Math.round(consumed));
  const remaining = safeBudget - eaten;
  const isOver = remaining < 0;
  const pct = Math.min(100, Math.round((eaten / safeBudget) * 100));
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;
  const color = isOver ? '#f97316' : pct >= 90 ? '#34d399' : '#fb923c';
  const status = isOver
    ? `${Math.abs(remaining).toLocaleString()} over`
    : remaining === 0
      ? 'Budget hit'
      : `${remaining.toLocaleString()} left`;

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 p-5 backdrop-blur-xl">
      <div className="flex items-center gap-5">
        <div
          className="relative h-28 w-28 shrink-0"
          role="img"
          aria-label={`${eaten} of ${safeBudget} calories, ${status}`}
        >
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="10" />
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              className="transition-[stroke-dasharray] duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold tabular-nums text-white">{pct}%</span>
            <span className="text-[10px] uppercase tracking-wide text-gray-400">of budget</span>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-sm font-semibold text-white">Today&apos;s calories</div>
          <div className="text-2xl font-bold tabular-nums text-white">
            {eaten.toLocaleString()}
            <span className="text-base font-medium text-gray-400"> / {safeBudget.toLocaleString()}</span>
          </div>
          <div
            className={cn(
              'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold',
              isOver ? 'bg-orange-500/15 text-orange-300' : 'bg-emerald-500/15 text-emerald-300'
            )}
          >
            {status}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{ width: `${pct}%`, backgroundColor: color }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
