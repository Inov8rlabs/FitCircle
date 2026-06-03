'use client';

import { Lightbulb } from 'lucide-react';
import { useEffect, useState } from 'react';

import { nutritionClient, type Insight } from '@/lib/api/nutrition-client';
import { cn } from '@/lib/utils';

interface InsightsListProps {
  lookbackDays?: number;
}

/**
 * Cross-signal insight cards with gentle, non-prescriptive framing. Renders the
 * server-provided headline/detail verbatim; never recomputes correlations.
 */
export function InsightsList({ lookbackDays }: InsightsListProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    nutritionClient
      .getInsights(lookbackDays)
      .then((data) => active && setInsights(data))
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Failed to load insights'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [lookbackDays]);

  if (loading) {
    return (
      <div className="flex h-24 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return <p className="py-6 text-center text-sm text-amber-300">{error}</p>;
  }

  if (insights.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-gray-400">
        Keep logging — patterns will show up here as we learn more.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {insights.map((insight) => (
        <div
          key={insight.id}
          className="rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 backdrop-blur-xl"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20">
              <Lightbulb className="h-4 w-4 text-amber-300" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h4 className="text-sm font-semibold text-white">{insight.headline}</h4>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[11px] capitalize',
                    insight.confidence === 'medium'
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                      : 'border-slate-600/50 bg-slate-700/40 text-gray-300'
                  )}
                >
                  {insight.confidence} confidence
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-gray-300">{insight.detail}</p>
              <p className="mt-2 text-[11px] text-gray-500">
                {insight.signalA} · {insight.signalB} · over {insight.sampleDays} days
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
