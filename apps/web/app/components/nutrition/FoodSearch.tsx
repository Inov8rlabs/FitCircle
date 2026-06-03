'use client';

import { Barcode, Loader2, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  nutritionClient,
  type CreateCustomFood,
  type Food,
} from '@/lib/api/nutrition-client';
import { cn } from '@/lib/utils';

interface FoodSearchProps {
  /** Called when a food is chosen (search/barcode/just-saved custom). */
  onSelect?: (food: Food) => void;
}

function macroLine(food: Food): string {
  const p = food.per100g;
  const parts: string[] = [];
  if (p.calories != null) parts.push(`${Math.round(p.calories)} cal`);
  if (p.proteinG != null) parts.push(`${Math.round(p.proteinG)}g protein`);
  return parts.length ? `${parts.join(' · ')} / 100g` : 'No macro data';
}

/**
 * Debounced food search + manual barcode lookup + custom-food save form.
 * Camera barcode scanning is intentionally out of scope for web (manual code
 * entry per the contract note).
 */
export function FoodSearch({ onSelect }: FoodSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Food[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [barcode, setBarcode] = useState('');
  const [barcodeLoading, setBarcodeLoading] = useState(false);

  const [showCustom, setShowCustom] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const found = await nutritionClient.searchFoods(q, { limit: 20 });
        setResults(found);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const lookupBarcode = async () => {
    const code = barcode.trim();
    if (!code) return;
    setBarcodeLoading(true);
    setError(null);
    try {
      const food = await nutritionClient.getBarcode(code);
      onSelect?.(food);
      setResults([food]);
    } catch {
      setError('No match for that barcode. Try search or add a custom food.');
    } finally {
      setBarcodeLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search box */}
      <div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search foods…"
            className="w-full rounded-lg border border-slate-700/60 bg-slate-800/60 py-2.5 pl-9 pr-9 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-500" />
          )}
        </div>

        {results.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {results.map((food) => (
              <li key={food.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(food)}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-2 text-left hover:bg-slate-700/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-white">
                      {food.name}
                      {food.brand && <span className="text-gray-400"> · {food.brand}</span>}
                    </span>
                    <span className="block truncate text-xs text-gray-400">
                      {macroLine(food)}
                    </span>
                  </span>
                  {food.isCustom && (
                    <span className="ml-2 shrink-0 rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 text-[11px] text-indigo-200">
                      Custom
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Manual barcode */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Barcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && lookupBarcode()}
            placeholder="Enter barcode"
            inputMode="numeric"
            className="w-full rounded-lg border border-slate-700/60 bg-slate-800/60 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <button
          type="button"
          onClick={lookupBarcode}
          disabled={barcodeLoading || !barcode.trim()}
          className="inline-flex items-center justify-center rounded-lg border border-slate-700/60 bg-slate-800/60 px-4 text-sm text-gray-200 hover:bg-slate-700/60 disabled:opacity-50"
        >
          {barcodeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Look up'}
        </button>
      </div>

      {error && <p className="text-sm text-amber-300">{error}</p>}

      {/* Custom food */}
      <button
        type="button"
        onClick={() => setShowCustom((s) => !s)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-300 hover:text-indigo-200"
      >
        <Plus className="h-3.5 w-3.5" />
        {showCustom ? 'Hide custom food form' : 'Add a custom food'}
      </button>

      {showCustom && (
        <CustomFoodForm
          onSaved={(food) => {
            setShowCustom(false);
            onSelect?.(food);
          }}
        />
      )}
    </div>
  );
}

function CustomFoodForm({ onSaved }: { onSaved: (food: Food) => void }) {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [calories, setCalories] = useState('');
  const [proteinG, setProteinG] = useState('');
  const [carbsG, setCarbsG] = useState('');
  const [fatG, setFatG] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (v: string) => (v === '' ? 0 : Number(v));

  const save = async () => {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input: CreateCustomFood = {
        name: name.trim(),
        ...(brand.trim() ? { brand: brand.trim() } : {}),
        per100g: {
          calories: num(calories),
          proteinG: num(proteinG),
          carbsG: num(carbsG),
          fatG: num(fatG),
        },
      };
      const food = await nutritionClient.createCustomFood(input);
      onSaved(food);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full rounded-md border border-slate-600 bg-slate-900/60 px-2 py-1.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3">
      <p className="mb-2 text-xs text-gray-400">Macros per 100g</p>
      <div className="space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={inputCls} />
        <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Brand (optional)" className={inputCls} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input type="number" value={calories} onChange={(e) => setCalories(e.target.value)} placeholder="Cal" className={inputCls} />
          <input type="number" value={proteinG} onChange={(e) => setProteinG(e.target.value)} placeholder="Protein" className={inputCls} />
          <input type="number" value={carbsG} onChange={(e) => setCarbsG(e.target.value)} placeholder="Carbs" className={inputCls} />
          <input type="number" value={fatG} onChange={(e) => setFatG(e.target.value)} placeholder="Fat" className={inputCls} />
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className={cn(
          'mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:from-indigo-700 hover:to-indigo-800 disabled:opacity-50'
        )}
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Save custom food
      </button>
    </div>
  );
}
