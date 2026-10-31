'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { EngageApiError, engageAdmin } from '@/lib/engage/client/admin-client';
import { PLATFORM_LABEL, PLATFORMS } from '@/lib/engage/preview/content';
import type { EngageMessage, EngagePlatform, MessageStats, VariantStats } from '@/lib/engage/types';
import { cn } from '@/lib/utils';

import { Callout, Card, Kpi, PlatformIcon, SegmentedControl, Skeleton, num, pct } from '../ui';

const RANGES = { '7': 7, '14': 14, '30': 30 } as const;

function sum(v: VariantStats[], k: keyof VariantStats): number {
  return v.reduce((s, x) => s + (typeof x[k] === 'number' ? (x[k]) : 0), 0);
}

export function significance(p: number | null | undefined): { label: string; tone: string } {
  if (p == null) return { label: '—', tone: 'text-slate-500' };
  if (p < 0.01) return { label: '99% significant', tone: 'bg-emerald-500/15 text-emerald-300' };
  if (p < 0.05) return { label: '95% significant', tone: 'bg-emerald-500/10 text-emerald-300' };
  if (p < 0.1) return { label: 'Trending', tone: 'bg-amber-500/10 text-amber-300' };
  return { label: 'Not significant', tone: 'bg-slate-800 text-slate-400' };
}

export function MessageAnalytics({ message }: { message: EngageMessage }) {
  const [range, setRange] = useState<keyof typeof RANGES>('14');
  const [platform, setPlatform] = useState<EngagePlatform | 'all'>('all');
  const [stats, setStats] = useState<MessageStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const to = new Date();
    const from = new Date(to.getTime() - RANGES[range] * 86_400_000);
    engageAdmin
      .stats(message.id, { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), platform })
      .then((s) => alive && (setStats(s), setError(null)))
      .catch((e) => alive && setError(e instanceof EngageApiError ? e.message : 'Could not load stats'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [message.id, range, platform]);

  const rows = useMemo(() => (stats?.variants ?? []).filter((v) => !v.platform || v.platform === 'all' || v.platform === platform), [stats, platform]);
  const treatment = rows.filter((v) => v.variantId !== 'control');
  const control = rows.find((v) => v.variantId === 'control');
  const isPush = message.channel === 'push';
  const isEmail = message.channel === 'email';

  const exposed = sum(treatment, 'exposedUsers');
  const imps = sum(treatment, 'uniqueImpressions');
  const clicks = sum(treatment, 'uniqueClicks');
  const conv = sum(treatment, 'conversions');
  const sent = sum(treatment, 'pushSent') || sum(treatment, 'emailSent');
  const opens = sum(treatment, 'pushOpens');
  const bestLift = treatment.reduce<VariantStats | null>((b, v) => (v.liftVsControl != null && (b == null || (b.liftVsControl ?? -Infinity) < v.liftVsControl) ? v : b), null);
  const daily = stats?.daily ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl value={range} onChange={setRange} options={[{ value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }]} />
        <SegmentedControl
          value={platform}
          onChange={setPlatform}
          options={[{ value: 'all' as const, label: 'All platforms' }, ...PLATFORMS.map((p) => ({ value: p, label: <span className="inline-flex items-center gap-1"><PlatformIcon p={p} className="h-3 w-3" /> {PLATFORM_LABEL[p]}</span> }))]}
        />
        {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
      </div>
      {error && <Callout tone="error">{error}</Callout>}

      {!stats && loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {isPush || isEmail ? (
            <>
              <Kpi label="Sent" value={num(sent)} spark={daily.map((d) => d.impressions)} />
              {isPush && <Kpi label="Opens" value={num(opens)} sub={`${pct(sent ? opens / sent : null)} open rate`} />}
              <Kpi label="Clicks" value={num(clicks)} />
            </>
          ) : (
            <>
              <Kpi label="Exposed users" value={num(exposed)} />
              <Kpi label="Impressions" value={num(imps)} sub={`${num(sum(treatment, 'impressions'))} total`} spark={daily.map((d) => d.impressions)} />
              <Kpi label="CTR" value={pct(imps ? clicks / imps : null)} sub={`${num(clicks)} unique clicks`} spark={daily.map((d) => d.clicks)} />
            </>
          )}
          <Kpi label="Conversions" value={num(conv)} sub={`${pct(exposed ? conv / exposed : null)} of exposed`} spark={daily.map((d) => d.conversions)} />
          <Kpi
            label="Best lift vs control"
            value={bestLift?.liftVsControl != null ? `${bestLift.liftVsControl >= 0 ? '+' : ''}${(bestLift.liftVsControl * 100).toFixed(1)}%` : '—'}
            sub={bestLift ? `Variant ${bestLift.variantId} · ${significance(bestLift.pValue).label}` : control ? 'Not enough data' : 'No control group'}
            tone={bestLift?.liftVsControl != null ? (bestLift.liftVsControl >= 0 ? 'up' : 'down') : 'neutral'}
          />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <p className="mb-3 text-sm font-semibold text-white">Daily</p>
          <div className="h-64">
            {daily.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daily} margin={{ left: -16, right: 8, top: 4 }}>
                  <defs>
                    {[['imp', '#a78bfa'], ['clk', '#38bdf8'], ['cnv', '#34d399']].map(([id, c]) => (
                      <linearGradient key={id} id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor={c} stopOpacity={0.35} />
                        <stop offset="1" stopColor={c} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: '#0b1023', border: '1px solid #1e293b', borderRadius: 12, fontSize: 12 }} labelStyle={{ color: '#e2e8f0' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="impressions" name={isPush || isEmail ? 'Sent' : 'Impressions'} stroke="#a78bfa" fill="url(#g-imp)" strokeWidth={2} isAnimationActive={false} />
                  <Area type="monotone" dataKey="clicks" name="Clicks" stroke="#38bdf8" fill="url(#g-clk)" strokeWidth={2} isAnimationActive={false} />
                  <Area type="monotone" dataKey="conversions" name="Conversions" stroke="#34d399" fill="url(#g-cnv)" strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-slate-500">No data yet</p>
            )}
          </div>
        </Card>
        <Card>
          <p className="mb-3 text-sm font-semibold text-white">Funnel</p>
          <Funnel
            steps={
              isPush
                ? [
                    { label: 'Sent', value: sent },
                    { label: 'Opened', value: opens },
                    { label: 'Converted', value: conv },
                  ]
                : isEmail
                  ? [
                      { label: 'Sent', value: sent },
                      { label: 'Clicked', value: clicks },
                      { label: 'Converted', value: conv },
                    ]
                  : [
                      { label: 'Eligible', value: exposed },
                      { label: 'Impression', value: imps },
                      { label: 'Click', value: clicks },
                      { label: 'Conversion', value: conv },
                    ]
            }
          />
        </Card>
      </div>

      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3">
          <p className="text-sm font-semibold text-white">Variants</p>
          {message.conversion && <p className="text-xs text-slate-500">Goal: {message.conversion.event} within {message.conversion.windowHours} h of {message.conversion.basis}</p>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-y border-slate-800 bg-slate-950/40 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-2 font-medium">Variant</th>
                <th className="px-3 py-2 text-right font-medium">Exposed</th>
                <th className="px-3 py-2 text-right font-medium">{isPush || isEmail ? 'Sent' : 'Impressions'}</th>
                <th className="px-3 py-2 text-right font-medium">Clicks</th>
                <th className="px-3 py-2 text-right font-medium">CTR</th>
                <th className="px-3 py-2 text-right font-medium">Conversions</th>
                <th className="px-3 py-2 text-right font-medium">Conv. rate</th>
                <th className="px-3 py-2 text-right font-medium">Lift</th>
                <th className="px-5 py-2 font-medium">Significance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-slate-500">
                    No exposures yet.
                  </td>
                </tr>
              )}
              {rows.map((v) => {
                const name = v.variantId === 'control' ? 'Control (holdout)' : message.variants.find((x) => x.id === v.variantId)?.name ?? `Variant ${v.variantId}`;
                const s = significance(v.pValue);
                return (
                  <tr key={`${v.variantId}-${v.platform ?? 'all'}`} className={cn(v.variantId === 'control' && 'bg-slate-950/30 text-slate-400')}>
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-white">{v.variantId === 'control' ? 'CTL' : v.variantId}</span> <span className="text-slate-400">{name}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(v.exposedUsers)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(isPush ? v.pushSent ?? 0 : isEmail ? v.emailSent ?? 0 : v.uniqueImpressions)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(v.uniqueClicks)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{pct(v.ctr)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(v.conversions)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{pct(v.conversionRate)}</td>
                    <td className={cn('px-3 py-2.5 text-right tabular-nums', v.liftVsControl == null ? '' : v.liftVsControl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                      {v.variantId === 'control' ? 'baseline' : v.liftVsControl == null ? '—' : `${v.liftVsControl >= 0 ? '+' : ''}${(v.liftVsControl * 100).toFixed(1)}%`}
                    </td>
                    <td className="px-5 py-2.5">
                      {v.variantId !== 'control' && (
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', s.tone)} title={v.pValue != null ? `p = ${v.pValue.toFixed(4)}` : undefined}>
                          {s.label}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <div className="space-y-2.5">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        return (
          <div key={s.label}>
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-slate-300">{s.label}</span>
              <span className="tabular-nums text-slate-400">
                {num(s.value)}
                {prev ? <span className="ml-1.5 text-slate-500">{pct(prev ? s.value / prev : null)}</span> : null}
              </span>
            </div>
            <div className="h-7 overflow-hidden rounded-lg bg-slate-800/60">
              <div className="h-full rounded-lg bg-gradient-to-r from-purple-500 to-fuchsia-500 transition-all" style={{ width: `${Math.max(2, (s.value / top) * 100)}%`, opacity: 1 - i * 0.15 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
