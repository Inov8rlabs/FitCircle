'use client';

import { Calendar, ChevronRight, Flame, Users } from 'lucide-react';
import Link from 'next/link';

import { AvatarStack, GlassCard } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';

import { SegmentedRing } from './SegmentedRing';
import { circleTypeLabel, daysLeft, leftToCloseLine } from './types';
import { useCircleStreak } from './useCircleStreak';

export interface CircleSummary {
  id: string;
  name: string;
  description?: string | null;
  type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  participant_count?: number;
  status?: string | null;
  is_creator?: boolean;
}

/**
 * One circle on the Circles tab, laid out like the iOS circle widget card
 * (gallery l02): segmented "3/5 in today" ring, name, "2 left to close it",
 * circle-streak flame, and the member stack with today's check-in rings.
 */
export function CircleListCard({ circle }: { circle: CircleSummary }) {
  const { status } = useCircleStreak(circle.id);
  const today = status?.today;
  const total = today?.activeCount ?? circle.participant_count ?? 0;
  const filled = today?.loggedCount ?? 0;
  const left = daysLeft(circle.end_date);
  const ended = Boolean(circle.end_date) && left === 0;

  return (
    <Link
      href={`/fitcircles/${circle.id}`}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-purple"
      data-testid="circle-card"
    >
      <GlassCard as="article" className="transition duration-200 ease-ios group-hover:border-white/20 group-hover:bg-surface-raised/70">
        <div className="flex items-center gap-4">
          {status === null ? (
            <Skeleton className="h-[76px] w-[76px] shrink-0 rounded-full" />
          ) : (
            <SegmentedRing filled={filled} total={Math.max(total, 1)} size={76} stroke={8} />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate text-title3 text-white">{circle.name}</h3>
              {status && (
                <span className="flex shrink-0 flex-col items-end leading-none" aria-label={`${status.currentStreak} day circle streak`}>
                  <span className="inline-flex items-center gap-1 text-title3 font-bold tabular-nums text-white">
                    <Flame className="h-5 w-5 text-brand-orange" fill="currentColor" aria-hidden />
                    {status.currentStreak}
                  </span>
                  <span className="mt-1 text-[11px] text-fg-tertiary">circle streak</span>
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-subhead text-fg-secondary">
              {today ? `${filled} of ${today.activeCount} in · ${leftToCloseLine(today)}` : circle.description || circleTypeLabel(circle.type)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-tertiary">
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" aria-hidden />
                {circle.participant_count ?? total}
              </span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" aria-hidden />
                {ended ? 'Ended' : `${left}d left`}
              </span>
              <span>{circleTypeLabel(circle.type)}</span>
            </div>
          </div>
          <ChevronRight className="hidden h-5 w-5 shrink-0 text-fg-tertiary sm:block" aria-hidden />
        </div>

        {today && today.members.length > 0 && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
            <AvatarStack
              people={today.members.map((m) => ({
                id: m.userId,
                name: m.displayName,
                src: m.avatarUrl,
                state: m.logged || m.covered ? 'in' : 'out',
              }))}
              max={6}
              size={28}
            />
            <span className={today.qualified ? 'text-caption font-semibold text-brand-green' : 'text-caption text-fg-secondary'}>
              {today.qualified ? 'Streak safe today' : `${Math.max(0, today.needed - today.loggedCount)} more keeps it alive`}
            </span>
          </div>
        )}
      </GlassCard>
    </Link>
  );
}

export function CircleListCardSkeleton() {
  return (
    <GlassCard aria-busy="true" data-testid="circle-card-skeleton">
      <div className="flex items-center gap-4">
        <Skeleton className="h-[76px] w-[76px] shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
        <Skeleton className="h-7 w-28 rounded-full" />
        <Skeleton className="h-3 w-24" />
      </div>
    </GlassCard>
  );
}
