'use client';

import { useEffect, useState } from 'react';

import { nutritionClient, type PlateScore } from '@/lib/api/nutrition-client';
import { cn } from '@/lib/utils';

interface PlateScoreCardProps {
  /** Optional preloaded score; otherwise the card fetches today's score. */
  score?: PlateScore | null;
  date?: string;
}

function ringColor(score: number): string {
  if (score >= 80) return '#34d399'; // emerald
  if (score >= 60) return '#fb923c'; // orange
  if (score >= 40) return '#fbbf24'; // amber
  return '#f87171'; // red
}

/**
 * Glanceable 0–100 Plate Score ring — the default, body-neutral nutrition
 * metric (never raw calories). Renders the server-provided score verbatim.
 */
export function PlateScoreCard({ score: initial, date }: PlateScoreCardProps) {
  const [score, setScore] = useState<PlateScore | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let active = true;
    setLoading(true);
    nutritionClient
      .getPlateScore(date)
      .then((s) => active && setScore(s))
      .catch((e) => active && setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [initial, date]);

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-slate-800/60 bg-slate-900/60 backdrop-blur-xl">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (error || !score) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 text-center text-sm text-gray-400 backdrop-blur-xl">
        {error ?? 'No Plate Score yet — log a meal to see it.'}
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, score.score));
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dash = (pct / 100) * circumference;
  const color = ringColor(pct);

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 p-5 backdrop-blur-xl">
      <div className="flex items-center gap-5">
        <div className="relative h-32 w-32 shrink-0">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(148,163,184,0.15)" strokeWidth="10" />
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              className="transition-[stroke-dasharray] duration-700"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-white tabular-nums">{Math.round(pct)}</span>
            <span className="text-[11px] uppercase tracking-wide text-gray-400">Plate Score</span>
          </div>
        </div>

        <div className="flex-1 space-y-2">
          <Component label="Adherence" value={score.components.adherence} />
          <Component label="Balance" value={score.components.balance} />
          <Component label="Goal fit" value={score.components.goalFit} />
        </div>
      </div>
    </div>
  );
}

function Component({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="font-medium text-gray-200 tabular-nums">{Math.round(pct)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className={cn('h-full rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
