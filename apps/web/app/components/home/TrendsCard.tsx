'use client';

import { LineChart as LineIcon } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { CardTitleRow, GlassCard } from '@/components/ui/ios';
import { getWeightUnit, weightKgToDisplay, type UnitSystem } from '@/lib/utils/units';

import type { TrackingRow } from './useTracking';

const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** iOS chartsSection: weight trend for the last 14 readings. */
export function WeightTrendCard({ rows, unitSystem }: { rows: TrackingRow[]; unitSystem: UnitSystem }) {
  const data = rows
    .filter((r) => typeof r.weight_kg === 'number' && r.weight_kg > 0)
    .slice(0, 14)
    .reverse()
    .map((r) => ({ date: shortDate(r.tracking_date), weight: Number(weightKgToDisplay(r.weight_kg!, unitSystem).toFixed(1)) }));
  if (data.length < 2) return null;
  const values = data.map((d) => d.weight);
  const pad = Math.max(0.5, (Math.max(...values) - Math.min(...values)) * 0.2);
  return (
    <GlassCard data-testid="weight-trend-card">
      <CardTitleRow icon={LineIcon} tone="purple" title={`Weight progress (${getWeightUnit(unitSystem)})`} />
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="weight-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
            <YAxis
              domain={[Math.floor(Math.min(...values) - pad), Math.ceil(Math.max(...values) + pad)]}
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
              tickFormatter={(v: number) => String(Math.round(v))}
              width={36}
            />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, color: '#fff' }}
              labelStyle={{ color: '#94a3b8' }}
            />
            <Area type="monotone" dataKey="weight" stroke="#8b5cf6" strokeWidth={2.5} fill="url(#weight-fill)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}
