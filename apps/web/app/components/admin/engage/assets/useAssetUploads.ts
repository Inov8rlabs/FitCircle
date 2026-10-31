'use client';

import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { EngageApiError, engageAdmin } from '@/lib/engage/client/admin-client';
import { checkFile, processImageFile } from '@/lib/engage/client/asset-pipeline';
import { assetStore } from '@/lib/engage/client/asset-store';
import type { EngageAsset } from '@/lib/engage/types';

export type UploadStatus = 'queued' | 'processing' | 'uploading' | 'done' | 'deduped' | 'error';

export interface UploadItem {
  key: string;
  name: string;
  size: number;
  status: UploadStatus;
  progress: number;
  error?: string;
  previewUrl?: string;
  asset?: EngageAsset;
  dominantColor?: string;
  variants?: number;
}

const CONCURRENCY = 2;

/** Upload queue: browser pipeline (hash, size, colour, WebP variants) + multipart upload with progress. */
export function useAssetUploads(opts: { onUploaded?: (a: EngageAsset, deduped: boolean) => void; tags?: string[] } = {}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const pending = useRef<Array<{ key: string; file: File }>>([]);
  const running = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const patch = useCallback((key: string, p: Partial<UploadItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i))), []);

  const pump = useCallback(() => {
    while (running.current < CONCURRENCY && pending.current.length) {
      const job = pending.current.shift()!;
      running.current++;
      void (async () => {
        try {
          patch(job.key, { status: 'processing' });
          const img = await processImageFile(job.file);
          patch(job.key, { status: 'uploading', previewUrl: img.previewUrl, dominantColor: img.dominantColor, variants: img.variants.length });
          const { asset, deduped } = await engageAdmin.uploadAsset(img, (p) => patch(job.key, { progress: p }), { tags: optsRef.current.tags });
          assetStore.put(asset);
          patch(job.key, { status: deduped ? 'deduped' : 'done', progress: 100, asset });
          if (deduped) toast.info(`“${asset.name}” is already in the library. Reusing it.`);
          optsRef.current.onUploaded?.(asset, deduped);
        } catch (e) {
          patch(job.key, { status: 'error', error: e instanceof EngageApiError || e instanceof Error ? e.message : 'Upload failed' });
        } finally {
          running.current--;
          pump();
        }
      })();
    }
  }, [patch]);

  const addFiles = useCallback(
    (files: File[]) => {
      const fresh: UploadItem[] = [];
      for (const file of files) {
        const key = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`;
        const check = checkFile(file);
        fresh.push({ key, name: file.name, size: file.size, status: check.ok ? 'queued' : 'error', progress: 0, error: check.error });
        if (check.ok) pending.current.push({ key, file });
      }
      setItems((list) => [...fresh, ...list]);
      pump();
    },
    [pump]
  );

  const clearFinished = useCallback(() => setItems((list) => list.filter((i) => i.status !== 'done' && i.status !== 'deduped' && i.status !== 'error')), []);

  return { items, addFiles, clearFinished, busy: items.some((i) => ['queued', 'processing', 'uploading'].includes(i.status)) };
}
