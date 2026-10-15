'use client';

import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { AnalyticsEvents, analytics, isUpgradeRequired } from '@/lib/analytics';
import { nutritionClient, type NutritionDraft } from '@/lib/api/nutrition-client';
import { cn } from '@/lib/utils';
import { describesAmount } from '@/lib/utils/food-text-amount';

/** Helper copy shown under a meal-description field that feeds "Estimate with AI". */
export const AI_ESTIMATE_HELPER = 'Include amounts for better accuracy — e.g. 2 scrambled eggs, 1 slice buttered toast';

export const NO_AMOUNT_HINT = "No amount given — we'll assume a typical serving. Add one for a better estimate.";

interface EstimateWithAiProps {
  /** The meal description the user typed. The button is disabled until it has text. */
  text: string;
  /** Set when estimating a meal that is already saved (re-analysis; never duplicates it). */
  existingEntryId?: string;
  /** Analytics placement for the AI-limit event. */
  surface?: string;
  /** Called with the draft; the caller fills its fields WITHOUT saving. */
  onEstimate: (draft: NutritionDraft) => void;
  className?: string;
}

/**
 * "Estimate with AI" for typed text: posts the description to voice-parse with
 * source "text" (no fallback entry) and hands the draft back. Shows the inline
 * no-amount hint (non-blocking), a loading state, and inline errors — including
 * the free-tier AI limit, worded by the server — while the typed text is kept.
 */
export function EstimateWithAi({ text, existingEntryId, surface = 'manual_form', onEstimate, className }: EstimateWithAiProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = text.trim();
  const missingAmount = trimmed.length > 0 && !describesAmount(trimmed);

  const run = async () => {
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const draft = await nutritionClient.textParse(trimmed, { existingEntryId });
      if (!draft.items || draft.items.length === 0) {
        setError("We couldn't find a food in that — try naming what you ate.");
        return;
      }
      onEstimate(draft);
    } catch (err) {
      if (isUpgradeRequired(err)) {
        analytics.track(AnalyticsEvents.aiLimitReached({ feature: 'voice_log', source: surface }));
      }
      setError(err instanceof Error && err.message ? err.message : "Couldn't estimate that — you can enter the numbers yourself.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      {missingAmount && (
        <p className="text-xs text-amber-300" data-testid="ai-estimate-no-amount">
          {NO_AMOUNT_HINT}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={run}
        disabled={!trimmed || loading}
        className="gap-1.5 border-indigo-500/40 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20 hover:text-indigo-100"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Estimating…
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" aria-hidden="true" /> Estimate with AI
          </>
        )}
      </Button>
      {error && (
        <p className="text-sm text-amber-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** "AI estimate" note with what the model assumed; the numbers stay editable. */
export function AiEstimateNote({ assumptions, className }: { assumptions?: string[] | null; className?: string }) {
  const list = (assumptions ?? []).filter((a) => typeof a === 'string' && a.trim());
  return (
    <div
      className={cn('rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs text-indigo-100', className)}
      data-testid="ai-estimate-note"
    >
      <div className="flex items-center gap-1.5 font-semibold">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> AI estimate — review before saving
      </div>
      {list.length > 0 && (
        <>
          <p className="mt-1 text-indigo-200/80">We assumed:</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
            {list.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
