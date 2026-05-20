'use client';

/**
 * Beverage log page — web port of iOS `BeverageLogView`. Standalone page
 * (separate from FoodLog) with quick-add modal, recent entries, and stats.
 */

import { motion } from 'framer-motion';
import {
  Coffee, Droplet, GlassWater, Milk, Wine, Loader2, Plus, Trash2, Zap, Cookie, FlaskConical,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Navbar } from '@/components/layout/navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuthStore } from '@/stores/auth-store';
import type {
  BeverageCategory, BeverageLogEntry, CreateBeverageLogInput,
} from '@/lib/types/beverage-log';

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
      await authedFetch<{ data: BeverageLogEntry }>('/api/mobile/beverages', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      toast.success('Logged!');
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Sign in to view your beverages.</p>
      </div>
    );
  }

  const totalMl = entries
    .filter(e => e.entry_date === new Date().toISOString().split('T')[0])
    .reduce((sum, e) => sum + e.volume_ml, 0);

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Beverages</h1>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="bg-cyan-500 hover:bg-cyan-600 gap-1">
                <Plus className="h-4 w-4" /> Log drink
              </Button>
            </DialogTrigger>
            <BeverageAddDialog onAdd={handleAdd} onClose={() => setAddOpen(false)} />
          </Dialog>
        </div>

        {/* Quick-add row */}
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wide">Quick add</p>
            <div className="grid grid-cols-6 gap-2">
              {CATEGORIES.slice(0, 6).map(cat => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => handleAdd({
                    category: cat.value,
                    beverage_type: cat.label,
                    volume_ml: cat.defaultMl,
                  })}
                  className="rounded-xl bg-zinc-800/50 hover:bg-zinc-800 p-3 text-center transition-colors"
                  aria-label={`Quick log ${cat.label}`}
                >
                  <cat.icon className={`h-5 w-5 mx-auto ${cat.color}`} />
                  <p className="text-[10px] mt-1 truncate">{cat.label}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Today's total */}
        <Card>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-cyan-500/15 flex items-center justify-center">
              <Droplet className="h-6 w-6 text-cyan-400" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">Today</p>
              <p className="text-2xl font-bold">{(totalMl / 1000).toFixed(1)}L</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {entries.filter(e => e.entry_date === new Date().toISOString().split('T')[0]).length} drinks
            </p>
          </CardContent>
        </Card>

        {/* Entries */}
        {isLoading ? (
          <Card><CardContent className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
        ) : entries.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground space-y-2">
              <GlassWater className="mx-auto h-12 w-12" />
              <p className="font-semibold">No entries yet</p>
              <p className="text-sm">Tap a quick-add button above to log your first drink.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {entries.map(entry => <BeverageRow key={entry.id} entry={entry} onDelete={() => handleDelete(entry.id)} />)}
          </div>
        )}
      </main>
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
    >
      <Card>
        <CardContent className="p-3 flex items-center gap-3">
          <div className={`h-10 w-10 rounded-full bg-zinc-800 flex items-center justify-center`}>
            <Icon className={`h-5 w-5 ${cat.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{entry.beverage_type}</p>
            <p className="text-xs text-muted-foreground">
              {entry.volume_ml} ml
              {entry.calories ? ` · ${entry.calories} cal` : ''}
              {entry.caffeine_mg ? ` · ${entry.caffeine_mg}mg caf` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive p-1"
            aria-label="Delete entry"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </CardContent>
      </Card>
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
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Log a drink</DialogTitle>
      </DialogHeader>
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
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={submitting} className="bg-cyan-500 hover:bg-cyan-600">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Log'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
