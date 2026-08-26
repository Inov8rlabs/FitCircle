'use client';

import { Check, Ruler } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { VitalsBmi } from '@/lib/types/vitals';
import { cn } from '@/lib/utils';
import { BMI_BANDS, BMI_SCALE, bmiScalePosition } from '@/lib/utils/bmi';
import type { UnitSystem } from '@/lib/utils/units';

import { BMI_BAND_STYLE, BMI_CATEGORY_LABEL, formatHeight, formatKg } from './format';

interface BmiScaleCardProps {
  bmi: VitalsBmi | null;
  unitSystem: UnitSystem;
  loading?: boolean;
}

/** Tick label at a scale position; edge ticks hug the ends so nothing overflows the bar. */
function Tick({ value, pct }: { value: number; pct: number }) {
  const edge = pct <= 0 ? 'left' : pct >= 100 ? 'right' : 'mid';
  return (
    <span
      className={cn(
        'absolute top-0 text-[10px] sm:text-xs text-gray-500 tabular-nums',
        edge === 'mid' && '-translate-x-1/2',
        edge === 'right' && '-translate-x-full'
      )}
      style={{ left: `${pct}%` }}
    >
      {value}
    </span>
  );
}

/**
 * BMI / Body Mass Index card (VITALS_CLIENT_CONTRACT.md §2). Full width,
 * directly under the hero grid. Renders the server's value/category; the
 * scale geometry comes from `scale.bands` so all platforms agree.
 */
export function BmiScaleCard({ bmi, unitSystem, loading }: BmiScaleCardProps) {
  const bands = bmi?.scale.bands?.length ? bmi.scale.bands : BMI_BANDS;
  const scaleMin = bmi?.scale.min ?? BMI_SCALE.min;
  const scaleMax = bmi?.scale.max ?? BMI_SCALE.max;
  const span = scaleMax - scaleMin || 1;
  const value = bmi?.value ?? null;
  const category = bmi?.category ?? null;
  const missing = bmi?.missing ?? (bmi ? null : 'weight');

  const ticks = [...bands.map((b) => b.from), scaleMax].map((v) => ({
    value: v,
    pct: ((v - scaleMin) / span) * 100,
  }));

  return (
    <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
      <CardHeader className="p-4 sm:p-6 pb-2 sm:pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center flex-shrink-0">
              <Ruler className="w-5 h-5 text-purple-400" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-white text-base sm:text-lg">BMI</CardTitle>
              <p className="text-xs text-gray-400">Body Mass Index</p>
            </div>
          </div>

          {value !== null && category ? (
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-3xl sm:text-4xl font-bold text-white tabular-nums leading-none">
                {value.toFixed(1)}
              </span>
              <span className={cn('rounded-full px-2 py-1 text-xs font-medium', BMI_BAND_STYLE[category].chip)}>
                {BMI_CATEGORY_LABEL[category]}
              </span>
            </div>
          ) : loading && !bmi ? (
            <div className="h-9 w-16 rounded-lg bg-slate-800/60 animate-pulse" aria-hidden />
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-6 pt-2 sm:pt-3 space-y-4">
        {value !== null ? (
          <>
            {/* Scale bar + marker */}
            <div className="pt-1">
              <div className="relative">
                <div className="flex h-3 w-full overflow-hidden rounded-full">
                  {bands.map((band) => (
                    <div
                      key={band.key}
                      className={BMI_BAND_STYLE[band.key].bar}
                      style={{ width: `${((band.to - band.from) / span) * 100}%` }}
                      title={`${band.label}: ${band.from}–${band.to}`}
                    />
                  ))}
                </div>
                <div
                  className="absolute -top-1 -bottom-1 w-[3px] -translate-x-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.8)]"
                  style={{ left: `${bmiScalePosition(value) * 100}%` }}
                  role="img"
                  aria-label={`Your BMI ${value.toFixed(1)}`}
                />
              </div>
              <div className="relative h-4 mt-1.5">
                {ticks.map((t) => (
                  <Tick key={t.value} value={t.value} pct={t.pct} />
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {bands.map((band) => (
                <div key={band.key} className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span className={cn('w-2 h-2 rounded-full', BMI_BAND_STYLE[band.key].dot)} aria-hidden />
                  {band.label}
                </div>
              ))}
            </div>

            {/* Healthy range callout */}
            {bmi?.healthy_range_kg && bmi.height_cm && (
              <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3">
                <Check className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" aria-hidden />
                <p className="text-xs sm:text-sm text-gray-300">
                  <span className="font-semibold text-emerald-400">Healthy weight range</span>
                  <span className="text-gray-500"> — </span>
                  <span className="tabular-nums">
                    {formatKg(bmi.healthy_range_kg.min, unitSystem)} – {formatKg(bmi.healthy_range_kg.max, unitSystem)}
                  </span>{' '}
                  for your height ({formatHeight(bmi.height_cm, unitSystem)})
                </p>
              </div>
            )}
          </>
        ) : missing === 'height' ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg bg-slate-800/40 p-4">
            <p className="text-sm text-gray-300">Add your height to see BMI</p>
            <Button asChild size="sm" className="bg-purple-600 hover:bg-purple-700 text-white">
              <Link href="/profile">Edit Profile</Link>
            </Button>
          </div>
        ) : loading && !bmi ? (
          <div className="h-3 w-full rounded-full bg-slate-800/60 animate-pulse" aria-hidden />
        ) : (
          <div className="rounded-lg bg-slate-800/40 p-4">
            <p className="text-sm text-gray-300">Log a weight to see BMI</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
