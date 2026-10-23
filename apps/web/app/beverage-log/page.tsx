'use client';

/**
 * Beverage log page — web port of iOS `BeverageLogView`. Standalone page
 * (separate from FoodLog) with quick-add modal, recent entries, and stats.
 */

import { motion } from 'framer-motion';
import {
  Coffee, Droplet, GlassWater, Milk, Wine, Loader2, Plus, Trash2, Zap, Cookie, FlaskConical,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { dayKeyToDate, formatWater } from '@/components/food-log/feed-model';
import { Navbar } from '@/components/layout/navbar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { DayHeader, Fab, GlassCard, Screen, ScreenHeader } from '@/components/ui/ios';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { announceStreakAutoClaim, clientTimezone, extractStreakMeta } from '@/lib/streaks/auto-claim-events';
import type {
  BeverageCategory, BeverageLogEntry, CreateBeverageLogInput,
} from '@/lib/types/beverage-log';
import { useAuthStore } from '@/stores/auth-store';

// ─── Beverage metadata ──────────────────────────────────────────────────────

const CATEGORIES: { value: BeverageCategory; label: string; icon: React.ComponentType<any>; color: string; defaultMl: number }[] = [
  { value: 'water',         label: 'Water',         icon: GlassWater,    color: 'text-cyan-400',    defaultMl: 250 },
  { value: 'coffee',        label: 'Coffee',        icon: Coffee,         color: 'text-amber-700',   defaultMl: 240 },
  { value: 'tea',           label: 'Tea',           icon: Coffee,         color: 'text-emerald-400', defaultMl: 240 },
  { value: 'smoothie',      label: 'Smoothie',      icon: FlaskConical,   color: 'text-pink-400',    defaultMl: 350 },
  { value: 'protein_shake', label: 'Protein',       icon: FlaskConical,   color: 'text-purple-400',  defaultMl: 400 },
  { value: 'juice',         label: 'Juice',         icon: GlassWater,     color: 'text-orange-400',  defaultMl: 250 },
  { value: 'soda',          label: 'Soda',          icon: Cookie,         color: 'text-red-400',     defaultMl: 355 },
  { value: 'energy_drink',  label: 'Energy',        icon: Zap,            color: 'text-yellow-400',  defaultMl: 250 },
  { value: 'sports_drink',  label: 'Sports',        icon: Droplet,        color: 'text-blue-400',    defaultMl: 500 },
  { value: 'milk',          label: 'Milk',          icon: Milk,           color: 'text-zinc-100',    defaultMl: 240 },
  { value: 'alcohol',       label: 'Alcohol',       icon: Wine,           color: 'text-purple-300',  defaultMl: 150 },
  { value: 'other',         label: 'Other',         icon: GlassWater,     color: 'text-zinc-400',    defaultMl: 250 },
];

// ─── API client ─────────────────────────────────────────────────────────────

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.error ?? `Request failed (${res.status})`;
    throw new Error(typeof msg === 'string' ? msg : 'Request failed');
  }
  return json as T;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function BeverageLogPage() {
  const { isAuthenticated } = useAuthStore();
  const [entries, setEntries] = useState<BeverageLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await authedFetch<{ data: BeverageLogEntry[] }>('/api/mobile/beverages?limit=50');
      setEntries(res.data ?? []);
    } catch (e: any) {
      console.warn('[beverage-log] load failed', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleAdd = async (input: CreateBeverageLogInput) => {
    try {
      const env = await authedFetch<{ data: BeverageLogEntry; meta?: unknown }>('/api/mobile/beverages', {
        method: 'POST',
        body: JSON.stringify({ ...input, timezone: clientTimezone() }),
      });
      analytics.track(AnalyticsEvents.beverageLogged({ category: input.category }));
      toast.success('Logged!');
      // Server-side streak auto-claim for this drink → refresh streak UI + toast.
      announceStreakAutoClaim(extractStreakMeta(env));
      setAddOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not save');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this entry?')) return;
    try {
      await authedFetch(`/api/mobile/beverages/${id}`, { method: 'DELETE' });
      setEntries(prev => prev.filter(e => e.id !== id));
      toast.success('Removed');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not delete');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <p className="text-muted-foreground">Sign in to view your beverages.</p>
      </div>
    );
  }

  return <BeverageScreen entries={entries} isLoading={isLoading} addOpen={addOpen} setAddOpen={setAddOpen} onAdd={handleAdd} onDelete={handleDelete} />;
}

function localDayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function BeverageScreen({
  entries, isLoading, addOpen, setAddOpen, onAdd, onDelete,
}: {
  entries: BeverageLogEntry[];
  isLoading: boolean;
  addOpen: boolean;
  setAddOpen: (v: boolean) => void;
  onAdd: (input: CreateBeverageLogInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const todayKey = localDayKey(new Date());
  const today = entries.filter(e => e.entry_date === todayKey);
  const totalMl = today.reduce((sum, e) => sum + e.volume_ml, 0);
  const days = useMemo(() => {
    const map = new Map<string, BeverageLogEntry[]>();
    for (const e of entries) {
      const list = map.get(e.entry_date) ?? [];
      list.push(e);
      map.set(e.entry_date, list);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [entries]);

  return (
    <div className="min-h-screen bg-canvas">
      <Navbar />
      <Screen>
        <ScreenHeader title="Beverages" subtitle="Coffee, tea, water and everything in between." />

        {/* Today's total */}
        <GlassCard className="flex items-center gap-4" data-testid="beverage-today">
          <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-brand-cyan/15 text-brand-cyan">
            <Droplet className="h-6 w-6 fill-current" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-footnote font-semibold uppercase tracking-wide text-fg-secondary">Today</p>
            <p className="text-title2 font-bold tabular-nums text-white">{formatWater(totalMl)}</p>
          </div>
          <p className="text-subhead text-fg-secondary">
            {today.length} {today.length === 1 ? 'drink' : 'drinks'}
          </p>
        </GlassCard>

        {/* Quick-add tiles (iOS hydration chips) */}
        <section className="mt-5" aria-label="Quick add">
          <h2 className="mb-2 text-footnote font-semibold uppercase tracking-wide text-fg-tertiary">Quick add</h2>
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            {CATEGORIES.slice(0, 6).map(cat => (
              <button
                key={cat.value}
                type="button"
                onClick={() => onAdd({
                  category: cat.value,
                  beverage_type: cat.label,
                  volume_ml: cat.defaultMl,
                })}
                className="flex flex-col items-center gap-1 rounded-xl border border-glass bg-surface-raised/50 px-2 py-3 text-center transition duration-200 ease-ios hover:border-white/20 active:scale-[0.97]"
                aria-label={`Quick log ${cat.label}`}
              >
                <cat.icon className={`h-6 w-6 ${cat.color}`} aria-hidden />
                <span className="text-subhead font-semibold text-white">+{cat.defaultMl} ml</span>
                <span className="text-caption text-fg-secondary">{cat.label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Entries by day */}
        <div className="mt-6">
          {isLoading ? (
            <div className="space-y-3" aria-label="Loading">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-[68px] rounded-xl" />)}
            </div>
          ) : entries.length === 0 ? (
            <EmptyState
              icon={GlassWater}
              tone="cyan"
              title="No drinks yet"
              description="Tap a quick-add tile above to log your first drink."
              className="rounded-xl border border-dashed border-hairline"
            />
          ) : (
            days.map(([key, list]) => (
              <section key={key}>
                <DayHeader date={dayKeyToDate(key)} count={list.length} countIcon={GlassWater} />
                <ul className="space-y-2.5">
                  {list.map(entry => (
                    <li key={entry.id}>
                      <BeverageRow entry={entry} onDelete={() => onDelete(entry.id)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </Screen>

      <Fab icon={Plus} label="Log a drink" onClick={() => setAddOpen(true)} />
      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        {addOpen && <BeverageAddDialog onAdd={onAdd} onClose={() => setAddOpen(false)} />}
      </Sheet>
    </div>
  );
}

// ─── Components ─────────────────────────────────────────────────────────────

function BeverageRow({ entry, onDelete }: { entry: BeverageLogEntry; onDelete: () => void }) {
  const cat = CATEGORIES.find(c => c.value === entry.category) ?? CATEGORIES[CATEGORIES.length - 1];
  const Icon = cat.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-center gap-3 rounded-xl border border-glass bg-surface-raised/50 p-3"
      data-testid="beverage-row"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-white/5">
        <Icon className={`h-5 w-5 ${cat.color}`} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-headline text-white">{entry.beverage_type}</p>
        <p className="text-footnote text-fg-secondary">
          {entry.volume_ml} ml
          {entry.calories ? ` · ${entry.calories} cal` : ''}
          {entry.caffeine_mg ? ` · ${entry.caffeine_mg}mg caf` : ''}
        </p>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="flex h-8 w-8 items-center justify-center rounded-full text-fg-tertiary transition hover:bg-brand-red/10 hover:text-brand-red"
        aria-label="Delete entry"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

function BeverageAddDialog({
  onAdd, onClose,
}: { onAdd: (input: CreateBeverageLogInput) => Promise<void>; onClose: () => void }) {
  const [category, setCategory] = useState<BeverageCategory>('water');
  const [beverageType, setBeverageType] = useState('Water');
  const [volumeMl, setVolumeMl] = useState('250');
  const [caffeine, setCaffeine] = useState('');
  const [calories, setCalories] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      await onAdd({
        category,
        beverage_type: beverageType.trim() || category,
        volume_ml: Number(volumeMl) || 250,
        caffeine_mg: caffeine ? Number(caffeine) : undefined,
        calories: calories ? Number(calories) : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SheetContent data-testid="beverage-add-sheet">
      <SheetHeader>
        <SheetTitle>Log a drink</SheetTitle>
      </SheetHeader>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label>Category</Label>
          <Select value={category} onValueChange={(v) => {
            setCategory(v as BeverageCategory);
            const meta = CATEGORIES.find(c => c.value === v);
            if (meta) {
              setBeverageType(meta.label);
              setVolumeMl(String(meta.defaultMl));
            }
          }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Beverage</Label>
          <Input value={beverageType} onChange={(e) => setBeverageType(e.target.value)} placeholder="e.g. Latte, Iced tea" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label>ml</Label>
            <Input type="number" inputMode="numeric" value={volumeMl} onChange={(e) => setVolumeMl(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>cal</Label>
            <Input type="number" inputMode="numeric" placeholder="optional" value={calories} onChange={(e) => setCalories(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>caffeine</Label>
            <Input type="number" inputMode="numeric" placeholder="mg" value={caffeine} onChange={(e) => setCaffeine(e.target.value)} />
          </div>
        </div>
      </div>
      <SheetFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={submitting} className="min-w-24">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Log'}
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}
