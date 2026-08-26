'use client';

import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { BathroomScale } from '@/components/icons/BathroomScale';
import type { VitalsSummary } from '@/lib/types/vitals';
import { cn } from '@/lib/utils';
import { getWeightUnit, type UnitSystem } from '@/lib/utils/units';

import { formatKg, kgToDisplay, parseDay } from './format';

interface WeightVitalsCardProps {
  summary: VitalsSummary | null;
  unitSystem: UnitSystem;
  /** Today's known weight (kg) from the dashboard — shown until the summary loads. */
  fallbackWeightKg?: number;
  /** ISO date of that reading. */
  fallbackWeightDate?: string;
  /** Goal from profiles.goals — shown until the summary loads. */
  fallbackGoalKg?: number;
  onEditGoal: () => void;
}

type ChipTone = 'toward' | 'away' | 'neutral';

const CHIP_TONE: Record<ChipTone, string> = {
  toward: 'bg-emerald-500/15 text-emerald-400',
  away: 'bg-orange-500/15 text-orange-400',
  neutral: 'bg-slate-700/40 text-gray-400',
};

/** Whether `change_kg` moves the user toward their goal (spec: for `lose`, negative = toward). */
function chipTone(changeKg: number, direction: 'lose' | 'gain' | 'maintain' | undefined): ChipTone {
  if (!direction || direction === 'maintain' || changeKg === 0) return 'neutral';
  const toward = direction === 'lose' ? changeKg < 0 : changeKg > 0;
  return toward ? 'toward' : 'away';
}

function formatLogged(date: string | undefined): string | null {
  if (!date) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseDay(date) : new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return `Logged: ${parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

/**
 * Inner content of the hero WEIGHT card (VITALS_CLIENT_CONTRACT.md §1).
 * Sits in the 2-col hero grid beside the steps ring; the parent owns the Card
 * chrome so both cells stay the same height.
 */
export function WeightVitalsCard({
  summary,
  unitSystem,
  fallbackWeightKg,
  fallbackWeightDate,
  fallbackGoalKg,
  onEditGoal,
}: WeightVitalsCardProps) {
  const weight = summary?.weight ?? null;
  const bmiValue = summary?.bmi.value ?? null;
  const unit = getWeightUnit(unitSystem);

  const currentKg = weight?.current_kg ?? fallbackWeightKg ?? null;
  const currentDate = weight?.current_date ?? fallbackWeightDate;
  const goal = weight?.goal ?? null;
  const goalKg = goal?.target_kg ?? (summary ? null : fallbackGoalKg ?? null);
  const changeKg = weight?.change_kg ?? null;

  const changeDisplay = changeKg === null ? null : Math.abs(kgToDisplay(changeKg, unitSystem));
  const tone = changeKg === null ? 'neutral' : chipTone(changeKg, goal?.direction);
  const ChangeIcon = changeKg === null || changeKg === 0 ? Minus : changeKg < 0 ? ArrowDown : ArrowUp;

  return (
    <div className="p-4 sm:p-6 flex flex-col items-center space-y-3 sm:space-y-4 h-full">
      {/* Header: icon + label */}
      <div className="w-full flex items-center gap-2 sm:gap-3">
        <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
          <BathroomScale className="w-5 h-5 text-purple-400" />
        </div>
        <p className="text-xs sm:text-sm font-medium text-gray-400 truncate">
          Weight <span className="text-gray-600">·</span> 7 days
        </p>
      </div>

      {/* Value block — same height as the steps ring so the cells align */}
      <div className="h-28 sm:h-32 flex flex-col items-center justify-center space-y-2 w-full">
        <p className="text-3xl sm:text-4xl font-bold text-white tabular-nums leading-none text-center">
          {currentKg !== null ? (
            <>
              {kgToDisplay(currentKg, unitSystem).toFixed(1)}
              <span className="text-base sm:text-lg font-semibold text-gray-400 ml-1">{unit}</span>
            </>
          ) : (
            <span className="text-2xl sm:text-3xl text-gray-500">No data</span>
          )}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 min-h-[1.25rem]">
          {bmiValue !== null && (
            <span className="text-xs text-gray-400 tabular-nums">BMI {bmiValue.toFixed(1)}</span>
          )}
          {changeDisplay !== null && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-xs font-medium tabular-nums',
                CHIP_TONE[tone]
              )}
              title={`Change over the last ${summary?.period.days ?? 7} days`}
            >
              <ChangeIcon className="w-3 h-3" aria-hidden />
              {changeDisplay.toFixed(1)} {unit}
            </span>
          )}
          {bmiValue === null && changeDisplay === null && (
            <span className="text-xs text-gray-400">{formatLogged(currentDate) ?? 'Log a weight to start'}</span>
          )}
        </div>
      </div>

      {/* Goal line */}
      <div className="text-center w-full">
        <p className="text-sm sm:text-base font-semibold text-white">Weight</p>
        {goal?.reached ? (
          <p className="text-xs text-emerald-400 font-medium">Goal reached 🎉</p>
        ) : goalKg !== null ? (
          <p className="text-xs text-gray-400 tabular-nums">
            <button
              type="button"
              onClick={onEditGoal}
              className="hover:text-white transition-colors underline-offset-2 hover:underline"
              aria-label="Edit weight goal"
            >
              Goal: {formatKg(goalKg, unitSystem)}
            </button>
            {goal && goal.to_go_kg > 0 && (
              <>
                <span className="text-gray-600"> · </span>
                <span className="text-orange-400">{formatKg(goal.to_go_kg, unitSystem)} to go</span>
              </>
            )}
          </p>
        ) : (
          <button
            type="button"
            onClick={onEditGoal}
            className="text-xs text-purple-400 hover:text-purple-300 underline-offset-2 hover:underline transition-colors"
          >
            Set a goal
          </button>
        )}
      </div>
    </div>
  );
}
