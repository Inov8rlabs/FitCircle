'use client';

import { AlertTriangle, CheckCircle2, CircleDashed, History, LayoutDashboard, Loader2, Megaphone, RefreshCw, XCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Btn } from '@/components/admin/campaigns/fields';
import { adsAdmin } from '@/lib/ads/admin-client';
import { addDays, diffDays, isYmd, todayInTz } from '@/lib/ads/dates';
import { CHANNEL_LABEL, type AdChannel, type ChannelSyncStatus } from '@/lib/ads/types';
import { CampaignApiError } from '@/lib/campaigns/admin-client';
import { cn } from '@/lib/utils';

import { dateTime, relTime } from './format';

/** Report time zone (matches the server default / Apple org time zone). */
export const REPORT_TZ = 'America/New_York';

// ---------------------------------------------------------------------------
// Header + nav
// ---------------------------------------------------------------------------

const NAV = [
  { href: '/admin/ads', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/ads/changes', label: 'Change log', icon: History, exact: false },
  { href: '/admin/campaigns', label: 'Campaigns', icon: Megaphone, exact: false },
];

export function AdsHeader({ title, subtitle, actions, back }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  const pathname = usePathname() ?? '';
  return (
    <div className="space-y-4">
      <nav className="flex gap-1 overflow-x-auto rounded-xl bg-slate-900/60 p-1 [scrollbar-width:none] sm:w-fit" aria-label="Admin">
        {NAV.map((n) => {
          const active = n.exact ? pathname === n.href || pathname.startsWith('/admin/ads/campaigns') : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition', active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white')}
            >
              <n.icon className="h-3.5 w-3.5" aria-hidden /> {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {back ? (
            <Link href={back.href} className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-300 hover:text-purple-200">
              ← {back.label}
            </Link>
          ) : (
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-purple-300">Ads console</p>
          )}
          <h1 className="mt-1 truncate text-3xl font-bold text-white">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-slate-400">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Panel({ title, description, actions, children, className }: { title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-slate-800 bg-slate-900/50 p-4 backdrop-blur-xl sm:p-5', className)}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-white">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
      {message}{' '}
      {onRetry && (
        <button type="button" onClick={onRetry} className="underline">
          Retry
        </button>
      )}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-20 text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

export const errorText = (e: unknown, fallback: string) => (e instanceof CampaignApiError ? `${e.message} (${e.status})` : fallback);

// ---------------------------------------------------------------------------
// Date range (URL state: ?start&end)
// ---------------------------------------------------------------------------

export interface Range {
  start: string;
  end: string;
}

export function useRangeParam(): [Range, (r: Range) => void, URLSearchParams] {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const search = useSearchParams();
  const today = todayInTz(REPORT_TZ);
  const start = search?.get('start');
  const end = search?.get('end');
  const range = useMemo<Range>(() => {
    const e = isYmd(end) ? end : today;
    const s = isYmd(start) && start <= e ? start : addDays(e, -6);
    return { start: s, end: e };
  }, [start, end, today]);
  const params = useMemo(() => new URLSearchParams(search?.toString() ?? ''), [search]);
  const set = useCallback(
    (r: Range) => {
      const p = new URLSearchParams(search?.toString() ?? '');
      p.set('start', r.start);
      p.set('end', r.end);
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [router, pathname, search]
  );
  return [range, set, params];
}

const PRESETS: { id: string; label: string; range: (today: string) => Range }[] = [
  { id: 'today', label: 'Today', range: (t) => ({ start: t, end: t }) },
  { id: 'yesterday', label: 'Yesterday', range: (t) => ({ start: addDays(t, -1), end: addDays(t, -1) }) },
  { id: '7d', label: '7D', range: (t) => ({ start: addDays(t, -6), end: t }) },
  { id: '14d', label: '14D', range: (t) => ({ start: addDays(t, -13), end: t }) },
  { id: '30d', label: '30D', range: (t) => ({ start: addDays(t, -29), end: t }) },
  { id: '90d', label: '90D', range: (t) => ({ start: addDays(t, -89), end: t }) },
];

export function DateRangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const today = todayInTz(REPORT_TZ);
  const active = PRESETS.find((p) => {
    const r = p.range(today);
    return r.start === value.start && r.end === value.end;
  })?.id;
  const [custom, setCustom] = useState(false);
  const input = 'h-8 rounded-lg border border-slate-700/80 bg-slate-950/60 px-2 text-xs text-white [color-scheme:dark] focus:border-purple-400 focus:outline-none';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-900/60 p-1 [scrollbar-width:none]" role="group" aria-label="Date range">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setCustom(false);
              onChange(p.range(today));
            }}
            className={cn('whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition', active === p.id && !custom ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white')}
            aria-pressed={active === p.id && !custom}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustom((c) => !c)}
          className={cn('whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition', custom || !active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white')}
          aria-pressed={custom || !active}
        >
          Custom
        </button>
      </div>
      {(custom || !active) && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            aria-label="Start date"
            className={input}
            value={value.start}
            max={value.end}
            onChange={(e) => isYmd(e.target.value) && onChange({ start: e.target.value, end: value.end })}
          />
          <span className="text-xs text-slate-500">→</span>
          <input
            type="date"
            aria-label="End date"
            className={input}
            value={value.end}
            min={value.start}
            max={today}
            onChange={(e) => isYmd(e.target.value) && onChange({ start: value.start, end: e.target.value })}
          />
        </div>
      )}
      <span className="text-[11px] text-slate-500">
        {diffDays(value.start, value.end) + 1} day{value.start === value.end ? '' : 's'} · ET
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sync status + Sync now
// ---------------------------------------------------------------------------

export function SyncBar({ status, onSynced }: { status: ChannelSyncStatus[]; onSynced: () => void }) {
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    setBusy(true);
    try {
      const res = await adsAdmin.syncNow();
      const results = (res.results ?? []) as Array<{ channel: AdChannel; ok: boolean; skipped?: string; error?: string | null; rowsMetrics?: number }>;
      const failed = results.filter((r) => !r.ok && r.skipped !== 'not_configured');
      if (failed.length) toast.error(`Sync failed: ${failed.map((f) => `${CHANNEL_LABEL[f.channel]}: ${f.error ?? 'error'}`).join('; ')}`);
      else if (results.every((r) => r.skipped)) toast.message(results.some((r) => r.skipped === 'debounced') ? 'Synced less than 2 min ago — nothing to do' : 'No channel is configured');
      else toast.success('Synced');
      onSynced();
    } catch (e) {
      toast.error(errorText(e, 'Sync failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status.map((s) => (
        <span
          key={s.channel}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/40 px-2.5 py-1 text-xs text-slate-300"
          title={s.error ? `Last error: ${s.error}` : s.finishedAt ? `Last synced ${dateTime(s.finishedAt)}` : undefined}
        >
          {!s.configured ? (
            <CircleDashed className="h-3.5 w-3.5 text-slate-500" aria-hidden />
          ) : s.ok === false ? (
            <XCircle className="h-3.5 w-3.5 text-rose-400" aria-hidden />
          ) : s.ok ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-amber-300" aria-hidden />
          )}
          <span className="font-medium text-white">{CHANNEL_LABEL[s.channel]}</span>
          <span className="text-slate-500">
            {!s.configured ? 'not connected' : s.ok === false ? `failed ${relTime(s.finishedAt)}` : `synced ${relTime(s.finishedAt)}`}
            {s.configured && !s.writeEnabled ? ' · read-only' : ''}
          </span>
        </span>
      ))}
      <Btn size="sm" onClick={() => void sync()} loading={busy}>
        {!busy && <RefreshCw className="h-3.5 w-3.5" />} Sync now
      </Btn>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status pill
// ---------------------------------------------------------------------------

export function EntityStatus({ status, serving }: { status: string | null; serving?: string | null }) {
  const s = (serving || status || '').toUpperCase();
  const tone = ['RUNNING', 'ACTIVE', 'ENABLED'].includes(s)
    ? 'bg-emerald-500/15 text-emerald-300'
    : ['PAUSED', 'ON_HOLD', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED'].includes(s)
      ? 'bg-amber-500/15 text-amber-200'
      : s
        ? 'bg-slate-700/50 text-slate-300'
        : 'bg-slate-800 text-slate-500';
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', tone)}>{(s || 'unknown').replace(/_/g, ' ').toLowerCase()}</span>;
}
