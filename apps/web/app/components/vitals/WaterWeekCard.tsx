'use client';

import { Droplet, Pencil } from 'lucide-react';
import { useMemo } from 'react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { VitalsWater } from '@/lib/types/vitals';
import { cn } from '@/lib/utils';
import type { UnitSystem } from '@/lib/utils/units';

import { formatVolume, mlToVolume, volumeUnit, weekdayInitial } from './format';

interface WaterWeekCardProps {
  water: VitalsWater | null;
  /** `period.end` — the user's local today; that bar is emphasised. */
  today?: string;
  unitSystem: UnitSystem;
  loading?: boolean;
  onEditGoal: () => void;
}

const CYAN = '#06b6d4';
const EMERALD = '#10b981';

interface DayPoint {
  date: string;
  label: string;
  value: number;
  ml: number;
  goalMet: boolean;
  isToday: boolean;
}

/** X tick: weekday initial, brighter and bold for today. */
function DayTick(props: { x?: number; y?: number; payload?: { value: string }; data: DayPoint[] }) {
  const { x = 0, y = 0, payload, data } = props;
  const point = data.find((d) => d.date === payload?.value);
  return (
    <text
      x={x}
      y={y + 12}
      textAnchor="middle"
      fontSize={11}
      fontWeight={point?.isToday ? 700 : 500}
      fill={point?.isToday ? '#ffffff' : '#6b7280'}
    >
      {point?.label ?? ''}
    </text>
  );
}

/**
 * Water this week (VITALS_CLIENT_CONTRACT.md §3): one bar per day from
 * `water.days`, dashed goal line, weekday initials. Full width.
 */
export function WaterWeekCard({ water, today, unitSystem, loading, onEditGoal }: WaterWeekCardProps) {
  const unit = volumeUnit(unitSystem);

  const data = useMemo<DayPoint[]>(() => {
    if (!water) return [];
    const last = water.days[water.days.length - 1]?.date;
    return water.days.map((d) => ({
      date: d.date,
      label: weekdayInitial(d.date),
      value: mlToVolume(d.ml, unitSystem),
      ml: d.ml,
      goalMet: d.goal_met,
      isToday: d.date === (today ?? last),
    }));
  }, [water, unitSystem, today]);

  const goalValue = water ? mlToVolume(water.goal_ml, unitSystem) : 0;
  const maxValue = Math.max(goalValue * 1.15, ...data.map((d) => d.value));
  const reached = (water?.pct ?? 0) >= 100;
  const dayCount = water?.days.length ?? 7;

  return (
    <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
      <CardHeader className="p-4 sm:p-6 pb-2 sm:pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
              <Droplet className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-white text-base sm:text-lg">Water this week</CardTitle>
              {water ? (
                <p className="text-xs text-gray-400 tabular-nums">
                  {formatVolume(water.total_ml, unitSystem)} / {formatVolume(water.total_goal_ml, unitSystem)}
                  <span className="text-gray-600"> · </span>
                  {reached ? (
                    <span className="text-emerald-400">Goal reached!</span>
                  ) : (
                    <>
                      {water.days_met} of {dayCount} days met
                    </>
                  )}
                </p>
              ) : (
                <p className="text-xs text-gray-400">{loading ? 'Loading…' : 'No data'}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {water && (
              <span
                className={cn(
                  'text-3xl sm:text-4xl font-bold tabular-nums leading-none',
                  reached ? 'text-emerald-400' : 'text-cyan-400'
                )}
              >
                {Math.round(water.pct)}%
              </span>
            )}
            <button
              type="button"
              onClick={onEditGoal}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-slate-800/60 transition-colors"
              aria-label="Edit water goal"
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden />
              Edit
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-6 pt-2 sm:pt-3">
        {water ? (
          <>
            <div className="h-40 sm:h-44 -ml-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    tick={<DayTick data={data} />}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={unitSystem === 'imperial' ? 40 : 34}
                    domain={[0, Math.ceil(maxValue)]}
                    tick={{ fill: '#6b7280', fontSize: 11 }}
                    tickFormatter={(v: number) => `${unitSystem === 'imperial' ? Math.round(v) : v}${unit}`}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      border: '1px solid #1e293b',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    labelStyle={{ color: '#9ca3af' }}
                    itemStyle={{ color: '#e5e7eb' }}
                    labelFormatter={(_label, payload) => {
                      const p = payload?.[0]?.payload as DayPoint | undefined;
                      return p ? `${p.label} · ${p.date}` : '';
                    }}
                    formatter={(_value, _name, item) => {
                      const p = item?.payload as DayPoint | undefined;
                      return [p ? formatVolume(p.ml, unitSystem) : '', p?.goalMet ? 'Goal met' : 'Water'];
                    }}
                  />
                  <ReferenceLine
                    y={goalValue}
                    stroke="#94a3b8"
                    strokeDasharray="4 4"
                    strokeOpacity={0.7}
                    ifOverflow="extendDomain"
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
                    {data.map((d) => (
                      <Cell
                        key={d.date}
                        fill={d.goalMet ? EMERALD : CYAN}
                        fillOpacity={d.isToday ? 1 : 0.7}
                        stroke={d.isToday ? '#ffffff' : 'none'}
                        strokeWidth={d.isToday ? 1 : 0}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-gray-500 tabular-nums">
              Daily goal {formatVolume(water.goal_ml, unitSystem)}
              {water.goal_source === 'default' && <span className="text-gray-600"> (default)</span>}
              <span className="text-gray-600"> · </span>
              Today {formatVolume(water.today_ml, unitSystem)}
            </p>
          </>
        ) : (
          <div className="h-40 sm:h-44 rounded-lg bg-slate-800/40 animate-pulse" aria-hidden />
        )}
      </CardContent>
    </Card>
  );
}
