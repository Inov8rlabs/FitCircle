'use client';

import { Camera, Check, Loader2, Plus, ScanLine, Sparkles, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { PhotoThumb, fileKey } from '@/components/nutrition/PhotoThumb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  BODY_COMP_LOW_CONFIDENCE_THRESHOLD,
  BODY_COMP_SCAN_MAX_IMAGES,
  BodyCompApiError,
  bodyCompClient,
} from '@/lib/api/body-comp-client';
import type {
  BodyCompCreate,
  BodyCompDraft,
  BodyCompDraftMetrics,
  BodyCompLog,
} from '@/lib/types/body-composition';
import { cn } from '@/lib/utils';
import { compressImagesForUpload } from '@/lib/utils/image-compression';
import type { UnitSystem } from '@/lib/utils/units';

import type { BodyCompPrefill } from './body-comp-entry-modal';
import {
  displayMassToKg,
  massKgToDisplay,
  massUnit,
  toLocalDateTimeInputValue,
} from './format';
import { SegmentalBodyMap } from './segmental-body-map';

// ---------------------------------------------------------------------------
// Scan flow (BODY_COMP_BUILD_CONTRACT §3): pick 1–3 photos of an InBody/DEXA
// sheet → POST /body-comp/photo-parse → draft review card with per-field
// "tap to fix" + date confirm → Save commits via POST /body-comp with source
// 'photo_scan'. Overall confidence < 0.6 → manual form prefilled instead.
// ---------------------------------------------------------------------------

type DraftMetricKey = keyof BodyCompDraftMetrics;

const DRAFT_METRIC_ROWS: { key: DraftMetricKey; label: string; kind: 'mass' | 'pct' | 'level' | 'kcal' }[] = [
  { key: 'weightKg', label: 'Weight', kind: 'mass' },
  { key: 'bodyFatPct', label: 'Body fat', kind: 'pct' },
  { key: 'skeletalMuscleMassKg', label: 'Skeletal muscle', kind: 'mass' },
  { key: 'fatMassKg', label: 'Fat mass', kind: 'mass' },
  { key: 'bodyWaterKg', label: 'Body water', kind: 'mass' },
  { key: 'boneMassKg', label: 'Bone mass', kind: 'mass' },
  { key: 'visceralFatLevel', label: 'Visceral fat', kind: 'level' },
  { key: 'bmrKcal', label: 'BMR', kind: 'kcal' },
];

interface BodyCompScanProps {
  unitSystem: UnitSystem;
  /** Draft parsed below the confidence floor → open the manual form prefilled. */
  onLowConfidence: (prefill: BodyCompPrefill) => void;
  onSaved: (log: BodyCompLog) => void;
}

function draftToPrefill(draft: BodyCompDraft): BodyCompPrefill {
  const m = draft.metrics;
  return {
    measuredAt: draft.measuredAt,
    weightKg: m.weightKg?.value,
    bodyFatPct: m.bodyFatPct?.value,
    skeletalMuscleMassKg: m.skeletalMuscleMassKg?.value,
    fatMassKg: m.fatMassKg?.value,
    bodyWaterKg: m.bodyWaterKg?.value,
    boneMassKg: m.boneMassKg?.value,
    visceralFatLevel: m.visceralFatLevel?.value,
    bmrKcal: m.bmrKcal?.value,
    segmental: draft.segmental,
  };
}

/** Editable review state: values held as display-unit strings, '' = dropped. */
type ReviewValues = Partial<Record<DraftMetricKey, string>>;

function draftToReviewValues(draft: BodyCompDraft, unitSystem: UnitSystem): ReviewValues {
  const out: ReviewValues = {};
  for (const row of DRAFT_METRIC_ROWS) {
    const metric = draft.metrics[row.key];
    if (!metric) continue;
    out[row.key] =
      row.kind === 'mass'
        ? String(massKgToDisplay(metric.value, unitSystem))
        : row.kind === 'kcal'
          ? String(Math.round(metric.value))
          : String(metric.value);
  }
  return out;
}

export function BodyCompScan({ unitSystem, onLowConfidence, onSaved }: BodyCompScanProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<BodyCompDraft | null>(null);
  const [values, setValues] = useState<ReviewValues>({});
  const [measuredAt, setMeasuredAt] = useState('');
  const [editingKey, setEditingKey] = useState<DraftMetricKey | null>(null);

  const unit = massUnit(unitSystem);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-picking the same file
    if (files.length === 0) return;
    setError(null);
    setPending((prev) => [...prev, ...files].slice(0, BODY_COMP_SCAN_MAX_IMAGES));
  };

  const analyze = async (files: File[]) => {
    if (files.length === 0) return;
    setParsing(true);
    setError(null);
    try {
      const compressed = await compressImagesForUpload(files);
      const parsed = await bodyCompClient.photoParse(compressed);
      setPending([]);
      if (parsed.overallConfidence < BODY_COMP_LOW_CONFIDENCE_THRESHOLD) {
        // Same rule as nutrition: shaky read → manual form prefilled with whatever parsed.
        onLowConfidence(draftToPrefill(parsed));
        return;
      }
      setDraft(parsed);
      setValues(draftToReviewValues(parsed, unitSystem));
      const when = parsed.measuredAt ? new Date(parsed.measuredAt) : new Date();
      setMeasuredAt(toLocalDateTimeInputValue(Number.isNaN(when.getTime()) ? new Date() : when));
      setEditingKey(null);
    } catch (err) {
      if (err instanceof BodyCompApiError && err.code === 'RATE_LIMITED') {
        setError('Daily scan limit reached — try again tomorrow, or log the numbers manually.');
      } else if (err instanceof BodyCompApiError && err.code === 'PARSE_FAILED') {
        setError('Could not read that sheet. Try a clearer photo, or log the numbers manually.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not read that sheet. Try again.');
      }
    } finally {
      setParsing(false);
    }
  };

  const resetReview = () => {
    setDraft(null);
    setValues({});
    setEditingKey(null);
  };

  const parsedRows = useMemo(
    () =>
      draft
        ? DRAFT_METRIC_ROWS.flatMap((row) => {
            const metric = draft.metrics[row.key];
            return metric ? [{ ...row, metric }] : [];
          })
        : [],
    [draft]
  );

  const save = async () => {
    if (!draft) return;
    const when = new Date(measuredAt);
    if (Number.isNaN(when.getTime())) {
      setError('Confirm the measurement date first.');
      return;
    }
    const metricValue = (key: DraftMetricKey): number | undefined => {
      const raw = values[key]?.trim();
      if (!raw) return undefined;
      const num = Number(raw);
      if (Number.isNaN(num)) return undefined;
      const kind = DRAFT_METRIC_ROWS.find((r) => r.key === key)?.kind;
      if (kind === 'mass') return displayMassToKg(num, unitSystem);
      if (kind === 'kcal') return Math.round(num);
      return num;
    };
    const input: BodyCompCreate = {
      measuredAt: when.toISOString(),
      source: 'photo_scan',
      weightKg: metricValue('weightKg'),
      bodyFatPct: metricValue('bodyFatPct'),
      skeletalMuscleMassKg: metricValue('skeletalMuscleMassKg'),
      fatMassKg: metricValue('fatMassKg'),
      bodyWaterKg: metricValue('bodyWaterKg'),
      boneMassKg: metricValue('boneMassKg'),
      visceralFatLevel: metricValue('visceralFatLevel'),
      bmrKcal: metricValue('bmrKcal'),
      ...(draft.segmental ? { segmental: draft.segmental } : {}),
    };
    if (
      input.weightKg == null &&
      input.bodyFatPct == null &&
      input.skeletalMuscleMassKg == null &&
      input.fatMassKg == null
    ) {
      setError('Keep at least one of weight, body fat %, skeletal muscle, or fat mass.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await bodyCompClient.create(input);
      resetReview();
      toast.success('Scan saved');
      onSaved(saved);
    } catch (err) {
      const message =
        err instanceof BodyCompApiError ? err.message : 'Could not save the scan. Please try again.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  // --- draft review card ----------------------------------------------------
  if (draft) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 backdrop-blur-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles className="h-4 w-4 text-indigo-400" aria-hidden="true" />
            Review your scan
          </h3>
          <span className="text-[11px] text-gray-400">
            {Math.round(draft.overallConfidence * 100)}% confident
          </span>
        </div>

        {draft.warnings.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5">
            {draft.warnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-300">
                {w}
              </li>
            ))}
          </ul>
        )}

        {/* Date confirm */}
        <div className="space-y-1.5">
          <Label htmlFor="scan-measured-at" className="text-gray-300">
            Measured on
          </Label>
          <Input
            id="scan-measured-at"
            type="datetime-local"
            value={measuredAt}
            max={toLocalDateTimeInputValue(new Date())}
            onChange={(e) => setMeasuredAt(e.target.value)}
          />
          {!draft.measuredAt && (
            <p className="text-xs text-gray-500">We couldn&apos;t read a date from the sheet — please confirm it.</p>
          )}
        </div>

        {/* Per-field tap-to-fix rows */}
        <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 overflow-hidden">
          {parsedRows.map((row) => {
            const metric = row.metric;
            const raw = values[row.key] ?? '';
            const removed = raw.trim() === '';
            const lowConfidence = metric.confidence < BODY_COMP_LOW_CONFIDENCE_THRESHOLD;
            const unitLabel =
              row.kind === 'mass' ? unit : row.kind === 'pct' ? '%' : row.kind === 'kcal' ? 'kcal' : '';
            return (
              <div key={row.key} className="flex items-center gap-2 bg-slate-900/40 px-3 py-2">
                <span
                  className={cn(
                    'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                    lowConfidence ? 'bg-amber-400' : 'bg-emerald-400'
                  )}
                  title={lowConfidence ? 'Low confidence — double-check this value' : 'High confidence'}
                />
                <span className={cn('flex-1 text-sm', removed ? 'text-gray-600 line-through' : 'text-gray-300')}>
                  {row.label}
                </span>
                {editingKey === row.key ? (
                  <Input
                    autoFocus
                    type="number"
                    inputMode="decimal"
                    step={row.kind === 'kcal' ? '1' : '0.1'}
                    value={raw}
                    onChange={(e) => setValues((prev) => ({ ...prev, [row.key]: e.target.value }))}
                    onBlur={() => setEditingKey(null)}
                    onKeyDown={(e) => e.key === 'Enter' && setEditingKey(null)}
                    className="h-8 w-24 text-right"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingKey(row.key)}
                    className={cn(
                      'rounded-md px-2 py-1 text-sm font-medium transition-colors hover:bg-slate-800',
                      removed ? 'text-gray-600' : 'text-white'
                    )}
                    title="Tap to fix"
                  >
                    {removed ? 'Removed' : `${raw} ${unitLabel}`.trim()}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setValues((prev) => ({
                      ...prev,
                      [row.key]: removed
                        ? draftToReviewValues(draft, unitSystem)[row.key] ?? ''
                        : '',
                    }))
                  }
                  className="rounded p-1 text-gray-500 hover:text-gray-300"
                  aria-label={removed ? `Restore ${row.label}` : `Remove ${row.label}`}
                >
                  {removed ? <Plus className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                </button>
              </div>
            );
          })}
        </div>

        {draft.segmental && (
          <div className="space-y-1.5">
            <p className="text-xs text-gray-400">
              Segmental data detected — saved with this entry as-is.
            </p>
            <SegmentalBodyMap segmental={draft.segmental} unitSystem={unitSystem} idPrefix="scan-seg" />
          </div>
        )}

        {error && <p className="text-sm text-amber-300">{error}</p>}

        <div className="flex gap-2">
          <Button onClick={() => void save()} disabled={saving} className="flex-1 h-10">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Save entry
          </Button>
          <Button variant="outline" onClick={resetReview} disabled={saving} className="h-10">
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // --- capture / preview ----------------------------------------------------
  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic"
        multiple
        className="hidden"
        onChange={onPick}
      />

      {pending.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={parsing}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/60 px-4 py-3 text-sm font-medium text-gray-200 hover:bg-slate-700/60 disabled:opacity-50"
        >
          {parsing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ScanLine className="h-4 w-4" aria-hidden="true" />
          )}
          {parsing ? 'Reading your scan…' : 'Scan an InBody / DEXA sheet'}
        </button>
      ) : (
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="flex items-center gap-1.5 text-sm font-semibold text-white">
              <Camera className="h-4 w-4 text-gray-400" aria-hidden="true" />
              Review photos
            </h4>
            <span className="text-[11px] text-gray-400">
              {pending.length}/{BODY_COMP_SCAN_MAX_IMAGES} photos
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {pending.map((file, idx) => (
              <PhotoThumb
                key={fileKey(file)}
                file={file}
                onRemove={parsing ? undefined : () => setPending((prev) => prev.filter((_, i) => i !== idx))}
              />
            ))}
            {pending.length < BODY_COMP_SCAN_MAX_IMAGES && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={parsing}
                className="flex aspect-square items-center justify-center rounded-md border border-dashed border-slate-600 text-gray-400 hover:border-indigo-500/60 hover:text-indigo-300 disabled:opacity-50"
                aria-label="Add another photo"
              >
                <Plus className="h-5 w-5" />
              </button>
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void analyze(pending)}
              disabled={parsing || pending.length === 0}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-2 text-sm font-semibold text-white hover:from-indigo-700 hover:to-purple-700 disabled:opacity-50"
            >
              {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {parsing ? 'Analyzing…' : 'Analyze'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPending([]);
                setError(null);
              }}
              disabled={parsing}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700/60 bg-slate-800/60 px-4 py-2 text-sm text-gray-300 hover:bg-slate-700/60 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-amber-300">{error}</p>}
    </div>
  );
}
