'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { VitalsGoalsUpdate, VitalsSummary } from '@/lib/types/vitals';
import { getWeightUnit, type UnitSystem } from '@/lib/utils/units';

import { displayToKg, displayToMl, kgToDisplay, mlToDisplay, waterInputUnit } from './format';

interface VitalsGoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: VitalsSummary | null;
  unitSystem: UnitSystem;
  /** Persists via PUT /api/mobile/vitals/goals; the hook swaps in the returned summary. */
  onSave: (body: VitalsGoalsUpdate) => Promise<unknown>;
}

// Server-side ranges (VITALS_CLIENT_CONTRACT.md): weight 20–400 kg, water 250–10000 ml.
const WEIGHT_KG = { min: 20, max: 400 };
const WATER_ML = { min: 250, max: 10000 };

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/**
 * Inline goal editor for the vitals cards: target weight (display units → kg)
 * and daily water (ml / fl oz → ml). The profile page still owns the wider
 * goal flow; this is the quick path from the dashboard.
 */
export function VitalsGoalDialog({ open, onOpenChange, summary, unitSystem, onSave }: VitalsGoalDialogProps) {
  const weightUnit = getWeightUnit(unitSystem);
  const waterUnit = waterInputUnit(unitSystem);
  const existingWeightGoal = summary?.weight?.goal?.target_kg ?? null;

  const [weightInput, setWeightInput] = useState('');
  const [waterInput, setWaterInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Prefill from the current summary each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setWeightInput(existingWeightGoal !== null ? round(kgToDisplay(existingWeightGoal, unitSystem), 1).toString() : '');
    const goalMl = summary?.water.goal_ml;
    setWaterInput(goalMl ? Math.round(mlToDisplay(goalMl, unitSystem)).toString() : '');
  }, [open, existingWeightGoal, summary?.water.goal_ml, unitSystem]);

  const weightRange = {
    min: round(kgToDisplay(WEIGHT_KG.min, unitSystem), 0),
    max: round(kgToDisplay(WEIGHT_KG.max, unitSystem), 0),
  };
  const waterRange = {
    min: Math.round(mlToDisplay(WATER_ML.min, unitSystem)),
    max: Math.round(mlToDisplay(WATER_ML.max, unitSystem)),
  };

  const handleSave = async () => {
    const body: VitalsGoalsUpdate = {};

    const weightTrim = weightInput.trim();
    if (weightTrim !== '') {
      const w = parseFloat(weightTrim);
      if (!Number.isFinite(w)) {
        toast.error('Enter a valid target weight');
        return;
      }
      const kg = round(displayToKg(w, unitSystem), 1);
      if (kg < WEIGHT_KG.min || kg > WEIGHT_KG.max) {
        toast.error(`Target weight must be between ${weightRange.min} and ${weightRange.max} ${weightUnit}`);
        return;
      }
      if (kg !== existingWeightGoal) body.target_weight_kg = kg;
    }

    const waterTrim = waterInput.trim();
    if (waterTrim !== '') {
      const v = parseFloat(waterTrim);
      if (!Number.isFinite(v)) {
        toast.error('Enter a valid daily water goal');
        return;
      }
      const ml = Math.round(displayToMl(v, unitSystem));
      if (ml < WATER_ML.min || ml > WATER_ML.max) {
        toast.error(`Daily water must be between ${waterRange.min} and ${waterRange.max} ${waterUnit}`);
        return;
      }
      if (ml !== summary?.water.goal_ml || summary.water.goal_source !== 'user') body.daily_water_ml_target = ml;
    }

    if (Object.keys(body).length === 0) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    try {
      await onSave(body);
      toast.success('Goals updated');
      onOpenChange(false);
    } catch (err) {
      console.error('Error saving vitals goals:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save goals');
    } finally {
      setSaving(false);
    }
  };

  const handleClearWeight = async () => {
    setClearing(true);
    try {
      await onSave({ target_weight_kg: null });
      toast.success('Weight goal cleared');
      onOpenChange(false);
    } catch (err) {
      console.error('Error clearing weight goal:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to clear weight goal');
    } finally {
      setClearing(false);
    }
  };

  const busy = saving || clearing;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md bg-slate-900 border-slate-800">
        <DialogHeader>
          <DialogTitle className="text-white">Edit goals</DialogTitle>
          <DialogDescription className="text-gray-400">
            Target weight and daily water. Leave a field blank to keep it unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          <div>
            <Label htmlFor="vitals-target-weight" className="text-white mb-2 block">
              Target weight
            </Label>
            <div className="relative">
              <Input
                id="vitals-target-weight"
                type="number"
                inputMode="decimal"
                step="0.1"
                min={weightRange.min}
                max={weightRange.max}
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                placeholder={unitSystem === 'imperial' ? '160.0' : '73.0'}
                className="bg-slate-800 border-slate-700 text-white pr-14 tabular-nums"
                disabled={busy}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{weightUnit}</span>
            </div>
          </div>

          <div>
            <Label htmlFor="vitals-daily-water" className="text-white mb-2 block">
              Daily water
            </Label>
            <div className="relative">
              <Input
                id="vitals-daily-water"
                type="number"
                inputMode="numeric"
                step="1"
                min={waterRange.min}
                max={waterRange.max}
                value={waterInput}
                onChange={(e) => setWaterInput(e.target.value)}
                placeholder={unitSystem === 'imperial' ? '68' : '2000'}
                className="bg-slate-800 border-slate-700 text-white pr-16 tabular-nums"
                disabled={busy}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{waterUnit}</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {waterRange.min}–{waterRange.max} {waterUnit}
            </p>
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
            {existingWeightGoal !== null && (
              <Button
                variant="ghost"
                onClick={handleClearWeight}
                disabled={busy}
                loading={clearing}
                className="sm:mr-auto text-gray-400 hover:text-red-400 hover:bg-red-500/10"
              >
                Clear weight goal
              </Button>
            )}
            <div className="flex gap-3 sm:ml-auto">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
                className="flex-1 sm:flex-none border-slate-700 hover:bg-slate-800"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={busy}
                loading={saving}
                className="flex-1 sm:flex-none bg-purple-600 hover:bg-purple-700"
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
