'use client';

import { Footprints, PlusCircle, Scale } from 'lucide-react';

import { GlassCard, ToneDisc } from '@/components/ui/ios';
import type { VitalsSummary } from '@/lib/types/vitals';
import { cn } from '@/lib/utils';
import { getWeightUnit, weightKgToDisplay, type UnitSystem } from '@/lib/utils/units';

function Ring({ value, size = 128 }: { value: number; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
      <defs>
        <linearGradient id="steps-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(99,102,241,0.18)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="url(#steps-ring)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        className="transition-[stroke-dashoffset] duration-700 ease-ios"
      />
    </svg>
  );
}

const addButton = (label: string, onClick: () => void, tone: 'indigo' | 'purple') => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    aria-label={label}
    className={cn(
      'flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-white/5',
      tone === 'indigo' ? 'text-brand-indigo' : 'text-brand-purple'
    )}
  >
    <PlusCircle className="h-6 w-6" fill="currentColor" stroke="#0f172a" />
  </button>
);

/**
 * iOS simplifiedProgressSection: Steps ring card and Weight card side by side
 * (stacked on very narrow phones). The + on each opens the quick-log sheet.
 */
export function ProgressCards({
  todaySteps,
  stepsGoal,
  lastStepsDate,
  summary,
  fallbackWeightKg,
  fallbackGoalKg,
  unitSystem,
  onUnitChange,
  unitLoading,
  onLogSteps,
  onLogWeight,
}: {
  todaySteps: number;
  stepsGoal: number;
  lastStepsDate?: string;
  summary: VitalsSummary | null;
  fallbackWeightKg?: number;
  fallbackGoalKg?: number;
  unitSystem: UnitSystem;
  onUnitChange: (u: UnitSystem) => void;
  unitLoading?: boolean;
  onLogSteps: () => void;
  onLogWeight: () => void;
}) {
  const weightKg = summary?.weight?.current_kg ?? fallbackWeightKg;
  const goalKg = summary?.weight?.goal?.target_kg ?? fallbackGoalKg;
  const toGoKg = summary?.weight?.goal?.to_go_kg ?? (weightKg && goalKg ? Math.abs(weightKg - goalKg) : undefined);
  const bmi = summary?.bmi?.value;
  const unit = getWeightUnit(unitSystem);
  const fmt = (kg: number) => weightKgToDisplay(kg, unitSystem).toFixed(1);
  const weightDate = summary?.weight?.current_date;

  return (
    <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:gap-4" data-testid="progress-cards">
      <GlassCard className="flex flex-col items-center text-center" role="button" tabIndex={0} onClick={onLogSteps} onKeyDown={(e) => e.key === 'Enter' && onLogSteps()}>
        <div className="mb-2 flex w-full items-center justify-between">
          <ToneDisc icon={Footprints} tone="indigo" />
          {addButton('Log steps', onLogSteps, 'indigo')}
        </div>
        <div className="relative">
          <Ring value={todaySteps / (stepsGoal || 10000)} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-title2 font-bold tabular-nums text-white" data-testid="today-steps">
              {todaySteps.toLocaleString()}
            </span>
            <span className="text-caption text-fg-secondary">steps</span>
          </div>
        </div>
        <p className="mt-3 text-caption text-fg-tertiary">
          {lastStepsDate ? new Date(`${lastStepsDate}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today'}
        </p>
        <p className="text-headline text-white">Steps</p>
        <p className="text-caption text-fg-secondary">Goal: {(stepsGoal || 10000).toLocaleString()}</p>
      </GlassCard>

      <GlassCard className="flex flex-col" role="button" tabIndex={0} onClick={onLogWeight} onKeyDown={(e) => e.key === 'Enter' && onLogWeight()}>
        <div className="mb-2 flex w-full items-center justify-between gap-2">
          <ToneDisc icon={Scale} tone="purple" />
          {addButton('Log weight', onLogWeight, 'purple')}
        </div>
        <div className="flex flex-1 flex-col items-center justify-center py-3 text-center">
          {weightKg ? (
            <>
              <p className="text-white">
                <span className="text-[36px] font-bold leading-none tabular-nums" data-testid="current-weight">
                  {fmt(weightKg)}
                </span>
                <span className="ml-1 text-callout text-fg-secondary">{unit}</span>
              </p>
              <p className="mt-2 text-caption">
                {bmi ? <span className="font-semibold text-brand-orange">BMI {bmi.toFixed(1)}</span> : null}
                {weightDate && (
                  <span className="ml-1.5 text-fg-tertiary">
                    {new Date(`${weightDate}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </p>
            </>
          ) : (
            <p className="text-subhead text-fg-secondary">No weight yet</p>
          )}
        </div>
        <p className="text-center text-headline text-white">Weight</p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUnitChange(unitSystem === 'metric' ? 'imperial' : 'metric');
          }}
          disabled={unitLoading}
          className="mx-auto mt-0.5 rounded-full px-2 text-caption font-semibold text-brand-purple hover:underline disabled:opacity-50"
          aria-label={`Show weight in ${unitSystem === 'metric' ? 'pounds' : 'kilograms'}`}
        >
          Show in {unitSystem === 'metric' ? 'lbs' : 'kg'}
        </button>
        <p className="text-center text-caption text-fg-secondary">
          {goalKg ? (
            <>
              Goal: {fmt(goalKg)} {unit}
              {toGoKg !== undefined && toGoKg > 0 && (
                <span className="text-brand-orange">
                  {' '}
                  · {fmt(toGoKg)} {unit} to go
                </span>
              )}
            </>
          ) : (
            'Set a goal'
          )}
        </p>
      </GlassCard>
    </div>
  );
}
