'use client';

import { format } from 'date-fns';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Coffee, CupSoda, Droplet, Leaf, Pill, Trash2, Utensils, Wine, type LucideIcon } from 'lucide-react';
import Image from 'next/image';
import { useMemo, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Chip, ChipRow } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { DayHeader, MetricPill, ToneDisc, type Tone } from '@/components/ui/ios';
import { useToast } from '@/components/ui/use-toast';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { BeverageLogService } from '@/lib/services/beverage-log-service';
import { FoodLogService } from '@/lib/services/food-log-service';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

import {
  applyFilter,
  cardTitle,
  entryKind,
  entryMacros,
  entryTime,
  FOOD_LOG_FILTERS,
  formatWater,
  groupByDay,
  imageUrls,
  itemLines,
  waterMl,
  type EntryKind,
  type FeedEntry,
  type FoodLogFilter,
} from './feed-model';
import { NutritionDetailDialog } from './nutrition-detail-dialog';

interface FoodLogFeedProps {
  entries: FeedEntry[];
  userId: string;
  /** Calorie card + first-run prompt: under the chips on phones, top of the side column on desktop. */
  summary?: React.ReactNode;
  /** Plate Score / insights / preferences: after the list on phones, side column on desktop. */
  nutrition?: React.ReactNode;
}

/**
 * The iOS Food Log list (FoodLogView.swift): filter chips, day sections with a
 * count pill, meal cards (photo or meal icon, item lines with kcal, macros,
 * time) and one expandable water card per day.
 */
export function FoodLogFeed({ entries, userId, summary, nutrition }: FoodLogFeedProps) {
  const [list, setList] = useState<FeedEntry[]>(entries);
  const [filter, setFilter] = useState<FoodLogFilter>('all');
  const [openWater, setOpenWater] = useState<Set<string>>(() => new Set());
  const { toast } = useToast();

  const groups = useMemo(() => groupByDay(applyFilter(list, filter)), [list, filter]);

  const handleDelete = async (id: string, kind: EntryKind, isBeverageRow: boolean) => {
    try {
      if (isBeverageRow) {
        await BeverageLogService.deleteEntry(id, userId, supabase as any);
      } else {
        await FoodLogService.deleteEntry(id, userId, supabase as any);
        if (kind === 'food') analytics.track(AnalyticsEvents.mealDeleted());
      }
      setList((prev) => prev.filter((e) => e.id !== id));
      toast({ title: 'Entry deleted' });
    } catch {
      toast({ title: 'Error deleting entry', variant: 'destructive' });
    }
  };

  const toggleWater = (key: string) =>
    setOpenWater((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    // Phones: one column in iOS order (chips, calorie card, days, nutrition).
    // Desktop: days on the left, calorie card + nutrition in a 340px side column.
    // The side column is `display: contents` on phones so its children join the
    // single-column order without rendering anything twice.
    <div
      data-testid="food-log-feed"
      className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-x-8"
    >
      <div className="contents lg:col-start-1 lg:row-start-1 lg:block">
      <ChipRow className="order-1">
        {FOOD_LOG_FILTERS.map((f) => (
          <Chip key={f.id} selected={filter === f.id} onClick={() => setFilter(f.id)} data-testid={`food-filter-${f.id}`}>
            {f.label}
          </Chip>
        ))}
      </ChipRow>

      <div className="order-3 lg:mt-5">
      {groups.length === 0 ? (
        <EmptyState
          icon={Utensils}
          tone="orange"
          title={list.length === 0 ? 'No entries yet' : 'Nothing here'}
          description={
            list.length === 0 ? 'Snap a photo or describe a meal to start your log.' : 'No entries match this filter.'
          }
          className="mt-2 rounded-xl border border-dashed border-hairline"
        />
      ) : (
        <div className="mt-2">
          {groups.map((g) => (
            <section key={g.key} aria-label={format(g.date, 'EEEE, MMMM d')} data-testid="food-day">
              <DayHeader date={g.date} count={g.rows.length + (g.water.length ? 1 : 0)} countIcon={Utensils} />
              <ul className="space-y-3">
                {g.water.length > 0 && (
                  <li>
                    <WaterDayCard
                      entries={g.water}
                      totalMl={g.waterTotalMl}
                      expanded={openWater.has(g.key)}
                      onToggle={() => toggleWater(g.key)}
                      onDelete={(e) => handleDelete(e.id, 'water', !e.entry_type)}
                    />
                  </li>
                )}
                {g.rows.map((e) => (
                  <li key={e.id}>
                    <MealCard entry={e} onDelete={() => handleDelete(e.id, entryKind(e), entryKind(e) === 'beverage')} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      </div>
      </div>

      <aside className="contents lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1 lg:block lg:space-y-4">
        {summary && <div className="order-2 space-y-4">{summary}</div>}
        {nutrition && <div className="order-4 mt-4 lg:mt-0">{nutrition}</div>}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- meal card

function iconFor(e: FeedEntry): { icon: LucideIcon; tone: Tone } {
  if (e.entry_type === 'supplement') return { icon: Pill, tone: 'green' };
  if (entryKind(e) === 'beverage') {
    const c = String(e.category ?? '');
    if (c === 'coffee') return { icon: Coffee, tone: 'orange' };
    if (c === 'tea') return { icon: Leaf, tone: 'green' };
    if (c === 'alcohol') return { icon: Wine, tone: 'pink' };
    return { icon: CupSoda, tone: 'cyan' };
  }
  return { icon: Utensils, tone: 'orange' };
}

export function MealCard({ entry, onDelete }: { entry: FeedEntry; onDelete: () => void }) {
  const { title, detail } = cardTitle(entry);
  const { lines, more } = itemLines(entry);
  const macros = entryMacros(entry);
  const urls = imageUrls(entry);
  const { icon, tone } = iconFor(entry);
  const time = entryTime(entry);
  const isBeverage = entryKind(entry) === 'beverage';
  // The detail dialog reads `images` [{url, thumbnail_url}].
  const dialogEntry = entry.images ? entry : { ...entry, images: urls.map((url, i) => ({ id: `${entry.id}-${i}`, url, thumbnail_url: url })) };

  return (
    <article
      className="group relative flex gap-3 rounded-xl border border-glass bg-surface-raised/50 p-3.5 transition-colors duration-200 hover:border-white/20"
      data-testid="meal-card"
    >
      <NutritionDetailDialog entry={dialogEntry}>
        <button type="button" className="flex min-w-0 flex-1 gap-3 text-left focus-visible:outline-none">
          {urls.length > 0 ? (
            <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[12px] ring-1 ring-white/10">
              <Image src={urls[0]} alt="" fill sizes="56px" className="object-cover" />
              {urls.length > 1 && (
                <span className="absolute bottom-0.5 right-0.5 rounded-md bg-black/60 px-1 text-[10px] font-semibold text-white">
                  +{urls.length - 1}
                </span>
              )}
            </span>
          ) : (
            <ToneDisc icon={icon} tone={tone} size="lg" square className="h-14 w-14 rounded-[12px]" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-headline text-white">{title}</span>
            {lines.length > 0 ? (
              <span className="mt-0.5 block space-y-0.5">
                {lines.map((l, i) => (
                  <span key={i} className="block truncate text-footnote text-fg-secondary">
                    • {l}
                  </span>
                ))}
                {more > 0 && <span className="block text-footnote text-fg-tertiary">+{more} more</span>}
              </span>
            ) : detail ? (
              <span className="mt-0.5 block line-clamp-2 text-footnote text-fg-secondary">{detail}</span>
            ) : isBeverage ? (
              <span className="mt-0.5 block text-footnote text-fg-secondary">{formatWater(waterMl(entry))}</span>
            ) : null}
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-caption text-fg-tertiary">{format(time, 'h:mm a')}</span>
              {macros.kcal !== null && macros.kcal > 0 && <MetricPill tone="orange">{Math.round(macros.kcal)} kcal</MetricPill>}
              {macros.protein !== null && macros.protein > 0 && <MetricPill tone="pink">P {Math.round(macros.protein)}g</MetricPill>}
              {macros.carbs !== null && macros.carbs > 0 && <MetricPill tone="yellow">C {Math.round(macros.carbs)}g</MetricPill>}
              {macros.fat !== null && macros.fat > 0 && <MetricPill tone="cyan">F {Math.round(macros.fat)}g</MetricPill>}
            </span>
          </span>
        </button>
      </NutritionDetailDialog>
      <DeleteButton label={title} onConfirm={onDelete} />
    </article>
  );
}

// ---------------------------------------------------------- water day card

export function WaterDayCard({
  entries,
  totalMl,
  expanded,
  onToggle,
  onDelete,
}: {
  entries: FeedEntry[];
  totalMl: number;
  expanded: boolean;
  onToggle: () => void;
  onDelete: (e: FeedEntry) => void;
}) {
  const logs = `${entries.length} ${entries.length === 1 ? 'log' : 'logs'}`;
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.05]" data-testid="water-day-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`Water, ${formatWater(totalMl)}, ${logs}`}
        className="flex w-full items-center gap-3.5 p-3.5 text-left"
      >
        <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-brand-cyan/15 text-brand-cyan">
          <Droplet className="h-6 w-6 fill-current" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-headline text-white">Water</span>
          <span className="block text-subhead">
            <span className="font-semibold tabular-nums text-brand-cyan">{formatWater(totalMl)}</span>
            <span className="text-fg-secondary"> · {logs}</span>
          </span>
        </span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-fg-tertiary transition-transform duration-200', expanded && 'rotate-180')}
          aria-hidden
        />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="divide-y divide-white/[0.06] pb-1.5"
          >
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2 pl-3.5 pr-2" data-testid="water-log-row">
                <span className="text-subhead tabular-nums text-fg-secondary">{format(entryTime(e), 'h:mm a')}</span>
                <span className="flex-1" />
                <span className="text-subhead font-semibold tabular-nums text-white">{formatWater(waterMl(e))}</span>
                <DeleteButton label="water log" onConfirm={() => onDelete(e)} alwaysVisible />
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function DeleteButton({ label, onConfirm, alwaysVisible = false }: { label: string; onConfirm: () => void; alwaysVisible?: boolean }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          aria-label={`Delete ${label}`}
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-full text-fg-tertiary transition hover:bg-brand-red/10 hover:text-brand-red',
            !alwaysVisible && 'md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100'
          )}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete entry?</AlertDialogTitle>
          <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
