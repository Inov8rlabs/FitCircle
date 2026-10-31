'use client';

import { Loader2, MessageSquare, Pause, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { EngageApiError, engageAdmin, type MessageListItem } from '@/lib/engage/client/admin-client';
import { CHANNEL_LABEL, LAYOUT_LABEL, PLACEMENT_LABEL, PLATFORM_LABEL } from '@/lib/engage/preview/content';
import type { EngageChannel, MessageStatus } from '@/lib/engage/types';
import { cn } from '@/lib/utils';

import { Btn, CHANNEL_COLOR, Callout, EmptyState, PageHeader, PlatformIcon, Skeleton, Sparkline, StatusPill, inputCls, num, pct } from '../ui';

const STATUSES: ('all' | MessageStatus)[] = ['all', 'live', 'scheduled', 'draft', 'paused', 'ended', 'archived'];

export function MessageList({ channel, campaignId, embedded }: { channel?: EngageChannel | null; campaignId?: string | null; embedded?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<MessageListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'all' | MessageStatus>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await engageAdmin.listMessages({ channel: channel ?? undefined, campaignId: campaignId ?? undefined }));
    } catch (e) {
      setError(e instanceof EngageApiError ? e.message : 'Could not load messages');
    }
  }, [channel, campaignId]);
  useEffect(() => {
    setItems(null);
    setSelected(new Set());
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (items ?? [])
      .filter((m) => (status === 'all' ? m.status !== 'archived' : m.status === status))
      .filter((m) => !n || m.name.toLowerCase().includes(n))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [items, status, q]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of items ?? []) c[m.status] = (c[m.status] ?? 0) + 1;
    return c;
  }, [items]);

  const bulkPause = async () => {
    setBusy(true);
    const ids = Array.from(selected).filter((id) => ['live', 'scheduled'].includes(items?.find((m) => m.id === id)?.status ?? ''));
    const res = await Promise.allSettled(ids.map((id) => engageAdmin.action(id, 'pause')));
    const ok = res.filter((r) => r.status === 'fulfilled').length;
    toast[ok === ids.length ? 'success' : 'error'](`Paused ${ok} of ${ids.length}`);
    setSelected(new Set());
    setBusy(false);
    void load();
  };

  const newHref = `/admin/messages/new?channel=${channel ?? 'content_card'}${campaignId ? `&campaignId=${campaignId}` : ''}`;
  const allChecked = visible.length > 0 && visible.every((m) => selected.has(m.id));

  return (
    <div className={cn('space-y-5', !embedded && 'py-6')}>
      {!embedded && (
        <PageHeader
          eyebrow="Messages"
          title={channel ? `${CHANNEL_LABEL[channel]}${channel === 'content_card' ? 's' : ''}` : 'All messages'}
          description={
            channel === 'content_card'
              ? 'Cards that fill Home, Circles, Profile and the check-in celebration.'
              : channel === 'in_app'
                ? 'Modals, slide-ups and full-screen messages triggered by app events.'
                : channel === 'push'
                  ? 'iOS + Android notifications, capped and quiet-hours aware.'
                  : channel === 'email'
                    ? 'Branded email to opted-in users.'
                    : 'Every message across channels.'
          }
          actions={
            <Link href={newHref} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 px-3.5 text-sm font-medium text-white shadow-lg shadow-purple-900/30 hover:brightness-110">
              <Plus className="h-4 w-4" /> New {channel ? CHANNEL_LABEL[channel].toLowerCase() : 'message'}
            </Link>
          }
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-900/60 p-1 [scrollbar-width:none]">
          {STATUSES.map((s) => (
            <button key={s} type="button" onClick={() => setStatus(s)} className={cn('whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition', status === s ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white')}>
              {s}
              {s !== 'all' && counts[s] ? <span className="ml-1.5 text-slate-500">{counts[s]}</span> : null}
            </button>
          ))}
        </div>
        {selected.size > 0 && (
          <Btn size="sm" variant="danger" onClick={() => void bulkPause()} loading={busy}>
            <Pause className="h-3.5 w-3.5" /> Pause {selected.size}
          </Btn>
        )}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name" className={cn(inputCls, 'pl-9')} />
        </div>
        {embedded && (
          <Link href={newHref} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 text-sm text-white hover:bg-slate-800">
            <Plus className="h-4 w-4" /> New message
          </Link>
        )}
      </div>

      {error && (
        <Callout tone="error">
          {error}{' '}
          <button type="button" className="underline" onClick={() => void load()}>
            Retry
          </button>
        </Callout>
      )}

      {!items && !error ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : items && visible.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="h-10 w-10" />}
          title={items.length ? 'Nothing matches' : 'No messages yet'}
          body="Create a content card, in-app message, push or email."
          action={
            <Link href={newHref} className="text-sm text-purple-300 hover:underline">
              Create one →
            </Link>
          }
        />
      ) : items ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900/40">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-slate-800 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="w-10 px-4 py-2.5">
                  <input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(visible.map((m) => m.id)))} className="accent-purple-500" aria-label="Select all" />
                </th>
                <th className="py-2.5 font-medium">Message</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Platforms</th>
                <th className="px-3 py-2.5 font-medium">Impressions · 14d</th>
                <th className="px-3 py-2.5 text-right font-medium">CTR</th>
                <th className="px-3 py-2.5 text-right font-medium">Conversions</th>
                <th className="px-4 py-2.5 text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {visible.map((m) => (
                <tr key={m.id} className="cursor-pointer transition hover:bg-slate-800/30" onClick={() => router.push(`/admin/messages/${m.id}`)}>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => setSelected((s) => {
                        const n = new Set(s);
                        if (n.has(m.id)) n.delete(m.id);
                        else n.add(m.id);
                        return n;
                      })}
                      className="accent-purple-500"
                      aria-label={`Select ${m.name}`}
                    />
                  </td>
                  <td className="py-3 pr-3">
                    <p className="font-medium text-white">{m.name || 'Untitled'}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', CHANNEL_COLOR[m.channel])}>{CHANNEL_LABEL[m.channel]}</span>
                      {m.placement && PLACEMENT_LABEL[m.placement]}
                      {m.layout && ` · ${LAYOUT_LABEL[m.layout]}`}
                      {m.variants.length > 1 && ` · ${m.variants.length} variants`}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <StatusPill status={m.status} />
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex gap-1 text-slate-400" title={(m.platforms.length ? m.platforms : (['ios', 'android', 'web'] as const)).map((p) => PLATFORM_LABEL[p]).join(' · ')}>
                      {(m.platforms.length ? m.platforms : (['ios', 'android', 'web'] as const)).map((p) => (
                        <PlatformIcon key={p} p={p} />
                      ))}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      {m.stats?.daily && m.stats.daily.length > 1 ? <Sparkline data={m.stats.daily} className="h-6 w-20" /> : <span className="h-6 w-20" />}
                      <span className="tabular-nums text-slate-300">{num(m.stats?.impressions ?? null)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-300">{pct(m.stats?.ctr ?? null)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-slate-300">{num(m.stats?.conversions ?? null)}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-500">{new Date(m.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
      )}
    </div>
  );
}
