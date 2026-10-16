'use client';

import { CalendarDays, Copy, ExternalLink, Gift, Loader2, Megaphone, Plus, RefreshCw, Search, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { CampaignHero } from '@/components/campaigns/CampaignHero';
import { campaignsAdmin, CampaignApiError } from '@/lib/campaigns/admin-client';
import { addDays, dateRange, diffDays, isYmd, shortDate, toInput, todayYmd } from '@/lib/campaigns/campaign-utils';
import type { AdminCampaign, CampaignStatus, CampaignTemplate } from '@/lib/campaigns/types';
import { cn } from '@/lib/utils';

import { Btn, StatusPill } from './fields';

const TEMPLATE_LABEL: Record<CampaignTemplate, { label: string; icon: typeof Gift }> = {
  seasonal_circle: { label: 'Seasonal circle', icon: Sparkles },
  daily_calendar: { label: 'Daily calendar', icon: Gift },
  spotlight: { label: 'Spotlight', icon: Megaphone },
};

const FILTERS: { id: 'all' | CampaignStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'draft', label: 'Drafts' },
  { id: 'ended', label: 'Ended' },
  { id: 'archived', label: 'Archived' },
];

const ORDER: Record<CampaignStatus, number> = { live: 0, scheduled: 1, draft: 2, ended: 3, archived: 4 };

export function CampaignList() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<AdminCampaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCampaigns(await campaignsAdmin.list());
    } catch (e) {
      setError(e instanceof CampaignApiError ? `${e.message} (${e.status})` : 'Could not load campaigns');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (campaigns ?? [])
      .filter((c) => (filter === 'all' ? c.status !== 'archived' : c.status === filter))
      .filter((c) => !q || `${c.title} ${c.slug} ${c.tagline}`.toLowerCase().includes(q))
      .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.startsAt.localeCompare(b.startsAt));
  }, [campaigns, filter, query]);

  // Shared timeline window across visible campaigns.
  const span = useMemo(() => {
    const list = visible.filter((c) => isYmd(c.startsAt) && isYmd(c.endsAt));
    if (!list.length) return null;
    const start = list.reduce((m, c) => ((c.featuredFrom || c.startsAt) < m ? c.featuredFrom || c.startsAt : m), list[0].featuredFrom || list[0].startsAt);
    const end = list.reduce((m, c) => (c.endsAt > m ? c.endsAt : m), list[0].endsAt);
    return { start, end: addDays(end, 2), days: Math.max(1, diffDays(start, addDays(end, 2)) + 1) };
  }, [visible]);

  const duplicate = async (c: AdminCampaign) => {
    setBusyId(c.id);
    try {
      const input = toInput(c);
      const copy = await campaignsAdmin.create({ ...input, slug: `${c.slug}_copy`.slice(0, 40), title: `${c.title} (copy)`.slice(0, 40), appStore: { ...input.appStore, eventId: null, state: null, lastSyncedAt: null, lastError: null } });
      toast.success('Duplicated as a draft');
      router.push(`/admin/campaigns/${copy.id}`);
    } catch (e) {
      toast.error(e instanceof CampaignApiError ? e.message : 'Duplicate failed');
      setBusyId(null);
    }
  };

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of campaigns ?? []) m[c.status] = (m[c.status] ?? 0) + 1;
    return m;
  }, [campaigns]);

  return (
    <div className="space-y-6 py-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-300">Admin</p>
          <h1 className="mt-1 text-3xl font-bold text-white">Campaigns</h1>
          <p className="mt-1 text-sm text-slate-400">Dated marketing moments the apps render natively: in-app, push, email, App Store and Play.</p>
        </div>
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={() => void load()} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Btn>
          <Link href="/admin/campaigns/new" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 px-3.5 text-sm font-medium text-white shadow-lg shadow-purple-900/30 hover:brightness-110">
            <Plus className="h-4 w-4" /> New campaign
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-900/60 p-1 [scrollbar-width:none]">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn('whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition', filter === f.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white')}
            >
              {f.label}
              {f.id !== 'all' && counts[f.id] ? <span className="ml-1.5 text-slate-500">{counts[f.id]}</span> : null}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-9 w-full rounded-lg border border-slate-800 bg-slate-950/60 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-purple-400 focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
          {error}{' '}
          <button type="button" onClick={() => void load()} className="underline">
            Retry
          </button>
        </div>
      )}

      {!campaigns && !error && (
        <div className="flex justify-center py-20 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}

      {campaigns && visible.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-800 py-16 text-center">
          <p className="text-4xl">🗓️</p>
          <p className="mt-3 font-semibold text-white">{campaigns.length ? 'Nothing matches' : 'No campaigns yet'}</p>
          <Link href="/admin/campaigns/new" className="mt-3 inline-block text-sm text-purple-300 hover:underline">
            Create the first one →
          </Link>
        </div>
      )}

      <ul className="space-y-3">
        {visible.map((c) => {
          const T = TEMPLATE_LABEL[c.template] ?? TEMPLATE_LABEL.spotlight;
          return (
            <li key={c.id} className="group rounded-2xl border border-slate-800 bg-slate-900/50 transition hover:border-slate-700">
              <div className="flex flex-col gap-4 p-3 sm:flex-row sm:items-center sm:p-4">
                <Link href={`/admin/campaigns/${c.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                  <CampaignHero art={c.art?.inAppHero?.url ?? c.art?.appStoreCard?.url} palette={c.palette} emoji={c.emoji} className="h-16 w-28 shrink-0 rounded-xl ring-1 ring-white/10" size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold text-white">
                        {c.title} <span aria-hidden>{c.emoji}</span>
                      </p>
                      <StatusPill status={c.status} />
                      {c.legacySeasonKey && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">legacy: {c.legacySeasonKey}</span>}
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <T.icon className="h-3.5 w-3.5" /> {T.label}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" /> {dateRange(c.startsAt, c.endsAt)}
                      </span>
                      <span className="font-mono text-slate-500">/c/{c.slug}</span>
                      {c.priority ? <span>priority {c.priority}</span> : null}
                    </p>
                    {span && <Timeline c={c} span={span} />}
                  </div>
                </Link>
                <div className="flex shrink-0 gap-1.5 sm:flex-col lg:flex-row">
                  <Btn size="sm" onClick={() => router.push(`/admin/campaigns/${c.id}`)}>
                    Edit
                  </Btn>
                  <Btn size="sm" variant="ghost" loading={busyId === c.id} onClick={() => void duplicate(c)} aria-label="Duplicate">
                    <Copy className="h-3.5 w-3.5" />
                  </Btn>
                  {c.published && (
                    <a href={`/c/${c.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-lg px-2.5 text-slate-300 hover:bg-slate-800" aria-label="Open page">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Timeline({ c, span }: { c: AdminCampaign; span: { start: string; days: number } }) {
  const pct = (d: string) => Math.min(100, Math.max(0, (diffDays(span.start, d) / span.days) * 100));
  const teaserFrom = c.featuredFrom && c.featuredFrom < c.startsAt ? c.featuredFrom : c.startsAt;
  const today = todayYmd();
  const todayPct = pct(today);
  return (
    <div className="relative mt-2 h-1.5 max-w-xl rounded-full bg-slate-800" title={`Teaser ${shortDate(teaserFrom)} · Live ${dateRange(c.startsAt, c.endsAt)}`}>
      <div className="absolute inset-y-0 rounded-full bg-sky-500/40" style={{ left: `${pct(teaserFrom)}%`, width: `${pct(c.startsAt) - pct(teaserFrom)}%` }} />
      <div className="absolute inset-y-0 rounded-full" style={{ left: `${pct(c.startsAt)}%`, width: `${Math.max(1, pct(addDays(c.endsAt, 1)) - pct(c.startsAt))}%`, background: c.accent }} />
      {todayPct > 0 && todayPct < 100 && <div className="absolute -top-1 h-3.5 w-px bg-white/70" style={{ left: `${todayPct}%` }} />}
    </div>
  );
}
