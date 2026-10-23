'use client';

import { Check, Flag, Flame } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { AvatarCircle, GlassCard, ProgressBar } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { coverCircleMember, getCircleStreakStatus } from './api';
import {
  canCover,
  milestoneLine,
  savesPoolLine,
  todayProgressLine,
  type CircleStreakMember,
  type CircleStreakStatus,
} from './types';

/**
 * iOS CircleStreakLiveCard: flame + circle streak, today's majority progress,
 * member chips (green ring = in today, 🛡️ = covered) with "Cover" for members
 * the viewer can save, the shared weekly save pool and the next milestone.
 */
export function CircleStreakLiveCard({
  circleId,
  status,
  viewerId,
  onChanged,
}: {
  circleId: string;
  status: CircleStreakStatus | null;
  viewerId?: string | null;
  onChanged?: (next: CircleStreakStatus) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);

  if (!status) return <CircleStreakLiveCardSkeleton />;

  const cover = async (m: CircleStreakMember) => {
    setSaving(m.userId);
    try {
      await coverCircleMember(circleId, m.userId);
      toast.success(`Covered ${m.displayName.split(' ')[0]} for today`);
      const next = await getCircleStreakStatus(circleId);
      onChanged?.(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not cover right now');
    } finally {
      setSaving(null);
    }
  };

  const today = status.today;
  return (
    <GlassCard data-testid="circle-streak-card">
      <div className="flex items-center gap-4">
        <span className="relative flex h-14 w-14 shrink-0 items-center justify-center">
          <span aria-hidden className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(249,115,22,0.45),transparent_70%)]" />
          <Flame className="relative h-8 w-8 text-brand-orange" fill="currentColor" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="flex items-baseline gap-2">
            <span className="text-[32px] font-extrabold leading-none tabular-nums text-white">{status.currentStreak}</span>
            <span className="text-subhead font-semibold text-fg-secondary">day circle streak</span>
          </p>
          {status.longestStreak > 0 && <p className="mt-1 text-caption text-fg-tertiary">Best: {status.longestStreak} days</p>}
        </div>
      </div>

      {today && (
        <div className="mt-4">
          <p className={cn('text-subhead font-semibold', today.qualified ? 'text-brand-green' : 'text-white')}>
            {todayProgressLine(today)}
          </p>
          <ProgressBar
            className="mt-2"
            value={(today.loggedCount / Math.max(1, today.needed)) * 100}
            barClassName={today.qualified ? 'bg-gradient-green' : 'bg-gradient-orange'}
          />
          {today.members.length > 0 && (
            <ul className="no-scrollbar -mx-1 mt-4 flex gap-3 overflow-x-auto px-1 pb-1" aria-label="Today's check-ins">
              {today.members.map((m) => (
                <li key={m.userId} className="flex w-14 shrink-0 flex-col items-center gap-1">
                  <span className="relative">
                    <AvatarCircle
                      name={m.displayName}
                      src={m.avatarUrl}
                      size={40}
                      className={cn(
                        'ring-2 ring-offset-2 ring-offset-surface',
                        m.logged ? 'ring-brand-green' : m.covered ? 'ring-brand-cyan' : 'opacity-50 ring-white/15'
                      )}
                    />
                    {m.logged && (
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-green">
                        <Check className="h-2.5 w-2.5 text-white" strokeWidth={4} aria-hidden />
                      </span>
                    )}
                    {!m.logged && m.covered && (
                      <span className="absolute -bottom-1 -right-1 text-[12px]" aria-hidden>
                        🛡️
                      </span>
                    )}
                  </span>
                  <span className="w-14 truncate text-center text-[10px] font-medium text-fg-secondary">
                    {m.displayName.split(' ')[0]}
                  </span>
                  <span className="sr-only">{m.logged ? 'checked in' : m.covered ? 'covered' : 'not in yet'}</span>
                  {canCover(status, m, viewerId) && (
                    <button
                      type="button"
                      onClick={() => void cover(m)}
                      disabled={saving !== null}
                      aria-label={`Cover ${m.displayName.split(' ')[0]}`}
                      className="inline-flex h-6 items-center rounded-full bg-brand-cyan px-2.5 text-[11px] font-bold text-white disabled:opacity-60"
                    >
                      {saving === m.userId ? '…' : 'Cover'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(status.saves || (status.nextMilestone && status.nextMilestone.remaining > 0)) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {status.saves && (
            <span className="rounded-full bg-brand-cyan/10 px-2.5 py-1 text-caption font-semibold text-brand-cyan">
              {savesPoolLine(status.saves)}
            </span>
          )}
          {status.saves && !status.saves.mySaveAvailable && (
            <span className="text-caption text-fg-tertiary">Your weekly save is used. It resets Monday.</span>
          )}
          {status.nextMilestone && status.nextMilestone.remaining > 0 && (
            <span className="inline-flex items-center gap-1 text-caption text-fg-secondary">
              <Flag className="h-3 w-3" aria-hidden />
              {milestoneLine(status.nextMilestone)}
            </span>
          )}
        </div>
      )}
    </GlassCard>
  );
}

export function CircleStreakLiveCardSkeleton() {
  return (
    <GlassCard aria-busy="true" data-testid="circle-streak-skeleton">
      <div className="flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="mt-4 h-4 w-3/4" />
      <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
      <div className="mt-4 flex gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-10 rounded-full" />
        ))}
      </div>
    </GlassCard>
  );
}
