'use client';

import { Camera, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { nutritionClient, ApiError, type NutritionDraft } from '@/lib/api/nutrition-client';

import { NutritionConfirm } from './NutritionConfirm';

interface PhotoLogProps {
  onLogged?: () => void;
}

/**
 * Photo → nutrition. Picks an image, posts it to /food/photo-parse (multipart),
 * and shows the returned draft in NutritionConfirm (confirm-then-commit).
 */
export function PhotoLog({ onLogged }: PhotoLogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<NutritionDraft | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setParsing(true);
    setError(null);
    try {
      const result = await nutritionClient.photoParse(file);
      setDraft(result);
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

  const reset = () => {
    setShowConfirm(false);
    setDraft(null);
  };

  if (showConfirm) {
    return (
      <NutritionConfirm
        draft={draft}
        onCommitted={() => {
          reset();
          onLogged?.();
        }}
        onCancel={reset}
      />
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
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
        {parsing ? 'Reading photo…' : 'Log from photo'}
      </button>
      {error && <p className="mt-2 text-sm text-amber-300">{error}</p>}
    </div>
  );
}
