'use client';

/**
 * Standalone Challenges library — web port of iOS `ChallengeLibraryView`.
 * Browse challenge templates by category, search, and start a challenge in
 * an existing circle.
 */

import { motion } from 'framer-motion';
import {
  Search, Filter, Dumbbell, Heart, Activity, Sparkles, Salad, Loader2, Plus,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Navbar } from '@/components/layout/navbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuthStore } from '@/stores/auth-store';

interface Template {
  id: string;
  name: string;
  description: string | null;
  category: string;
  challenge_category: string;
  goal_amount: number;
  unit: string;
  duration_days: number;
  difficulty: string | null;
  icon_name: string | null;
  completions_count: number;
}

const CATEGORIES: { value: string; label: string; icon: React.ComponentType<any>; color: string }[] = [
  { value: 'all',         label: 'All',         icon: Sparkles, color: 'text-purple-400' },
  { value: 'strength',    label: 'Strength',    icon: Dumbbell, color: 'text-red-400' },
  { value: 'cardio',      label: 'Cardio',      icon: Activity, color: 'text-orange-400' },
  { value: 'flexibility', label: 'Flexibility', icon: Heart,    color: 'text-cyan-400' },
  { value: 'wellness',    label: 'Wellness',    icon: Salad,    color: 'text-emerald-400' },
];

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

export default function ChallengesLibraryPage() {
  const { isAuthenticated } = useAuthStore();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [category, setCategory] = useState<string>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await authedFetch<{ data: Template[] }>('/api/mobile/challenges/templates');
      setTemplates(res.data ?? []);
    } catch (e) {
      console.warn('[challenges] load failed', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      const matchesCategory = category === 'all' || t.category === category;
      const matchesQuery =
        !q ||
        t.name.toLowerCase().includes(q) ||
        (t.description?.toLowerCase().includes(q) ?? false);
      return matchesCategory && matchesQuery;
    });
  }, [templates, category, query]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Sign in to browse challenges.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <Navbar />
      <main className="mx-auto max-w-4xl px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Challenge Library</h1>
            <p className="text-sm text-muted-foreground">Find a challenge for your next FitCircle.</p>
          </div>
          <Link href="/fitcircles">
            <Button variant="secondary">My Circles</Button>
          </Link>
        </div>

        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search challenges..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {CATEGORIES.map(c => {
            const active = category === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors
                  ${active ? 'bg-purple-500 text-white' : 'bg-zinc-800 text-muted-foreground hover:text-foreground'}`}
              >
                <c.icon className={`h-3.5 w-3.5 ${active ? '' : c.color}`} />
                {c.label}
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <Card><CardContent className="p-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center space-y-2">
              <Filter className="mx-auto h-10 w-10 text-muted-foreground" />
              <p className="font-semibold">No challenges match</p>
              <p className="text-sm text-muted-foreground">Try a different search term or category.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => <TemplateCard key={t.id} template={t} />)}
          </div>
        )}
      </main>
    </div>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const meta = CATEGORIES.find(c => c.value === template.category) ?? CATEGORIES[0];
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="h-full">
        <CardContent className="p-4 space-y-3 h-full flex flex-col">
          <div className="flex items-start justify-between">
            <div className={`h-10 w-10 rounded-lg bg-zinc-800 flex items-center justify-center ${meta.color}`}>
              <meta.icon className="h-5 w-5" />
            </div>
            {template.difficulty && (
              <span className="text-[10px] uppercase tracking-wide bg-zinc-800 rounded-full px-2 py-0.5 text-muted-foreground">
                {template.difficulty}
              </span>
            )}
          </div>
          <div className="flex-1">
            <h3 className="font-semibold leading-tight">{template.name}</h3>
            {template.description && (
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{template.description}</p>
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{template.goal_amount} {template.unit}</span>
            <span>{template.duration_days} days</span>
          </div>
          <Link href={`/fitcircles?template=${template.id}`} className="block">
            <Button size="sm" className="w-full bg-purple-500 hover:bg-purple-600">
              <Plus className="h-3 w-3 mr-1" /> Start in a Circle
            </Button>
          </Link>
        </CardContent>
      </Card>
    </motion.div>
  );
}
