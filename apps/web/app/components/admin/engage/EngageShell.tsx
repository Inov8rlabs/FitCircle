'use client';

import {
  ArrowLeft,
  Bell,
  CalendarRange,
  ChevronDown,
  CircleDot,
  Command,
  Image as ImageIcon,
  LayoutDashboard,
  LayoutTemplate,
  Mail,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { campaignsAdmin } from '@/lib/campaigns/admin-client';
import type { AdminCampaign } from '@/lib/campaigns/types';
import { engageAdmin } from '@/lib/engage/client/admin-client';
import { CHANNEL_LABEL } from '@/lib/engage/preview/content';
import type { EngageChannel, EngageMessage, EngageSegment } from '@/lib/engage/types';
import { cn } from '@/lib/utils';

import { Kbd } from './ui';

const CHANNEL_ICON: Record<EngageChannel, typeof Bell> = {
  content_card: LayoutTemplate,
  in_app: MessageSquare,
  push: Bell,
  email: Mail,
};

const CHANNELS: EngageChannel[] = ['content_card', 'in_app', 'push', 'email'];

/** The Engage tool chrome: left nav, top bar search + "New message", keyboard shortcuts. */
export function EngageShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ShellInner>{children}</ShellInner>
    </Suspense>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/admin';
  const search = useSearchParams();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const gPressed = useRef<number>(0);

  // Keyboard: ⌘K / "/" search · "n" new message · "g" then o/c/m/s/a navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === 'n') {
        e.preventDefault();
        setNewOpen(true);
      } else if (e.key === 'g') {
        gPressed.current = Date.now();
      } else if (Date.now() - gPressed.current < 900) {
        const to: Record<string, string> = { o: '/admin', c: '/admin/campaigns', m: '/admin/messages', s: '/admin/segments', a: '/admin/assets' };
        if (to[e.key]) {
          e.preventDefault();
          router.push(to[e.key]);
        }
        gPressed.current = 0;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  useEffect(() => setMobileNav(false), [pathname]);

  const channel = search?.get('channel');
  const isActive = (href: string, exact = false) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  const nav = (
    <nav className="flex h-full flex-col gap-1 p-3 text-sm" aria-label="Engage">
      <Link href="/admin" className="mb-3 flex items-center gap-2.5 px-2 py-1.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 via-fuchsia-500 to-orange-400 shadow-lg shadow-purple-900/40">
          <CircleDot className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-bold text-white">FitCircle Engage</span>
          <span className="block text-[10px] uppercase tracking-wider text-slate-500">Admin</span>
        </span>
      </Link>
      <NavItem href="/admin" icon={LayoutDashboard} label="Overview" active={isActive('/admin', true)} hint="g o" />
      <NavItem href="/admin/campaigns" icon={CalendarRange} label="Campaigns" active={isActive('/admin/campaigns')} hint="g c" />
      <NavItem href="/admin/messages" icon={MessageSquare} label="Messages" active={isActive('/admin/messages') && !channel} hint="g m" />
      <div className="ml-4 flex flex-col gap-0.5 border-l border-slate-800 pl-2">
        {CHANNELS.map((c) => (
          <NavItem key={c} href={`/admin/messages?channel=${c}`} icon={CHANNEL_ICON[c]} label={`${CHANNEL_LABEL[c]}${c === 'content_card' ? 's' : ''}`} active={pathname === '/admin/messages' && channel === c} small />
        ))}
      </div>
      <NavItem href="/admin/segments" icon={Users} label="Segments" active={isActive('/admin/segments')} hint="g s" />
      <NavItem href="/admin/assets" icon={ImageIcon} label="Assets" active={isActive('/admin/assets')} hint="g a" />
      <div className="mt-auto space-y-2 border-t border-slate-800 pt-3">
        <Link href="/dashboard" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-400 hover:bg-slate-800/60 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to FitCircle
        </Link>
        <p className="px-2.5 text-[10px] text-slate-600">
          <Kbd>⌘K</Kbd> search · <Kbd>N</Kbd> new · <Kbd>G</Kbd> go
        </p>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-[#070a17] text-slate-200">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-slate-800/80 bg-slate-950/90 backdrop-blur-xl lg:block">{nav}</aside>
      {mobileNav && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileNav(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-slate-800 bg-slate-950">{nav}</aside>
        </div>
      )}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-800/80 bg-[#070a17]/85 px-4 backdrop-blur-xl sm:px-6">
          <button type="button" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 lg:hidden" onClick={() => setMobileNav(true)} aria-label="Menu">
            <Menu className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 text-left text-sm text-slate-500 transition hover:border-slate-700"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 truncate">Search messages, campaigns, segments…</span>
            <span className="hidden items-center gap-0.5 sm:flex">
              <Kbd>
                <Command className="inline h-2.5 w-2.5" />K
              </Kbd>
            </span>
          </button>
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setNewOpen((o) => !o)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-fuchsia-600 px-3.5 text-sm font-medium text-white shadow-lg shadow-purple-900/30 hover:brightness-110"
            >
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New message</span> <ChevronDown className="h-3.5 w-3.5 opacity-70" />
            </button>
            {newOpen && <NewMessageMenu onClose={() => setNewOpen(false)} />}
          </div>
        </header>
        <main className="mx-auto max-w-[1500px] px-4 pb-16 sm:px-6">{children}</main>
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

function NavItem({ href, icon: Icon, label, active, hint, small }: { href: string; icon: typeof Bell; label: string; active: boolean; hint?: string; small?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-2.5 rounded-lg px-2.5 transition',
        small ? 'py-1.5 text-[13px]' : 'py-2',
        active ? 'bg-purple-500/15 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-white'
      )}
      aria-current={active ? 'page' : undefined}
    >
      <Icon className={cn(small ? 'h-3.5 w-3.5' : 'h-4 w-4', active ? 'text-purple-300' : '')} />
      <span className="flex-1">{label}</span>
      {hint && <span className="hidden font-mono text-[10px] text-slate-600 group-hover:inline">{hint}</span>}
    </Link>
  );
}

function NewMessageMenu({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      const i = ['1', '2', '3', '4'].indexOf(e.key);
      if (i >= 0) {
        e.preventDefault();
        onClose();
        router.push(`/admin/messages/new?channel=${CHANNELS[i]}`);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, router]);
  const items: { c: EngageChannel; d: string }[] = [
    { c: 'content_card', d: 'Cards in Home, Circles, Profile, check-in' },
    { c: 'in_app', d: 'Modal, slide-up or full screen on an event' },
    { c: 'push', d: 'iOS + Android notifications' },
    { c: 'email', d: 'Branded email to opted-in users' },
  ];
  return (
    <div ref={ref} className="absolute right-0 top-11 z-50 w-72 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 p-1.5 shadow-2xl">
      {items.map(({ c, d }, i) => {
        const Icon = CHANNEL_ICON[c];
        return (
          <Link key={c} href={`/admin/messages/new?channel=${c}`} onClick={onClose} className="flex items-start gap-3 rounded-lg p-2.5 hover:bg-slate-800/70">
            <Icon className="mt-0.5 h-4 w-4 text-purple-300" />
            <span className="flex-1">
              <span className="block text-sm font-medium text-white">{CHANNEL_LABEL[c]}</span>
              <span className="block text-xs text-slate-500">{d}</span>
            </span>
            <Kbd>{i + 1}</Kbd>
          </Link>
        );
      })}
      <div className="my-1 border-t border-slate-800" />
      <Link href="/admin/campaigns/new" onClick={onClose} className="flex items-center gap-3 rounded-lg p-2.5 text-sm text-slate-300 hover:bg-slate-800/70">
        <CalendarRange className="h-4 w-4 text-orange-300" /> New campaign
      </Link>
    </div>
  );
}

interface PaletteItem {
  id: string;
  label: string;
  sub: string;
  href: string;
  group: string;
}

let paletteCache: PaletteItem[] | null = null;

function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PaletteItem[]>(paletteCache ?? []);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (paletteCache) return;
    void Promise.allSettled([engageAdmin.listMessages(), campaignsAdmin.list(), engageAdmin.listSegments()]).then(([m, c, s]) => {
      const out: PaletteItem[] = [];
      if (m.status === 'fulfilled') out.push(...(m.value as EngageMessage[]).map((x) => ({ id: x.id, label: x.name || 'Untitled', sub: `${CHANNEL_LABEL[x.channel]} · ${x.status}`, href: `/admin/messages/${x.id}`, group: 'Messages' })));
      if (c.status === 'fulfilled') out.push(...(c.value).map((x) => ({ id: x.id, label: `${x.title} ${x.emoji}`, sub: `Campaign · ${x.status}`, href: `/admin/campaigns/${x.id}`, group: 'Campaigns' })));
      if (s.status === 'fulfilled') out.push(...(s.value).map((x) => ({ id: x.id, label: x.name, sub: 'Segment', href: `/admin/segments/${x.id}`, group: 'Segments' })));
      paletteCache = out;
      setItems(out);
    });
  }, []);

  const pages: PaletteItem[] = useMemo(
    () => [
      { id: 'p-o', label: 'Overview', sub: 'Go to', href: '/admin', group: 'Go to' },
      { id: 'p-c', label: 'Campaigns', sub: 'Go to', href: '/admin/campaigns', group: 'Go to' },
      { id: 'p-m', label: 'Messages', sub: 'Go to', href: '/admin/messages', group: 'Go to' },
      { id: 'p-s', label: 'Segments', sub: 'Go to', href: '/admin/segments', group: 'Go to' },
      { id: 'p-a', label: 'Assets', sub: 'Go to', href: '/admin/assets', group: 'Go to' },
      ...CHANNELS.map((c) => ({ id: `n-${c}`, label: `New ${CHANNEL_LABEL[c]}`, sub: 'Create', href: `/admin/messages/new?channel=${c}`, group: 'Create' })),
    ],
    []
  );

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = [...pages, ...items];
    return (needle ? all.filter((i) => `${i.label} ${i.sub}`.toLowerCase().includes(needle)) : all).slice(0, 40);
  }, [q, items, pages]);

  useEffect(() => setSel(0), [q]);

  const go = useCallback(
    (i: PaletteItem | undefined) => {
      if (!i) return;
      onClose();
      router.push(i.href);
    },
    [onClose, router]
  );

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 p-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
        <div className="flex items-center gap-2 border-b border-slate-800 px-4">
          <Search className="h-4 w-4 text-slate-500" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((s) => Math.min(results.length - 1, s + 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              }
              if (e.key === 'Enter') go(results[sel]);
            }}
            placeholder="Search or jump to…"
            className="h-12 flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && <li className="p-6 text-center text-sm text-slate-500">No matches</li>}
          {results.map((r, i) => (
            <li key={`${r.group}-${r.id}`}>
              <button
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={() => go(r)}
                className={cn('flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left', i === sel ? 'bg-purple-500/15' : '')}
              >
                <span className="min-w-0 truncate text-sm text-white">{r.label}</span>
                <span className="shrink-0 text-xs text-slate-500">{r.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
