'use client';

import { Loader2, Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import type { UnitSystem } from '@/lib/utils/units';

import { formatVolume } from './format';
import {
  defaultAmountForUnit,
  roundWaterAmount,
  stepForUnit,
  WATER_QUICK_PRESETS,
  waterAmountToMl,
  type WaterQuickUnit,
} from './waterMl';

interface WaterQuickAddProps {
  unitSystem: UnitSystem;
  disabled?: boolean;
  onLogWater: (ml: number) => Promise<void>;
}

const UNITS: { id: WaterQuickUnit; label: string }[] = [
  { id: 'glasses', label: 'Glasses' },
  { id: 'oz', label: 'oz' },
  { id: 'L', label: 'L' },
];

/**
 * Compact quick-add on the Water this week card: one-tap Half / Glass / 8 oz,
 * plus Custom with glasses, fluid ounces, or litres.
 */
export function WaterQuickAdd({ unitSystem, disabled, onLogWater }: WaterQuickAddProps) {
  const [busy, setBusy] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [unit, setUnit] = useState<WaterQuickUnit>(unitSystem === 'imperial' ? 'oz' : 'glasses');
  const [amount, setAmount] = useState(() => defaultAmountForUnit(unitSystem === 'imperial' ? 'oz' : 'glasses'));
  const [amountText, setAmountText] = useState(() => String(defaultAmountForUnit(unitSystem === 'imperial' ? 'oz' : 'glasses')));
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!status) return;
    const t = window.setTimeout(() => setStatus(null), 2000);
    return () => window.clearTimeout(t);
  }, [status]);

  const customMl = waterAmountToMl(unit, amount);
  const isBusy = busy || disabled;

  const log = async (ml: number) => {
    if (isBusy || ml < 1) return;
    setBusy(true);
    setStatus(null);
    try {
      await onLogWater(ml);
      setStatus({ kind: 'ok', text: `Logged ${formatVolume(ml, unitSystem)}` });
    } catch (err) {
      setStatus({
        kind: 'err',
        text: err instanceof Error ? err.message : "Couldn't log water",
      });
    } finally {
      setBusy(false);
    }
  };

  const applyUnit = (next: WaterQuickUnit) => {
    const def = defaultAmountForUnit(next);
    setUnit(next);
    setAmount(def);
    setAmountText(String(def));
  };

  const applyAmount = (value: number) => {
    const next = roundWaterAmount(unit, value);
    setAmount(next);
    setAmountText(String(next));
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-800/80">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs font-medium text-gray-400">Log water</p>
        {isBusy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" aria-hidden />
        ) : status ? (
          <p
            className={cn(
              'text-xs tabular-nums',
              status.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'
            )}
            role="status"
          >
            {status.text}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {WATER_QUICK_PRESETS.map((preset) => (
          <button
            key={preset.ml}
            type="button"
            disabled={isBusy}
            onClick={() => void log(preset.ml)}
            className="min-h-[44px] rounded-full bg-cyan-500/15 px-2 text-xs font-medium text-cyan-400 hover:bg-cyan-500/25 disabled:opacity-50 transition-colors"
            aria-label={`Log ${preset.label.toLowerCase()} of water`}
          >
            + {preset.label}
          </button>
        ))}
        <button
          type="button"
          disabled={isBusy}
          onClick={() => setShowCustom((v) => !v)}
          aria-expanded={showCustom}
          className={cn(
            'min-h-[44px] rounded-full px-2 text-xs font-medium transition-colors disabled:opacity-50',
            showCustom
              ? 'bg-cyan-500/25 text-cyan-300 ring-1 ring-cyan-500/60'
              : 'bg-slate-800/60 text-gray-300 hover:bg-slate-800'
          )}
        >
          Custom
        </button>
      </div>

      {showCustom && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-800/50 p-1">
            {UNITS.map((u) => (
              <button
                key={u.id}
                type="button"
                disabled={isBusy}
                onClick={() => applyUnit(u.id)}
                className={cn(
                  'min-h-[44px] rounded-md text-xs font-medium transition-colors disabled:opacity-50',
                  unit === u.id ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-400 hover:text-white'
                )}
              >
                {u.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => applyAmount(amount - stepForUnit(unit))}
              className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-slate-800/80 text-gray-300 hover:text-white disabled:opacity-50"
              aria-label="Decrease amount"
            >
              <Minus className="w-4 h-4" aria-hidden />
            </button>
            <input
              type="text"
              inputMode="decimal"
              value={amountText}
              disabled={isBusy}
              onChange={(e) => {
                const raw = e.target.value.replace(',', '.');
                setAmountText(raw);
                const n = parseFloat(raw);
                if (Number.isFinite(n) && n > 0) setAmount(n);
              }}
              onBlur={() => {
                const n = parseFloat(amountText.replace(',', '.'));
                if (Number.isFinite(n) && n > 0) applyAmount(n);
                else applyAmount(defaultAmountForUnit(unit));
              }}
              className="h-11 min-h-[44px] flex-1 rounded-lg border border-slate-700 bg-slate-900/80 px-3 text-center text-sm tabular-nums text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
              aria-label={`Amount in ${unit}`}
            />
            <button
              type="button"
              disabled={isBusy}
              onClick={() => applyAmount(amount + stepForUnit(unit))}
              className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-slate-800/80 text-gray-300 hover:text-white disabled:opacity-50"
              aria-label="Increase amount"
            >
              <Plus className="w-4 h-4" aria-hidden />
            </button>
            <button
              type="button"
              disabled={isBusy || customMl < 1}
              onClick={() => void log(customMl)}
              className="min-h-[44px] flex-shrink-0 rounded-full bg-cyan-500/20 px-4 text-sm font-medium text-cyan-300 hover:bg-cyan-500/30 disabled:opacity-50"
            >
              Add
            </button>
          </div>
          {customMl >= 1 && (
            <p className="text-[11px] text-gray-500 tabular-nums">{formatVolume(customMl, unitSystem)}</p>
          )}
        </div>
      )}
    </div>
  );
}
