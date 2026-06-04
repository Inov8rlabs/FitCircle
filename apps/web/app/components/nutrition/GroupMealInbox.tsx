'use client';

import { Check, Loader2, Utensils, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useDietaryUnits } from '@/hooks/useDietaryUnits';
import {
  nutritionClient,
  type PendingGroupMealTag,
} from '@/lib/api/nutrition-client';
import { formatCalories, formatGrams } from '@/lib/format/units';

interface GroupMealInboxProps {
  /** Only show pending tags for this circle (the composer lives here too). */
  circleId?: string;
  onChanged?: () => void;
}

/**
 * §6.12 — the "accept into my diary" inbox. One-tap Accept (creates the caller's
 * own food entry from the shared meal) or Decline for each pending tag.
 */
export function GroupMealInbox({ circleId, onChanged }: GroupMealInboxProps) {
  const units = useDietaryUnits();
  const [pending, setPending] = useState<PendingGroupMealTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyTagId, setBusyTagId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await nutritionClient.getPendingGroupMeals();
      const scoped = circleId
        ? all.filter((p) => p.groupMeal.fitcircleId === circleId)
        : all;
      setPending(scoped);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invites');
    } finally {
      setLoading(false);
    }
  }, [circleId]);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = async (tagId: string, action: 'accept' | 'decline') => {
    setBusyTagId(tagId);
    try {
      if (action === 'accept') await nutritionClient.acceptGroupMealTag(tagId);
      else await nutritionClient.declineGroupMealTag(tagId);
      setPending((prev) => prev.filter((p) => p.tag.id !== tagId));
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusyTagId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-20 items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return <p className="py-4 text-center text-sm text-amber-300">{error}</p>;
  }

  if (pending.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-gray-400">
        No meal invites waiting.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {pending.map(({ tag, groupMeal }) => {
        const busy = busyTagId === tag.id;
        const m = groupMeal.macros;
        return (
          <li
            key={tag.id}
            className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
                <Utensils className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{groupMeal.name}</p>
                {groupMeal.restaurantName && (
                  <p className="truncate text-xs text-gray-300">{groupMeal.restaurantName}</p>
                )}
                {(m.calories != null ||
                  m.proteinG != null ||
                  m.carbsG != null ||
                  m.fatG != null) && (
                  <p className="mt-0.5 text-xs text-gray-400">
                    {formatCalories(m.calories)} · {formatGrams(m.proteinG, units)} protein ·{' '}
                    {formatGrams(m.carbsG, units)} carbs · {formatGrams(m.fatG, units)} fat
                  </p>
                )}
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => respond(tag.id, 'accept')}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Accept into diary
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => respond(tag.id, 'decline')}
                aria-label={`Decline ${groupMeal.name}`}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-700/60 bg-slate-800/60 px-3 py-1.5 text-xs text-gray-200 hover:bg-slate-700/60 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Decline
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
