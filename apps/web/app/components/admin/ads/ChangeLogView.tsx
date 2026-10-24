'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { adsAdmin } from '@/lib/ads/admin-client';
import { CHANNEL_LABEL, type AdChangeLogEntry, type ChangeOutcome } from '@/lib/ads/types';
import { cn } from '@/lib/utils';

import { dateTime, money } from './format';
import { AdsHeader, ErrorBox, errorText, Panel, Spinner } from './parts';

const OUTCOME_TONE: Record<ChangeOutcome, string> = {
  applied: 'bg-emerald-500/15 text-emerald-300',
  dry_run: 'bg-slate-700/60 text-slate-300',
  rejected: 'bg-amber-500/15 text-amber-200',
  failed: 'bg-rose-500/15 text-rose-300',
};

const FIELD: Record<string, string> = { bid: 'Bid', daily_budget: 'Daily budget', status: 'Status' };
const fmt = (field: string, v: string | null) => (v === null ? '—' : field === 'status' ? v : money(Number(v)));

export function ChangeLogView() {
  const [rows, setRows] = useState<AdChangeLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | ChangeOutcome>('all');

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await adsAdmin.changes(300));
    } catch (e) {
      setError(errorText(e, 'Could not load the change log'));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => (rows ?? []).filter((r) => filter === 'all' || r.outcome === filter), [rows, filter]);

  return (
    <div className="space-y-6 py-6 sm:py-10">
      <AdsHeader title="Change log" subtitle="Every bid, budget and status change attempt: dry runs, rejections, failures and applied changes." />
      <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-900/60 p-1 [scrollbar-width:none] sm:w-fit">
        {(['all', 'applied', 'dry_run', 'rejected', 'failed'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn('whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition', filter === f ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white')}
          >
            {f === 'all' ? 'All' : f.replace('_', ' ')}
          </button>
        ))}
      </div>
      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!rows && !error && <Spinner />}
      {rows && (
        <Panel>
          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No changes yet. Edits made from a campaign page show up here.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-slate-400">
                  <tr className="border-b border-slate-800">
                    {['When', 'Who', 'Entity', 'Field', 'Old → new', 'Outcome', 'Detail'].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 text-left font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {visible.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-300">{dateTime(r.createdAt)}</td>
                      <td className="max-w-[180px] truncate px-3 py-2.5 text-slate-300">{r.actorName ?? r.actorEmail ?? 'API'}</td>
                      <td className="max-w-[260px] px-3 py-2.5">
                        <p className="truncate text-white">
                          {r.campaignExternalId ? (
                            <Link href={`/admin/ads/campaigns/${r.channel}/${encodeURIComponent(r.campaignExternalId)}`} className="hover:underline">
                              {r.entityName ?? r.externalId}
                            </Link>
                          ) : (
                            (r.entityName ?? r.externalId)
                          )}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {CHANNEL_LABEL[r.channel as keyof typeof CHANNEL_LABEL] ?? r.channel} · {r.level.replace('_', ' ')}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-slate-300">{FIELD[r.field] ?? r.field}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-slate-200">
                        {fmt(r.field, r.oldValue)} → {fmt(r.field, r.outcome === 'applied' ? r.newValue : r.requestedValue)}
                        {r.forced && <span className="ml-1.5 rounded bg-amber-500/15 px-1 text-[10px] text-amber-200">forced</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', OUTCOME_TONE[r.outcome])}>{r.outcome.replace('_', ' ')}</span>
                      </td>
                      <td className="max-w-[280px] px-3 py-2.5 text-xs text-slate-400">{r.error ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
