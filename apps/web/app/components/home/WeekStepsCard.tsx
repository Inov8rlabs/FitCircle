'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { GlassCard } from '@/components/ui/ios';
import { cn } from '@/lib/utils';

import { compactSteps, weekDays } from './week-steps';

/**
 * iOS WeeklyGoalsWidget: "This Week" with previous / next week, one bar per day
 * (filled to the goal), "n/7 Days" met and the daily goal.
 */
export function WeekStepsCard({
  rows,
  stepsGoal,
}: {
  rows: { tracking_date: string; steps?: number | null }[];
  stepsGoal: number;
}) {
  const [offset, setOffset] = useState(0);
  const days = weekDays(rows, offset);
  const met = days.filter((d) => d.steps >= stepsGoal).length;
  const goal = stepsGoal > 0 ? stepsGoal : 10000;
  const range = `${new Date(`${days[0].date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(
    `${days[6].date}T12:00:00`
  ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return (
    <GlassCard data-testid="week-steps-card">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOffset((o) => o - 1)}
          aria-label="Previous week"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-indigo/20 text-brand-indigo transition hover:bg-brand-indigo/30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="text-center">
          <h2 className="text-headline text-white">{offset === 0 ? 'This Week' : offset === -1 ? 'Last Week' : range}</h2>
          {offset !== 0 && offset !== -1 ? null : <p className="text-caption text-fg-tertiary">{range}</p>}
        </div>
        <button
          type="button"
          onClick={() => setOffset((o) => Math.min(0, o + 1))}
          disabled={offset === 0}
          aria-label="Next week"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 text-fg-secondary transition hover:bg-white/10 disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="mb-3 flex items-center justify-between text-footnote text-fg-secondary">
        <span>{met}/7 Days</span>
        <span>Goal: {goal.toLocaleString()}</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5" role="list" aria-label="Steps per day">
        {days.map((d) => {
          const pct = Math.min(1, d.steps / goal);
          const done = d.steps >= goal;
          return (
            <div key={d.date} role="listitem" className="flex flex-col items-center gap-1" aria-label={`${d.label}: ${d.steps} steps`}>
              {/* Future days have no value but keep the label row's height so every bar lines up. */}
              <span className="min-h-[1lh] text-caption tabular-nums text-fg-tertiary">{d.isFuture ? '\u00A0' : compactSteps(d.steps)}</span>
              <div className="relative h-24 w-full overflow-hidden rounded-md bg-white/[0.06]">
                <div
                  className={cn(
                    'absolute inset-x-0 bottom-0 rounded-md transition-[height] duration-500 ease-ios',
                    done ? 'bg-brand-green' : 'bg-brand-indigo/80'
                  )}
                  style={{ height: `${pct * 100}%` }}
                />
              </div>
              <span className={cn('text-caption font-semibold', d.isToday ? 'text-brand-indigo' : 'text-fg-tertiary')}>{d.label}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-4 text-caption text-fg-tertiary">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brand-green" /> Complete
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brand-indigo" /> In progress
        </span>
      </div>
    </GlassCard>
  );
}
