'use client';

import { Activity, Dumbbell, Footprints, Lock, TrendingDown, TrendingUp } from 'lucide-react';

import { BathroomScale } from '@/components/icons/BathroomScale';
import { ProgressBar } from '@/components/ui/ios';
import type { UnitSystem } from '@/lib/utils/units';

import {
  formatEntryDay,
  formatMetricValue,
  formatWeightChange,
  hiddenMessage,
  metricTitle,
  weightUnitLabel,
  weightValue,
  type MemberCircleProgress,
} from './member-progress-format';

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div
      className={
        highlight
          ? 'rounded-lg border border-purple-500/30 bg-purple-500/15 p-3 text-center'
          : 'rounded-lg border border-slate-700/30 bg-slate-900/50 p-3 text-center'
      }
    >
      <div className="mb-1 text-xs text-gray-400">{label}</div>
      <div className="text-lg font-bold text-white">{value}</div>
      {sub ? <div className="text-xs text-gray-500">{sub}</div> : null}
    </div>
  );
}

function MetricIcon({ metric }: { metric: MemberCircleProgress['metric'] }) {
  if (metric === 'weight') return <BathroomScale className="h-4 w-4 text-purple-400" size={16} />;
  if (metric === 'steps') return <Footprints className="h-4 w-4 text-indigo-400" aria-hidden />;
  if (metric === 'workout_minutes') return <Dumbbell className="h-4 w-4 text-orange-400" aria-hidden />;
  return <Activity className="h-4 w-4 text-green-400" aria-hidden />;
}

/**
 * A circle member's progress in the circle's own metric (web participant
 * sheet). Steps show steps, a weight circle shows weight in the viewer's units
 * with lost / gained, custom challenges their own unit; hidden progress shows
 * why, never values.
 */
export function MemberProgressPanel({ progress, unitSystem }: { progress: MemberCircleProgress; unitSystem: UnitSystem }) {
  const { metric, unit, summary, entries, today } = progress;
  const fmt = (v: number) => formatMetricValue(v, metric, unit, unitSystem);

  if (!progress.can_view) {
    return (
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6 text-center" data-testid="member-progress-hidden">
        <Lock className="mx-auto mb-3 h-8 w-8 text-gray-500" aria-hidden />
        <p className="text-gray-300">{hiddenMessage(progress.hidden_reason)}</p>
      </div>
    );
  }

  if (metric === 'none') {
    return (
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-6 text-center" data-testid="member-progress-none">
        <Activity className="mx-auto mb-3 h-8 w-8 text-gray-500" aria-hidden />
        <p className="text-gray-300">No shared progress for this circle yet.</p>
      </div>
    );
  }

  const weightStat = (kg: number | null) => (kg == null ? '—' : weightValue(kg, unitSystem));
  const weightChange = metric === 'weight' && summary.change != null ? formatWeightChange(summary.change, unitSystem) : null;

  return (
    <div className="space-y-6" data-testid={`member-progress-${metric}`}>
      <div className="rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-800/40 to-slate-800/20 p-6">
        <div className="mb-5 flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold text-white">
            <MetricIcon metric={metric} />
            {metricTitle(progress)}
          </span>
          {summary.progress_percentage != null ? (
            <span className="rounded-full border border-purple-500/30 bg-purple-500/20 px-3 py-1 text-sm font-bold text-purple-300">
              {Math.round(summary.progress_percentage)}%
            </span>
          ) : null}
        </div>

        {metric === 'weight' ? (
          <>
            <div className="mb-4 grid grid-cols-3 gap-3">
              <Stat label="Starting" value={weightStat(summary.starting)} sub={weightUnitLabel(unitSystem)} />
              <Stat label="Current" value={weightStat(summary.current)} sub={weightUnitLabel(unitSystem)} highlight />
              <Stat label="Target" value={weightStat(summary.target)} sub={weightUnitLabel(unitSystem)} />
            </div>
            {weightChange ? (
              <p
                className={weightChange.direction === 'lost' ? 'text-sm font-semibold text-green-400' : 'text-sm font-semibold text-orange-300'}
                data-testid="member-weight-change"
              >
                {weightChange.text} since the start
              </p>
            ) : (
              <p className="text-sm text-gray-400">No weigh-ins in this circle yet.</p>
            )}
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total" value={summary.total != null ? fmt(summary.total) : '—'} highlight />
            <Stat label="Daily average" value={summary.daily_average != null ? fmt(summary.daily_average) : '—'} />
            <Stat label="Today" value={summary.today_value != null ? fmt(summary.today_value) : '—'} />
            <Stat
              label="Best day"
              value={summary.best_day ? fmt(summary.best_day.value) : '—'}
              sub={summary.best_day ? formatEntryDay(summary.best_day.date, today) : undefined}
            />
          </div>
        )}

        {summary.progress_percentage != null && metric !== 'weight' && summary.goal != null ? (
          <div className="mt-4 space-y-1">
            <ProgressBar value={summary.progress_percentage} />
            <p className="text-xs text-gray-400">Goal: {fmt(summary.goal)}</p>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Progress history</h3>
          {entries.length > 0 ? <span className="text-sm text-gray-400">{entries.length} days</span> : null}
        </div>
        {entries.length === 0 ? (
          <div className="py-8 text-center">
            <Activity className="mx-auto mb-4 h-12 w-12 text-gray-600" aria-hidden />
            <p className="text-gray-400">No progress entries yet</p>
          </div>
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto" data-testid="member-progress-entries">
            {entries.map((entry) => {
              const change = metric === 'weight' && entry.change != null ? formatWeightChange(entry.change, unitSystem) : null;
              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between rounded-lg border border-slate-700/40 bg-slate-900/40 px-4 py-3"
                >
                  <div>
                    <div className="text-xs text-gray-400">{formatEntryDay(entry.date, today)}</div>
                    <div className="font-semibold text-white">{fmt(entry.value)}</div>
                  </div>
                  {change && change.direction !== 'same' ? (
                    <span
                      className={change.direction === 'lost' ? 'flex items-center gap-1 text-sm text-green-400' : 'flex items-center gap-1 text-sm text-orange-300'}
                    >
                      {change.direction === 'lost' ? <TrendingDown className="h-4 w-4" aria-hidden /> : <TrendingUp className="h-4 w-4" aria-hidden />}
                      {change.text}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
