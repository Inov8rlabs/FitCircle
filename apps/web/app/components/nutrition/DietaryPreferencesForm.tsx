'use client';

import { Check, Loader2, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { primeDietaryUnits } from '@/hooks/useDietaryUnits';
import {
  DIET_TYPES,
  nutritionClient,
  type DietType,
  type DietaryUnits,
} from '@/lib/api/nutrition-client';
import { cn } from '@/lib/utils';

const DIET_LABEL: Record<DietType, string> = {
  none: 'No restriction',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  pescatarian: 'Pescatarian',
  halal: 'Halal',
  kosher: 'Kosher',
  gluten_free: 'Gluten-free',
};

const COMMON_ALLERGENS = [
  'peanuts',
  'tree nuts',
  'milk',
  'eggs',
  'wheat',
  'soy',
  'fish',
  'shellfish',
  'sesame',
];

/**
 * §6.15 — dietary pattern + allergen chips + display-units toggle. Search,
 * suggestions and the coach respect these server-side; units are display-only
 * (the API always returns canonical grams/kcal).
 */
export function DietaryPreferencesForm() {
  const [diet, setDiet] = useState<DietType>('none');
  const [allergens, setAllergens] = useState<string[]>([]);
  const [units, setUnits] = useState<DietaryUnits>('metric');
  const [customAllergen, setCustomAllergen] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    nutritionClient
      .getDietaryPreferences()
      .then((p) => {
        setDiet(p.diet);
        setAllergens(p.allergens);
        setUnits(p.units);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const toggleAllergen = (token: string) => {
    const t = token.trim().toLowerCase();
    if (!t) return;
    setAllergens((prev) =>
      prev.includes(t) ? prev.filter((a) => a !== t) : [...prev, t]
    );
  };

  const addCustom = () => {
    const t = customAllergen.trim().toLowerCase();
    if (t && !allergens.includes(t)) setAllergens((prev) => [...prev, t]);
    setCustomAllergen('');
  };

  const save = async () => {
    setSaving(true);
    setStatus('idle');
    setError(null);
    try {
      const result = await nutritionClient.setDietaryPreferences({
        diet,
        allergens,
        units,
      });
      setDiet(result.diet);
      setAllergens(result.allergens);
      setUnits(result.units);
      primeDietaryUnits(result.units);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-slate-800/60 bg-slate-900/60 backdrop-blur-xl">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 backdrop-blur-xl">
      {/* Diet */}
      <div>
        <label htmlFor="diet-select" className="mb-1.5 block text-sm font-medium text-white">
          Dietary pattern
        </label>
        <select
          id="diet-select"
          value={diet}
          onChange={(e) => setDiet(e.target.value as DietType)}
          className="w-full rounded-lg border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {DIET_TYPES.map((d) => (
            <option key={d} value={d}>
              {DIET_LABEL[d]}
            </option>
          ))}
        </select>
      </div>

      {/* Allergens */}
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-white">Allergens</legend>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_ALLERGENS.map((a) => {
            const on = allergens.includes(a);
            return (
              <button
                key={a}
                type="button"
                aria-pressed={on}
                onClick={() => toggleAllergen(a)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs capitalize transition-colors',
                  on
                    ? 'border-rose-500/50 bg-rose-500/20 text-rose-100'
                    : 'border-slate-700/60 bg-slate-800/60 text-gray-200 hover:bg-slate-700/60'
                )}
              >
                {on && <Check className="h-3 w-3" aria-hidden="true" />}
                {a}
              </button>
            );
          })}
        </div>

        {/* Custom allergens not in the common list */}
        {allergens.filter((a) => !COMMON_ALLERGENS.includes(a)).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {allergens
              .filter((a) => !COMMON_ALLERGENS.includes(a))
              .map((a) => (
                <span
                  key={a}
                  className="inline-flex items-center gap-1 rounded-full border border-rose-500/50 bg-rose-500/20 px-2.5 py-1 text-xs text-rose-100"
                >
                  {a}
                  <button
                    type="button"
                    onClick={() => toggleAllergen(a)}
                    aria-label={`Remove ${a}`}
                    className="text-rose-200 hover:text-white"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
          </div>
        )}

        <div className="mt-2 flex gap-2">
          <input
            value={customAllergen}
            onChange={(e) => setCustomAllergen(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustom())}
            placeholder="Add another allergen"
            aria-label="Add a custom allergen"
            className="flex-1 rounded-md border border-slate-600 bg-slate-900/60 px-2.5 py-1.5 text-sm text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={addCustom}
            aria-label="Add allergen"
            className="inline-flex items-center gap-1 rounded-md border border-slate-700/60 bg-slate-800/60 px-3 text-sm text-gray-200 hover:bg-slate-700/60"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </fieldset>

      {/* Units */}
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-white">Nutrition units</legend>
        <div className="inline-flex rounded-lg border border-slate-700/60 bg-slate-800/60 p-0.5">
          {(['metric', 'imperial'] as DietaryUnits[]).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={units === u}
              onClick={() => setUnits(u)}
              className={cn(
                'rounded-md px-4 py-1.5 text-sm capitalize transition-colors',
                units === u ? 'bg-indigo-500/30 text-white' : 'text-gray-300 hover:text-white'
              )}
            >
              {u === 'metric' ? 'Metric (g, ml)' : 'Imperial (oz, fl oz)'}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-gray-400">
          Display only — your data is always stored in grams and calories.
        </p>
      </fieldset>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:from-indigo-700 hover:to-indigo-800 disabled:opacity-50"
      >
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Check className="h-4 w-4" aria-hidden="true" />
        )}
        {status === 'saved' ? 'Saved' : 'Save preferences'}
      </button>
    </div>
  );
}
