'use client';

import { Loader2, Lock, Users } from 'lucide-react';
import { useId } from 'react';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/** "Private" / "Shared with circles" — the visible state of a meal (§1 Visible state). */
export function MealSharingChip({ shared, className, testId }: { shared: boolean; className?: string; testId?: string }) {
  const Icon = shared ? Users : Lock;
  return (
    <span
      data-testid={testId ?? 'meal-sharing-chip'}
      data-shared={shared ? 'true' : 'false'}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        shared
          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
          : 'border-slate-600/60 bg-slate-800/70 text-slate-300',
        className
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {shared ? 'Shared with circles' : 'Private'}
    </span>
  );
}

/**
 * The per-meal "Share with my circles" control shown on every food logging
 * surface and on the edit / detail screens. Controlled: the caller owns the
 * state and decides when to persist it.
 */
export function MealSharingControl({
  shared,
  onChange,
  disabled,
  busy,
  description,
  className,
  testId = 'meal-sharing-control',
}: {
  shared: boolean;
  onChange: (shared: boolean) => void;
  disabled?: boolean;
  /** Show a spinner while a change is being saved. */
  busy?: boolean;
  description?: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  const labelId = useId();
  const descId = useId();
  const Icon = shared ? Users : Lock;
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex items-center gap-3 rounded-lg border border-slate-700/50 bg-slate-800/40 p-3',
        className
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          shared ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-700/60 text-slate-300'
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span id={labelId} className="text-sm font-medium text-white">
            Share with my circles
          </span>
          <span aria-live="polite">
            <MealSharingChip shared={shared} testId={`${testId}-chip`} />
          </span>
        </div>
        <p id={descId} className="mt-0.5 text-xs text-slate-400">
          {description ??
            (shared ? 'Members of your circles will see this meal in chat.' : 'Only you can see this meal.')}
        </p>
      </div>
      {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-400" aria-label="Saving" />}
      <Switch
        data-testid={`${testId}-switch`}
        aria-labelledby={labelId}
        aria-describedby={descId}
        checked={shared}
        disabled={disabled || busy}
        onCheckedChange={onChange}
        className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-slate-600"
      />
    </div>
  );
}
