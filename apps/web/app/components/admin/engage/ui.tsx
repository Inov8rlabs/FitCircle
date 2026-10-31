'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Apple, Globe, Smartphone, X } from 'lucide-react';

import { PLATFORM_LABEL, PLATFORMS } from '@/lib/engage/preview/content';
import type { EngageChannel, EngagePlatform } from '@/lib/engage/types';
import { cn } from '@/lib/utils';

export { Btn, Callout, Field, SelectField, StatusPill, TextAreaField, TextField, Toggle, inputCls, textLength } from '../campaigns/fields';

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-purple-300">{eyebrow}</p>}
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-white">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, padded = true }: { children: React.ReactNode; className?: string; padded?: boolean }) {
  return <div className={cn('rounded-2xl border border-slate-800 bg-slate-900/50', padded && 'p-4 sm:p-5', className)}>{children}</div>;
}

export function Kpi({ label, value, sub, tone, spark }: { label: string; value: string; sub?: React.ReactNode; tone?: 'up' | 'down' | 'neutral'; spark?: number[] }) {
  return (
    <Card className="relative overflow-hidden">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-white">{value}</p>
      {sub && <p className={cn('mt-0.5 text-xs', tone === 'up' ? 'text-emerald-400' : tone === 'down' ? 'text-rose-400' : 'text-slate-500')}>{sub}</p>}
      {spark && spark.length > 1 && <Sparkline data={spark} className="absolute bottom-3 right-4 h-8 w-24 opacity-80" />}
    </Card>
  );
}

export function Sparkline({ data, className, color = '#a78bfa' }: { data: number[]; className?: string; color?: string }) {
  const w = 100;
  const h = 28;
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden>
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill={`${color}22`} stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 px-6 py-14 text-center">
      {icon && <div className="mb-3 text-slate-500">{icon}</div>}
      <p className="font-semibold text-white">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-slate-400">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-slate-700 bg-slate-800/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{children}</kbd>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-slate-800/60', className)} />;
}

export function Drawer({ open, onOpenChange, title, children, width = 'max-w-xl' }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: React.ReactNode; width?: string }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className={cn('fixed inset-y-0 right-0 z-[81] flex w-full flex-col border-l border-slate-800 bg-slate-950 shadow-2xl focus:outline-none', width)}>
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 px-5">
            <DialogPrimitive.Title className="truncate text-base font-semibold text-white">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close">
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Modal({ open, onOpenChange, title, children, width = 'max-w-3xl' }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: React.ReactNode; width?: string }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className={cn('fixed left-1/2 top-[8vh] z-[81] flex max-h-[84vh] w-[calc(100%-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl focus:outline-none', width)}>
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-800 px-5">
            <DialogPrimitive.Title className="text-base font-semibold text-white">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close">
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function SegmentedControl<T extends string>({ value, onChange, options, size = 'md', className }: { value: T; onChange: (v: T) => void; options: readonly { value: T; label: React.ReactNode; title?: string }[]; size?: 'sm' | 'md'; className?: string }) {
  return (
    <div className={cn('inline-flex rounded-lg bg-slate-950/70 p-0.5 ring-1 ring-slate-800', className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn('inline-flex items-center gap-1.5 rounded-md font-medium transition', size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs', value === o.value ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-white')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PlatformIcon({ p, className = 'h-3.5 w-3.5' }: { p: EngagePlatform; className?: string }) {
  if (p === 'ios') return <Apple className={className} />;
  if (p === 'android') return <Smartphone className={className} />;
  return <Globe className={className} />;
}

/** Multi-select platform chips; empty = all. */
export function PlatformSelector({ value, onChange, disabled, size = 'md', exclude = [] }: { value: EngagePlatform[]; onChange: (v: EngagePlatform[]) => void; disabled?: EngagePlatform[]; size?: 'sm' | 'md'; exclude?: EngagePlatform[] }) {
  const all = value.length === 0;
  const toggle = (p: EngagePlatform) => {
    const cur = all ? [...PLATFORMS] : value;
    const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
    onChange(next.length === PLATFORMS.length ? [] : next.length === 0 ? [p] : PLATFORMS.filter((x) => next.includes(x)));
  };
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5" role="group" aria-label="Platforms">
      {PLATFORMS.filter((p) => !exclude.includes(p)).map((p) => {
        const on = all || value.includes(p);
        const off = disabled?.includes(p);
        return (
          <button
            key={p}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(p)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border font-medium transition',
              size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs',
              on ? (off ? 'border-amber-500/40 bg-amber-500/10 text-amber-200 line-through decoration-amber-400/60' : 'border-purple-400/60 bg-purple-500/15 text-white') : 'border-slate-700 text-slate-500 hover:border-slate-500'
            )}
          >
            <PlatformIcon p={p} className="h-3 w-3" />
            {PLATFORM_LABEL[p]}
          </button>
        );
      })}
      <span className="text-[11px] text-slate-500">{all ? 'All platforms' : ''}</span>
    </div>
  );
}

export const CHANNEL_COLOR: Record<EngageChannel, string> = {
  content_card: 'text-sky-300 bg-sky-500/10',
  in_app: 'text-fuchsia-300 bg-fuchsia-500/10',
  push: 'text-amber-300 bg-amber-500/10',
  email: 'text-emerald-300 bg-emerald-500/10',
};

export const pct = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`);
export const num = (v: number | null | undefined) => (v == null ? '—' : v >= 10_000 ? `${(v / 1000).toFixed(v >= 100_000 ? 0 : 1)}k` : v.toLocaleString());
