'use client';

/**
 * Steps: the iOS "This Week" bars (WeeklyGoalsWidget: per-day columns, goal
 * line, n/7 days) plus a day-by-day list. Data: daily_tracking.steps.
 */
import { Check, ChevronLeft, ChevronRight, Footprints } from 'lucide-react';
import { useMemo, useState } from 'react';

import { CardTitleRow, GlassCard, ListGroup, ListRow, ProgressBar } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { localDateKey, parseDateKey, type TrackingRow } from './api';
import { formatSteps } from './workout-meta';

/** Monday-start week containing `ref`, shifted by `offset` weeks. */
export function weekDays(ref: Date, offset = 0): Date[] {
  const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = (start.getDay() + 6) % 7; // Mon = 0
  start.setDate(start.getDate() - dow + offset * 7);
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export function WeekStepsCard({
  rows,
  goal,
  loading,
}: {
  rows: TrackingRow[];
  goal: number;
  loading?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const byDate = useMemo(() => new Map(rows.map((r) => [r.tracking_date.slice(0, 10), r.steps ?? 0])), [rows]);
  const days = weekDays(new Date(), offset);
  const todayKey = localDateKey(new Date());
  const values = days.map((d) => byDate.get(localDateKey(d)) ?? 0);
  const met = values.filter((v) => v >= goal).length;
  const max = Math.max(goal, ...values, 1);
  const label =
    offset === 0
      ? 'This Week'
      : `${days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

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
        <h2 className="text-headline text-white">{label}</h2>
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
      <div className="mb-4 flex justify-between text-footnote text-fg-secondary">
        <span>
          {met}/7 Days
        </span>
        <span>Goal: {goal.toLocaleString()}</span>
      </div>
      <div className="grid h-40 grid-cols-7 items-end gap-1.5 sm:gap-2.5" aria-label="Steps per day">
        {days.map((d, i) => {
          const v = values[i];
          const key = localDateKey(d);
          const isToday = key === todayKey;
          const future = key > todayKey;
          const h = loading ? 30 : Math.max(4, Math.round((v / max) * 100));
          return (
            <div key={key} className="flex h-full flex-col items-center justify-end gap-1.5">
              <span className="min-h-[1lh] text-caption tabular-nums text-fg-secondary">{loading || future ? '\u00A0' : formatSteps(v)}</span>
              <div className="relative flex w-full flex-1 items-end overflow-hidden rounded-lg bg-white/[0.06]">
                {loading ? (
                  <Skeleton className="h-full w-full rounded-lg" />
                ) : (
                  <div
                    className={cn(
                      'w-full rounded-lg transition-[height] duration-500 ease-ios',
                      v >= goal ? 'bg-gradient-green' : 'bg-brand-indigo/80'
                    )}
                    style={{ height: future ? 0 : `${h}%` }}
                  />
                )}
              </div>
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-caption font-semibold',
                  isToday ? 'bg-brand-indigo text-white' : 'text-fg-tertiary'
                )}
              >
                {d.toLocaleDateString('en-US', { weekday: 'narrow' })}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-4 text-caption text-fg-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brand-green" /> Goal met
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brand-indigo" /> In progress
        </span>
      </div>
    </GlassCard>
  );
}

export function StepsPanel({ rows, goal, loading }: { rows: TrackingRow[]; goal: number; loading: boolean }) {
  const todayKey = localDateKey(new Date());
  const today = rows.find((r) => r.tracking_date.slice(0, 10) === todayKey)?.steps ?? 0;
  const history = rows.filter((r) => typeof r.steps === 'number' && (r.steps ?? 0) > 0).slice(0, 14);
  const weekAvg = (() => {
    const last7 = rows.slice(0, 7).map((r) => r.steps ?? 0).filter((s) => s > 0);
    return last7.length ? Math.round(last7.reduce((a, b) => a + b, 0) / last7.length) : 0;
  })();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
      <div className="space-y-4">
        <GlassCard>
          <CardTitleRow icon={Footprints} tone="indigo" title="Today" />
          <div className="flex items-baseline gap-2">
            {loading ? (
              <Skeleton className="h-10 w-32" />
            ) : (
              <span className="text-[40px] font-bold leading-none tabular-nums text-white">{today.toLocaleString()}</span>
            )}
            <span className="text-subhead text-fg-secondary">/ {goal.toLocaleString()} steps</span>
          </div>
          <ProgressBar value={(today / goal) * 100} className="mt-4 h-2" barClassName="bg-gradient-indigo" />
          <p className="mt-3 text-footnote text-fg-secondary">
            7-day average: <span className="font-semibold text-white">{weekAvg.toLocaleString()}</span>
          </p>
        </GlassCard>
        <WeekStepsCard rows={rows} goal={goal} loading={loading} />
      </div>
      <ListGroup title="Daily steps" footer="Steps sync from Apple Health or Health Connect in the app, or log them from Home.">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex h-[52px] items-center gap-3 px-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="ml-auto h-4 w-16" />
            </li>
          ))
        ) : history.length === 0 ? (
          <ListRow title="No steps logged yet" subtitle="They appear here once synced or logged." />
        ) : (
          history.map((r) => {
            const d = parseDateKey(r.tracking_date);
            const s = r.steps ?? 0;
            return (
              <ListRow
                key={r.id}
                icon={s >= goal ? Check : Footprints}
                tone={s >= goal ? 'green' : 'indigo'}
                title={d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                value={<span className="tabular-nums text-white">{s.toLocaleString()}</span>}
              />
            );
          })
        )}
      </ListGroup>
    </div>
  );
}
