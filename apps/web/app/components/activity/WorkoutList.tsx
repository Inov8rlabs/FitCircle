'use client';

/**
 * iOS Exercise Log list: category chips, day groups ("Wednesday · Sep 9, 2026"
 * + count pill), and workout rows (tinted icon tile, name, Health heart for
 * synced workouts, duration / kcal / distance pills).
 */
import { Clock, Dumbbell, Flame, Footprints, Heart, MapPin, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Chip, ChipRow } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { DayHeader, GlassCard, MetricPill, ToneDisc } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';
import type { ExerciseCategory, ExerciseLog } from '@/lib/types/exercise';

import { parseDateKey } from './api';
import { CATEGORY_FILTERS, CATEGORY_TONE, formatDistance, workoutIcon } from './workout-meta';

export function groupByDay<T>(items: T[], dateOf: (t: T) => string): { key: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const k = dateOf(it).slice(0, 10);
    const list = map.get(k);
    if (list) list.push(it);
    else map.set(k, [it]);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([key, items]) => ({ key, items }));
}

export function WorkoutRow({ log, onDelete }: { log: ExerciseLog; onDelete?: () => void }) {
  const tone = CATEGORY_TONE[log.category] ?? 'indigo';
  const Icon = workoutIcon(log.exercise_type, log.category);
  const synced = log.source === 'healthkit' || Boolean(log.source_platform);
  const distance = formatDistance(log.distance_meters);
  return (
    <GlassCard as="li" padded={false} className="group flex items-center gap-3 p-3.5" data-testid="workout-row">
      <ToneDisc icon={Icon} tone={tone} size="lg" square className="rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-headline capitalize text-white">
          <span className="truncate">{log.exercise_type}</span>
          {synced && (
            <Heart className="h-3.5 w-3.5 shrink-0 fill-brand-pink text-brand-pink" aria-label="Synced from Health" />
          )}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <MetricPill icon={Clock} tone="cyan">
            {log.duration_minutes}min
          </MetricPill>
          {log.calories_burned ? (
            <MetricPill icon={Flame} tone="orange">
              {Math.round(log.calories_burned)}cal
            </MetricPill>
          ) : null}
          {distance && (
            <MetricPill icon={MapPin} tone="green">
              {distance}
            </MetricPill>
          )}
          {log.effort_level ? <MetricPill tone="slate">RPE {log.effort_level}</MetricPill> : null}
        </div>
      </div>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${log.exercise_type}`}
          className="rounded-full p-2 text-fg-tertiary opacity-100 transition hover:bg-white/5 hover:text-brand-red md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </GlassCard>
  );
}

/** Row-shaped placeholders: same height as a WorkoutRow, so nothing moves when data lands. */
export function WorkoutListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading workouts" className="space-y-3">
      <Skeleton className="mb-2 h-11 w-40" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-[78px] items-center gap-3 rounded-xl border border-glass bg-surface-raised/50 p-3.5">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkoutList({
  logs,
  loading,
  onDelete,
  onAdd,
}: {
  logs: ExerciseLog[];
  loading: boolean;
  onDelete: (log: ExerciseLog) => void;
  onAdd: () => void;
}) {
  const [filter, setFilter] = useState<'all' | ExerciseCategory>('all');
  const present = useMemo(() => new Set(logs.map((l) => l.category)), [logs]);
  const chips = CATEGORY_FILTERS.filter((c) => c.id === 'all' || present.has(c.id) || c.id === filter);
  const visible = filter === 'all' ? logs : logs.filter((l) => l.category === filter);
  const days = useMemo(() => groupByDay(visible, (l) => l.exercise_date || l.started_at || ''), [visible]);

  return (
    <div className="min-w-0">
      {logs.length > 0 && (
        <ChipRow className="mb-4">
          {chips.map((c) => (
            <Chip
              key={c.id}
              selected={filter === c.id}
              onClick={() => setFilter(c.id)}
              className={filter === c.id ? 'bg-gradient-brand' : undefined}
            >
              {c.label}
            </Chip>
          ))}
        </ChipRow>
      )}

      {loading ? (
        <WorkoutListSkeleton />
      ) : visible.length === 0 ? (
        <GlassCard>
          <EmptyState
            icon={Dumbbell}
            tone="orange"
            title={logs.length === 0 ? 'No workouts yet' : 'Nothing in this category'}
            description={
              logs.length === 0
                ? 'Workouts from Apple Health or Health Connect show up here automatically. Add one by hand with +.'
                : 'Try another filter.'
            }
            action={
              logs.length === 0 ? (
                <button
                  type="button"
                  onClick={onAdd}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-brand px-5 text-headline text-white shadow-glow"
                >
                  <Footprints className="h-4 w-4" aria-hidden /> Log a workout
                </button>
              ) : undefined
            }
          />
        </GlassCard>
      ) : (
        <div data-testid="workout-days" className="space-y-7">
          {days.map((d) => (
            <section key={d.key} aria-label={d.key}>
              <DayHeader date={parseDateKey(d.key)} count={d.items.length} countIcon={Footprints} className="mt-0" />
              <ul className="space-y-3">
                {d.items.map((log) => (
                  <WorkoutRow key={log.id} log={log} onDelete={() => onDelete(log)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
