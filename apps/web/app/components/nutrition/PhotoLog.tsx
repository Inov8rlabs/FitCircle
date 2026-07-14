'use client';

import { Camera, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  nutritionClient,
  ApiError,
  PHOTO_PARSE_MAX_IMAGES,
  PHOTO_PARSE_MAX_NOTE_CHARS,
  type NutritionDraft,
} from '@/lib/api/nutrition-client';
import { compressImagesForUpload } from '@/lib/utils/image-compression';

import { NutritionConfirm } from './NutritionConfirm';
import { PhotoThumb, fileKey } from './PhotoThumb';

interface PhotoLogProps {
  onLogged?: () => void;
}

/**
 * Photo → nutrition, confirm-then-analyze. Picking photos does NOT start the AI:
 * the user first sees a preview card with the chosen photos, can add/remove
 * photos and type an optional note for the AI, and only "Analyze" posts
 * everything to /food/photo-parse (one request, one vision call). The draft is
 * then reviewed in NutritionConfirm; the photos ride along and are attached to
 * the entry on commit.
 */
export function PhotoLog({ onLogged }: PhotoLogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<NutritionDraft | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFiles, setLastFiles] = useState<File[]>([]);
  const [lastNote, setLastNote] = useState('');

  const analyze = async (files: File[], hint: string) => {
    if (files.length === 0) return;
    setParsing(true);
    // Leave any open confirm card: reanalyze must remount NutritionConfirm with the
    // fresh draft (it seeds state from props on mount) and surface errors out here.
    setShowConfirm(false);
    setError(null);
    try {
      // Downscale before upload — full-res camera files waste upload time and vision
      // tokens (≤1568px is plenty for a plate). The compressed files are also what we
      // attach to the entry on commit.
      const compressed = await compressImagesForUpload(files);
      setLastFiles(compressed);
      setLastNote(hint);
      const parsed = await nutritionClient.photoParse(compressed, hint);
      setDraft(parsed);
      setShowConfirm(true);
      setPending([]);
      setNote('');
    } catch (err) {
      // Option B: the parse failed/was rate-limited, but the server saved the photos as a
      // food-log entry so they're not lost. Show the friendly note and refresh so it appears.
      if (err instanceof ApiError && err.details?.savedEntryId) {
        setError(err.message);
        setPending([]);
        setNote('');
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
    if (files.length === 0) return;
    setError(null);
    setPending((prev) => [...prev, ...files].slice(0, PHOTO_PARSE_MAX_IMAGES));
  };

  const removePending = (idx: number) => setPending((prev) => prev.filter((_, i) => i !== idx));

  const cancelPreview = () => {
    setPending([]);
    setNote('');
    setError(null);
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
        onReanalyze={lastFiles.length ? () => void analyze(lastFiles, lastNote) : undefined}
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

      {pending.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={parsing}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/60 px-4 py-3 text-sm font-medium text-gray-200 hover:bg-slate-700/60 disabled:opacity-50"
        >
          {parsing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Camera className="h-4 w-4" aria-hidden="true" />}
          {parsing ? 'Analyzing…' : 'Log from photo'}
        </button>
      ) : (
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-white">Review photos</h4>
            <span className="text-[11px] text-gray-400">
              {pending.length}/{PHOTO_PARSE_MAX_IMAGES} photos
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {pending.map((file, idx) => (
              <PhotoThumb key={fileKey(file)} file={file} onRemove={parsing ? undefined : () => removePending(idx)} />
            ))}
            {pending.length < PHOTO_PARSE_MAX_IMAGES && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={parsing}
                className="flex aspect-square items-center justify-center rounded-md border border-dashed border-slate-600 text-gray-400 hover:border-indigo-500/60 hover:text-indigo-300 disabled:opacity-50"
                aria-label="Add another photo"
              >
                <Plus className="h-5 w-5" />
              </button>
            )}
          </div>

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={PHOTO_PARSE_MAX_NOTE_CHARS}
            rows={2}
            disabled={parsing}
            placeholder="Tell the AI about this meal (optional) — e.g. “paneer curry cooked in ghee, small portion of rice”"
            className="mt-3 w-full resize-none rounded-md border border-slate-600 bg-slate-900/60 px-2 py-1.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void analyze(pending, note)}
              disabled={parsing || pending.length === 0}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50"
            >
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {parsing ? 'Analyzing…' : 'Analyze'}
            </button>
            <button
              type="button"
              onClick={cancelPreview}
              disabled={parsing}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/60 px-4 py-2 text-sm text-gray-300 hover:bg-slate-700/60 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-amber-300">{error}</p>}
    </div>
  );
}
