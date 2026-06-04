'use client';

import { Check, Loader2, Search, Users, Utensils } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  nutritionClient,
  type CreateGroupMealInput,
  type Food,
  type GroupMealType,
} from '@/lib/api/nutrition-client';
import { cn } from '@/lib/utils';

import { FoodSearch } from './FoodSearch';

const MEAL_TYPES: GroupMealType[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

export interface CircleMember {
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
}

interface GroupMealComposerProps {
  circleId: string;
  members: CircleMember[];
  /** Exclude the current user from the tag list (they get their own entry automatically). */
  currentUserId?: string;
  onCreated?: () => void;
}

/**
 * §6.12 — log a SHARED meal at a restaurant and tag circle members.
 * Restaurant lookup (Nutritionix) and the food DB both prefill macros; the
 * creator's own entry is created server-side and tagged members get pending
 * tags they accept from the inbox. Macro math lives server-side; we only POST.
 */
export function GroupMealComposer({
  circleId,
  members,
  currentUserId,
  onCreated,
}: GroupMealComposerProps) {
  const [name, setName] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [mealType, setMealType] = useState<GroupMealType>('dinner');
  const [calories, setCalories] = useState('');
  const [proteinG, setProteinG] = useState('');
  const [carbsG, setCarbsG] = useState('');
  const [fatG, setFatG] = useState('');
  const [tagged, setTagged] = useState<Set<string>>(new Set());
  const [showFoodSearch, setShowFoodSearch] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const taggable = members.filter((m) => m.user_id !== currentUserId);

  const toggleMember = (id: string) =>
    setTagged((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const applyFood = (food: Food) => {
    if (!name.trim()) setName(food.name);
    const p = food.per100g;
    if (p.calories != null) setCalories(String(Math.round(p.calories)));
    if (p.proteinG != null) setProteinG(String(Math.round(p.proteinG)));
    if (p.carbsG != null) setCarbsG(String(Math.round(p.carbsG)));
    if (p.fatG != null) setFatG(String(Math.round(p.fatG)));
    setShowFoodSearch(false);
  };

  const num = (v: string) => (v === '' ? 0 : Number(v));
  const hasMacros =
    calories !== '' || proteinG !== '' || carbsG !== '' || fatG !== '';

  const submit = async () => {
    if (!name.trim()) {
      setError('Give the meal a name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input: CreateGroupMealInput = {
        fitcircleId: circleId,
        name: name.trim(),
        ...(restaurantName.trim() ? { restaurantName: restaurantName.trim() } : {}),
        mealType,
        ...(hasMacros
          ? {
              macros: {
                calories: num(calories),
                proteinG: num(proteinG),
                carbsG: num(carbsG),
                fatG: num(fatG),
              },
            }
          : {}),
        taggedUserIds: Array.from(tagged),
      };
      await nutritionClient.createGroupMeal(input);
      setDone(true);
      setName('');
      setRestaurantName('');
      setCalories('');
      setProteinG('');
      setCarbsG('');
      setFatG('');
      setTagged(new Set());
      onCreated?.();
      setTimeout(() => setDone(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the meal.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full rounded-md border border-slate-600 bg-slate-900/60 px-2.5 py-2 text-sm text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 backdrop-blur-xl">
      <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-white">
        <Utensils className="h-4 w-4 text-indigo-400" aria-hidden="true" />
        Log a group meal
      </h3>

      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs text-gray-300">Meal name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sharing pizza night"
            className={inputCls}
          />
        </label>

        <RestaurantField
          value={restaurantName}
          onChange={setRestaurantName}
          onPickFood={applyFood}
        />

        {/* Meal type */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Meal type">
          {MEAL_TYPES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mealType === m}
              onClick={() => setMealType(m)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs capitalize transition-colors',
                mealType === m
                  ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-100'
                  : 'border-slate-700/60 bg-slate-800/60 text-gray-200 hover:bg-slate-700/60'
              )}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Macros */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs text-gray-300">Per-person macros (optional)</span>
            <button
              type="button"
              onClick={() => setShowFoodSearch((s) => !s)}
              className="text-xs font-medium text-indigo-300 hover:text-indigo-200"
            >
              {showFoodSearch ? 'Hide food search' : 'Find from food DB'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <NumField label="Cal" value={calories} onChange={setCalories} />
            <NumField label="Protein (g)" value={proteinG} onChange={setProteinG} />
            <NumField label="Carbs (g)" value={carbsG} onChange={setCarbsG} />
            <NumField label="Fat (g)" value={fatG} onChange={setFatG} />
          </div>
          {showFoodSearch && (
            <div className="mt-2 rounded-lg border border-slate-700/50 bg-slate-800/40 p-3">
              <FoodSearch onSelect={applyFood} />
            </div>
          )}
        </div>

        {/* Tag members */}
        <div>
          <span className="mb-1.5 flex items-center gap-1.5 text-xs text-gray-300">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Tag circle members
          </span>
          {taggable.length === 0 ? (
            <p className="text-xs text-gray-400">No other members to tag yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {taggable.map((m) => {
                const on = tagged.has(m.user_id);
                return (
                  <button
                    key={m.user_id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleMember(m.user_id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                      on
                        ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-100'
                        : 'border-slate-700/60 bg-slate-800/60 text-gray-200 hover:bg-slate-700/60'
                    )}
                  >
                    {on && <Check className="h-3 w-3" aria-hidden="true" />}
                    {m.display_name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-300">{error}</p>}
        {done && <p className="text-sm text-emerald-300">Meal logged and tags sent.</p>}

        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:from-indigo-700 hover:to-indigo-800 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Utensils className="h-4 w-4" aria-hidden="true" />
          )}
          Log &amp; tag
          {tagged.size > 0 && ` (${tagged.size})`}
        </button>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-gray-400">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-600 bg-slate-900/60 px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </label>
  );
}

/** Restaurant name input with a debounced Nutritionix menu-item lookup. */
function RestaurantField({
  value,
  onChange,
  onPickFood,
}: {
  value: string;
  onChange: (v: string) => void;
  onPickFood: (food: Food) => void;
}) {
  const [results, setResults] = useState<Food[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const run = async () => {
      try {
        const found = await nutritionClient.searchRestaurant(q);
        setResults(found);
        setOpen(found.length > 0);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    };
    debounceRef.current = setTimeout(() => void run(), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  return (
    <div className="relative">
      <span className="mb-1 block text-xs text-gray-300">Restaurant (optional)</span>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          aria-hidden="true"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search a restaurant menu item…"
          className="w-full rounded-md border border-slate-600 bg-slate-900/60 py-2 pl-9 pr-9 text-sm text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {searching && (
          <Loader2
            className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400"
            aria-hidden="true"
          />
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-700/60 bg-slate-900/95 p-1 shadow-xl backdrop-blur-xl">
          {results.map((food) => (
            <li key={food.id}>
              <button
                type="button"
                onClick={() => {
                  if (food.brand) onChange(food.brand);
                  onPickFood(food);
                  setOpen(false);
                }}
                className="flex w-full flex-col rounded-md px-2.5 py-1.5 text-left hover:bg-slate-700/50"
              >
                <span className="truncate text-sm text-white">{food.name}</span>
                {food.brand && (
                  <span className="truncate text-xs text-gray-400">{food.brand}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
