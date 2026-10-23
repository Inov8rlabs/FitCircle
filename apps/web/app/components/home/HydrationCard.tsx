'use client';

import { CupSoda, Droplet, GlassWater, Milk, Pencil, PlusCircle } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CardTitleRow, GlassCard, ToneDisc } from '@/components/ui/ios';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import type { VitalsWater } from '@/lib/types/vitals';
import { cn } from '@/lib/utils';
import type { UnitSystem } from '@/lib/utils/units';

import { amount, heroParts, microcopy, mlFromOz, presets, weekdayInitial } from './hydration-format';

const PRESET_ICON = { glass: GlassWater, bottle: Milk, large: CupSoda } as const;

/** The iOS glass: tapered tumbler whose water level follows today's progress. */
function WaterGlass({ progress }: { progress: number }) {
  const id = useId().replace(/:/g, '');
  const level = Math.max(0, Math.min(1, progress));
  // Inner cavity spans y = 10 → 112; water top moves up as progress grows.
  const top = 112 - level * 96;
  return (
    <svg viewBox="0 0 96 124" className="h-[124px] w-[96px] shrink-0" aria-hidden>
      <defs>
        <linearGradient id={`w${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#0891b2" />
        </linearGradient>
        <clipPath id={`c${id}`}>
          <path d="M8 6 H88 L80 112 Q79 118 72 118 H24 Q17 118 16 112 Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#c${id})`}>
        <rect x="0" y="0" width="96" height="124" fill="rgba(255,255,255,0.04)" />
        <path
          d={`M0 ${top} Q24 ${top - 5} 48 ${top} T96 ${top} V124 H0 Z`}
          fill={`url(#w${id})`}
          className="transition-[d] duration-700 ease-ios"
        />
        <rect x="14" y="14" width="5" height="70" rx="2.5" fill="rgba(255,255,255,0.18)" />
      </g>
      <path
        d="M8 6 H88 L80 112 Q79 118 72 118 H24 Q17 118 16 112 Z"
        fill="none"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="2"
      />
    </svg>
  );
}

/** A water drop filled to `fill` (0..1); today gets a highlighted tile. */
function WeekDrop({ fill, label, today }: { fill: number; label: string; today: boolean }) {
  const id = useId().replace(/:/g, '');
  const y = 26 - Math.max(0, Math.min(1, fill)) * 22;
  return (
    <div className={cn('flex flex-1 flex-col items-center gap-1 rounded-lg py-2', today && 'bg-brand-cyan/10')}>
      <svg viewBox="0 0 20 28" className="h-7 w-5" aria-hidden>
        <defs>
          <clipPath id={`d${id}`}>
            <path d="M10 1 C10 1 2 11 2 17.5 A8 8 0 0 0 18 17.5 C18 11 10 1 10 1 Z" />
          </clipPath>
        </defs>
        <path d="M10 1 C10 1 2 11 2 17.5 A8 8 0 0 0 18 17.5 C18 11 10 1 10 1 Z" fill="rgba(255,255,255,0.08)" />
        <rect x="0" y={y} width="20" height="28" fill="#06b6d4" clipPath={`url(#d${id})`} />
      </svg>
      <span className={cn('text-caption', today ? 'font-semibold text-white' : 'text-fg-tertiary')}>{label}</span>
    </div>
  );
}

export function HydrationCardSkeleton() {
  return (
    <GlassCard data-testid="hydration-card-skeleton" aria-busy="true">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <Skeleton className="h-5 w-28" />
      </div>
      <div className="flex items-center gap-5">
        <Skeleton className="h-[124px] w-[96px] rounded-2xl" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-2 w-full" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[84px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-5 h-[60px] w-full rounded-lg" />
    </GlassCard>
  );
}

/**
 * Dashboard Hydration card (iOS HydrationCard): glass visual, today vs goal,
 * microcopy, one-tap +Glass / +Bottle / +Large, Custom sheet, this-week drops.
 * Taps are optimistic: the total moves immediately and rolls back on failure.
 */
export function HydrationCard({
  water,
  unitSystem,
  onLogWater,
  onEditGoal,
}: {
  water: VitalsWater;
  unitSystem: UnitSystem;
  onLogWater: (ml: number) => Promise<void>;
  onEditGoal: () => void;
}) {
  const [pendingMl, setPendingMl] = useState(0);
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  // A fresh summary already includes what was pending.
  useEffect(() => setPendingMl(0), [water.today_ml]);

  const todayMl = water.today_ml + pendingMl;
  const goalMl = water.goal_ml > 0 ? water.goal_ml : 2000;
  const progress = todayMl / goalMl;
  const hero = heroParts(todayMl, unitSystem);
  const days = water.days.slice(-7);
  const lastIndex = days.length - 1;
  const metDays = days.filter((d, i) => (i === lastIndex ? todayMl >= goalMl : d.goal_met)).length;

  const add = async (ml: number) => {
    if (ml < 1) return;
    setPendingMl((p) => p + ml);
    setFlash(`+${amount(ml, unitSystem)}`);
    window.setTimeout(() => setFlash(null), 900);
    try {
      await onLogWater(ml);
    } catch {
      setPendingMl((p) => Math.max(0, p - ml));
      toast.error("Couldn't log water. Try again.");
    }
  };

  const customMl = (() => {
    const v = Number(customText);
    if (!Number.isFinite(v) || v <= 0) return 0;
    return unitSystem === 'imperial' ? mlFromOz(v) : Math.round(v);
  })();

  return (
    <GlassCard data-testid="hydration-card" aria-label="Hydration">
      <CardTitleRow
        icon={Droplet}
        tone="cyan"
        title="Hydration"
        trailing={
          <button
            type="button"
            onClick={onEditGoal}
            aria-label="Edit water goal"
            className="flex h-9 w-9 items-center justify-center rounded-full text-fg-secondary transition hover:bg-white/5 hover:text-white"
          >
            <Pencil className="h-4 w-4" />
          </button>
        }
      />

      <div className="flex items-center gap-5">
        <WaterGlass progress={progress} />
        <div className="relative min-w-0 flex-1">
          <p className="text-white" aria-live="polite">
            <span className="text-[34px] font-bold leading-none tabular-nums" data-testid="hydration-today">
              {hero.value}
            </span>{' '}
            <span className="text-title3 font-medium text-fg-secondary">{hero.unit}</span>
          </p>
          <p className="mt-1.5 text-subhead text-fg-secondary">
            of {amount(goalMl, unitSystem)}
            {water.goal_source !== 'user' && (
              <>
                {'  ·  '}
                <button type="button" onClick={onEditGoal} className="font-semibold text-brand-cyan hover:underline">
                  Set goal
                </button>
              </>
            )}
          </p>
          <p className="mt-2 text-callout font-semibold text-brand-cyan">{microcopy(progress, todayMl)}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-600 to-cyan-300 transition-[width] duration-500 ease-ios"
              style={{ width: `${Math.min(100, progress * 100)}%` }}
            />
          </div>
          {flash && (
            <span className="pointer-events-none absolute -top-2 right-0 animate-fade-in text-subhead font-bold text-brand-cyan">
              {flash}
            </span>
          )}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-2">
        {presets(unitSystem).map((p) => {
          const Icon = PRESET_ICON[p.id];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => void add(p.ml)}
              data-testid={`water-preset-${p.id}`}
              className="flex h-[84px] flex-col items-center justify-center gap-0.5 rounded-xl border border-brand-cyan/25 bg-brand-cyan/10 text-white transition duration-150 ease-ios hover:bg-brand-cyan/15 active:scale-95"
            >
              <Icon className="h-5 w-5 text-brand-cyan" aria-hidden />
              <span className="text-headline tabular-nums">+{amount(p.ml, unitSystem)}</span>
              <span className="text-caption text-fg-secondary">{p.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setCustomOpen(true)}
          data-testid="water-preset-custom"
          className="flex h-[84px] flex-col items-center justify-center gap-0.5 rounded-xl border border-glass bg-white/5 text-white transition duration-150 ease-ios hover:bg-white/10 active:scale-95"
        >
          <PlusCircle className="h-5 w-5 text-fg-secondary" aria-hidden />
          <span className="text-headline">Custom</span>
          <span className="text-caption text-fg-secondary">Any amount</span>
        </button>
      </div>

      <div className="mt-5">
        <div className="mb-1 flex items-center justify-between text-footnote">
          <span className="text-fg-secondary">This week</span>
          <span className="text-fg-tertiary">
            {metDays} of {days.length || 7} days
          </span>
        </div>
        <div className="flex gap-1" data-testid="hydration-week">
          {days.map((d, i) => {
            const ml = i === lastIndex ? todayMl : d.ml;
            return <WeekDrop key={d.date} fill={ml / goalMl} label={weekdayInitial(d.date)} today={i === lastIndex} />;
          })}
        </div>
      </div>

      <Sheet open={customOpen} onOpenChange={setCustomOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Log water</SheetTitle>
            <SheetDescription>Any amount, in {unitSystem === 'imperial' ? 'fluid ounces' : 'millilitres'}.</SheetDescription>
          </SheetHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customMl < 1 || customMl > 10_000) return;
              setCustomOpen(false);
              setCustomText('');
              void add(customMl);
            }}
          >
            <div className="flex items-center gap-3">
              <ToneDisc icon={Droplet} tone="cyan" />
              <Input
                autoFocus
                inputMode="decimal"
                type="number"
                min={1}
                step="any"
                placeholder={unitSystem === 'imperial' ? '12' : '330'}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                aria-label={`Amount in ${unitSystem === 'imperial' ? 'oz' : 'ml'}`}
              />
              <span className="text-callout text-fg-secondary">{unitSystem === 'imperial' ? 'oz' : 'ml'}</span>
            </div>
            <SheetFooter>
              <Button type="submit" size="lg" disabled={customMl < 1 || customMl > 10_000} className="w-full sm:w-auto">
                {customMl > 0 ? `Add ${amount(customMl, unitSystem)}` : 'Add'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </GlassCard>
  );
}
