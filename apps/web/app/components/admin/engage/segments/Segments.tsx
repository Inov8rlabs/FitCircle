'use client';

import { ArrowLeft, Loader2, Plus, Save, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { EngageApiError, engageAdmin, type MessageListItem } from '@/lib/engage/client/admin-client';
import { conditionValid, describeCondition } from '@/lib/engage/preview/attributes';
import { CHANNEL_LABEL } from '@/lib/engage/preview/content';
import type { EngageSegment, FilterCondition } from '@/lib/engage/types';
import { cn } from '@/lib/utils';

import { ReachPanel, useReach } from '../composer/MessageComposer';
import { FilterBuilder } from '../FilterBuilder';
import { Btn, Callout, Card, EmptyState, PageHeader, Skeleton, StatusPill, inputCls, num } from '../ui';

export function SegmentList() {
  const [list, setList] = useState<EngageSegment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    engageAdmin
      .listSegments()
      .then(setList)
      .catch((e) => setError(e instanceof EngageApiError ? e.message : 'Could not load segments'));
  }, []);
  return (
    <div className="space-y-5 py-6">
      <PageHeader
        eyebrow="Audiences"
        title="Segments"
        description="Saved audience filters. Use them in any message; inline filters stack on top."
        actions={
          <Link href="/admin/segments/new" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 px-3.5 text-sm font-medium text-white hover:brightness-110">
            <Plus className="h-4 w-4" /> New segment
          </Link>
        }
      />
      {error && <Callout tone="error">{error}</Callout>}
      {!list && !error ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      ) : list && list.length === 0 ? (
        <EmptyState icon={<Users className="h-10 w-10" />} title="No segments yet" body="Group users by streak, platform, Pro status, circles and more." action={<Link href="/admin/segments/new" className="text-sm text-purple-300 hover:underline">Create one →</Link>} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list?.map((s) => (
            <li key={s.id}>
              <Link href={`/admin/segments/${s.id}`} className="block h-full rounded-2xl border border-slate-800 bg-slate-900/50 p-4 transition hover:border-slate-600">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-semibold text-white">{s.name}</p>
                  <span className="shrink-0 text-right">
                    <span className="block text-lg font-bold tabular-nums text-white">{s.estimatedCount != null ? `≈${num(s.estimatedCount)}` : '—'}</span>
                    <span className="block text-[10px] text-slate-500">users</span>
                  </span>
                </div>
                {s.description && <p className="mt-1 line-clamp-2 text-sm text-slate-400">{s.description}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.filters.slice(0, 4).map((f, i) => (
                    <span key={i} className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                      {describeCondition(f)}
                    </span>
                  ))}
                  {s.filters.length > 4 && <span className="text-[11px] text-slate-500">+{s.filters.length - 4}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SegmentEditor({ id }: { id: string | null }) {
  const router = useRouter();
  const [seg, setSeg] = useState<EngageSegment | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [usage, setUsage] = useState<MessageListItem[] | null>(null);
  const valid = filters.every(conditionValid);
  const { est, loading: estimating } = useReach({ filters }, valid);

  useEffect(() => {
    if (!id) return;
    engageAdmin
      .getSegment(id)
      .then((s) => {
        setSeg(s);
        setName(s.name);
        setDescription(s.description);
        setFilters(s.filters);
      })
      .catch(() => toast.error('Could not load the segment'))
      .finally(() => setLoading(false));
    engageAdmin
      .listMessages()
      .then((all) => setUsage(all.filter((m) => m.segmentId === id)))
      .catch(() => setUsage([]));
  }, [id]);

  const dirty = useMemo(() => !seg || name !== seg.name || description !== seg.description || JSON.stringify(filters) !== JSON.stringify(seg.filters), [seg, name, description, filters]);

  const save = useCallback(async () => {
    if (!name.trim()) return void toast.error('Give it a name');
    setSaving(true);
    try {
      const s = seg ? await engageAdmin.updateSegment(seg.id, { name, description, filters }) : await engageAdmin.createSegment({ name, description, filters });
      setSeg(s);
      toast.success('Segment saved');
      if (!seg) router.replace(`/admin/segments/${s.id}`);
    } catch (e) {
      toast.error(e instanceof EngageApiError ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [seg, name, description, filters, router]);

  const remove = async () => {
    if (!seg || !window.confirm(`Delete “${seg.name}”?`)) return;
    try {
      await engageAdmin.deleteSegment(seg.id);
      router.push('/admin/segments');
    } catch (e) {
      toast.error(e instanceof EngageApiError ? e.message : 'Delete failed');
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  if (loading)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );

  return (
    <div className="space-y-5 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/segments" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Segment name" className="min-w-0 flex-1 bg-transparent text-2xl font-bold text-white placeholder:text-slate-600 focus:outline-none" />
        {seg && (
          <Btn variant="ghost" onClick={() => void remove()}>
            <Trash2 className="h-4 w-4" /> Delete
          </Btn>
        )}
        <Btn variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty || !valid}>
          <Save className="h-4 w-4" /> Save
        </Btn>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-5">
          <Card>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (who is this?)" className={cn(inputCls, 'mb-4')} />
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Users who match all of</p>
            <FilterBuilder value={filters} onChange={setFilters} />
          </Card>
          <Card>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Used by</p>
            {usage === null ? (
              <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
            ) : usage.length === 0 ? (
              <p className="text-sm text-slate-500">No messages use this segment yet.</p>
            ) : (
              <ul className="divide-y divide-slate-800">
                {usage.map((m) => (
                  <li key={m.id}>
                    <Link href={`/admin/messages/${m.id}`} className="flex items-center justify-between py-2 text-sm hover:text-purple-200">
                      <span className="text-white">{m.name}</span>
                      <span className="flex items-center gap-2 text-xs text-slate-500">
                        {CHANNEL_LABEL[m.channel]} <StatusPill status={m.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-3">
          <ReachPanel est={est} loading={estimating} platforms={[]} />
          {!valid && <p className="text-xs text-rose-400">Fix the highlighted conditions to estimate.</p>}
          {seg?.estimatedAt && <p className="text-xs text-slate-500">Last saved estimate {new Date(seg.estimatedAt).toLocaleString()}</p>}
        </div>
      </div>
    </div>
  );
}
