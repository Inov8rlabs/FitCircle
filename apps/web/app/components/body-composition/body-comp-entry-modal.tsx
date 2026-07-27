'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { UnitToggle } from '@/components/ui/unit-toggle';
import { useUnitPreference } from '@/hooks/useUnitPreference';
import { bodyCompClient, BodyCompApiError } from '@/lib/api/body-comp-client';
import type {
  BodyCompCreate,
  BodyCompLog,
  BodyCompUpdate,
  SegmentalData,
} from '@/lib/types/body-composition';
import { cn } from '@/lib/utils';
import { kgToLbs, type UnitSystem } from '@/lib/utils/units';

import {
  displayMassToKg,
  massKgToDisplay,
  massUnit,
  toLocalDateTimeInputValue,
} from './format';
import { SegmentalGrid } from './segmental-grid';

// ---------------------------------------------------------------------------
// Manual entry modal — the heart of the journal (BODY_COMP_BUILD_CONTRACT §3).
// Date defaults to now, weight prefills from the latest known weight, every
// metric is optional but ≥1 core metric is required, inputs are unit-aware
// (kg/lb per user preference), validation is inline, and weight+BF% shows a
// display-only computed fat-mass hint (the server does the real derivation).
// Save is ≤2 taps from the journal: open → Save.
// ---------------------------------------------------------------------------

/** Canonical-kg values used to prefill the form (edit mode or low-confidence scan fallback). */
export interface BodyCompPrefill {
  measuredAt?: string | null;
  weightKg?: number;
  bodyFatPct?: number;
  skeletalMuscleMassKg?: number;
  fatMassKg?: number;
  leanBodyMassKg?: number;
  bodyWaterKg?: number;
  boneMassKg?: number;
  visceralFatLevel?: number;
  bmrKcal?: number;
  /** Rides along on create when the prefill came from a scan draft. */
  segmental?: SegmentalData | null;
}

interface BodyCompEntryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present → edit mode (PUT); absent → create mode (POST). */
  log?: BodyCompLog | null;
  /** Low-confidence scan fallback: manual form prefilled with whatever parsed. */
  prefill?: BodyCompPrefill | null;
  /** Latest known weight (kg) — prefills the weight field on fresh entries. */
  latestWeightKg?: number | null;
  /** body_comp_segmental gate — hides the display-only segmental grid when flipped. */
  segmentalAllowed?: boolean;
  onSaved: (log: BodyCompLog) => void;
}

// --- form schema (string fields; numeric + range checks in superRefine) -----

const MASS_FIELDS = [
  'weight',
  'bodyFatPct',
  'skeletalMuscleMass',
  'fatMass',
  'leanBodyMass',
  'bodyWater',
  'boneMass',
  'visceralFatLevel',
  'bmrKcal',
] as const;

type MetricField = (typeof MASS_FIELDS)[number];

/** Fields entered as masses (converted kg↔lb); the rest are unit-agnostic. */
const CONVERTED_FIELDS: MetricField[] = [
  'weight',
  'skeletalMuscleMass',
  'fatMass',
  'leanBodyMass',
  'bodyWater',
  'boneMass',
];

interface FormValues {
  measuredAt: string;
  weight: string;
  bodyFatPct: string;
  skeletalMuscleMass: string;
  fatMass: string;
  leanBodyMass: string;
  bodyWater: string;
  boneMass: string;
  visceralFatLevel: string;
  bmrKcal: string;
  notes: string;
}

interface FieldRange {
  min: number;
  max: number;
  integer?: boolean;
}

/** Validation ranges in DISPLAY units (mirrors the API's canonical-kg bounds). */
function fieldRanges(unitSystem: UnitSystem): Record<MetricField, FieldRange> {
  const imperial = unitSystem === 'imperial';
  const mass = (minKg: number, maxKg: number): FieldRange => ({
    min: imperial ? kgToLbs(minKg) : minKg,
    max: imperial ? kgToLbs(maxKg) : maxKg,
  });
  return {
    weight: mass(20, 400),
    skeletalMuscleMass: mass(0.1, 400),
    fatMass: mass(0.1, 400),
    leanBodyMass: mass(0.1, 400),
    bodyWater: mass(0.1, 400),
    boneMass: mass(0.1, 99),
    bodyFatPct: { min: 2, max: 65 },
    visceralFatLevel: { min: 0.1, max: 100 },
    bmrKcal: { min: 500, max: 10000, integer: true },
  };
}

function fieldUnitLabel(field: MetricField, unitSystem: UnitSystem): string {
  if (field === 'bodyFatPct') return '%';
  if (field === 'visceralFatLevel') return 'level';
  if (field === 'bmrKcal') return 'kcal';
  return massUnit(unitSystem);
}

function buildSchema(unitSystem: UnitSystem) {
  const ranges = fieldRanges(unitSystem);
  return z
    .object({
      measuredAt: z.string().min(1, 'Pick a date and time'),
      weight: z.string(),
      bodyFatPct: z.string(),
      skeletalMuscleMass: z.string(),
      fatMass: z.string(),
      leanBodyMass: z.string(),
      bodyWater: z.string(),
      boneMass: z.string(),
      visceralFatLevel: z.string(),
      bmrKcal: z.string(),
      notes: z.string().max(2000, 'Notes must be under 2000 characters'),
    })
    .superRefine((v, ctx) => {
      const when = new Date(v.measuredAt);
      if (Number.isNaN(when.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['measuredAt'], message: 'Pick a valid date and time' });
      } else if (when.getTime() > Date.now() + 60_000) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['measuredAt'], message: 'Cannot be in the future' });
      }

      for (const field of MASS_FIELDS) {
        const raw = v[field].trim();
        if (raw === '') continue;
        const num = Number(raw);
        const range = ranges[field];
        if (Number.isNaN(num)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'Enter a valid number' });
        } else if (range.integer && !Number.isInteger(num)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'Enter a whole number' });
        } else if (num < range.min || num > range.max) {
          const unit = fieldUnitLabel(field, unitSystem);
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `Must be between ${range.min} and ${range.max} ${unit}`,
          });
        }
      }

      const hasCore = (['weight', 'bodyFatPct', 'skeletalMuscleMass', 'fatMass'] as const).some(
        (f) => v[f].trim() !== ''
      );
      if (!hasCore) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['weight'],
          message: 'Enter at least one of weight, body fat %, skeletal muscle, or fat mass',
        });
      }
    });
}

// --- prefill plumbing -------------------------------------------------------

function metricToInput(
  value: number | null | undefined,
  field: MetricField,
  unitSystem: UnitSystem
): string {
  if (value == null) return '';
  if (CONVERTED_FIELDS.includes(field)) return String(massKgToDisplay(value, unitSystem));
  return String(value);
}

function inputToMetric(raw: string, field: MetricField, unitSystem: UnitSystem): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const num = Number(trimmed);
  if (Number.isNaN(num)) return undefined;
  if (CONVERTED_FIELDS.includes(field)) return displayMassToKg(num, unitSystem);
  return num;
}

function defaultValues(
  unitSystem: UnitSystem,
  log?: BodyCompLog | null,
  prefill?: BodyCompPrefill | null,
  latestWeightKg?: number | null
): FormValues {
  if (log) {
    // Edit: leave server-derived fields blank (the server re-derives on save);
    // the hint below the form explains the ≈ values.
    return {
      measuredAt: toLocalDateTimeInputValue(new Date(log.measuredAt)),
      weight: metricToInput(log.weightKg, 'weight', unitSystem),
      bodyFatPct: metricToInput(log.bodyFatPct, 'bodyFatPct', unitSystem),
      skeletalMuscleMass: metricToInput(log.skeletalMuscleMassKg, 'skeletalMuscleMass', unitSystem),
      fatMass: log.derived.fatMassKg ? '' : metricToInput(log.fatMassKg, 'fatMass', unitSystem),
      leanBodyMass: log.derived.leanBodyMassKg
        ? ''
        : metricToInput(log.leanBodyMassKg, 'leanBodyMass', unitSystem),
      bodyWater: metricToInput(log.bodyWaterKg, 'bodyWater', unitSystem),
      boneMass: metricToInput(log.boneMassKg, 'boneMass', unitSystem),
      visceralFatLevel: metricToInput(log.visceralFatLevel, 'visceralFatLevel', unitSystem),
      bmrKcal: metricToInput(log.bmrKcal, 'bmrKcal', unitSystem),
      notes: log.notes ?? '',
    };
  }
  const measuredAt = prefill?.measuredAt ? new Date(prefill.measuredAt) : new Date();
  return {
    measuredAt: toLocalDateTimeInputValue(Number.isNaN(measuredAt.getTime()) ? new Date() : measuredAt),
    weight: metricToInput(prefill?.weightKg ?? latestWeightKg, 'weight', unitSystem),
    bodyFatPct: metricToInput(prefill?.bodyFatPct, 'bodyFatPct', unitSystem),
    skeletalMuscleMass: metricToInput(prefill?.skeletalMuscleMassKg, 'skeletalMuscleMass', unitSystem),
    fatMass: metricToInput(prefill?.fatMassKg, 'fatMass', unitSystem),
    leanBodyMass: metricToInput(prefill?.leanBodyMassKg, 'leanBodyMass', unitSystem),
    bodyWater: metricToInput(prefill?.bodyWaterKg, 'bodyWater', unitSystem),
    boneMass: metricToInput(prefill?.boneMassKg, 'boneMass', unitSystem),
    visceralFatLevel: metricToInput(prefill?.visceralFatLevel, 'visceralFatLevel', unitSystem),
    bmrKcal: metricToInput(prefill?.bmrKcal, 'bmrKcal', unitSystem),
    notes: '',
  };
}

export function BodyCompEntryModal({
  open,
  onOpenChange,
  log,
  prefill,
  latestWeightKg,
  segmentalAllowed = true,
  onSaved,
}: BodyCompEntryModalProps) {
  const { unitSystem, setUnitSystem, isLoading: isLoadingUnits } = useUnitPreference();
  const [showMore, setShowMore] = useState(false);
  const [prevUnitSystem, setPrevUnitSystem] = useState(unitSystem);

  const schema = useMemo(() => buildSchema(unitSystem), [unitSystem]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    getValues,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues(unitSystem, log, prefill, latestWeightKg),
  });

  // Re-seed whenever the modal opens for a (possibly different) entry/prefill.
  useEffect(() => {
    if (open) {
      reset(defaultValues(unitSystem, log, prefill, latestWeightKg));
      setShowMore(
        Boolean(
          log?.fatMassKg && !log.derived.fatMassKg
        ) ||
          Boolean(log?.bodyWaterKg || log?.boneMassKg || log?.visceralFatLevel || log?.bmrKcal) ||
          Boolean(
            prefill &&
              (prefill.fatMassKg != null ||
                prefill.bodyWaterKg != null ||
                prefill.boneMassKg != null ||
                prefill.visceralFatLevel != null ||
                prefill.bmrKcal != null)
          )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, log?.id, prefill]);

  // Convert typed values in place when the unit system flips (same UX as the
  // dashboard quick-entry card).
  useEffect(() => {
    if (unitSystem === prevUnitSystem) return;
    const toLb = unitSystem === 'imperial';
    for (const field of CONVERTED_FIELDS) {
      const raw = getValues(field).trim();
      if (raw === '') continue;
      const num = Number(raw);
      if (Number.isNaN(num)) continue;
      const converted = toLb ? num * 2.20462 : num / 2.20462;
      setValue(field, converted.toFixed(1), { shouldValidate: false });
    }
    setPrevUnitSystem(unitSystem);
  }, [unitSystem, prevUnitSystem, getValues, setValue]);

  // Display-only fat-mass hint — the server does the real derivation.
  const watchedWeight = watch('weight');
  const watchedBf = watch('bodyFatPct');
  const watchedFatMass = watch('fatMass');
  const fatMassHint = useMemo(() => {
    if (watchedFatMass.trim() !== '') return null;
    const w = Number(watchedWeight);
    const bf = Number(watchedBf);
    if (!watchedWeight.trim() || !watchedBf.trim() || Number.isNaN(w) || Number.isNaN(bf)) return null;
    if (bf < 2 || bf > 65 || w <= 0) return null;
    return `≈ ${((w * bf) / 100).toFixed(1)} ${massUnit(unitSystem)} fat mass`;
  }, [watchedWeight, watchedBf, watchedFatMass, unitSystem]);

  const onSubmit = async (v: FormValues) => {
    const measuredAtISO = new Date(v.measuredAt).toISOString();
    const metric = (field: MetricField) => inputToMetric(v[field], field, unitSystem);
    try {
      let saved: BodyCompLog;
      if (log) {
        // Edit: send every metric (value or null) so cleared fields are erased
        // and the server re-derives fat/lean mass from the merged row.
        const patch: BodyCompUpdate = {
          measuredAt: measuredAtISO,
          weightKg: metric('weight') ?? null,
          bodyFatPct: metric('bodyFatPct') ?? null,
          skeletalMuscleMassKg: metric('skeletalMuscleMass') ?? null,
          fatMassKg: metric('fatMass') ?? null,
          leanBodyMassKg: metric('leanBodyMass') ?? null,
          bodyWaterKg: metric('bodyWater') ?? null,
          boneMassKg: metric('boneMass') ?? null,
          visceralFatLevel: metric('visceralFatLevel') ?? null,
          bmrKcal: metric('bmrKcal') ?? null,
          notes: v.notes.trim() === '' ? null : v.notes.trim(),
        };
        saved = await bodyCompClient.update(log.id, patch);
        toast.success('Entry updated');
      } else {
        const input: BodyCompCreate = {
          measuredAt: measuredAtISO,
          // A low-confidence scan fallback still commits with its scan provenance
          // (and carries the parsed segmental data along).
          source: prefill ? 'photo_scan' : 'manual',
          weightKg: metric('weight'),
          bodyFatPct: metric('bodyFatPct'),
          skeletalMuscleMassKg: metric('skeletalMuscleMass'),
          fatMassKg: metric('fatMass'),
          leanBodyMassKg: metric('leanBodyMass'),
          bodyWaterKg: metric('bodyWater'),
          boneMassKg: metric('boneMass'),
          visceralFatLevel: metric('visceralFatLevel'),
          bmrKcal: metric('bmrKcal'),
          ...(prefill?.segmental ? { segmental: prefill.segmental } : {}),
          ...(v.notes.trim() ? { notes: v.notes.trim() } : {}),
        };
        saved = await bodyCompClient.create(input);
        toast.success('Entry saved');
      }
      onOpenChange(false);
      onSaved(saved);
    } catch (err) {
      const message =
        err instanceof BodyCompApiError
          ? err.message
          : 'Could not save the entry. Please try again.';
      toast.error(message);
    }
  };

  const fieldError = (field: keyof FormValues) => errors[field]?.message;

  const numberInput = (
    field: MetricField,
    label: string,
    placeholder: string,
    step: string
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`bc-${field}`} className="text-gray-300">
        {label}{' '}
        <span className="text-xs text-gray-500">({fieldUnitLabel(field, unitSystem)})</span>
      </Label>
      <Input
        id={`bc-${field}`}
        type="number"
        inputMode="decimal"
        step={step}
        placeholder={placeholder}
        {...register(field)}
        className={cn(fieldError(field) && 'border-red-500/60 focus-visible:ring-red-500/50')}
      />
      {fieldError(field) && <p className="text-xs text-red-400">{fieldError(field)}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto bg-slate-900 border-slate-800 sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between pr-8">
            <DialogTitle className="text-white">
              {log ? 'Edit entry' : 'Log body composition'}
            </DialogTitle>
            <UnitToggle
              value={unitSystem}
              onChange={setUnitSystem}
              isLoading={isLoadingUnits}
              size="sm"
            />
          </div>
          <DialogDescription>
            {log
              ? 'Update this measurement. Clearing a field removes it.'
              : 'All fields optional — log whatever your scale or scan gives you.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* When */}
          <div className="space-y-1.5">
            <Label htmlFor="bc-measuredAt" className="text-gray-300">
              When
            </Label>
            <Input
              id="bc-measuredAt"
              type="datetime-local"
              max={toLocalDateTimeInputValue(new Date())}
              {...register('measuredAt')}
              className={cn(
                fieldError('measuredAt') && 'border-red-500/60 focus-visible:ring-red-500/50'
              )}
            />
            {fieldError('measuredAt') && (
              <p className="text-xs text-red-400">{fieldError('measuredAt')}</p>
            )}
          </div>

          {/* Core metrics */}
          <div className="grid grid-cols-2 gap-3">
            {numberInput('weight', 'Weight', unitSystem === 'imperial' ? '155.4' : '70.5', '0.1')}
            {numberInput('bodyFatPct', 'Body fat', '26.6', '0.1')}
          </div>
          {fatMassHint && <p className="text-xs text-indigo-300">{fatMassHint}</p>}
          {numberInput(
            'skeletalMuscleMass',
            'Skeletal muscle mass',
            unitSystem === 'imperial' ? '68.3' : '31.0',
            '0.1'
          )}

          {/* More metrics */}
          <button
            type="button"
            onClick={() => setShowMore((s) => !s)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2 text-sm text-gray-300 hover:bg-slate-800/70 transition-colors"
          >
            More metrics
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', showMore && 'rotate-180')}
              aria-hidden="true"
            />
          </button>
          {showMore && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {numberInput('fatMass', 'Fat mass', unitSystem === 'imperial' ? '53.1' : '24.1', '0.1')}
                {numberInput(
                  'leanBodyMass',
                  'Lean mass',
                  unitSystem === 'imperial' ? '121.3' : '55.0',
                  '0.1'
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {numberInput('bodyWater', 'Body water', unitSystem === 'imperial' ? '88.2' : '40.0', '0.1')}
                {numberInput('boneMass', 'Bone mass', unitSystem === 'imperial' ? '7.7' : '3.5', '0.1')}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {numberInput('visceralFatLevel', 'Visceral fat', '8', '0.1')}
                {numberInput('bmrKcal', 'BMR', '1600', '1')}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="bc-notes" className="text-gray-300">
              Notes <span className="text-xs text-gray-500">(optional)</span>
            </Label>
            <Textarea id="bc-notes" rows={2} placeholder="Anything worth remembering…" {...register('notes')} />
            {fieldError('notes') && <p className="text-xs text-red-400">{fieldError('notes')}</p>}
          </div>

          {/* Segmental (display-only, edit mode) */}
          {segmentalAllowed && log?.segmental && (
            <div className="space-y-1.5">
              <Label className="text-gray-300">Segmental</Label>
              <SegmentalGrid segmental={log.segmental} unitSystem={unitSystem} />
            </div>
          )}

          <Button type="submit" disabled={isSubmitting} className="w-full h-11">
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {log ? 'Save changes' : 'Save entry'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
