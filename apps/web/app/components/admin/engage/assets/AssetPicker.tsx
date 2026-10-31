'use client';

import { ImagePlus, Library, Loader2, Search, UploadCloud, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { imageFilesFrom } from '@/lib/engage/client/asset-pipeline';
import { assetStore, useAssetLibrary, useAssetStoreVersion } from '@/lib/engage/client/asset-store';
import type { EngageAsset } from '@/lib/engage/types';
import { cn } from '@/lib/utils';

import { Btn, Modal, inputCls } from '../ui';

import { AssetGrid, AssetThumb, UploadTray } from './AssetsPage';
import { useAssetUploads } from './useAssetUploads';

/** Library picker; also accepts drops/uploads (which are selected on completion). */
export function AssetPicker({
  open,
  onOpenChange,
  onPick,
  filter,
  title = 'Choose from library',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (a: EngageAsset) => void;
  filter?: (a: EngageAsset) => string | null; // returns a reason when not allowed
  title?: string;
}) {
  const { assets, loading } = useAssetLibrary();
  const [q, setQ] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const { items, addFiles, clearFinished } = useAssetUploads({
    onUploaded: (a) => {
      onPick(a);
      onOpenChange(false);
    },
  });
  const visible = useMemo(() => {
    const n = q.trim().toLowerCase();
    return assets.filter((a) => !n || `${a.name} ${a.tags?.join(' ')}`.toLowerCase().includes(n));
  }, [assets, q]);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} width="max-w-4xl">
      <div
        className="space-y-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(imageFilesFrom(e.dataTransfer));
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the library" className={cn(inputCls, 'pl-9')} />
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          <Btn onClick={() => fileRef.current?.click()}>
            <UploadCloud className="h-4 w-4" /> Upload new
          </Btn>
        </div>
        {notice && <p className="text-xs text-amber-300">{notice}</p>}
        <UploadTray items={items} onClear={clearFinished} />
        {loading && assets.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading library
          </p>
        ) : (
          <AssetGrid
            compact
            assets={visible}
            onOpen={(a) => {
              const reason = filter?.(a) ?? null;
              if (reason) return setNotice(reason);
              onPick(a);
              onOpenChange(false);
            }}
          />
        )}
        <p className="text-center text-xs text-slate-500">Tip: drop a file here to upload and use it right away.</p>
      </div>
    </Modal>
  );
}

/**
 * Image well for the composer: drop a file → uploads to the library → shown
 * in the preview immediately (local object URL until the CDN copy loads);
 * or pick from the library.
 */
export function ImageWell({
  assetId,
  onChange,
  label = 'Image',
  hint,
  aspect = 'aspect-[16/9]',
  onLocalPreview,
}: {
  assetId: string | null | undefined;
  onChange: (assetId: string | null) => void;
  label?: string;
  hint?: string;
  aspect?: string;
  /** Called with a local object URL while uploading (instant preview). */
  onLocalPreview?: (url: string | null) => void;
}) {
  useAssetStoreVersion();
  const asset = assetStore.get(assetId ?? undefined);
  const [picker, setPicker] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { items, addFiles } = useAssetUploads({
    onUploaded: (a) => {
      onChange(a.id);
      onLocalPreview?.(null);
    },
  });
  const current = items[0];
  const uploading = current && ['queued', 'processing', 'uploading'].includes(current.status);
  const localUrl = uploading ? current?.previewUrl ?? null : null;
  const localCb = useRef(onLocalPreview);
  localCb.current = onLocalPreview;
  useEffect(() => {
    localCb.current?.(localUrl);
  }, [localUrl]);

  const take = useCallback((files: File[]) => files[0] && addFiles([files[0]]), [addFiles]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
        {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          take(imageFilesFrom(e.dataTransfer));
        }}
        onPaste={(e) => take(imageFilesFrom(e.clipboardData))}
        className={cn('group relative overflow-hidden rounded-xl border-2 border-dashed transition', over ? 'border-purple-400 bg-purple-500/10' : 'border-slate-700 bg-slate-950/40 hover:border-slate-500')}
      >
        {asset || current?.previewUrl ? (
          <div className={cn('relative w-full', aspect)}>
            {asset ? (
              <AssetThumb asset={asset} className="absolute inset-0" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={current.previewUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}
            {uploading && (
              <div className="absolute inset-x-0 bottom-0 bg-black/60 p-2 text-xs text-white">
                {current.status === 'uploading' ? `Uploading ${current.progress}%` : 'Processing…'}
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/20">
                  <div className="h-full bg-purple-400 transition-all" style={{ width: `${Math.max(6, current.progress)}%` }} />
                </div>
              </div>
            )}
            {asset && !uploading && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition group-hover:opacity-100">
                <Btn size="sm" onClick={() => setPicker(true)}>
                  <Library className="h-3.5 w-3.5" /> Replace
                </Btn>
                <Btn size="sm" variant="danger" onClick={() => onChange(null)}>
                  <X className="h-3.5 w-3.5" /> Remove
                </Btn>
              </div>
            )}
          </div>
        ) : (
          <div className={cn('flex w-full flex-col items-center justify-center gap-2 p-4 text-center', aspect)}>
            <ImagePlus className="h-7 w-7 text-slate-500" />
            <p className="text-sm text-slate-300">Drop an image, paste, or</p>
            <div className="flex gap-2">
              <Btn size="sm" onClick={() => fileRef.current?.click()}>
                <UploadCloud className="h-3.5 w-3.5" /> Upload
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => setPicker(true)}>
                <Library className="h-3.5 w-3.5" /> Library
              </Btn>
            </div>
          </div>
        )}
        {current?.status === 'error' && <p className="absolute inset-x-0 bottom-0 bg-rose-950/80 p-1.5 text-center text-xs text-rose-200">{current.error}</p>}
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { take(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <AssetPicker open={picker} onOpenChange={setPicker} onPick={(a) => onChange(a.id)} />
    </div>
  );
}
