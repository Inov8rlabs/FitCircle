'use client';

import { Check, Loader2, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { useDietaryUnits } from '@/hooks/useDietaryUnits';
import {
  LOW_CONFIDENCE_THRESHOLD,
  nutritionClient,
  type NutritionDraft,
  type NutritionDraftItem,
} from '@/lib/api/nutrition-client';
import { formatGrams } from '@/lib/format/units';
import { cn } from '@/lib/utils';

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

interface NutritionConfirmProps {
  /** Draft returned by photo/voice parse. When null, starts an empty manual entry. */
  draft: NutritionDraft | null;
  onCommitted?: () => void;
  onCancel?: () => void;
}

function emptyItem(): NutritionDraftItem {
  return {
    name: '',
    quantity: 1,
    quantityRange: null,
    servingUnit: 'serving',
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    confidence: 1,
  };
}

/**
 * "Tap to fix" draft card. Per-item editable name/qty/macros with live totals
 * and a confidence chip. Below LOW_CONFIDENCE_THRESHOLD the draft is treated as
 * a manual-entry starting point (we surface a hint rather than a shaky guess).
 * Confirm commits via the existing food-log create endpoint; cancel discards.
 */
export function NutritionConfirm({ draft, onCommitted, onCancel }: NutritionConfirmProps) {
  const units = useDietaryUnits();
  const lowConfidence =
    !draft || draft.overallConfidence < LOW_CONFIDENCE_THRESHOLD;

  const [items, setItems] = useState<NutritionDraftItem[]>(() =>
    draft && draft.items.length > 0 ? draft.items.map((i) => ({ ...i })) : [emptyItem()]
  );
  const [mealType, setMealType] = useState<MealType>('snack');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totals = items.reduce(
    (acc, it) => ({
      calories: acc.calories + (Number(it.calories) || 0),
      proteinG: acc.proteinG + (Number(it.proteinG) || 0),
      carbsG: acc.carbsG + (Number(it.carbsG) || 0),
      fatG: acc.fatG + (Number(it.fatG) || 0),
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );

  const patchItem = (idx: number, patch: Partial<NutritionDraftItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const removeItem = (idx: number) =>
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  const num = (v: string) => (v === '' ? 0 : Number(v));

  const commit = async () => {
    const named = items.filter((i) => i.name.trim());
    if (named.length === 0) {
      setError('Add at least one item with a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const title = named.map((i) => i.name.trim()).join(', ');
      await nutritionClient.createFoodLog({
        entry_type: 'food',
        meal_type: mealType,
        title,
        nutrition_data: {
          calories: Math.round(totals.calories),
          protein_g: Math.round(totals.proteinG),
          carbs_g: Math.round(totals.carbsG),
          fat_g: Math.round(totals.fatG),
        },
      });
      onCommitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-white">
          {lowConfidence ? 'Add details' : 'Tap to fix, then confirm'}
        </h3>
        {draft && (
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-xs',
              lowConfidence
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
            )}
          >
            {Math.round(draft.overallConfidence * 100)}% confident
          </span>
        )}
      </div>

      {lowConfidence && draft && (
        <p className="mb-3 text-xs text-amber-200/80">
          We weren&apos;t sure about this one — please check or fill in the details below.
        </p>
      )}

      <div className="space-y-3">
        {items.map((it, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3"
          >
            <div className="mb-2 flex items-center gap-2">
              <input
                value={it.name}
                onChange={(e) => patchItem(idx, { name: e.target.value })}
                placeholder="Food name"
                className="flex-1 rounded-md border border-slate-600 bg-slate-900/60 px-2 py-1.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => removeItem(idx)}
                aria-label="Remove item"
                className="rounded-md p-1.5 text-gray-400 hover:bg-slate-700/60 hover:text-red-400 disabled:opacity-40"
                disabled={items.length === 1}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Field label="Qty">
                <input
                  type="number"
                  value={it.quantity}
                  onChange={(e) => patchItem(idx, { quantity: num(e.target.value) })}
                  className="w-full rounded-md border border-slate-600 bg-slate-900/60 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </Field>
              <Field label="Unit">
                <input
                  value={it.servingUnit}
                  onChange={(e) => patchItem(idx, { servingUnit: e.target.value })}
                  className="w-full rounded-md border border-slate-600 bg-slate-900/60 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </Field>
              <Field label="Calories">
                <input
                  type="number"
                  value={it.calories}
                  onChange={(e) => patchItem(idx, { calories: num(e.target.value) })}
                  className="w-full rounded-md border border-slate-600 bg-slate-900/60 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </Field>
              <Field label="Protein (g)">
                <input
                  type="number"
                  value={it.proteinG}
                  onChange={(e) => patchItem(idx, { proteinG: num(e.target.value) })}
                  className="w-full rounded-md border border-slate-600 bg-slate-900/60 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </Field>
              <Field label="Carbs (g)">
                <input
                  type="number"
                  value={it.carbsG}
                  onChange={(e) => patchItem(idx, { carbsG: num(e.target.value) })}
                  className="w-full rounded-md border border-slate-600 bg-slate-900/60 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </Field>
              <Field label="Fat (g)">
                <input
                  type="number"
                  value={it.fatG}
                  onChange={(e) => patchItem(idx, { fatG: num(e.target.value) })}
                  className="w-full rounded-md border border-slate-600 bg-slate-900/60 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </Field>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setItems((prev) => [...prev, emptyItem()])}
        className="mt-3 text-xs font-medium text-indigo-300 hover:text-indigo-200"
      >
        + Add another item
      </button>

      {/* Totals */}
      <div className="mt-4 grid grid-cols-4 gap-2 rounded-lg border border-slate-700/50 bg-slate-800/40 p-3 text-center">
        <Total label="Cal" value={Math.round(totals.calories)} />
        <Total label="Protein" value={formatGrams(totals.proteinG, units)} />
        <Total label="Carbs" value={formatGrams(totals.carbsG, units)} />
        <Total label="Fat" value={formatGrams(totals.fatG, units)} />
      </div>

      {/* Meal type */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {MEAL_TYPES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMealType(m)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs capitalize transition-colors',
              mealType === m
                ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-200'
                : 'border-slate-700/60 bg-slate-800/60 text-gray-300 hover:bg-slate-700/60'
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={commit}
          disabled={saving}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-green-600 to-green-700 px-4 py-2 text-sm font-semibold text-white hover:from-green-700 hover:to-green-800 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Confirm &amp; log
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/60 px-4 py-2 text-sm text-gray-300 hover:bg-slate-700/60 disabled:opacity-50"
        >
          <X className="h-4 w-4" />
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-gray-400">{label}</span>
      {children}
    </label>
  );
}

function Total({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-base font-bold text-white tabular-nums">{value}</div>
      <div className="text-[11px] text-gray-400">{label}</div>
    </div>
  );
}
