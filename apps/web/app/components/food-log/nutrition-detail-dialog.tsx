'use client';

import { format } from 'date-fns';
import Image from 'next/image';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const round = (v: unknown) => (typeof v === 'number' ? Math.round(v) : 0);
const numFmt = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n)) return '—';
  return n === Math.round(n) ? String(n) : n.toFixed(1);
};

interface SavedItem {
  name?: string;
  quantity?: number | null;
  serving_unit?: string | null;
  calories?: number | null;
  matched_food_id?: string | null;
}

/**
 * Read-only detail of a logged meal: macro + secondary-nutrient summary, a
 * health score, and the per-ingredient breakdown — rendered from the entry's
 * persisted `nutrition_data`. Use the row content as the trigger.
 */
export function NutritionDetailDialog({ entry, children }: { entry: any; children: React.ReactNode }) {
  const nd = entry?.nutrition_data ?? {};
  const items: SavedItem[] = Array.isArray(nd.items) ? nd.items : [];
  const hasSecondary = (nd.fiber_g || 0) > 0 || (nd.sugar_g || 0) > 0 || (nd.sodium_mg || 0) > 0;
  const score: number | null = typeof nd.health_score === 'number' ? nd.health_score : null;
  const img: string | undefined = entry?.images?.[0]?.url || entry?.images?.[0]?.thumbnail_url;

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{entry?.title || 'Meal'}</DialogTitle>
          {entry?.logged_at && (
            <p className="text-xs text-muted-foreground">{format(new Date(entry.logged_at), 'PPp')}</p>
          )}
        </DialogHeader>

        {img && (
          <div className="relative h-40 w-full overflow-hidden rounded-lg">
            <Image src={img} alt={entry?.title || 'Meal'} fill className="object-cover" sizes="480px" />
          </div>
        )}

        {/* Macro summary */}
        <div className="grid grid-cols-4 gap-2 rounded-lg border bg-card p-3 text-center">
          <Stat label="Calories" value={round(nd.calories)} accent="text-orange-400" big />
          <Stat label="Protein" value={`${round(nd.protein_g)}g`} accent="text-indigo-400" />
          <Stat label="Carbs" value={`${round(nd.carbs_g)}g`} accent="text-emerald-400" />
          <Stat label="Fat" value={`${round(nd.fat_g)}g`} accent="text-cyan-400" />
        </div>

        {hasSecondary && (
          <div className="grid grid-cols-3 gap-2 rounded-lg border bg-card p-3 text-center">
            <Stat label="Fiber" value={`${round(nd.fiber_g)}g`} />
            <Stat label="Sugar" value={`${round(nd.sugar_g)}g`} />
            <Stat label="Sodium" value={`${round(nd.sodium_mg)}mg`} />
          </div>
        )}

        {score != null && (
          <div className="rounded-lg border bg-card p-3">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium">Health Score</span>
              <span
                className={cn(
                  'font-bold',
                  score >= 7 ? 'text-emerald-400' : score >= 4 ? 'text-amber-400' : 'text-orange-400'
                )}
              >
                {Math.round(score)}/10
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  'h-full rounded-full',
                  score >= 7 ? 'bg-emerald-400' : score >= 4 ? 'bg-amber-400' : 'bg-orange-400'
                )}
                style={{ width: `${Math.max(0, Math.min(100, score * 10))}%` }}
              />
            </div>
          </div>
        )}

        {items.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-semibold">Ingredients</h4>
            <div className="space-y-1.5">
              {items.map((it, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{it.name || 'Item'}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {round(it.calories)} cal{it.matched_food_id ? ' · from database' : ''}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {numFmt(it.quantity)} {it.serving_unit || 'g'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {items.length === 0 && round(nd.calories) === 0 && (
          <p className="text-sm text-muted-foreground">No nutrition details saved for this entry.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, accent, big }: { label: string; value: string | number; accent?: string; big?: boolean }) {
  return (
    <div>
      <div className={cn('font-bold tabular-nums', big ? 'text-2xl' : 'text-base', accent ?? 'text-foreground')}>
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}
