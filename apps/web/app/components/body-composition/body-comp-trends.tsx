'use client';

import { format } from 'date-fns';
import { TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Switch } from '@/components/ui/switch';
import type { BodyCompTrends } from '@/lib/types/body-composition';
import { cn } from '@/lib/utils';
import type { UnitSystem } from '@/lib/utils/units';

import { DELTA_METRIC_LABELS, formatDelta, massKgToDisplayRaw, massUnit } from './format';
import { LockCard } from './lock-card';
import { StateChip } from './state-chip';

// ---------------------------------------------------------------------------
// Trends section (BODY_COMP_BUILD_CONTRACT §3): dual-line fat mass + skeletal
// muscle chart with an optional smoothed-weight overlay, the server state
// chip, server insights rendered VERBATIM, the projection only when the server
// sends one, and the standing disclaimer. No trend math happens here — the
// series, states, deltas, and copy all come from the server; this component
// only converts kg → display units.
// ---------------------------------------------------------------------------

const FAT_MASS_COLOR = '#f97316'; // orange
const SMM_COLOR = '#6366f1'; // indigo
const WEIGHT_COLOR = '#8b5cf6'; // purple

interface BodyCompTrendsSectionProps {
  trends: BodyCompTrends | null;
  /** Server said body_comp_trends is not in the user's plan. */
  locked: boolean;
  unitSystem: UnitSystem;
}

export function BodyCompTrendsSection({ trends, locked, unitSystem }: BodyCompTrendsSectionProps) {
  const [showWeight, setShowWeight] = useState(false);
  const unit = massUnit(unitSystem);

  const chartData = useMemo(() => {
    if (!trends) return [];
    return trends.series.map((p) => ({
      date: p.date,
      dateLabel: format(new Date(`${p.date}T00:00:00`), 'MMM d'),
      fatMass: p.fatMassKg != null ? round1(massKgToDisplayRaw(p.fatMassKg, unitSystem)) : null,
      smm:
        p.skeletalMuscleMassKg != null
          ? round1(massKgToDisplayRaw(p.skeletalMuscleMassKg, unitSystem))
          : null,
      weight:
        p.weightKgSmoothed != null
          ? round1(massKgToDisplayRaw(p.weightKgSmoothed, unitSystem))
          : null,
    }));
  }, [trends, unitSystem]);

  if (locked) {
    return <LockCard title="Body composition trends" />;
  }
  if (!trends) return null;

  const hasChartData = chartData.some((d) => d.fatMass != null || d.smm != null || d.weight != null);
  const hasWeightSeries = chartData.some((d) => d.weight != null);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur-xl shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 sm:p-6 pb-0 sm:pb-0">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-indigo-400" aria-hidden="true" />
          <h2 className="text-base sm:text-lg font-semibold text-white">Trends</h2>
          <StateChip state={trends.state} />
        </div>
        {hasWeightSeries && (
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            Smoothed weight
            <Switch checked={showWeight} onCheckedChange={setShowWeight} />
          </label>
        )}
      </div>

      {/* Chart */}
      <div className="h-64 sm:h-80 p-3 sm:p-6">
        {!hasChartData ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-gray-400 text-center px-6">
              Log a few scans and your fat-mass and muscle lines will appear here.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="dateLabel" stroke="#94a3b8" className="text-xs" minTickGap={24} />
              <YAxis
                stroke="#94a3b8"
                className="text-xs"
                domain={['auto', 'auto']}
                width={40}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  color: '#fff',
                }}
                formatter={(value: unknown, name: unknown) => {
                  const label = typeof name === 'string' ? name : '';
                  if (typeof value !== 'number') return ['—', label];
                  return [`${value} ${unit}`, label];
                }}
              />
              <Line
                type="monotone"
                dataKey="fatMass"
                name="Fat mass"
                stroke={FAT_MASS_COLOR}
                strokeWidth={2.5}
                dot={{ r: 3, fill: FAT_MASS_COLOR, strokeWidth: 0 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="smm"
                name="Skeletal muscle"
                stroke={SMM_COLOR}
                strokeWidth={2.5}
                dot={{ r: 3, fill: SMM_COLOR, strokeWidth: 0 }}
                connectNulls
              />
              {showWeight && (
                <Line
                  type="monotone"
                  dataKey="weight"
                  name="Weight (smoothed)"
                  stroke={WEIGHT_COLOR}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="space-y-4 p-4 sm:p-6 pt-0 sm:pt-0">
        {/* Latest vs previous deltas with noise flags */}
        {trends.latestVsPrevious.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {trends.latestVsPrevious.map((d) => (
              <div
                key={d.metric}
                className="rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2"
              >
                <p className="text-[11px] uppercase tracking-wider text-gray-500">
                  {DELTA_METRIC_LABELS[d.metric] ?? d.metric}
                </p>
                <p
                  className={cn(
                    'text-sm font-semibold',
                    d.withinNoise ? 'text-gray-300' : 'text-white'
                  )}
                >
                  {formatDelta(d.metric, d.delta, unitSystem)}
                </p>
                {d.withinNoise && (
                  <p className="text-[11px] text-gray-500">within typical variation</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Projection — only when the server sends one */}
        {trends.projection && (
          <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-4 py-3">
            <p className="text-sm text-indigo-200">
              Projected to reach {trends.projection.goalBodyFatPct.toFixed(1)}% body fat between{' '}
              <span className="font-semibold">
                {format(new Date(`${trends.projection.earliestDate}T00:00:00`), 'MMM d, yyyy')}
              </span>{' '}
              and{' '}
              <span className="font-semibold">
                {format(new Date(`${trends.projection.latestDate}T00:00:00`), 'MMM d, yyyy')}
              </span>
              .
            </p>
          </div>
        )}

        {/* Server-authored insights — rendered verbatim */}
        {trends.insights.length > 0 && (
          <div className="space-y-2">
            {trends.insights.map((insight) => (
              <div
                key={insight.id}
                className="rounded-lg border border-slate-800 bg-slate-800/40 px-4 py-3"
              >
                <p className="text-sm font-semibold text-white">{insight.headline}</p>
                <p className="mt-0.5 text-sm text-gray-400">{insight.detail}</p>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-gray-500">{trends.disclaimer}</p>
      </div>
    </div>
  );
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
