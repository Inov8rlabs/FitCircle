'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

// Stable identity per picked File so thumbnail keys survive removals (an index-based
// key would remount — and re-decode — every thumbnail after the removed one).
let fileSeq = 0;
const fileIds = new WeakMap<File, string>();
export function fileKey(file: File): string {
  let id = fileIds.get(file);
  if (!id) {
    id = `photo-${++fileSeq}`;
    fileIds.set(file, id);
  }
  return id;
}

/**
 * Square object-URL thumbnail for a picked (not yet uploaded) photo, with an optional
 * remove button. Owns its object-URL lifecycle (revoked on unmount/file change).
 * Use `fileKey(file)` as the React key. (The legacy food-log-entry-form grid predates
 * this component and renders precomputed string previews with its own styling.)
 */
export function PhotoThumb({ file, onRemove }: { file: File; onRemove?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return (
    <div className="relative aspect-square overflow-hidden rounded-md border border-slate-700/60 bg-slate-900/60">
      {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
      {url && <img src={url} alt={file.name} className="h-full w-full object-cover" />}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-1 top-1 rounded-full bg-slate-950/80 p-1 text-gray-200 hover:bg-red-500/80 hover:text-white"
          aria-label={`Remove ${file.name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
