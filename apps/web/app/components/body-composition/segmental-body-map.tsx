'use client';

import type { SegmentalData } from '@/lib/types/body-composition';
import { cn } from '@/lib/utils';
import type { UnitSystem } from '@/lib/utils/units';

import { massUnit } from './format';

// ---------------------------------------------------------------------------
// Body map for segmental lean mass — the five values an InBody/DEXA sheet
// prints (trunk, both arms, both legs). Values sit ON the figure, where they
// appear on the printout, so transcribing a sheet is a matter of matching
// shapes rather than reading a list of labels.
//
// Contract §3: segmental data is DISPLAY-ONLY. This renders what the user (or
// their sheet) reported. It never derives, never compares left to right, and
// never coaches.
// ---------------------------------------------------------------------------

export const SEGMENT_KEYS = ['trunk', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;
export type SegmentKey = (typeof SEGMENT_KEYS)[number];

export const SEGMENT_LABELS: Record<SegmentKey, string> = {
  trunk: 'Trunk',
  leftArm: 'Left arm',
  rightArm: 'Right arm',
  leftLeg: 'Left leg',
  rightLeg: 'Right leg',
};

/** Chip anchors as percentages of the map container. */
const CHIP_ANCHORS: Record<SegmentKey, { left: number; top: number }> = {
  trunk: { left: 50, top: 30 },
  leftArm: { left: 16, top: 44 },
  rightArm: { left: 84, top: 44 },
  leftLeg: { left: 28, top: 70 },
  rightLeg: { left: 72, top: 70 },
};

/**
 * The silhouette, in a 100 × 179 viewBox (the iOS figure's 0.56 aspect).
 *
 * Drawn as separate opaque parts rather than one combined path: the limbs
 * overlap the trunk, and a single path would need every subpath to wind the
 * same way or the overlaps punch holes under the non-zero fill rule. The
 * gradient is `userSpaceOnUse` so all parts share ONE gradient across the
 * whole figure — the default (objectBoundingBox) would restart it per part
 * and show every seam.
 */
function BodySilhouette({ gradientId }: { gradientId: string }) {
  return (
    <svg
      viewBox="0 0 100 179"
      className="h-full w-auto"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="50" y1="0" x2="50" y2="179">
          <stop offset="0" stopColor="#5b46a6" />
          <stop offset="1" stopColor="#2e3468" />
        </linearGradient>
      </defs>

      <g fill={`url(#${gradientId})`}>
        {/* Head */}
        <ellipse cx="50" cy="15.75" rx="10" ry="11.46" />
        {/* Neck */}
        <rect x="45.5" y="25.06" width="9" height="11.1" rx="2" />
        {/* Torso: shoulders → waist → hips, symmetric about x = 50 */}
        <path
          d="M34 40.28
             Q35.6 58.18 38.8 71.6
             Q37.6 89.5 36 102.93
             Q50 110.1 64 102.93
             Q62.4 89.5 61.2 71.6
             Q64.4 58.18 66 40.28
             Q59.8 32.58 50 31.15
             Q40.2 32.58 34 40.28
             Z"
        />
        {/* Feet */}
        <ellipse cx="41.7" cy="170.25" rx="6.3" ry="4.65" />
        <ellipse cx="58.3" cy="170.25" rx="6.3" ry="4.65" />
      </g>

      {/* Arms and legs are round-capped strokes — a stroked line IS a capsule. */}
      <g stroke={`url(#${gradientId})`} strokeLinecap="round" fill="none">
        <line x1="36.6" y1="43.5" x2="27.6" y2="101.1" strokeWidth="7.6" />
        <line x1="63.4" y1="43.5" x2="72.4" y2="101.1" strokeWidth="7.6" />
        <line x1="44" y1="89.5" x2="41.8" y2="167.4" strokeWidth="13.2" />
        <line x1="56" y1="89.5" x2="58.2" y2="167.4" strokeWidth="13.2" />
      </g>
    </svg>
  );
}

function ColumnHeaders() {
  return (
    <div className="mb-1 flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">
      <span>Left</span>
      <span>Right</span>
    </div>
  );
}

const CHIP_SHELL =
  'absolute w-[30%] max-w-[7rem] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-slate-950/90 px-2 py-1.5 shadow-lg shadow-black/40 backdrop-blur-sm';

// --- editable ---------------------------------------------------------------

export interface SegmentInputValue {
  lean: string;
  pct: string;
}

export type SegmentInputs = Record<SegmentKey, SegmentInputValue>;

export const EMPTY_SEGMENT_INPUTS: SegmentInputs = {
  trunk: { lean: '', pct: '' },
  leftArm: { lean: '', pct: '' },
  rightArm: { lean: '', pct: '' },
  leftLeg: { lean: '', pct: '' },
  rightLeg: { lean: '', pct: '' },
};

export function SegmentalBodyMapEditor({
  values,
  onChange,
  unitSystem,
  errors,
  idPrefix = 'seg',
}: {
  values: SegmentInputs;
  onChange: (key: SegmentKey, field: keyof SegmentInputValue, value: string) => void;
  unitSystem: UnitSystem;
  /** Per-segment error message, keyed by segment. */
  errors?: Partial<Record<SegmentKey, string>>;
  idPrefix?: string;
}) {
  const gradientId = `${idPrefix}-body-gradient`;

  return (
    <div>
      <ColumnHeaders />
      <div className="relative h-[22rem] w-full">
        <div className="absolute inset-0 flex items-center justify-center">
          <BodySilhouette gradientId={gradientId} />
        </div>

        {SEGMENT_KEYS.map((key) => {
          const anchor = CHIP_ANCHORS[key];
          const value = values[key];
          const hasError = Boolean(errors?.[key]);
          return (
            <div
              key={key}
              className={cn(
                CHIP_SHELL,
                hasError
                  ? 'border-red-500/70'
                  : value.lean.trim()
                    ? 'border-indigo-500/50'
                    : 'border-slate-700'
              )}
              style={{ left: `${anchor.left}%`, top: `${anchor.top}%` }}
            >
              <label className="sr-only" htmlFor={`${idPrefix}-${key}-lean`}>
                {SEGMENT_LABELS[key]} lean mass
              </label>
              <div className="flex items-baseline gap-1">
                <input
                  id={`${idPrefix}-${key}-lean`}
                  type="text"
                  inputMode="decimal"
                  placeholder="––"
                  value={value.lean}
                  onChange={(e) => onChange(key, 'lean', e.target.value)}
                  className="w-full min-w-0 bg-transparent text-right text-sm font-bold text-white outline-none placeholder:text-gray-600"
                />
                <span className="text-[9px] font-semibold text-gray-500">{massUnit(unitSystem)}</span>
              </div>

              <label className="sr-only" htmlFor={`${idPrefix}-${key}-pct`}>
                {SEGMENT_LABELS[key]} percent of ideal
              </label>
              <div className="flex items-baseline gap-1">
                <input
                  id={`${idPrefix}-${key}-pct`}
                  type="text"
                  inputMode="decimal"
                  placeholder="––"
                  value={value.pct}
                  onChange={(e) => onChange(key, 'pct', e.target.value)}
                  className="w-full min-w-0 bg-transparent text-right text-[11px] font-semibold text-gray-300 outline-none placeholder:text-gray-600"
                />
                <span className="text-[9px] font-semibold text-gray-500">%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- read-only --------------------------------------------------------------

export function SegmentalBodyMap({
  segmental,
  unitSystem,
  idPrefix = 'seg-ro',
}: {
  segmental: SegmentalData;
  unitSystem: UnitSystem;
  idPrefix?: string;
}) {
  const gradientId = `${idPrefix}-body-gradient`;

  return (
    <div>
      <ColumnHeaders />
      <div className="relative h-[22rem] w-full">
        <div className="absolute inset-0 flex items-center justify-center">
          <BodySilhouette gradientId={gradientId} />
        </div>

        {SEGMENT_KEYS.map((key) => {
          const anchor = CHIP_ANCHORS[key];
          const seg = segmental[key];
          const lean =
            seg == null
              ? '––'
              : (unitSystem === 'imperial' ? seg.leanKg * 2.20462 : seg.leanKg).toFixed(1);
          return (
            <div
              key={key}
              className={cn(CHIP_SHELL, seg ? 'border-indigo-500/50' : 'border-slate-700')}
              style={{ left: `${anchor.left}%`, top: `${anchor.top}%` }}
            >
              <div className="flex items-baseline justify-end gap-1">
                <span className={cn('text-sm font-bold', seg ? 'text-white' : 'text-gray-600')}>
                  {lean}
                </span>
                <span className="text-[9px] font-semibold text-gray-500">{massUnit(unitSystem)}</span>
              </div>
              <div className="text-right text-[11px] font-semibold text-gray-300">
                {seg?.pctOfIdeal != null ? `${seg.pctOfIdeal.toFixed(1)} %` : SEGMENT_LABELS[key]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
