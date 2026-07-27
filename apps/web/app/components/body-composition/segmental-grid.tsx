'use client';

import type { SegmentalData } from '@/lib/types/body-composition';
import type { UnitSystem } from '@/lib/utils/units';

import { formatMass } from './format';

const SEGMENT_ROWS: { key: keyof SegmentalData; label: string }[] = [
  { key: 'trunk', label: 'Trunk' },
  { key: 'leftArm', label: 'Left arm' },
  { key: 'rightArm', label: 'Right arm' },
  { key: 'leftLeg', label: 'Left leg' },
  { key: 'rightLeg', label: 'Right leg' },
];

/**
 * Display-only 5-row segmental grid (trunk/arms/legs) for entries that carry
 * vendor segmental data. No advice, no left/right comparisons highlighted
 * (BODY_COMP_BUILD_CONTRACT.md §3).
 */
export function SegmentalGrid({
  segmental,
  unitSystem,
}: {
  segmental: SegmentalData;
  unitSystem: UnitSystem;
}) {
  const rows = SEGMENT_ROWS.flatMap((r) => {
    const seg = segmental[r.key];
    return seg ? [{ ...r, seg }] : [];
  });
  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
      <div className="grid grid-cols-3 gap-2 border-b border-slate-800 px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-gray-500">
        <span>Segment</span>
        <span className="text-right">Lean mass</span>
        <span className="text-right">% of ideal</span>
      </div>
      {rows.map(({ key, label, seg }) => {
        return (
          <div
            key={key}
            className="grid grid-cols-3 gap-2 px-4 py-2 text-sm border-b border-slate-800/50 last:border-b-0"
          >
            <span className="text-gray-300">{label}</span>
            <span className="text-right font-medium text-white">
              {formatMass(seg.leanKg, unitSystem)}
            </span>
            <span className="text-right text-gray-300">
              {seg.pctOfIdeal != null ? `${seg.pctOfIdeal.toFixed(1)}%` : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
