'use client';

import { ArrowDown, ArrowUp, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { AdsMetrics, AdsRow, AdsTargets, GroupBy } from '@/lib/ads/types';
import { CHANNEL_LABEL } from '@/lib/ads/types';
import { cn } from '@/lib/utils';

import { count, money, pct, strategyLabel } from './format';
import { EntityStatus } from './parts';

export const GROUP_LABEL: Record<GroupBy, string> = {
  channel: 'Channel',
  platform: 'Platform',
  campaign: 'Campaign',
  ad_group: 'Ad group',
  keyword: 'Keyword',
  ad: 'Ad / creative',
};

type ColKey = keyof Pick<
  AdsMetrics,
  'spend' | 'impressions' | 'taps' | 'installs' | 'cpi' | 'users' | 'activated' | 'payers' | 'costPerUser' | 'costPerActivated' | 'costPerPayer' | 'revenueToDate' | 'roasD7' | 'roasD30' | 'roasToDate'
>;

interface Col {
  key: ColKey;
  label: string;
  fmt: (m: AdsMetrics) => string;
  /** Greyed when this cohort window is still open. */
  incomplete?: (m: AdsMetrics) => boolean;
  tone?: (m: AdsMetrics, t: AdsTargets) => 'good' | 'bad' | null;
  hideSm?: boolean;
}

export const METRIC_COLS: Col[] = [
  { key: 'spend', label: 'Spend', fmt: (m) => money(m.spend) },
  { key: 'impressions', label: 'Impr.', fmt: (m) => count(m.impressions), hideSm: true },
  { key: 'taps', label: 'Taps', fmt: (m) => count(m.taps), hideSm: true },
  { key: 'installs', label: 'Installs', fmt: (m) => count(m.installs) },
  { key: 'cpi', label: 'CPI', fmt: (m) => money(m.cpi) },
  { key: 'users', label: 'Users', fmt: (m) => count(m.users) },
  { key: 'activated', label: 'Activated', fmt: (m) => count(m.activated), incomplete: (m) => m.incomplete.activated },
  { key: 'payers', label: 'Payers', fmt: (m) => count(m.payers) },
  { key: 'costPerUser', label: '$/user', fmt: (m) => money(m.costPerUser) },
  { key: 'costPerActivated', label: '$/activated', fmt: (m) => money(m.costPerActivated), incomplete: (m) => m.incomplete.activated, hideSm: true },
  { key: 'costPerPayer', label: 'CAC', fmt: (m) => money(m.costPerPayer), tone: (m, t) => (m.costPerPayer === null ? null : m.costPerPayer <= t.costPerPayerMax ? 'good' : 'bad') },
  { key: 'revenueToDate', label: 'Revenue', fmt: (m) => money(m.revenueToDate) },
  { key: 'roasD7', label: 'ROAS D7', fmt: (m) => pct(m.roasD7), incomplete: (m) => m.incomplete.d7, tone: (m, t) => (m.roasD7 === null ? null : m.roasD7 >= t.roasD7Min ? 'good' : m.incomplete.d7 ? null : 'bad') },
  { key: 'roasD30', label: 'ROAS D30', fmt: (m) => pct(m.roasD30), incomplete: (m) => m.incomplete.d30, tone: (m, t) => (m.roasD30 === null ? null : m.roasD30 >= t.roasD30Min ? 'good' : m.incomplete.d30 ? null : 'bad') },
  { key: 'roasToDate', label: 'ROAS', fmt: (m) => pct(m.roasToDate) },
];

export function MetricCells({ m, targets, cols = METRIC_COLS }: { m: AdsMetrics; targets: AdsTargets; cols?: Col[] }) {
  return (
    <>
      {cols.map((c) => {
        const inc = c.incomplete?.(m) ?? false;
        const tone = c.tone?.(m, targets) ?? null;
        return (
          <td
            key={c.key}
            className={cn('whitespace-nowrap px-3 py-2.5 text-right tabular-nums', inc ? 'text-slate-500' : 'text-slate-200', tone === 'good' && !inc && 'text-emerald-300', tone === 'bad' && !inc && 'text-amber-300', c.hideSm && 'hidden md:table-cell')}
            title={inc ? 'Cohort window still open' : undefined}
          >
            {c.fmt(m)}
          </td>
        );
      })}
    </>
  );
}

export function MetricHeaders({ sort, onSort, cols = METRIC_COLS }: { sort?: { key: ColKey; desc: boolean }; onSort?: (k: ColKey) => void; cols?: Col[] }) {
  return (
    <>
      {cols.map((c) => (
        <th key={c.key} scope="col" className={cn('whitespace-nowrap px-3 py-2 text-right font-medium', c.hideSm && 'hidden md:table-cell')} aria-sort={sort?.key === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
          {onSort ? (
            <button type="button" onClick={() => onSort(c.key)} className={cn('inline-flex items-center gap-0.5 hover:text-white', sort?.key === c.key && 'text-white')}>
              {c.label}
              {sort?.key === c.key && (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
            </button>
          ) : (
            c.label
          )}
        </th>
      ))}
    </>
  );
}

export function BreakdownTable({
  rows,
  totals,
  targets,
  groupBy,
  onGroupBy,
  range,
}: {
  rows: AdsRow[];
  totals: AdsRow;
  targets: AdsTargets;
  groupBy: GroupBy;
  onGroupBy: (g: GroupBy) => void;
  range: { start: string; end: string };
}) {
  const [sort, setSort] = useState<{ key: ColKey; desc: boolean }>({ key: 'spend', desc: true });
  const [channel, setChannel] = useState<string>('all');
  const channels = useMemo(() => [...new Set(rows.map((r) => r.channel).filter(Boolean))] as string[], [rows]);
  const sorted = useMemo(() => {
    const list = rows.filter((r) => channel === 'all' || r.channel === channel);
    const val = (r: AdsRow) => r.metrics[sort.key];
    return [...list].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va === vb) return a.label.localeCompare(b.label);
      if (va === null) return 1; // nulls ("—") last either way
      if (vb === null) return -1;
      return sort.desc ? vb - va : va - vb;
    });
  }, [rows, sort, channel]);

  const onSort = (k: ColKey) => setSort((s) => (s.key === k ? { key: k, desc: !s.desc } : { key: k, desc: true }));
  const qs = `?start=${range.start}&end=${range.end}`;
  const hrefFor = (r: AdsRow) => (r.channel && r.campaignExternalId && r.level ? `/admin/ads/campaigns/${r.channel}/${encodeURIComponent(r.campaignExternalId)}${qs}` : null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-900/60 p-1 [scrollbar-width:none]" role="tablist" aria-label="Group by">
          {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={groupBy === g}
              onClick={() => onGroupBy(g)}
              className={cn('whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition', groupBy === g ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white')}
            >
              {GROUP_LABEL[g]}
            </button>
          ))}
        </div>
        {channels.length > 1 && (
          <select
            aria-label="Channel filter"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="h-8 rounded-lg border border-slate-800 bg-slate-950/60 px-2 text-xs text-slate-200 focus:border-purple-400 focus:outline-none"
          >
            <option value="all">All channels</option>
            {channels.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c as keyof typeof CHANNEL_LABEL] ?? c}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-slate-900 px-3 py-2 text-left font-medium">
                {GROUP_LABEL[groupBy]}
              </th>
              <MetricHeaders sort={sort} onSort={onSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={METRIC_COLS.length + 1} className="px-3 py-10 text-center text-sm text-slate-400">
                  Nothing in this range yet.
                </td>
              </tr>
            )}
            {sorted.map((r) => {
              const href = hrefFor(r);
              return (
                <tr key={r.key} className="group hover:bg-slate-800/30">
                  <th scope="row" className="sticky left-0 z-10 max-w-[280px] bg-slate-950/95 px-3 py-2.5 text-left font-normal group-hover:bg-slate-900">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate font-medium text-white">
                          {href ? (
                            <Link href={href} className="truncate hover:text-purple-200 hover:underline">
                              {r.label}
                            </Link>
                          ) : (
                            <span className="truncate">{r.label}</span>
                          )}
                          {r.entity && <EntityStatus status={r.entity.status} serving={r.entity.servingStatus} />}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">
                          {[r.sublabel, r.entity?.matchType?.toLowerCase(), r.entity?.bidAmount != null ? `bid ${money(r.entity.bidAmount)}` : null, r.level === 'campaign' && r.entity ? strategyLabel(r.entity.bidStrategy) : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      {href && <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-600 group-hover:text-slate-300" aria-hidden />}
                    </div>
                  </th>
                  <MetricCells m={r.metrics} targets={targets} />
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-slate-700 bg-slate-900/60 font-semibold">
            <tr>
              <th scope="row" className="sticky left-0 z-10 bg-slate-900 px-3 py-2.5 text-left text-white">
                Total
              </th>
              <MetricCells m={totals.metrics} targets={targets} />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">
        Users, activation, payers and revenue are by sign-up cohort (users who signed up in the range), attributed first-touch. Grey = cohort window still open. “—” = no denominator yet.
      </p>
    </div>
  );
}
