'use client';

import { Check, Copy, ExternalLink, Image as ImageIcon, Loader2, Search, Tag, Trash2, UploadCloud, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { EngageApiError, engageAdmin, type AssetUsage } from '@/lib/engage/client/admin-client';
import { formatBytes, imageFilesFrom } from '@/lib/engage/client/asset-pipeline';
import { assetStore, useAssetLibrary } from '@/lib/engage/client/asset-store';
import type { EngageAsset } from '@/lib/engage/types';
import { cn } from '@/lib/utils';

import { Btn, Callout, Drawer, EmptyState, PageHeader, Skeleton, inputCls } from '../ui';

import { useAssetUploads, type UploadItem } from './useAssetUploads';

/** Page-wide drag & drop + paste for image files. */
export function usePageDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setDragging(true);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = imageFilesFrom(e.dataTransfer);
      if (files.length) onFiles(files);
    };
    const paste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const files = imageFilesFrom(e.clipboardData);
      if (files.length) {
        e.preventDefault();
        onFiles(files);
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
    };
  }, [onFiles, enabled]);
  return dragging;
}

export function DropOverlay({ show, label = 'Drop images to upload' }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center bg-purple-950/40 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-purple-300/70 bg-slate-950/80 px-16 py-12 text-center shadow-2xl">
        <UploadCloud className="h-12 w-12 text-purple-300" />
        <p className="text-lg font-semibold text-white">{label}</p>
        <p className="text-sm text-slate-400">PNG, JPG, WebP or GIF · up to 10 MB · ≥ 320 px wide</p>
      </div>
    </div>
  );
}

export function UploadTray({ items, onClear }: { items: UploadItem[]; onClear: () => void }) {
  if (items.length === 0) return null;
  const done = items.filter((i) => i.status === 'done' || i.status === 'deduped').length;
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Uploads · {done}/{items.length}
        </p>
        <button type="button" onClick={onClear} className="text-xs text-slate-500 hover:text-white">
          Clear finished
        </button>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-3 rounded-xl bg-slate-950/60 p-2">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg" style={{ background: i.dominantColor ?? '#1e293b' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {i.previewUrl && <img src={i.previewUrl} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-white">{i.name}</p>
              <p className={cn('truncate text-[11px]', i.status === 'error' ? 'text-rose-400' : i.status === 'deduped' ? 'text-amber-300' : 'text-slate-500')}>
                {i.status === 'queued' && 'Queued'}
                {i.status === 'processing' && 'Hashing + encoding WebP…'}
                {i.status === 'uploading' && `Uploading ${i.progress}% · ${formatBytes(i.size)}${i.variants ? ` + ${i.variants} variants` : ''}`}
                {i.status === 'done' && `On the CDN · ${i.variants ?? 0} WebP variants`}
                {i.status === 'deduped' && 'Already in the library (same bytes)'}
                {i.status === 'error' && i.error}
              </p>
              {(i.status === 'uploading' || i.status === 'processing') && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-800">
                  <div className={cn('h-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 transition-all', i.status === 'processing' && 'w-1/4 animate-pulse')} style={i.status === 'uploading' ? { width: `${Math.max(4, i.progress)}%` } : undefined} />
                </div>
              )}
            </div>
            {i.status === 'done' && <Check className="h-4 w-4 shrink-0 text-emerald-400" />}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AssetThumb({ asset, className, selected }: { asset: EngageAsset; className?: string; selected?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const src = asset.variants?.find((v) => v.width >= 480)?.url ?? asset.url;
  return (
    <div className={cn('relative overflow-hidden', selected && 'ring-2 ring-purple-400', className)} style={{ background: asset.dominantColor }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={asset.alt ?? asset.name} loading="lazy" onLoad={() => setLoaded(true)} className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')} />
    </div>
  );
}

export function AssetGrid({ assets, onOpen, selectedId, compact }: { assets: EngageAsset[]; onOpen: (a: EngageAsset) => void; selectedId?: string | null; compact?: boolean }) {
  return (
    <ul className={cn('grid gap-3', compact ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6')}>
      {assets.map((a) => (
        <li key={a.id}>
          <button type="button" onClick={() => onOpen(a)} className="group block w-full text-left focus-visible:outline-none" aria-label={a.name}>
            <AssetThumb asset={a} selected={selectedId === a.id} className="aspect-[4/3] w-full rounded-xl ring-1 ring-white/5 transition group-hover:ring-purple-400/60 group-focus-visible:ring-2 group-focus-visible:ring-purple-400" />
            <p className="mt-1.5 truncate text-xs font-medium text-slate-200">{a.name}</p>
            <p className="truncate text-[11px] text-slate-500">
              {a.width}×{a.height} · {formatBytes(a.bytes)}
              {a.usageCount ? ` · used ${a.usageCount}×` : ''}
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function AssetsPage() {
  const { assets, loading, error, reload } = useAssetLibrary();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [open, setOpen] = useState<EngageAsset | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { items, addFiles, clearFinished } = useAssetUploads();
  const onFiles = useCallback((f: File[]) => addFiles(f), [addFiles]);
  const dragging = usePageDrop(onFiles);

  const tags = useMemo(() => Array.from(new Set(assets.flatMap((a) => a.tags ?? []))).sort(), [assets]);
  const visible = useMemo(() => {
    const n = q.trim().toLowerCase();
    return assets.filter((a) => (!tag || a.tags?.includes(tag)) && (!n || `${a.name} ${a.tags?.join(' ')} ${a.alt ?? ''}`.toLowerCase().includes(n)));
  }, [assets, q, tag]);

  return (
    <div className="space-y-5 py-6">
      <DropOverlay show={dragging} />
      <PageHeader
        eyebrow="Library"
        title="Assets"
        description="Drop images anywhere on this page (or paste). Each one is hashed, sized and encoded to WebP in your browser, then served from the CDN."
        actions={
          <>
            <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
            <Btn variant="primary" onClick={() => fileRef.current?.click()}>
              <UploadCloud className="h-4 w-4" /> Upload
            </Btn>
          </>
        }
      />

      <UploadTray items={items} onClear={clearFinished} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, tag, alt" className={cn(inputCls, 'pl-9')} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setTag(null)} className={cn('rounded-full px-2.5 py-1 text-xs', !tag ? 'bg-slate-700 text-white' : 'bg-slate-900 text-slate-400 hover:text-white')}>
            All · {assets.length}
          </button>
          {tags.map((t) => (
            <button key={t} type="button" onClick={() => setTag(t === tag ? null : t)} className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs', tag === t ? 'bg-purple-500/25 text-purple-100' : 'bg-slate-900 text-slate-400 hover:text-white')}>
              <Tag className="h-3 w-3" /> {t}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <Callout tone="error">
          {error}{' '}
          <button type="button" className="underline" onClick={reload}>
            Retry
          </button>
        </Callout>
      )}

      {loading && assets.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="aspect-[4/3] w-full rounded-xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <button type="button" onClick={() => fileRef.current?.click()} className="block w-full">
          <EmptyState icon={<ImageIcon className="h-10 w-10" />} title={assets.length ? 'Nothing matches' : 'Your library is empty'} body="Drag images onto this page, paste a screenshot, or click to choose files." />
        </button>
      ) : (
        <AssetGrid assets={visible} onOpen={setOpen} />
      )}

      <AssetDrawer asset={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export function AssetDrawer({ asset, onClose }: { asset: EngageAsset | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [alt, setAlt] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [usage, setUsage] = useState<AssetUsage[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!asset) return;
    setName(asset.name);
    setAlt(asset.alt ?? '');
    setTags(asset.tags ?? []);
    setUsage(null);
    engageAdmin
      .assetUsage(asset.id)
      .then(setUsage)
      .catch(() => setUsage([]));
  }, [asset]);

  if (!asset) return <Drawer open={false} onOpenChange={() => undefined} title="">{null}</Drawer>;

  const dirty = name !== asset.name || alt !== (asset.alt ?? '') || tags.join(',') !== (asset.tags ?? []).join(',');
  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => toast.success('Copied'));

  const save = async () => {
    setSaving(true);
    try {
      const a = await engageAdmin.updateAsset(asset.id, { name, alt: alt || null, tags });
      assetStore.put({ ...asset, ...a });
      toast.success('Saved');
    } catch (e) {
      toast.error(e instanceof EngageApiError ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!window.confirm(`Archive “${asset.name}”? Messages that already use it keep working.`)) return;
    try {
      await engageAdmin.archiveAsset(asset.id);
      assetStore.remove(asset.id);
      toast.success('Archived');
      onClose();
    } catch (e) {
      if (e instanceof EngageApiError && e.code === 'ASSET_IN_USE') {
        const list = Array.isArray(e.details?.usage) ? (e.details.usage as AssetUsage[]) : [];
        setUsage(list);
        toast.error(`In use by ${list.length || 'a'} live message${list.length === 1 ? '' : 's'}`);
      } else toast.error(e instanceof EngageApiError ? e.message : 'Archive failed');
    }
  };

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={asset.name}>
      <div className="space-y-5">
        <div className="overflow-hidden rounded-xl" style={{ background: asset.dominantColor }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset.url} alt={asset.alt ?? asset.name} className="mx-auto max-h-80 w-auto object-contain" />
        </div>
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <Meta k="Size" v={`${asset.width}×${asset.height}`} />
          <Meta k="Bytes" v={formatBytes(asset.bytes)} />
          <Meta k="Type" v={asset.mime.replace('image/', '').toUpperCase()} />
          <Meta
            k="Colour"
            v={
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3 w-3 rounded" style={{ background: asset.dominantColor }} /> {asset.dominantColor}
              </span>
            }
          />
          <Meta k="SHA-256" v={<span className="font-mono">{asset.sha256.slice(0, 12)}…</span>} />
          <Meta k="Added" v={new Date(asset.createdAt).toLocaleDateString()} />
        </dl>

        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">CDN URLs</p>
          {[{ label: 'Original', url: asset.url, w: asset.width }, ...(asset.variants ?? []).map((v) => ({ label: `${v.width}w ${v.format}`, url: v.url, w: v.width }))].map((v) => (
            <div key={v.url} className="flex items-center gap-2 rounded-lg bg-slate-900/80 px-2.5 py-1.5">
              <span className="w-24 shrink-0 text-xs text-slate-400">{v.label}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300">{v.url}</span>
              <button type="button" onClick={() => copy(v.url)} className="text-slate-400 hover:text-white" aria-label="Copy URL">
                <Copy className="h-3.5 w-3.5" />
              </button>
              <a href={v.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white" aria-label="Open">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          ))}
          {asset.mime === 'image/gif' && <p className="text-xs text-slate-500">Animated GIFs keep the original only.</p>}
        </div>

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Alt text</span>
            <input value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="Describe the image for VoiceOver / TalkBack" className={inputCls} />
          </label>
          <div className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Tags</span>
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-950/60 p-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-md bg-purple-500/20 px-2 py-0.5 text-xs text-purple-100">
                  {t}
                  <button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                    e.preventDefault();
                    const t = tagInput.trim().toLowerCase();
                    if (!tags.includes(t)) setTags([...tags, t]);
                    setTagInput('');
                  }
                  if (e.key === 'Backspace' && !tagInput && tags.length) setTags(tags.slice(0, -1));
                }}
                placeholder="Add tag ⏎"
                className="min-w-[6rem] flex-1 bg-transparent px-1 text-sm text-white placeholder:text-slate-500 focus:outline-none"
              />
            </div>
          </div>
          <Btn variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty}>
            Save details
          </Btn>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Used in</p>
          {usage === null ? (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading
            </p>
          ) : usage.length === 0 ? (
            <p className="text-xs text-slate-500">Not used yet.</p>
          ) : (
            <ul className="space-y-1">
              {usage.map((u, i) => (
                <li key={i}>
                  <a href={u.messageId ? `/admin/messages/${u.messageId}` : u.campaignId ? `/admin/campaigns/${u.campaignId}` : '#'} className="flex items-center justify-between rounded-lg bg-slate-900/80 px-2.5 py-1.5 text-xs hover:bg-slate-800">
                    <span className="text-white">{u.name}</span>
                    <span className="text-slate-500">{u.status ?? (u.campaignId ? 'campaign' : 'message')}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Btn variant="danger" onClick={() => void archive()}>
          <Trash2 className="h-4 w-4" /> Archive
        </Btn>
      </div>
    </Drawer>
  );
}

function Meta({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-900/80 p-2">
      <dt className="text-[10px] uppercase tracking-wider text-slate-500">{k}</dt>
      <dd className="mt-0.5 truncate text-slate-200">{v}</dd>
    </div>
  );
}
