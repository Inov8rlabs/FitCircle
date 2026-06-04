'use client';

import { Loader2, Settings2, Target, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  NUTRITION_METRIC_TYPES,
  TARGET_REQUIRED_METRICS,
  nutritionClient,
  type NutritionChallenge,
  type NutritionMetricType,
} from '@/lib/api/nutrition-client';
import { cn } from '@/lib/utils';

const METRIC_LABEL: Record<NutritionMetricType, string> = {
  calorie_target: 'Calorie target',
  protein_target: 'Protein target',
  carb_target: 'Carb target',
  veg_days: 'Vegetarian days',
  sober_days: 'Alcohol-free days',
  standard: 'Standard nutrition',
};

const METRIC_UNIT: Partial<Record<NutritionMetricType, string>> = {
  calorie_target: 'cal/day',
  protein_target: 'g protein/day',
  carb_target: 'g carbs/day',
};

interface NutritionChallengeCardProps {
  circleId: string;
  /** Creators can configure the metric/target. */
  isCreator?: boolean;
}

/**
 * §6.5 — nutrition-driven challenge. Shows the configured metric + per-member
 * adherence/consistency progress (NEVER ranked by eating least, per §6.7).
 * Creators can set the metric + daily target. Renders server values verbatim.
 */
export function NutritionChallengeCard({
  circleId,
  isCreator = false,
}: NutritionChallengeCardProps) {
  const [data, setData] = useState<NutritionChallenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = () => {
    setLoading(true);
    nutritionClient
      .getNutritionChallenge(circleId)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [circleId]);

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border border-slate-800/60 bg-slate-900/60 backdrop-blur-xl">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 text-center text-sm text-amber-300 backdrop-blur-xl">
        {error}
      </div>
    );
  }

  const config = data?.config ?? null;
  const progress = data?.progress ?? null;
  const rows = progress?.rows ?? [];

  return (
    <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 p-4 backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <Trophy className="h-4 w-4 text-yellow-400" aria-hidden="true" />
          Nutrition challenge
        </h3>
        {isCreator && (
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            aria-label={editing ? 'Close challenge settings' : 'Configure challenge'}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700/60 bg-slate-800/60 px-2.5 py-1 text-xs text-gray-200 hover:bg-slate-700/60"
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
            {config ? 'Edit' : 'Set up'}
          </button>
        )}
      </div>

      {editing && isCreator && (
        <ChallengeConfigForm
          circleId={circleId}
          current={config}
          onSaved={() => {
            setEditing(false);
            load();
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {!config ? (
        !editing && (
          <p className="py-4 text-center text-sm text-gray-400">
            {isCreator
              ? 'No nutrition metric set yet. Tap “Set up” to choose one.'
              : 'No nutrition metric configured for this circle yet.'}
          </p>
        )
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-800/40 px-3 py-2">
            <Target className="h-4 w-4 text-indigo-400" aria-hidden="true" />
            <span className="text-sm text-gray-100">
              {METRIC_LABEL[config.metricType]}
              {config.targetValue != null && (
                <span className="text-gray-300">
                  {' '}
                  · {config.targetValue} {METRIC_UNIT[config.metricType] ?? ''}
                </span>
              )}
            </span>
          </div>

          {rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400">No progress yet.</p>
          ) : (
            <ol className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.member.id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2',
                    r.isCurrentUser
                      ? 'border-indigo-500/40 bg-indigo-500/10'
                      : 'border-slate-700/50 bg-slate-800/40'
                  )}
                >
                  <span className="w-5 shrink-0 text-center text-sm font-bold text-gray-300 tabular-nums">
                    {r.rank}
                  </span>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 text-xs font-semibold text-white">
                    {r.member.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.member.avatarUrl}
                        alt={r.member.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      r.member.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      {r.member.name}
                      {r.isCurrentUser && <span className="text-indigo-300"> · You</span>}
                    </p>
                    <p className="text-xs text-gray-400">
                      {r.successDays}/{r.challengeDays} days hit · {r.daysLogged} logged
                      {r.averageValue != null && ` · avg ${Math.round(r.averageValue)}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-base font-bold text-white tabular-nums">
                      {r.adherencePct}%
                    </p>
                    <p className="text-[11px] text-gray-400">adherence</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

function ChallengeConfigForm({
  circleId,
  current,
  onSaved,
  onCancel,
}: {
  circleId: string;
  current: NutritionChallenge['config'];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [metricType, setMetricType] = useState<NutritionMetricType>(
    current?.metricType ?? 'standard'
  );
  const [targetValue, setTargetValue] = useState<string>(
    current?.targetValue != null ? String(current.targetValue) : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsTarget = TARGET_REQUIRED_METRICS.includes(metricType);

  const save = async () => {
    if (needsTarget && (targetValue === '' || Number(targetValue) <= 0)) {
      setError('This metric needs a positive daily target.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await nutritionClient.setNutritionChallenge(
        circleId,
        metricType,
        needsTarget ? Number(targetValue) : null
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-3 space-y-3 rounded-lg border border-slate-700/50 bg-slate-800/40 p-3">
      <label className="block">
        <span className="mb-1 block text-xs text-gray-300">Metric</span>
        <select
          value={metricType}
          onChange={(e) => setMetricType(e.target.value as NutritionMetricType)}
          className="w-full rounded-md border border-slate-600 bg-slate-900/60 px-2.5 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          {NUTRITION_METRIC_TYPES.map((m) => (
            <option key={m} value={m}>
              {METRIC_LABEL[m]}
            </option>
          ))}
        </select>
      </label>

      {needsTarget && (
        <label className="block">
          <span className="mb-1 block text-xs text-gray-300">
            Daily target ({METRIC_UNIT[metricType] ?? ''})
          </span>
          <input
            type="number"
            inputMode="numeric"
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            className="w-full rounded-md border border-slate-600 bg-slate-900/60 px-2.5 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-gradient-to-r from-indigo-600 to-indigo-700 px-3 py-1.5 text-sm font-semibold text-white hover:from-indigo-700 hover:to-indigo-800 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-700/60 bg-slate-800/60 px-3 py-1.5 text-sm text-gray-200 hover:bg-slate-700/60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
