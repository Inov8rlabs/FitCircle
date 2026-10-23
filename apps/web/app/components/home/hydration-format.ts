/**
 * Hydration card formatting, ported from FitCircle-iOS HydrationCard.swift
 * (HydrationFormat / HydrationPreset) so the web shows the same amounts and copy.
 */
import type { UnitSystem } from '@/lib/utils/units';

export const ML_PER_OZ = 29.5735;

export const oz = (ml: number) => Math.round(ml / ML_PER_OZ);
export const mlFromOz = (o: number) => Math.round(o * ML_PER_OZ);

function litres(ml: number): string {
  const l = ml / 1000;
  return Number.isInteger(l) ? String(l) : l.toFixed(2).replace(/0$/, '');
}

/** "750 ml", "1.25 L" or "26 oz". */
export function amount(ml: number, unit: UnitSystem): string {
  if (unit === 'imperial') return `${oz(ml)} oz`;
  return ml < 1000 ? `${Math.round(ml)} ml` : `${litres(ml)} L`;
}

/** Big number + unit for the hero line. */
export function heroParts(ml: number, unit: UnitSystem): { value: string; unit: string } {
  if (unit === 'imperial') return { value: String(oz(ml)), unit: 'oz' };
  return ml < 1000 ? { value: String(Math.round(ml)), unit: 'ml' } : { value: litres(ml), unit: 'L' };
}

export function microcopy(progress: number, todayMl: number): string {
  if (todayMl <= 0) return 'Start with a glass 💧';
  if (progress < 0.5) return 'Nice start';
  if (progress < 0.7) return 'Halfway there';
  if (progress < 0.9) return 'Keep sipping';
  if (progress < 1) return 'Almost there!';
  return "Goal hit! You're hydrated ✨";
}

export interface HydrationPreset {
  id: 'glass' | 'bottle' | 'large';
  ml: number;
  label: string;
}

export function presets(unit: UnitSystem): HydrationPreset[] {
  if (unit === 'imperial') {
    return [
      { id: 'glass', ml: mlFromOz(8), label: 'Glass' },
      { id: 'bottle', ml: mlFromOz(16), label: 'Bottle' },
      { id: 'large', ml: mlFromOz(24), label: 'Large' },
    ];
  }
  return [
    { id: 'glass', ml: 250, label: 'Glass' },
    { id: 'bottle', ml: 500, label: 'Bottle' },
    { id: 'large', ml: 750, label: 'Large' },
  ];
}

/** Single-letter weekday for a YYYY-MM-DD date (local calendar, not UTC). */
export function weekdayInitial(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'narrow' });
}
