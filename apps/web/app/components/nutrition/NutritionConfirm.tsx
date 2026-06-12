'use client';

import { Check, ChevronDown, Loader2, Minus, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import {
  LOW_CONFIDENCE_THRESHOLD,
  nutritionClient,
  type NutritionDraft,
  type NutritionDraftItem,
  type UnitOption,
} from '@/lib/api/nutrition-client';
import { cn } from '@/lib/utils';

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];
const UNIT_EXTRAS = ['serving', 'piece', 'cup'];

interface NutritionConfirmProps {
  /** Draft returned by photo/voice parse. When null, starts an empty manual entry. */
  draft: NutritionDraft | null;
  onCommitted?: () => void;
  onCancel?: () => void;
  /** When provided, shows a "Fix Issue" control that re-runs the AI analysis. */
  onReanalyze?: () => void;
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

// --- portion math (mirrors the iOS client) --------------------------------

function resolvedUnitOptions(item: NutritionDraftItem): UnitOption[] {
  if (item.unitOptions && item.unitOptions.length > 0) return item.unitOptions;
  const out: UnitOption[] = [];
  if (item.servingUnit && item.servingUnit.toLowerCase() !== 'g') {
    out.push({ label: item.servingUnit, gramsPerUnit: item.gramsPerUnit || item.grams || 1 });
  }
  out.push({ label: 'g', gramsPerUnit: 1 });
  out.push({ label: 'oz', gramsPerUnit: 28.3495 });
  return out;
}

function unitLabels(item: NutritionDraftItem): string[] {
  const out = resolvedUnitOptions(item).map((o) => o.label);
  for (const extra of UNIT_EXTRAS) {
    if (!out.some((l) => l.toLowerCase() === extra)) out.push(extra);
  }
  return out;
}

function gramsPerUnitFor(label: string, item: NutritionDraftItem): number {
  const l = label.toLowerCase();
  if (l === 'g' || l === 'gram' || l === 'grams') return 1;
  if (l === 'oz' || l === 'ounce' || l === 'ounces') return 28.3495;
  const opt = resolvedUnitOptions(item).find((o) => o.label.toLowerCase() === l);
  if (opt) return opt.gramsPerUnit;
  return item.gramsPerUnit && item.gramsPerUnit > 0 ? item.gramsPerUnit : 1;
}

function perGram(item: NutritionDraftItem) {
  const g = item.grams && item.grams > 0 ? item.grams : 0;
  if (!g) return null;
  return {
    cal: item.calories / g,
    p: item.proteinG / g,
    c: item.carbsG / g,
    f: item.fatG / g,
    fiber: (item.fiberG || 0) / g,
    sugar: (item.sugarG || 0) / g,
    sodium: (item.sodiumMg || 0) / g,
  };
}

/** Apply a new portion (quantity + unit) and rescale macros LIVE from per-gram density. */
function applyPortion(item: NutritionDraftItem, quantity: number, unitLabel: string): NutritionDraftItem {
  const label = unitLabel || item.servingUnit || 'g';
  const gpu = gramsPerUnitFor(label, item);
  const newGrams = quantity * gpu;
  const d = perGram(item);
  const next: NutritionDraftItem = { ...item, quantity, servingUnit: label, gramsPerUnit: gpu };
  if (newGrams > 0 && d) {
    const r = (v: number) => Math.round(v * newGrams * 10) / 10;
    next.grams = Math.round(newGrams * 10) / 10;
    next.calories = r(d.cal);
    next.proteinG = r(d.p);
    next.carbsG = r(d.c);
    next.fatG = r(d.f);
    next.fiberG = r(d.fiber);
    next.sugarG = r(d.sugar);
    next.sodiumMg = r(d.sodium);
  } else {
    next.grams = newGrams > 0 ? newGrams : item.grams;
  }
  return next;
}

function scaleItem(item: NutritionDraftItem, factor: number) {
  if (factor === 1) return item;
  const m = (v: number) => Math.round(v * factor * 10) / 10;
  const mo = (v: number | undefined) => (v == null ? v : Math.round(v * factor * 10) / 10);
  return {
    ...item,
    quantity: m(item.quantity),
    grams: mo(item.grams),
    calories: m(item.calories),
    proteinG: m(item.proteinG),
    carbsG: m(item.carbsG),
    fatG: m(item.fatG),
    fiberG: mo(item.fiberG),
    sugarG: mo(item.sugarG),
    sodiumMg: mo(item.sodiumMg),
  };
}

// Display formatter for read-only quantity/servings labels: whole numbers stay
// whole, common fractions render as glyphs (½, ¼, ¾, ⅓, ⅔), else up to 2 trimmed
// decimals. (Editable fields use raw <input type="number"> values, not this.)
const numFmt = (v: number) => {
  const whole = Math.floor(v);
  const frac = Math.round((v - whole) * 100);
  const glyph: Record<number, string> = { 25: '¼', 50: '½', 75: '¾', 33: '⅓', 66: '⅔', 67: '⅔', 20: '⅕', 12: '⅛', 13: '⅛' };
  if (glyph[frac]) return whole === 0 ? glyph[frac] : `${whole}${glyph[frac]}`;
  if (v === Math.round(v)) return String(v);
  return parseFloat(v.toFixed(2)).toString();
};

/**
 * Competitor-grade meal review: a macro + secondary-nutrient summary with a
 * health score, a meal-level servings multiplier, and a tappable ingredient
 * list whose editor offers measurement pills + live macro recompute. Confirm
 * commits the full breakdown via the food-log create endpoint.
 */
export function NutritionConfirm({ draft, onCommitted, onCancel, onReanalyze }: NutritionConfirmProps) {
  const lowConfidence = !draft || draft.overallConfidence < LOW_CONFIDENCE_THRESHOLD;

  const [items, setItems] = useState<NutritionDraftItem[]>(() =>
    draft && draft.items.length > 0 ? draft.items.map((i) => ({ ...i })) : [emptyItem()]
  );
  const [servings, setServings] = useState(1);
  const [mealType, setMealType] = useState<MealType>('snack');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [reanalyzingIdx, setReanalyzingIdx] = useState<number | null>(null);

  const base = items.reduce(
    (a, it) => ({
      cal: a.cal + (it.calories || 0),
      p: a.p + (it.proteinG || 0),
      c: a.c + (it.carbsG || 0),
      f: a.f + (it.fatG || 0),
      fiber: a.fiber + (it.fiberG || 0),
      sugar: a.sugar + (it.sugarG || 0),
      sodium: a.sodium + (it.sodiumMg || 0),
    }),
    { cal: 0, p: 0, c: 0, f: 0, fiber: 0, sugar: 0, sodium: 0 }
  );
  const sc = (v: number) => Math.round(v * servings);
  const hasSecondary = base.fiber > 0 || base.sugar > 0 || base.sodium > 0;
  const healthScore = draft?.healthScore ?? null;

  const patchItem = (idx: number, patch: Partial<NutritionDraftItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const setPortion = (idx: number, quantity: number, unit: string) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? applyPortion(it, quantity, unit) : it)));

  const removeItem = (idx: number) =>
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  /** Re-estimate one item's macros from its corrected name + current portion. */
  const reanalyze = async (idx: number) => {
    const it = items[idx];
    const name = it.name.trim();
    if (!name) {
      setError('Add a name first, then reanalyze.');
      return;
    }
    setReanalyzingIdx(idx);
    setError(null);
    try {
      const grams = it.grams && it.grams > 0 ? it.grams : (it.quantity || 0) * (it.gramsPerUnit || 0);
      const est = await nutritionClient.estimateItem({
        name,
        grams: grams > 0 ? grams : undefined,
        quantity: it.quantity > 0 ? it.quantity : undefined,
        servingUnit: it.servingUnit || undefined,
      });
      // Keep the user's corrected name; adopt the fresh nutrition + grounding.
      setItems((prev) =>
        prev.map((cur, i) =>
          i === idx
            ? {
                ...cur,
                grams: est.grams,
                gramsPerUnit: est.gramsPerUnit,
                quantity: est.quantity ?? cur.quantity,
                servingUnit: est.servingUnit || cur.servingUnit,
                calories: est.calories,
                proteinG: est.proteinG,
                carbsG: est.carbsG,
                fatG: est.fatG,
                fiberG: est.fiberG,
                sugarG: est.sugarG,
                sodiumMg: est.sodiumMg,
                matchedFoodId: est.matchedFoodId,
                itemSource: est.itemSource,
                unitOptions: est.unitOptions,
              }
            : cur
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reanalyze failed');
    } finally {
      setReanalyzingIdx(null);
    }
  };

  const num = (v: string) => (v === '' ? 0 : Number(v));

  const commit = async () => {
    const named = items.filter((i) => i.name.trim()).map((i) => scaleItem(i, servings));
    if (named.length === 0) {
      setError('Add at least one item with a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const title = named.map((i) => i.name.trim()).join(', ');
      const totals = named.reduce(
        (a, it) => ({
          calories: a.calories + (it.calories || 0),
          protein_g: a.protein_g + (it.proteinG || 0),
          carbs_g: a.carbs_g + (it.carbsG || 0),
          fat_g: a.fat_g + (it.fatG || 0),
          fiber_g: a.fiber_g + (it.fiberG || 0),
          sugar_g: a.sugar_g + (it.sugarG || 0),
          sodium_mg: a.sodium_mg + (it.sodiumMg || 0),
        }),
        { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0 }
      );
      await nutritionClient.createFoodLog({
        entry_type: 'food',
        meal_type: mealType,
        title,
        nutrition_data: {
          calories: Math.round(totals.calories),
          protein_g: Math.round(totals.protein_g),
          carbs_g: Math.round(totals.carbs_g),
          fat_g: Math.round(totals.fat_g),
          fiber_g: Math.round(totals.fiber_g),
          sugar_g: Math.round(totals.sugar_g),
          sodium_mg: Math.round(totals.sodium_mg),
          health_score: healthScore,
          items: named.map((it) => ({
            name: it.name.trim(),
            quantity: it.quantity,
            serving_unit: it.servingUnit,
            grams: it.grams ?? null,
            calories: it.calories,
            protein_g: it.proteinG,
            carbs_g: it.carbsG,
            fat_g: it.fatG,
            fiber_g: it.fiberG ?? null,
            sugar_g: it.sugarG ?? null,
            sodium_mg: it.sodiumMg ?? null,
          })),
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
        <h3 className="text-base font-semibold text-white">Review your meal</h3>
        <div className="flex items-center gap-2">
          {onReanalyze && (
            <button
              type="button"
              onClick={onReanalyze}
              className="inline-flex items-center gap-1 rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-200 hover:bg-indigo-500/20"
            >
              <Sparkles className="h-3.5 w-3.5" /> Fix Issue
            </button>
          )}
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
      </div>

      {/* Summary */}
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3">
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label="Calories" value={sc(base.cal)} accent="text-orange-300" big />
          <Stat label="Protein" value={`${sc(base.p)}g`} accent="text-indigo-300" />
          <Stat label="Carbs" value={`${sc(base.c)}g`} accent="text-emerald-300" />
          <Stat label="Fat" value={`${sc(base.f)}g`} accent="text-cyan-300" />
        </div>
        {hasSecondary && (
          <div className="mt-2 grid grid-cols-3 gap-2 border-t border-slate-700/40 pt-2 text-center">
            <Stat label="Fiber" value={`${sc(base.fiber)}g`} accent="text-purple-300" />
            <Stat label="Sugar" value={`${sc(base.sugar)}g`} accent="text-amber-300" />
            <Stat label="Sodium" value={`${sc(base.sodium)}mg`} accent="text-cyan-300" />
          </div>
        )}
        {healthScore != null && (
          <div className="mt-3 border-t border-slate-700/40 pt-3">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium text-white">Health Score</span>
              <span
                className={cn(
                  'font-bold',
                  healthScore >= 7 ? 'text-emerald-300' : healthScore >= 4 ? 'text-amber-300' : 'text-orange-300'
                )}
              >
                {Math.round(healthScore)}/10
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700/60">
              <div
                className={cn(
                  'h-full rounded-full',
                  healthScore >= 7 ? 'bg-emerald-400' : healthScore >= 4 ? 'bg-amber-400' : 'bg-orange-400'
                )}
                style={{ width: `${Math.max(0, Math.min(100, healthScore * 10))}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Servings */}
      <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-800/40 p-3">
        <div>
          <div className="text-sm font-semibold text-white">Servings</div>
          <div className="text-[11px] text-gray-400">How many of this plate</div>
        </div>
        <div className="flex items-center gap-3 rounded-lg bg-slate-900/60 px-2 py-1">
          <Step icon={<Minus className="h-3.5 w-3.5" />} onClick={() => setServings((s) => Math.max(1, Math.round((s - 0.5) * 2) / 2))} />
          <span className="min-w-[2ch] text-center text-base font-bold text-white tabular-nums">{numFmt(servings)}</span>
          <Step icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setServings((s) => Math.round((s + 0.5) * 2) / 2)} />
        </div>
      </div>

      {/* Ingredients */}
      <div className="mt-4 flex items-center justify-between">
        <h4 className="text-sm font-bold text-white">Ingredients</h4>
        <button
          type="button"
          onClick={() => {
            setItems((prev) => [...prev, emptyItem()]);
            setOpenIdx(items.length);
          }}
          className="text-xs font-medium text-indigo-300 hover:text-indigo-200"
        >
          + Add
        </button>
      </div>

      <div className="mt-2 space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="rounded-lg border border-slate-700/50 bg-slate-800/40">
            <button
              type="button"
              onClick={() => setOpenIdx(openIdx === idx ? null : idx)}
              className="flex w-full items-center justify-between gap-2 p-3 text-left"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{it.name || 'New ingredient'}</div>
                <div className="text-[11px] text-gray-400">
                  {Math.round(it.calories || 0)} cal{it.matchedFoodId ? ' · from database' : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-300">
                <span>
                  {numFmt(it.quantity)} {it.servingUnit || 'g'}
                </span>
                <ChevronDown className={cn('h-4 w-4 transition-transform', openIdx === idx && 'rotate-180')} />
              </div>
            </button>

            {openIdx === idx && (
              <div className="space-y-3 border-t border-slate-700/40 p-3">
                <input
                  value={it.name}
                  onChange={(e) => patchItem(idx, { name: e.target.value })}
                  placeholder="Food name"
                  className="w-full rounded-md border border-slate-600 bg-slate-900/60 px-2 py-1.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />

                {/* Reanalyze: correct the AI's guess → refresh calories & macros */}
                <button
                  type="button"
                  onClick={() => reanalyze(idx)}
                  disabled={reanalyzingIdx === idx || !it.name.trim()}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2 py-1.5 text-xs font-medium text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50"
                >
                  {reanalyzingIdx === idx ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reanalyzing…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" /> Reanalyze nutrition
                    </>
                  )}
                </button>
                <p className="-mt-1 text-[11px] text-gray-500">
                  Fix the name if the AI guessed wrong, then reanalyze to update the macros below.
                </p>

                {/* Measurement pills */}
                <div className="flex flex-wrap gap-1.5">
                  {unitLabels(it).map((label) => {
                    const selected = label.toLowerCase() === (it.servingUnit || 'g').toLowerCase();
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setPortion(idx, it.quantity, label)}
                        className={cn(
                          'rounded-full border px-3 py-1 text-xs transition-colors',
                          selected
                            ? 'border-indigo-500/60 bg-indigo-500 text-white'
                            : 'border-slate-700/60 bg-slate-900/60 text-gray-300 hover:bg-slate-700/60'
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* Quantity stepper */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Amount</span>
                  <div className="flex items-center gap-3 rounded-lg bg-slate-900/60 px-2 py-1">
                    <Step icon={<Minus className="h-3.5 w-3.5" />} onClick={() => setPortion(idx, Math.max(0, Math.round((it.quantity - stepSize(it)) * 100) / 100), it.servingUnit)} />
                    <input
                      type="number"
                      step={stepSize(it)}
                      value={it.quantity}
                      onChange={(e) => setPortion(idx, num(e.target.value), it.servingUnit)}
                      className="w-16 bg-transparent text-center text-sm font-bold text-white focus:outline-none"
                    />
                    <Step icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setPortion(idx, Math.round((it.quantity + stepSize(it)) * 100) / 100, it.servingUnit)} />
                  </div>
                </div>

                {/* Editable macros */}
                <div className="grid grid-cols-4 gap-2">
                  <Field label="Cal">
                    <MacroInput value={it.calories} onChange={(v) => patchItem(idx, { calories: v })} />
                  </Field>
                  <Field label="P (g)">
                    <MacroInput value={it.proteinG} onChange={(v) => patchItem(idx, { proteinG: v })} />
                  </Field>
                  <Field label="C (g)">
                    <MacroInput value={it.carbsG} onChange={(v) => patchItem(idx, { carbsG: v })} />
                  </Field>
                  <Field label="F (g)">
                    <MacroInput value={it.fatG} onChange={(v) => patchItem(idx, { fatG: v })} />
                  </Field>
                </div>

                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  disabled={items.length === 1}
                  className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-400 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove ingredient
                </button>
              </div>
            )}
          </div>
        ))}
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

function stepSize(item: NutritionDraftItem): number {
  switch ((item.servingUnit || 'g').toLowerCase()) {
    case 'g':
    case 'gram':
    case 'grams':
    case 'ml':
    case 'milliliter':
      return 10;
    case 'oz':
    case 'ounce':
    case 'ounces':
      return 1;
    case 'cup':
    case 'cups':
    case 'tbsp':
    case 'tablespoon':
    case 'tsp':
    case 'teaspoon':
      return 0.25; // volume units — quarter-steps so ¼/½/¾ are reachable
    default:
      return 0.5; // count units (piece, slice, serving, …) — allow halves
  }
}

function Step({ icon, onClick }: { icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md p-1 text-indigo-300 hover:bg-slate-700/60">
      {icon}
    </button>
  );
}

function MacroInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      className="w-full rounded-md border border-slate-600 bg-slate-900/60 px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
    />
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

function Stat({ label, value, accent, big }: { label: string; value: string | number; accent?: string; big?: boolean }) {
  return (
    <div>
      <div className={cn('font-bold tabular-nums', big ? 'text-2xl' : 'text-base', accent ?? 'text-white')}>{value}</div>
      <div className="text-[11px] text-gray-400">{label}</div>
    </div>
  );
}
