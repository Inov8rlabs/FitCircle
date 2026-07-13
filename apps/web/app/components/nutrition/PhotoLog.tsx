'use client';

import { Camera, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { nutritionClient, ApiError, mergeDrafts, type NutritionDraft } from '@/lib/api/nutrition-client';

import { NutritionConfirm } from './NutritionConfirm';

interface PhotoLogProps {
  onLogged?: () => void;
}

/**
 * Photo → nutrition. Picks one or more images, posts each to /food/photo-parse
 * (multipart), merges the results (append semantics — every photo's foods are
 * added to the meal), and shows the draft in NutritionConfirm. The chosen photos
 * ride along and are attached to the entry on commit.
 */
export function PhotoLog({ onLogged }: PhotoLogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<NutritionDraft | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFiles, setLastFiles] = useState<File[]>([]);

  const parse = async (files: File[]) => {
    if (files.length === 0) return;
    setLastFiles(files);
    setParsing(true);
    setShowConfirm(false);
    setError(null);
    try {
      // Parse each photo. The first drives the Option-B fallback on failure;
      // additional photos are best-effort and merged in.
      const drafts: NutritionDraft[] = [await nutritionClient.photoParse(files[0])];
      for (const file of files.slice(1)) {
        try {
          drafts.push(await nutritionClient.photoParse(file));
        } catch {
          /* skip a failed extra photo */
        }
      }
      setDraft(mergeDrafts(drafts));
      setShowConfirm(true);
    } catch (err) {
      // Option B: the parse failed/was rate-limited, but the server saved the photo as a
      // food-log entry so it's not lost. Show the friendly note and refresh so it appears.
      if (err instanceof ApiError && err.details?.savedEntryId) {
        setError(err.message);
        onLogged?.();
      } else {
        setError(err instanceof Error ? err.message : 'Could not read that photo. Try search or manual entry.');
      }
    } finally {
      setParsing(false);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-picking the same file
    if (files.length) void parse(files);
  };

  const reset = () => {
    setShowConfirm(false);
    setDraft(null);
  };

  if (showConfirm) {
    return (
      <NutritionConfirm
        draft={draft}
        initialImages={lastFiles}
        onCommitted={() => {
          reset();
          onLogged?.();
        }}
        onCancel={reset}
        onReanalyze={lastFiles.length ? () => void parse(lastFiles) : undefined}
      />
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onPick}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={parsing}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/60 px-4 py-3 text-sm font-medium text-gray-200 hover:bg-slate-700/60 disabled:opacity-50"
      >
        {parsing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Camera className="h-4 w-4" aria-hidden="true" />}
        {parsing ? 'Reading photos…' : 'Log from photo'}
      </button>
      {error && <p className="mt-2 text-sm text-amber-300">{error}</p>}
    </div>
  );
}
