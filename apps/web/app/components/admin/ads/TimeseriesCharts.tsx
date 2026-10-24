'use client';

/**
 * Spend vs outcomes over time, as three small multiples (one y-axis each —
 * money, people, ROAS) instead of a dual-axis chart. Users / payers / revenue
 * are by sign-up day (cohort), spend by report day. Colors validated for the
 * dark surface (dataviz validator): spend #8b5cf6, revenue #059669; people
 * #0284c7 / #d97706 / #059669 (CVD-adjacent pair carries legend + markers).
 */
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { AdsTargets, TimeseriesPoint } from '@/lib/ads/types';

import { count, money, pct, shortDay } from './format';

const C = { spend: '#8b5cf6', revenue: '#059669', users: '#0284c7', activated: '#d97706', payers: '#059669', roas: '#8b5cf6' };
const AXIS = { stroke: '#64748b', fontSize: 11, tickLine: false, axisLine: false } as const;
const GRID = <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />;

function TipBox({ active, payload, label, fmt }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string; dataKey?: string }>; label?: string; fmt: (k: string, v: number | null) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-ios-md">
      <p className="mb-1 font-semibold text-white">{label ? shortDay(label) : ''}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center justify-between gap-4 text-slate-300">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
            {p.name}
          </span>
          <span className="tabular-nums text-white">{fmt(String(p.dataKey), (p.value as number | null) ?? null)}</span>
        </p>
      ))}
    </div>
  );
}

function ChartCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-hairline bg-slate-900/60 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
        <p className="text-sm font-semibold text-white">{title}</p>
        {note && <p className="text-[11px] text-slate-500">{note}</p>}
      </div>
      <div className="h-56">{children}</div>
    </div>
  );
}

const legendStyle = { fontSize: 11, color: '#94a3b8', paddingTop: 4 };

export function TimeseriesCharts({ points, targets }: { points: TimeseriesPoint[]; targets: AdsTargets }) {
  const hasData = points.some((p) => p.spend > 0 || p.users > 0);
  if (!hasData) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 px-4 py-10 text-center text-sm text-slate-400">
        No spend or sign-ups in this range yet. Apple reports lag a few hours; new campaigns show up after the first delivery.
      </div>
    );
  }
  const money$ = (k: string, v: number | null) => (k === 'cumulativeRoas' ? pct(v) : ['spend', 'revenue'].includes(k) ? money(v) : count(v));
  const sparse = points.length <= 3;
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <ChartCard title="Spend vs revenue" note="revenue by sign-up day, to date">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
            {GRID}
            <XAxis dataKey="date" tickFormatter={shortDay} {...AXIS} minTickGap={16} />
            <YAxis {...AXIS} width={48} tickFormatter={(v: number) => `$${v}`} />
            <Tooltip content={<TipBox fmt={money$} />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
            <Bar dataKey="spend" name="Spend" fill={C.spend} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Line dataKey="revenue" name="Revenue" stroke={C.revenue} strokeWidth={2} dot={{ r: sparse ? 4 : 2.5, strokeWidth: 0, fill: C.revenue }} activeDot={{ r: 5 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Users, activated, payers" note="by sign-up day">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {GRID}
            <XAxis dataKey="date" tickFormatter={shortDay} {...AXIS} minTickGap={16} />
            <YAxis {...AXIS} width={32} allowDecimals={false} />
            <Tooltip content={<TipBox fmt={money$} />} cursor={{ stroke: 'rgba(255,255,255,0.2)' }} />
            <Legend wrapperStyle={legendStyle} iconType="circle" iconSize={8} />
            <Line dataKey="users" name="Users" stroke={C.users} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: C.users }} />
            <Line dataKey="activated" name="Activated" stroke={C.activated} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3, strokeWidth: 0, fill: C.activated }} />
            <Line dataKey="payers" name="Payers" stroke={C.payers} strokeWidth={2} dot={{ r: 4, strokeWidth: 0, fill: C.payers }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Cumulative ROAS" note="dashed: D7 / D30 / 12-month targets">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {GRID}
            <XAxis dataKey="date" tickFormatter={shortDay} {...AXIS} minTickGap={16} />
            <YAxis {...AXIS} width={40} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} domain={[0, (max: number) => Math.max(max, targets.roas12mMin) * 1.1]} />
            <Tooltip content={<TipBox fmt={money$} />} cursor={{ stroke: 'rgba(255,255,255,0.2)' }} />
            <ReferenceLine y={targets.roasD7Min} stroke="#64748b" strokeDasharray="4 4" label={{ value: 'D7', position: 'insideTopLeft', fill: '#94a3b8', fontSize: 10 }} />
            <ReferenceLine y={targets.roasD30Min} stroke="#64748b" strokeDasharray="4 4" label={{ value: 'D30', position: 'insideTopLeft', fill: '#94a3b8', fontSize: 10 }} />
            <ReferenceLine y={targets.roas12mMin} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: '12-mo 100%', position: 'insideTopLeft', fill: '#94a3b8', fontSize: 10 }} />
            <Line dataKey="cumulativeRoas" name="ROAS to date" stroke={C.roas} strokeWidth={2} connectNulls dot={{ r: sparse ? 4 : 2.5, strokeWidth: 0, fill: C.roas }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
