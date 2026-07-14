'use client';

import { format } from 'date-fns';
import { Camera, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { nutritionClient, PHOTO_PARSE_MAX_IMAGES, type NutritionDraft, type NutritionDraftItem } from '@/lib/api/nutrition-client';
import { compressImagesForUpload } from '@/lib/utils/image-compression';
import { cn } from '@/lib/utils';

import { NutritionConfirm } from '../nutrition/NutritionConfirm';

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';

/** Rebuild an editable draft item from a persisted (snake_case) saved item. */
function toDraftItem(it: Record<string, any>): NutritionDraftItem {
  const quantity = typeof it.quantity === 'number' ? it.quantity : 1;
  const grams = typeof it.grams === 'number' ? it.grams : undefined;
  return {
    name: it.name ?? '',
    quantity,
    quantityRange: null,
    servingUnit: it.serving_unit ?? 'serving',
    grams,
    gramsPerUnit: grams != null && quantity > 0 ? grams / quantity : undefined,
    calories: it.calories ?? 0,
    proteinG: it.protein_g ?? 0,
    carbsG: it.carbs_g ?? 0,
    fatG: it.fat_g ?? 0,
    fiberG: it.fiber_g ?? undefined,
    sugarG: it.sugar_g ?? undefined,
    sodiumMg: it.sodium_mg ?? undefined,
    confidence: 1,
    matchedFoodId: it.matched_food_id ?? null,
  };
}

const round = (v: unknown) => (typeof v === 'number' ? Math.round(v) : 0);
const numFmt = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n)) return '—';
  return n === Math.round(n) ? String(n) : n.toFixed(1);
};

interface SavedItem {
  name?: string;
  quantity?: number | null;
  serving_unit?: string | null;
  calories?: number | null;
  matched_food_id?: string | null;
}

/**
 * Read-only detail of a logged meal: macro + secondary-nutrient summary, a
 * health score, and the per-ingredient breakdown — rendered from the entry's
 * persisted `nutrition_data`. Use the row content as the trigger.
 */
export function NutritionDetailDialog({ entry, children }: { entry: any; children: React.ReactNode }) {
  const router = useRouter();
  const nd = entry?.nutrition_data ?? {};
  const items: SavedItem[] = Array.isArray(nd.items) ? nd.items : [];
  const hasSecondary = (nd.fiber_g || 0) > 0 || (nd.sugar_g || 0) > 0 || (nd.sodium_mg || 0) > 0;
  const score: number | null = typeof nd.health_score === 'number' ? nd.health_score : null;
  const img: string | undefined = entry?.images?.[0]?.url || entry?.images?.[0]?.thumbnail_url;

  const [open, setOpen] = useState(false);
  // When set, we're reviewing new photo(s) appended to this meal.
  const [seedDraft, setSeedDraft] = useState<NutritionDraft | null>(null);
  const [addFiles, setAddFiles] = useState<File[]>([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  // Only meals/snacks carry AI nutrition; don't offer it on water/supplement.
  const canAddPhoto = entry?.id && entry?.entry_type !== 'water' && entry?.entry_type !== 'supplement';

  const resetAdd = () => {
    setSeedDraft(null);
    setAddFiles([]);
    setAddError(null);
  };

  const onAddPhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;
    // The parse endpoint takes at most PHOTO_PARSE_MAX_IMAGES per request; analyze the
    // first batch and tell the user about anything dropped rather than failing the lot.
    const files = await compressImagesForUpload(picked.slice(0, PHOTO_PARSE_MAX_IMAGES));
    const dropped = picked.length - files.length;
    setAdding(true);
    setAddError(null);
    try {
      // One request, one vision call — the server analyzes all photos together.
      const merged = await nutritionClient.photoParse(files);
      const newItems = merged.items.filter((i) => i.name.trim());
      if (dropped > 0) {
        setAddError(`Only ${PHOTO_PARSE_MAX_IMAGES} photos can be analyzed at once — ${dropped} ${dropped === 1 ? 'photo was' : 'photos were'} skipped.`);
      }
      if (newItems.length === 0) {
        setAddError('We could not find any food in that photo.');
        return;
      }
      // Existing meal items (or a synthesized summary line when the entry has
      // aggregate macros but no per-item breakdown), then the new photo's items.
      let existing: NutritionDraftItem[] = items.map((it) => toDraftItem(it as Record<string, any>));
      if (existing.length === 0 && round(nd.calories) > 0) {
        existing = [
          toDraftItem({
            name: entry?.title || 'Logged meal',
            quantity: 1,
            serving_unit: 'serving',
            calories: nd.calories,
            protein_g: nd.protein_g,
            carbs_g: nd.carbs_g,
            fat_g: nd.fat_g,
            fiber_g: nd.fiber_g,
            sugar_g: nd.sugar_g,
            sodium_mg: nd.sodium_mg,
          }),
        ];
      }
      setSeedDraft({
        items: [...existing, ...newItems],
        overallConfidence: 1,
        notes: null,
        inputMethod: 'photo',
        nutritionSource: 'llm_vision',
        model: '',
        cached: false,
        totals: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        healthScore: score ?? merged.healthScore ?? null,
      });
      setAddFiles(files);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Could not analyze that photo.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetAdd();
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        {seedDraft ? (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">Add to {entry?.title || 'this meal'}</DialogTitle>
            </DialogHeader>
            <NutritionConfirm
              draft={seedDraft}
              initialImages={addFiles}
              editEntry={{ id: entry.id, mealType: entry?.meal_type as MealType | undefined }}
              onCommitted={() => {
                resetAdd();
                setOpen(false);
                router.refresh();
              }}
              onCancel={resetAdd}
            />
          </>
        ) : (
          <>
        <DialogHeader>
          <DialogTitle className="pr-6">{entry?.title || 'Meal'}</DialogTitle>
          {entry?.logged_at && (
            <p className="text-xs text-muted-foreground">{format(new Date(entry.logged_at), 'PPp')}</p>
          )}
        </DialogHeader>

        {img && (
          <div className="relative h-40 w-full overflow-hidden rounded-lg">
            <Image src={img} alt={entry?.title || 'Meal'} fill className="object-cover" sizes="480px" />
          </div>
        )}

        {/* Macro summary */}
        <div className="grid grid-cols-4 gap-2 rounded-lg border bg-card p-3 text-center">
          <Stat label="Calories" value={round(nd.calories)} accent="text-orange-400" big />
          <Stat label="Protein" value={`${round(nd.protein_g)}g`} accent="text-indigo-400" />
          <Stat label="Carbs" value={`${round(nd.carbs_g)}g`} accent="text-emerald-400" />
          <Stat label="Fat" value={`${round(nd.fat_g)}g`} accent="text-cyan-400" />
        </div>

        {hasSecondary && (
          <div className="grid grid-cols-3 gap-2 rounded-lg border bg-card p-3 text-center">
            <Stat label="Fiber" value={`${round(nd.fiber_g)}g`} />
            <Stat label="Sugar" value={`${round(nd.sugar_g)}g`} />
            <Stat label="Sodium" value={`${round(nd.sodium_mg)}mg`} />
          </div>
        )}

        {score != null && (
          <div className="rounded-lg border bg-card p-3">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium">Health Score</span>
              <span
                className={cn(
                  'font-bold',
                  score >= 7 ? 'text-emerald-400' : score >= 4 ? 'text-amber-400' : 'text-orange-400'
                )}
              >
                {Math.round(score)}/10
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full',
                  score >= 7 ? 'bg-emerald-400' : score >= 4 ? 'bg-amber-400' : 'bg-orange-400'
                )}
                style={{ width: `${Math.max(0, Math.min(100, score * 10))}%` }}
              />
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-semibold">Ingredients</h4>
            <div className="space-y-1.5">
              {items.map((it, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{it.name || 'Item'}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {round(it.calories)} cal{it.matched_food_id ? ' · from database' : ''}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {numFmt(it.quantity)} {it.serving_unit || 'g'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {items.length === 0 && round(nd.calories) === 0 && (
          <p className="text-sm text-muted-foreground">No nutrition details saved for this entry.</p>
        )}

        {canAddPhoto && (
          <>
            <input ref={addRef} type="file" accept="image/*" multiple className="hidden" onChange={onAddPhotos} />
            <button
              type="button"
              onClick={() => addRef.current?.click()}
              disabled={adding}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-700 px-4 py-2.5 text-sm font-semibold text-white hover:from-indigo-700 hover:to-indigo-800 disabled:opacity-50"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              {adding ? 'Analyzing…' : 'Add to this meal'}
            </button>
            <p className="-mt-1 text-center text-[11px] text-muted-foreground">
              Snap a later course or dessert — we&apos;ll add its calories to this meal.
            </p>
            {addError && <p className="text-center text-xs text-red-400">{addError}</p>}
          </>
        )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, accent, big }: { label: string; value: string | number; accent?: string; big?: boolean }) {
  return (
    <div>
      <div className={cn('font-bold tabular-nums', big ? 'text-2xl' : 'text-base', accent ?? 'text-foreground')}>
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
