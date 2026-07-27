// Display helpers for the body-composition surfaces. All API values are
// canonical metric (kg / kcal / percent-as-number); conversion happens here,
// at the UI layer only (BODY_COMP_BUILD_CONTRACT.md — units rule).

import type { BodyCompSource, BodyCompTrendState } from '@/lib/types/body-composition';
import { kgToLbs, lbsToKg, type UnitSystem } from '@/lib/utils/units';

export const KG_PER_LB = 0.45359237;

/** 'kg' | 'lb' label for mass metrics (fat mass, SMM, lean, water, bone). */
export function massUnit(unitSystem: UnitSystem): string {
  return unitSystem === 'imperial' ? 'lb' : 'kg';
}

/** Canonical kg → display value (1 decimal). */
export function massKgToDisplay(kg: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? kgToLbs(kg) : Math.round(kg * 10) / 10;
}

/** Display value (in the current unit) → canonical kg. */
export function displayMassToKg(value: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? lbsToKg(value) : value;
}

/** Unrounded kg → display conversion for deltas/chart values (formatted by caller). */
export function massKgToDisplayRaw(kg: number, unitSystem: UnitSystem): number {
  return unitSystem === 'imperial' ? kg / KG_PER_LB : kg;
}

export function formatMass(kg: number | null | undefined, unitSystem: UnitSystem): string {
  if (kg == null) return '—';
  return `${massKgToDisplay(kg, unitSystem).toFixed(1)} ${massUnit(unitSystem)}`;
}

export function formatPct(pct: number | null | undefined): string {
  if (pct == null) return '—';
  return `${pct.toFixed(1)}%`;
}

// --- source badges ----------------------------------------------------------

export const SOURCE_LABELS: Record<BodyCompSource, string> = {
  manual: 'Manual',
  photo_scan: 'Scan',
  healthkit: 'Apple Health',
  health_connect: 'Health Connect',
  dexa: 'DEXA',
  smart_scale: 'Smart scale',
};

export const SOURCE_BADGE_CLASSES: Record<BodyCompSource, string> = {
  manual: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  photo_scan: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  healthkit: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  health_connect: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  dexa: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  smart_scale: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
};

// --- trend state chip -------------------------------------------------------
// Body-neutral labels: describe direction, never celebrate or judge it.

export const TREND_STATE_CHIP: Record<BodyCompTrendState, { label: string; className: string }> = {
  recomposition: {
    label: 'Recomposition',
    className: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  },
  losing: {
    label: 'Trending down',
    className: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  },
  gaining: {
    label: 'Trending up',
    className: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  },
  steady: {
    label: 'Steady',
    className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
  insufficient_data: {
    label: 'Gathering data',
    className: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  },
};

// --- delta metric labels ----------------------------------------------------

export const DELTA_METRIC_LABELS: Record<string, string> = {
  weightKg: 'Weight',
  bodyFatPct: 'Body fat',
  fatMassKg: 'Fat mass',
  skeletalMuscleMassKg: 'Skeletal muscle',
  leanBodyMassKg: 'Lean mass',
};

/** Whether a delta metric is a mass (needs kg↔lb conversion) vs a percentage. */
export function isMassMetric(metric: string): boolean {
  return metric.endsWith('Kg');
}

export function formatDelta(metric: string, delta: number, unitSystem: UnitSystem): string {
  const sign = delta > 0 ? '+' : '';
  if (isMassMetric(metric)) {
    const v = massKgToDisplayRaw(delta, unitSystem);
    return `${sign}${v.toFixed(1)} ${massUnit(unitSystem)}`;
  }
  return `${sign}${delta.toFixed(1)}%`;
}

// --- datetime-local plumbing ------------------------------------------------

/** YYYY-MM-DDTHH:mm in the user's local timezone (datetime-local input format). */
export function toLocalDateTimeInputValue(d: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
