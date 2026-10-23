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
    <section
      className="rounded-xl border border-glass bg-surface-raised/50 p-4 shadow-ios-sm backdrop-blur-xl sm:p-5"
      data-testid="calorie-budget-card"
    >
      <div className="flex items-center gap-5">
        <div
          className="relative h-[104px] w-[104px] shrink-0"
          role="img"
          aria-label={`${eaten} of ${safeBudget} calories, ${status}`}
        >
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
            <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(16,185,129,0.14)" strokeWidth="10" />
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
            <span className="text-title2 font-bold tabular-nums text-white">{pct}%</span>
            <span className="text-caption text-fg-secondary">of budget</span>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-headline text-white">Today&apos;s calories</div>
          <div className="text-title2 font-bold tabular-nums text-white">
            {eaten.toLocaleString()}
            <span className="text-callout font-medium text-fg-secondary"> / {safeBudget.toLocaleString()}</span>
          </div>
          <div
            className={cn(
              'inline-flex rounded-full px-2.5 py-0.5 text-caption font-semibold',
              isOver ? 'bg-brand-orange/15 text-brand-orange' : 'bg-brand-green/15 text-brand-green'
            )}
          >
            {status}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{ width: `${pct}%`, backgroundColor: color }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
