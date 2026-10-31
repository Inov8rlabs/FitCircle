'use client';

import { ArrowRight, CalendarRange, Radio, Timer, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { campaignsAdmin } from '@/lib/campaigns/admin-client';
import { dateRange } from '@/lib/campaigns/campaign-utils';
import type { AdminCampaign } from '@/lib/campaigns/types';
import { EngageApiError, engageAdmin, type OverviewData } from '@/lib/engage/client/admin-client';
import { CHANNEL_LABEL, PLACEMENT_LABEL } from '@/lib/engage/preview/content';
import { cn } from '@/lib/utils';

import { CHANNEL_COLOR, Callout, Card, Kpi, PageHeader, PlatformIcon, Skeleton, StatusPill, num, pct } from '../ui';

export function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [campaigns, setCampaigns] = useState<AdminCampaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    engageAdmin
      .overview()
      .then(setData)
      .catch((e) => setError(e instanceof EngageApiError ? e.message : 'Could not load the overview'));
    campaignsAdmin
      .list()
      .then(setCampaigns)
      .catch(() => setCampaigns([]));
  }, []);

  const t = data?.totals;
  const daily = data?.daily ?? [];
  const liveCampaigns = (campaigns ?? []).filter((c) => c.status === 'live');
  const nextCampaigns = (campaigns ?? []).filter((c) => c.status === 'scheduled').sort((a, b) => a.featuredFrom.localeCompare(b.featuredFrom)).slice(0, 3);

  return (
    <div className="space-y-6 py-6">
      <PageHeader eyebrow="FitCircle Engage" title="Overview" description="What’s live right now, what’s next, and how the last 7 days went." />
      {error && <Callout tone="error">{error}</Callout>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data ? (
          <>
            <Kpi label="Impressions · 7d" value={num(t?.impressions ?? 0)} spark={daily.map((d) => d.impressions)} />
            <Kpi label="Clicks · 7d" value={num(t?.clicks ?? 0)} sub={`${pct(t?.impressions ? (t.clicks ?? 0) / t.impressions : null)} CTR`} spark={daily.map((d) => d.clicks)} />
            <Kpi label="Conversions · 7d" value={num(t?.conversions ?? 0)} spark={daily.map((d) => d.conversions)} />
            <Kpi label="Live now" value={String((data.live?.length ?? 0) + liveCampaigns.length)} sub={`${data.live?.length ?? 0} message${data.live?.length === 1 ? '' : 's'} · ${liveCampaigns.length} campaign${liveCampaigns.length === 1 ? '' : 's'}`} />
          </>
        ) : (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-semibold text-white">
              <Radio className="h-4 w-4 text-emerald-400" /> Live now
            </p>
            <Link href="/admin/messages?" className="text-xs text-slate-400 hover:text-white">
              All messages →
            </Link>
          </div>
          {!data ? (
            <Skeleton className="h-40" />
          ) : data.live.length + liveCampaigns.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Nothing live. Launch a message or publish a campaign.</p>
          ) : (
            <ul className="divide-y divide-slate-800/70">
              {liveCampaigns.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/campaigns/${c.id}`} className="flex items-center gap-3 py-2.5 hover:text-purple-200">
                    <span className="text-xl">{c.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">{c.title}</span>
                      <span className="block text-xs text-slate-500">Campaign · {dateRange(c.startsAt, c.endsAt)}</span>
                    </span>
                    <StatusPill status="live" />
                  </Link>
                </li>
              ))}
              {data.live.map((m) => (
                <li key={m.id}>
                  <Link href={`/admin/messages/${m.id}`} className="flex items-center gap-3 py-2.5 hover:text-purple-200">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', CHANNEL_COLOR[m.channel])}>{CHANNEL_LABEL[m.channel]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">{m.name}</span>
                      <span className="block text-xs text-slate-500">
                        {m.placement ? PLACEMENT_LABEL[m.placement] : ''} {m.endsAt ? `· until ${new Date(m.endsAt).toLocaleDateString()}` : ''}
                      </span>
                    </span>
                    <span className="flex gap-1 text-slate-500">
                      {(m.platforms?.length ? m.platforms : (['ios', 'android', 'web'] as const)).map((p) => (
                        <PlatformIcon key={p} p={p} className="h-3 w-3" />
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Timer className="h-4 w-4 text-sky-300" /> Upcoming
          </p>
          {!data ? (
            <Skeleton className="h-40" />
          ) : data.upcoming.length + nextCampaigns.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Nothing scheduled.</p>
          ) : (
            <ul className="space-y-2">
              {nextCampaigns.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/campaigns/${c.id}`} className="flex items-center gap-3 rounded-xl bg-slate-950/40 p-2.5 hover:bg-slate-800/50">
                    <CalendarRange className="h-4 w-4 text-orange-300" />
                    <span className="min-w-0 flex-1 truncate text-sm text-white">
                      {c.emoji} {c.title}
                    </span>
                    <span className="text-xs text-slate-500">{dateRange(c.startsAt, c.endsAt)}</span>
                  </Link>
                </li>
              ))}
              {data.upcoming.map((m) => (
                <li key={m.id}>
                  <Link href={`/admin/messages/${m.id}`} className="flex items-center gap-3 rounded-xl bg-slate-950/40 p-2.5 hover:bg-slate-800/50">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', CHANNEL_COLOR[m.channel])}>{CHANNEL_LABEL[m.channel]}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-white">{m.name}</span>
                    <span className="text-xs text-slate-500">{new Date(m.startsAt).toLocaleDateString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <p className="mb-3 text-sm font-semibold text-white">Last 7 days</p>
          <div className="h-56">
            {daily.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ left: -16, right: 4, top: 4 }}>
                  <CartesianGrid stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={{ background: '#0b1023', border: '1px solid #1e293b', borderRadius: 12, fontSize: 12 }} />
                  <Bar dataKey="impressions" name="Impressions" fill="#a78bfa" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="clicks" name="Clicks" fill="#38bdf8" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="conversions" name="Conversions" fill="#34d399" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-slate-500">{data ? 'No activity yet' : ''}</p>
            )}
          </div>
        </Card>
        <Card>
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Trophy className="h-4 w-4 text-amber-300" /> Top messages · 7d
          </p>
          {(data?.top ?? []).length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">{data ? 'No data yet' : ''}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="pb-2 font-medium">Message</th>
                  <th className="pb-2 text-right font-medium">Clicks</th>
                  <th className="pb-2 text-right font-medium">CTR</th>
                  <th className="pb-2 text-right font-medium">Conv.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {data?.top?.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2">
                      <Link href={`/admin/messages/${m.id}?tab=analytics`} className="group flex items-center gap-1.5 text-white hover:text-purple-200">
                        <span className="truncate">{m.name}</span>
                        <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100" />
                      </Link>
                      <span className="text-[11px] text-slate-500">{CHANNEL_LABEL[m.channel]}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-slate-300">{num(m.clicks)}</td>
                    <td className="py-2 text-right tabular-nums text-slate-300">{pct(m.ctr)}</td>
                    <td className="py-2 text-right tabular-nums text-slate-300">{num(m.conversions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
