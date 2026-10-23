'use client';

import { Footprints, Scale } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToneDisc } from '@/components/ui/ios';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { UnitToggle } from '@/components/ui/unit-toggle';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { cn } from '@/lib/utils';
import {
  detectWrongUnit,
  getWeightUnit,
  getWeightValidationMessage,
  isValidWeight,
  parseWeightToKg,
  type UnitSystem,
} from '@/lib/utils/units';

import { isoDay } from './useTracking';

export type QuickLogKind = 'weight' | 'steps';

/**
 * iOS quick-log sheet (replaces the old inline kg / steps forms and the
 * "Log past date" dialog): pick Weight or Steps, a day (today by default,
 * any past day allowed), enter the value, save. Same daily_tracking upsert,
 * validation and analytics as before.
 */
export function QuickLogSheet({
  open,
  onOpenChange,
  initialKind = 'weight',
  pastDate = false,
  unitSystem,
  onUnitChange,
  unitLoading,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialKind?: QuickLogKind;
  /** Open with the date field focused on a past day (the "Log data for a past date" row). */
  pastDate?: boolean;
  unitSystem: UnitSystem;
  onUnitChange: (u: UnitSystem) => void;
  unitLoading?: boolean;
  onSave: (date: string, values: { weight_kg?: number; steps?: number }) => Promise<void>;
}) {
  const [kind, setKind] = useState<QuickLogKind>(initialKind);
  const [date, setDate] = useState(isoDay());
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setValue('');
    const d = new Date();
    if (pastDate) d.setDate(d.getDate() - 1);
    setDate(isoDay(d));
  }, [open, initialKind, pastDate]);

  const isToday = date === isoDay();

  const submit = async () => {
    const n = Number(value);
    if (!value || !Number.isFinite(n) || n <= 0) return;
    let values: { weight_kg?: number; steps?: number };
    if (kind === 'weight') {
      if (!isValidWeight(n, unitSystem)) {
        toast.error(getWeightValidationMessage(n, unitSystem) || 'Invalid weight value');
        return;
      }
      const kg = parseWeightToKg(value, unitSystem)!;
      const check = detectWrongUnit(kg, unitSystem);
      if (check.isWrong && !window.confirm(`${check.message}\n\nClick OK to save as ${kg.toFixed(1)} kg, or Cancel to fix it.`)) {
        return;
      }
      values = { weight_kg: kg };
    } else {
      if (!Number.isInteger(n) || n > 200_000) {
        toast.error('Enter a whole number of steps');
        return;
      }
      values = { steps: n };
    }
    setSaving(true);
    try {
      await onSave(date, values);
      const source = isToday ? 'quick_log' : 'form';
      if (kind === 'weight') analytics.track(AnalyticsEvents.weightLogged({ source }));
      else analytics.track(AnalyticsEvents.stepsLogged({ source }));
      toast.success(kind === 'weight' ? 'Weight logged!' : 'Steps logged!');
      onOpenChange(false);
    } catch (error) {
      console.error(error);
      toast.error(kind === 'weight' ? 'Failed to save weight' : 'Failed to save steps');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{pastDate ? 'Log a past day' : 'Quick log'}</SheetTitle>
          <SheetDescription>Weight or steps, for today or any earlier day.</SheetDescription>
        </SheetHeader>

        <div role="tablist" aria-label="What to log" className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-hairline bg-white/5 p-1">
          {(['weight', 'steps'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => {
                setKind(k);
                setValue('');
              }}
              className={cn(
                'flex h-9 items-center justify-center gap-2 rounded-md text-subhead font-semibold transition',
                kind === k ? 'bg-surface-raised text-white shadow-ios-sm' : 'text-fg-secondary hover:text-white'
              )}
            >
              {k === 'weight' ? <Scale className="h-4 w-4" /> : <Footprints className="h-4 w-4" />}
              {k === 'weight' ? 'Weight' : 'Steps'}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
        >
          <div className="flex items-center gap-3">
            <ToneDisc icon={kind === 'weight' ? Scale : Footprints} tone={kind === 'weight' ? 'purple' : 'indigo'} />
            <Input
              autoFocus
              type="number"
              inputMode={kind === 'weight' ? 'decimal' : 'numeric'}
              step={kind === 'weight' ? '0.1' : '1'}
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === 'weight' ? (unitSystem === 'metric' ? '70.0' : '154.0') : '8000'}
              aria-label={kind === 'weight' ? `Weight in ${getWeightUnit(unitSystem)}` : 'Steps'}
              data-testid="quick-log-value"
            />
            {kind === 'weight' ? (
              <UnitToggle value={unitSystem} onChange={onUnitChange} isLoading={unitLoading} size="sm" />
            ) : (
              <span className="text-callout text-fg-secondary">steps</span>
            )}
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-white/5 px-3.5 py-2.5">
            <span className="text-subhead text-fg-secondary">Day</span>
            <input
              type="date"
              value={date}
              max={isoDay()}
              onChange={(e) => setDate(e.target.value || isoDay())}
              className="bg-transparent text-right text-subhead text-white [color-scheme:dark] focus:outline-none"
              data-testid="quick-log-date"
            />
          </label>

          <SheetFooter>
            <Button type="submit" size="lg" loading={saving} disabled={!value} className="w-full sm:w-auto" data-testid="quick-log-save">
              {isToday ? 'Save' : `Save for ${new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
