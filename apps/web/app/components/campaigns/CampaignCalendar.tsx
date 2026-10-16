'use client';

import { Bell, Gift, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Switch } from '@/components/ui/switch';
import { diffDays, shortDate } from '@/lib/campaigns/campaign-utils';
import type { CampaignView } from '@/lib/campaigns/types';
import { cn } from '@/lib/utils';

import { DoorDetail, DoorTile, FriendsStrip } from './CampaignCards';
import { CampaignCtaButton } from './CampaignCta';
import { CampaignHero } from './CampaignHero';

interface CampaignCalendarProps {
  view: CampaignView;
  inert?: boolean;
  onToggleReminders?: (next: boolean) => void;
  remindersBusy?: boolean;
  /** Tighter layout for phone mocks. */
  compact?: boolean;
}

export function calendarHeaderLine(view: CampaignView): string {
  if (view.phase === 'teaser') return `Opens ${shortDate(view.startsAt)} · ${view.totalDays} doors`;
  if (view.phase === 'ended') return `${view.calendar?.openedCount ?? 0} of ${view.totalDays} doors opened`;
  const left = Math.max(0, diffDays(view.today, view.endsAt));
  return `${shortDate(view.today)} · ${left === 0 ? 'last door' : `${left} ${left === 1 ? 'door' : 'doors'} to go`}`;
}

/** The full calendar screen for daily_calendar campaigns (CAMPAIGNS_SPEC §10). */
export function CampaignCalendar({ view, inert, onToggleReminders, remindersBusy, compact }: CampaignCalendarProps) {
  const doors = useMemo(() => view.calendar?.doors ?? [], [view.calendar]);
  const defaultDay = view.dayNumber ?? null;
  const [selected, setSelected] = useState<number | null>(defaultDay);
  useEffect(() => setSelected(defaultDay), [defaultDay]);
  const door = doors.find((d) => d.day === selected) ?? null;

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')}>
      <CampaignHero
        art={view.art.inAppHero}
        palette={view.palette}
        emoji={view.emoji}
        title={view.title}
        className={cn('w-full rounded-3xl', compact ? 'aspect-[16/10]' : 'aspect-[16/9] sm:aspect-[21/9]')}
        size={compact ? 'md' : 'lg'}
      >
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-slate-950/95 via-slate-950/50 to-transparent" />
        <div className={cn('absolute inset-x-0 bottom-0', compact ? 'p-3' : 'p-4 sm:p-6')}>
          <h1 className={cn('font-extrabold text-white', compact ? 'text-lg' : 'text-2xl sm:text-3xl')}>
            {view.title} <span aria-hidden>{view.emoji}</span>
          </h1>
          <p className={cn('text-slate-200', compact ? 'text-xs' : 'text-sm')}>{calendarHeaderLine(view)}</p>
        </div>
      </CampaignHero>

      {view.calendar && view.phase === 'live' && view.calendar.streak > 1 && (
        <p className="text-center text-sm text-slate-300">
          🔥 <span className="font-semibold text-white">{view.calendar.streak} doors in a row</span>
        </p>
      )}

      <div className={cn('grid grid-cols-6', compact ? 'gap-1.5' : 'mx-auto max-w-xl gap-2 sm:gap-3')} role="grid" aria-label="Calendar doors">
        {doors.map((d) => (
          <DoorTile key={d.day} door={d} size={compact ? 'sm' : 'md'} selected={d.day === selected} onClick={() => setSelected(d.day === selected ? null : d.day)} />
        ))}
      </div>

      {door && <DoorDetail door={door} onClose={compact ? undefined : () => setSelected(null)} />}

      {view.phase === 'live' && <FriendsStrip view={view} />}

      {view.phase !== 'ended' && (
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-3">
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/15">
              <Bell className="h-4 w-4 text-amber-300" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">Remind me each morning</span>
              <span className="block text-xs text-slate-400">A nudge when a new door opens</span>
            </span>
          </span>
          <Switch
            checked={view.participant.reminders}
            disabled={inert || remindersBusy}
            onCheckedChange={(v) => onToggleReminders?.(v)}
            aria-label="Remind me each morning"
            className="data-[state=checked]:bg-amber-400 data-[state=unchecked]:bg-slate-700"
          />
        </label>
      )}

      <div className={cn('flex flex-col gap-2', !compact && 'sm:flex-row')}>
        {view.circle && view.phase !== 'ended' && (
          <CampaignCtaButton view={view} inert={inert} action="start_circle" label={`Start ${aOrAn(view.circle.name)} ${view.circle.name}`} className="flex-1" />
        )}
        <CampaignCtaButton
          view={view}
          inert={inert}
          action="invite"
          label="Bring a friend along"
          variant="secondary"
          className="flex-1"
        />
      </div>
      {!compact && (
        <p className="flex items-center justify-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <Gift className="h-3.5 w-3.5" /> A door opens when you check in that day
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <Users className="h-3.5 w-3.5" /> Friends from your circles
          </span>
        </p>
      )}
    </div>
  );
}

function aOrAn(word: string): string {
  return /^[aeiou]/i.test(word.trim()) ? 'an' : 'a';
}
