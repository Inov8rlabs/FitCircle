'use client';

import { Lock } from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';

import { useDietaryUnits } from '@/hooks/useDietaryUnits';
import {
  nutritionClient,
  type FoodFeedCard,
  type FoodReactionSummary,
  type PrivacyTier,
  type ReactionKind,
} from '@/lib/api/nutrition-client';
import { formatCalories, formatGrams } from '@/lib/format/units';
import { cn } from '@/lib/utils';

const REACTION_KINDS: ReactionKind[] = ['flame', 'clap', 'eyes', 'same', 'heart', 'laugh'];
const REACTION_EMOJI: Record<ReactionKind, string> = {
  flame: '🔥',
  clap: '👏',
  eyes: '👀',
  same: '🙌',
  heart: '❤️',
  laugh: '😂',
};

const TIER_LABEL: Record<PrivacyTier, string> = {
  full: 'Sharing full',
  summary: 'Sharing summary',
  private: 'Private',
};

interface CircleFoodFeedProps {
  circleId: string;
  /** Active privacy tier, shown as a chip near the top of the feed. */
  privacyTier?: PrivacyTier | null;
}

/** Food feed cards with photo, macros (null when hidden), and tapback reactions. */
export function CircleFoodFeed({ circleId, privacyTier }: CircleFoodFeedProps) {
  const [cards, setCards] = useState<FoodFeedCard[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (before?: string) => {
      try {
        const res = await nutritionClient.getFoodFeed(circleId, { before, limit: 20 });
        setCards((prev) => (before ? [...prev, ...res.cards] : res.cards));
        setHasMore(res.hasMore);
        setNextBefore(res.nextBefore);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load feed');
      }
    },
    [circleId]
  );

  useEffect(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  const loadMore = async () => {
    if (!nextBefore) return;
    setLoadingMore(true);
    await load(nextBefore);
    setLoadingMore(false);
  };

  const onReactionChange = (cardId: string, reactions: FoodReactionSummary[]) =>
    setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, reactions } : c)));

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return <p className="py-8 text-center text-sm text-amber-300">{error}</p>;
  }

  return (
    <div className="space-y-3">
      {privacyTier && (
        <div className="flex justify-end">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700/60 bg-slate-800/60 px-2.5 py-1 text-xs text-gray-300">
            <Lock className="h-3 w-3" />
            {TIER_LABEL[privacyTier]}
          </span>
        </div>
      )}

      {cards.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-400">
          No meals shared yet. Be the first to log one!
        </p>
      ) : (
        cards.map((card) => (
          <FoodFeedItem key={card.id} card={card} onReactionChange={onReactionChange} />
        ))
      )}

      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="mx-auto block rounded-lg border border-slate-700/60 bg-slate-800/60 px-4 py-2 text-sm text-gray-300 hover:bg-slate-700/60 disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

function FoodFeedItem({
  card,
  onReactionChange,
}: {
  card: FoodFeedCard;
  onReactionChange: (id: string, r: FoodReactionSummary[]) => void;
}) {
  const units = useDietaryUnits();
  const time = new Date(card.loggedAt).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 backdrop-blur-xl">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 text-sm font-semibold text-white">
          {card.owner.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.owner.avatarUrl} alt={card.owner.name} className="h-full w-full object-cover" />
          ) : (
            card.owner.name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{card.owner.name}</p>
          <p className="text-xs text-gray-400">{time}</p>
        </div>
      </div>

      {card.photoUrl && (
        <div className="mb-3 overflow-hidden rounded-lg">
          <Image
            src={card.photoUrl}
            alt={card.foodName}
            width={640}
            height={400}
            className="h-48 w-full object-cover"
            unoptimized
          />
        </div>
      )}

      <p className="text-sm font-medium text-white">{card.foodName}</p>

      {card.macros ? (
        <p className="mt-1 text-xs text-gray-400">
          {formatCalories(card.macros.calories)} · {formatGrams(card.macros.proteinG, units)} protein ·{' '}
          {formatGrams(card.macros.carbsG, units)} carbs · {formatGrams(card.macros.fatG, units)} fat
        </p>
      ) : (
        <p className="mt-1 text-xs italic text-gray-500">Macros hidden</p>
      )}

      <FoodReactionBar foodLogId={card.id} reactions={card.reactions} onChange={(r) => onReactionChange(card.id, r)} />
    </div>
  );
}

/**
 * Food-feed tapback. Mirrors the chat ReactionBar visual + six-emoji set, but
 * toggles via the food-log reaction endpoints from the contract.
 */
function FoodReactionBar({
  foodLogId,
  reactions,
  onChange,
}: {
  foodLogId: string;
  reactions: FoodReactionSummary[];
  onChange: (r: FoodReactionSummary[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const byKind = new Map<ReactionKind, FoodReactionSummary>();
  for (const r of reactions) byKind.set(r.reaction, r);
  const active = reactions.filter((r) => r.count > 0);

  const toggle = async (reaction: ReactionKind) => {
    if (pending) return;
    setPickerOpen(false);
    setPending(true);
    try {
      const existing = byKind.get(reaction);
      const result = existing?.reactedByMe
        ? await nutritionClient.removeFoodReaction(foodLogId, reaction)
        : await nutritionClient.addFoodReaction(foodLogId, reaction);
      onChange(result.reactions);
    } catch (err) {
      console.warn('[food-feed] reaction toggle failed', err);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {active.map((r) => (
        <button
          key={r.reaction}
          type="button"
          disabled={pending}
          onClick={() => toggle(r.reaction)}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:opacity-50',
            r.reactedByMe
              ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-200'
              : 'border-slate-700/60 bg-slate-800/60 text-gray-300 hover:bg-slate-700/60'
          )}
        >
          <span>{REACTION_EMOJI[r.reaction]}</span>
          <span className="tabular-nums">{r.count}</span>
        </button>
      ))}

      <div className="relative">
        <button
          type="button"
          disabled={pending}
          onClick={() => setPickerOpen((o) => !o)}
          aria-label="Add reaction"
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-700/60 bg-slate-800/60 text-xs text-gray-400 transition-colors hover:bg-slate-700/60 disabled:opacity-50"
        >
          +
        </button>

        {pickerOpen && (
          <div className="absolute bottom-full left-0 z-20 mb-1 flex gap-0.5 rounded-full border border-slate-700/60 bg-slate-900/95 px-1.5 py-1 shadow-xl backdrop-blur-xl">
            {REACTION_KINDS.map((reaction) => (
              <button
                key={reaction}
                type="button"
                onClick={() => toggle(reaction)}
                aria-label={reaction}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-base transition-transform hover:scale-125',
                  byKind.get(reaction)?.reactedByMe && 'bg-indigo-500/20'
                )}
              >
                {REACTION_EMOJI[reaction]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
