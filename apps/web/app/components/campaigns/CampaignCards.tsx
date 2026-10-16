'use client';

import { Check, ChevronRight, Lock } from 'lucide-react';
import Link from 'next/link';

import { phaseLine, shortDate } from '@/lib/campaigns/campaign-utils';
import type { CalendarDoorView, CampaignView } from '@/lib/campaigns/types';
import { cn } from '@/lib/utils';

import { CampaignCtaButton } from './CampaignCta';
import { CampaignHero, paletteBackdrop } from './CampaignHero';

interface CardProps {
  view: CampaignView;
  /** Admin preview: no navigation, no analytics. */
  inert?: boolean;
  className?: string;
}

/** The home/dashboard card for the homeSlug campaign, per template (CAMPAIGNS_SPEC §10). */
export function CampaignHomeCard({ view, inert, className }: CardProps) {
  if (view.template === 'daily_calendar') return <CalendarHomeCard view={view} inert={inert} className={className} />;
  if (view.template === 'spotlight') return <SpotlightHomeCard view={view} inert={inert} className={className} />;
  return <SeasonalHomeCard view={view} inert={inert} className={className} />;
}

function PreviewPill({ view }: { view: CampaignView }) {
  if (!view.isPreview) return null;
  return (
    <span className="absolute right-3 top-3 z-10 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-950">
      Preview
    </span>
  );
}

function SeasonalHomeCard({ view, inert, className }: CardProps) {
  return (
    <div data-testid="campaign-home-card" className={cn('relative overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70', className)}>
      <PreviewPill view={view} />
      <CampaignHero art={view.art.inAppHero} palette={view.palette} emoji={view.emoji} title={view.title} className="aspect-[16/9] w-full" size="lg">
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-slate-950 via-slate-950/70 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: view.accent }}>
            {phaseLine(view)}
          </p>
          <h3 className="mt-1 text-xl font-extrabold leading-tight text-white sm:text-2xl">
            {view.title} <span aria-hidden>{view.emoji}</span>
          </h3>
          <p className="mt-1 line-clamp-2 text-sm text-slate-200/90">{view.tagline}</p>
        </div>
      </CampaignHero>
      {view.phase !== 'ended' && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <p className="min-w-0 truncate text-xs text-slate-400">{[view.circle?.name?.trim(), `${shortDate(view.startsAt)} – ${shortDate(view.endsAt)}`].filter(Boolean).join(' · ')}</p>
          <CampaignCtaButton view={view} inert={inert} className="shrink-0" />
        </div>
      )}
    </div>
  );
}

function SpotlightHomeCard({ view, inert, className }: CardProps) {
  return (
    <div data-testid="campaign-home-card" className={cn('relative overflow-hidden rounded-3xl border border-white/10 bg-slate-900/70 sm:flex', className)}>
      <PreviewPill view={view} />
      <CampaignHero art={view.art.inAppHero} palette={view.palette} emoji={view.emoji} title={view.title} className="aspect-[16/9] w-full sm:aspect-auto sm:w-2/5" />
      <div className="flex flex-1 flex-col justify-center gap-2 p-4 sm:p-6">
        <h3 className="text-xl font-extrabold text-white">
          {view.title} <span aria-hidden>{view.emoji}</span>
        </h3>
        <p className="text-sm text-slate-300">{view.description || view.tagline}</p>
        <div className="pt-1">
          <CampaignCtaButton view={view} inert={inert} />
        </div>
      </div>
    </div>
  );
}

function calendarStatus(view: CampaignView): string {
  const cal = view.calendar;
  if (view.phase === 'teaser') return `Opens ${shortDate(view.startsAt)} · ${view.totalDays} doors`;
  if (view.phase === 'ended') return `You opened ${cal?.openedCount ?? 0} of ${view.totalDays} doors`;
  if (cal?.todayOpened) return `Door ${view.dayNumber} opened ✓${cal.streak > 1 ? ` · ${cal.streak} in a row` : ''}`;
  return `Door ${view.dayNumber} is open. Check in to open it`;
}

function CalendarHomeCard({ view, inert, className }: CardProps) {
  const doors = view.calendar?.doors ?? [];
  const anchor = view.dayNumber ?? (view.phase === 'ended' ? view.totalDays : 1);
  const start = Math.max(0, Math.min(doors.length - 6, anchor - 3));
  const strip = doors.slice(start, start + 6);
  const body = (
    <div
      data-testid="campaign-home-card"
      className={cn('relative overflow-hidden rounded-3xl border border-white/10 p-4 sm:p-5', className)}
      style={{ background: paletteBackdrop(view.palette) }}
    >
      <PreviewPill view={view} />
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-2xl ring-1 ring-white/15" aria-hidden>
          {view.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: view.accent }}>
            {phaseLine(view)}
          </p>
          <h3 className="truncate text-lg font-extrabold text-white">{view.title}</h3>
          <p className="truncate text-sm text-slate-300">{calendarStatus(view)}</p>
        </div>
        {!inert && <ChevronRight className="mt-3 h-5 w-5 shrink-0 text-white/60" aria-hidden />}
      </div>
      {strip.length > 0 && (
        <div className="mt-4 grid max-w-sm grid-cols-6 gap-2">
          {strip.map((d) => (
            <DoorTile key={d.day} door={d} size="sm" />
          ))}
        </div>
      )}
    </div>
  );
  if (inert) return body;
  return (
    <Link href={`/c/${view.slug}`} className="block transition hover:brightness-110" aria-label={`${view.title}: open the calendar`}>
      {body}
    </Link>
  );
}

/** Compact Circles-tab banner (seasonal_circle + daily_calendar). */
export function CampaignBanner({ view, inert, className }: CardProps) {
  const inner = (
    <div className={cn('relative flex items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/80 p-2.5 pr-4', className)}>
      <CampaignHero art={view.art.inAppHero} palette={view.palette} emoji={view.emoji} title={view.title} className="h-14 w-20 shrink-0 rounded-xl" size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-white">
          {view.title} <span aria-hidden>{view.emoji}</span>
        </p>
        <p className="truncate text-xs text-slate-400">{view.template === 'daily_calendar' && view.phase === 'live' ? calendarStatus(view) : phaseLine(view)}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
    </div>
  );
  if (inert) return inner;
  return <Link href={`/c/${view.slug}`}>{inner}</Link>;
}

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

export function DoorTile({
  door,
  size = 'md',
  selected,
  onClick,
}: {
  door: CalendarDoorView;
  size?: 'sm' | 'md';
  selected?: boolean;
  onClick?: () => void;
}) {
  const base = cn(
    'relative flex aspect-square w-full items-center justify-center rounded-xl font-bold transition',
    size === 'sm' ? 'text-xs' : 'text-sm sm:text-base',
    onClick && 'cursor-pointer hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
    selected && 'ring-2 ring-white'
  );
  const emojiCls = size === 'sm' ? 'text-base' : 'text-xl sm:text-2xl';
  let content: React.ReactNode;
  let cls = '';
  switch (door.state) {
    case 'today':
      cls = 'bg-gradient-to-br from-amber-300 to-amber-500 text-slate-950 shadow-[0_0_18px_rgba(251,191,36,0.55)] animate-[pulse_2.2s_ease-in-out_infinite]';
      content = <span className={emojiCls}>{door.emoji || door.day}</span>;
      break;
    case 'opened':
      cls = 'bg-gradient-to-br from-fuchsia-500/80 via-purple-500/80 to-cyan-400/80 text-white';
      content = (
        <>
          <span className={emojiCls}>{door.emoji || '✓'}</span>
          {size === 'md' && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-slate-950">
              <Check className="h-2.5 w-2.5 text-white" strokeWidth={4} />
            </span>
          )}
        </>
      );
      break;
    case 'missed':
      cls = 'border border-white/10 bg-white/5 text-slate-400 opacity-60';
      content = <span className={cn(emojiCls, 'grayscale')}>{door.emoji || door.day}</span>;
      break;
    default:
      cls = 'border border-dashed border-white/20 bg-slate-950/40 text-slate-300';
      content = <span>{door.day}</span>;
  }
  const label = `Door ${door.day}: ${door.state}`;
  if (onClick) {
    return (
      <button type="button" className={cn(base, cls)} onClick={onClick} aria-label={label} aria-pressed={selected}>
        {content}
      </button>
    );
  }
  return (
    <div className={cn(base, cls)} aria-label={label}>
      {content}
    </div>
  );
}

export function DoorDetail({ door, onClose }: { door: CalendarDoorView; onClose?: () => void }) {
  const revealed = door.state !== 'locked';
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-4 sm:p-5" data-testid="door-detail">
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-3xl',
            door.state === 'today' ? 'bg-amber-400/20 ring-1 ring-amber-300/50' : door.state === 'opened' ? 'bg-purple-500/20 ring-1 ring-purple-300/40' : 'bg-white/5'
          )}
          aria-hidden
        >
          {revealed ? door.emoji || '🎁' : <Lock className="h-6 w-6 text-slate-400" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Door {door.day} · {shortDate(door.date)}
          </p>
          <h4 className="mt-0.5 text-lg font-bold text-white">{revealed ? door.title || 'Surprise' : 'Still locked'}</h4>
          <p className="mt-1 text-sm text-slate-300">{revealed ? door.task : `Opens ${shortDate(door.date)}. No peeking!`}</p>
          <p
            className={cn(
              'mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
              door.state === 'opened' && 'bg-emerald-500/15 text-emerald-300',
              door.state === 'today' && 'bg-amber-400/15 text-amber-200',
              door.state === 'missed' && 'bg-white/5 text-slate-400',
              door.state === 'locked' && 'bg-white/5 text-slate-400'
            )}
          >
            {door.state === 'opened' && (
              <>
                <Check className="h-3.5 w-3.5" /> Opened
              </>
            )}
            {door.state === 'today' && 'Check in today to open it'}
            {door.state === 'missed' && 'Missed, but you can still give it a go'}
            {door.state === 'locked' && 'Locked'}
          </p>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} className="text-sm text-slate-400 hover:text-white" aria-label="Close door">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

export function FriendsStrip({ view }: { view: CampaignView }) {
  const f = view.calendar?.friends;
  if (!f || f.total === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-3">
      <div className="flex -space-x-2">
        {f.members.slice(0, 6).map((m) => (
          <div
            key={m.userId}
            title={m.name}
            className={cn(
              'relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-xs font-bold text-white ring-2',
              m.openedToday ? 'ring-emerald-400' : 'ring-slate-900 opacity-60'
            )}
          >
            {m.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.avatarUrl} alt={m.name} className="h-full w-full object-cover" />
            ) : (
              m.name.charAt(0).toUpperCase()
            )}
          </div>
        ))}
      </div>
      <p className="text-sm text-slate-300">
        <span className="font-semibold text-white">
          {f.openedToday} of {f.total}
        </span>{' '}
        {f.total === 1 ? 'friend' : 'friends'} opened today&apos;s door
      </p>
    </div>
  );
}
