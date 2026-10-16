'use client';

import { ChevronLeft, Search, Share } from 'lucide-react';

import { CampaignCalendar } from '@/components/campaigns/CampaignCalendar';
import { CampaignBanner, CampaignHomeCard } from '@/components/campaigns/CampaignCards';
import { shortDate } from '@/lib/campaigns/campaign-utils';
import type { AppStoreBadge, CampaignAppStore, CampaignEmail, CampaignView } from '@/lib/campaigns/types';
import { cn } from '@/lib/utils';

export const BADGE_LABELS: Record<AppStoreBadge, string> = {
  CHALLENGE: 'Challenge',
  COMPETITION: 'Competition',
  LIVE_EVENT: 'Live Event',
  MAJOR_UPDATE: 'Major Update',
  NEW_SEASON: 'New Season',
  PREMIERE: 'Premiere',
  SPECIAL_EVENT: 'Special Event',
};

export function MockLabel({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <p className="mb-2 flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
      <span>{children}</span>
      {note && <span className="normal-case tracking-normal text-slate-500">{note}</span>}
    </p>
  );
}

/** A phone outline with a status bar; content scrolls inside. */
export function PhoneFrame({ children, className, height = 640, light }: { children: React.ReactNode; className?: string; height?: number; light?: boolean }) {
  return (
    <div className={cn('mx-auto w-full max-w-[320px] rounded-[44px] border border-slate-700 bg-slate-950 p-2.5 shadow-2xl shadow-black/50', className)}>
      <div className={cn('relative overflow-hidden rounded-[36px]', light ? 'bg-white' : 'bg-slate-950')} style={{ height }}>
        <div className={cn('flex h-9 items-center justify-between px-6 pt-1 text-[11px] font-semibold', light ? 'text-black' : 'text-white')}>
          <span>9:41</span>
          <span className="absolute left-1/2 top-2 h-6 w-24 -translate-x-1/2 rounded-full bg-black" />
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-[2px] border border-current" />
          </span>
        </div>
        <div className="h-[calc(100%-2.25rem)] overflow-y-auto overscroll-contain [scrollbar-width:none]">{children}</div>
      </div>
    </div>
  );
}

function AppRow({ light }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.png" alt="" className="h-11 w-11 rounded-[10px] ring-1 ring-black/10" />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-semibold', light ? 'text-black' : 'text-white')}>FitCircle</p>
        <p className={cn('truncate text-xs', light ? 'text-neutral-500' : 'text-white/70')}>Fitness & Nutrition</p>
      </div>
      <span className={cn('rounded-full px-4 py-1 text-sm font-bold', light ? 'bg-neutral-100 text-blue-600' : 'bg-white/25 text-white')}>Get</span>
    </div>
  );
}

/** App Store "Today"/search card for an In-App Event: art, badge, name, short description + app row. */
export function AppStoreCardMock({ art, appStore, view }: { art: string | null; appStore: CampaignAppStore; view: CampaignView }) {
  const badge = appStore.badge ? BADGE_LABELS[appStore.badge] : 'Event';
  const happening = view.phase === 'live' ? 'Happening now' : view.phase === 'teaser' ? `Starts ${shortDate(view.startsAt)}` : 'Ended';
  return (
    <div className="mx-auto w-full max-w-[360px] rounded-3xl bg-white p-3 shadow-xl">
      <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{happening}</p>
      <div className="relative aspect-[16/9] overflow-hidden rounded-2xl bg-slate-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {art && <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-10">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/80">{badge}</p>
          <p className="text-lg font-bold leading-tight text-white">{appStore.name || view.title}</p>
          <p className="text-xs text-white/85">{appStore.shortDescription || view.tagline}</p>
        </div>
      </div>
      <div className="px-1 pt-3">
        <AppRow light />
      </div>
    </div>
  );
}

/** App Store event details page. */
export function AppStoreDetailsMock({ art, appStore, view }: { art: string | null; appStore: CampaignAppStore; view: CampaignView }) {
  const badge = appStore.badge ? BADGE_LABELS[appStore.badge] : 'Event';
  return (
    <PhoneFrame height={600}>
      <div className="relative min-h-full bg-black">
        <div className="relative aspect-[9/16] w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {art && <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          <div className="absolute left-3 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white">
            <ChevronLeft className="h-4 w-4" />
          </div>
          <div className="absolute right-3 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white">
            <Share className="h-3.5 w-3.5" />
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-4 pt-24">
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/75">{badge}</p>
            <p className="text-2xl font-bold leading-tight text-white">{appStore.name || view.title}</p>
            <p className="mt-1 text-sm text-white/85">{appStore.shortDescription || view.tagline}</p>
            <div className="mt-4">
              <AppRow />
            </div>
          </div>
        </div>
        <div className="space-y-3 p-4 text-white">
          <p className="text-sm leading-relaxed text-white/85">{appStore.longDescription || view.description}</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-white/10 p-2.5">
              <p className="text-white/60">Starts</p>
              <p className="font-semibold">{shortDate(view.startsAt)}</p>
            </div>
            <div className="rounded-xl bg-white/10 p-2.5">
              <p className="text-white/60">Ends</p>
              <p className="font-semibold">{shortDate(view.endsAt)}</p>
            </div>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

function AppChrome({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-3 pb-6">
      <div className="flex items-center justify-between py-2">
        <p className="text-lg font-bold text-white">{title}</p>
        <span className="h-7 w-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600" />
      </div>
      {children}
    </div>
  );
}

function Skeleton({ h = 'h-20' }: { h?: string }) {
  return <div className={cn('rounded-2xl border border-white/5 bg-white/[0.04]', h)} />;
}

export function HomeMock({ view }: { view: CampaignView }) {
  return (
    <PhoneFrame>
      <AppChrome title="Today">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Skeleton h="h-16" />
            <Skeleton h="h-16" />
            <Skeleton h="h-16" />
          </div>
          <CampaignHomeCard view={view} inert />
          <Skeleton h="h-24" />
          <Skeleton h="h-32" />
        </div>
      </AppChrome>
    </PhoneFrame>
  );
}

export function CirclesMock({ view }: { view: CampaignView }) {
  return (
    <PhoneFrame height={420}>
      <AppChrome title="Circles">
        <div className="space-y-3">
          <CampaignBanner view={view} inert />
          <Skeleton h="h-24" />
          <Skeleton h="h-24" />
        </div>
      </AppChrome>
    </PhoneFrame>
  );
}

export function CalendarMock({ view }: { view: CampaignView }) {
  return (
    <PhoneFrame height={680}>
      <div className="min-h-full bg-slate-950 px-3 pb-6">
        <div className="flex items-center gap-1 py-2 text-sm text-slate-300">
          <ChevronLeft className="h-4 w-4" /> Home
        </div>
        <CampaignCalendar view={view} inert compact />
      </div>
    </PhoneFrame>
  );
}

/** iOS lock-screen style push banner. */
export function PushBannerMock({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto w-full max-w-[360px] rounded-[28px] bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 p-4">
      <div className="rounded-2xl bg-white/20 p-3 backdrop-blur-xl">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" className="h-9 w-9 rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-semibold text-white">{title || 'Title'}</p>
              <span className="text-[11px] text-white/60">now</span>
            </div>
            <p className="text-[13px] leading-snug text-white/90">{body || 'Body'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function EmailPreviewMock({ email, view, headerArt, render }: { email: CampaignEmail; view: CampaignView; headerArt: string | null; render: (s: string) => string }) {
  const paragraphs = render(email.body || '').split(/\n\s*\n/).filter(Boolean);
  return (
    <div className="mx-auto w-full max-w-[560px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-100">
      <div className="flex items-center gap-2 border-b border-slate-300 bg-white px-4 py-2.5">
        <Search className="h-3.5 w-3.5 text-slate-400" />
        <div className="min-w-0 flex-1 text-xs">
          <p className="truncate">
            <span className="font-semibold text-slate-900">FitCircle</span> <span className="text-slate-400">&lt;team@fitcircle.ai&gt;</span>
          </p>
          <p className="truncate">
            <span className="font-semibold text-slate-900">{render(email.subject) || 'Subject'}</span>
            <span className="text-slate-500"> · {render(email.preheader)}</span>
          </p>
        </div>
      </div>
      <div className="bg-[#0b0f1f] p-4 sm:p-6">
        <div className="mx-auto max-w-[480px] overflow-hidden rounded-2xl bg-[#111830]">
          <div className="h-1.5 bg-gradient-to-r from-purple-500 via-fuchsia-500 to-pink-500" />
          {headerArt && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={headerArt} alt="" className="block aspect-[5/2] w-full object-cover" />
          )}
          <div className="space-y-3 p-5">
            <p className="text-xl font-bold text-white">{render(email.heading) || view.title}</p>
            {paragraphs.map((p, i) => (
              <p key={i} className="whitespace-pre-line text-sm leading-relaxed text-slate-300">
                {p}
              </p>
            ))}
            <span className="inline-block rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 px-5 py-2.5 text-sm font-semibold text-white">
              {email.ctaLabel || view.ctaLabel}
            </span>
            <p className="pt-2 text-[11px] text-slate-500">
              fitcircle.ai/c/{view.slug} · <span className="underline">Unsubscribe</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
