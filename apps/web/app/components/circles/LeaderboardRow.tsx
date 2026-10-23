'use client';

import { CheckCircle2, Crown, Lock, Medal, Trophy } from 'lucide-react';

import { AvatarCircle, ProgressBar } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface LeaderboardRowData {
  user_id: string;
  display_name: string;
  avatar_url?: string | null;
  progress: number;
  current_value?: number;
  starting_value?: number;
  target_value?: number;
  is_public?: boolean;
  is_current_user?: boolean;
}

const RANK_BG: Record<number, string> = {
  1: 'bg-gradient-orange',
  2: 'bg-slate-400',
  3: 'bg-amber-700',
};

function RankDisc({ rank }: { rank: number }) {
  const Icon = rank === 1 ? Trophy : rank <= 3 ? Medal : null;
  return (
    <span
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white',
        RANK_BG[rank] ?? 'bg-white/10'
      )}
      aria-label={`Rank ${rank}`}
    >
      {Icon ? <Icon className="h-5 w-5" aria-hidden /> : <span className="text-headline font-bold">#{rank}</span>}
    </span>
  );
}

/**
 * iOS LeaderboardRow (gallery l06): rank disc, avatar, name with "You" pill and
 * a green check when in today, the goal line, and % with a progress bar.
 */
export function LeaderboardRow({
  rank,
  entry,
  isCreator,
  checkedInToday,
  isYou,
  unit = 'kg',
  onClick,
}: {
  rank: number;
  entry: LeaderboardRowData;
  isCreator?: boolean;
  checkedInToday?: boolean;
  isYou: boolean;
  unit?: string;
  onClick?: () => void;
}) {
  const locked = !isYou && entry.is_public === false;
  const goal =
    entry.current_value && entry.target_value
      ? `${entry.current_value.toFixed(1)} ${unit} → ${entry.target_value.toFixed(1)} ${unit} goal`
      : entry.target_value
        ? `No data → ${entry.target_value.toFixed(1)} ${unit} goal`
        : entry.current_value
          ? `${entry.current_value.toFixed(1)} ${unit}`
          : 'No data yet';
  const detail =
    entry.starting_value && entry.current_value && entry.target_value
      ? `${Math.abs(entry.starting_value - entry.current_value).toFixed(1)} ${unit} of ${Math.abs(entry.starting_value - entry.target_value).toFixed(1)} ${unit}`
      : null;

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={locked}
        data-testid="leaderboard-row"
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition duration-200 ease-ios sm:gap-4 sm:p-4',
          isYou ? 'border-brand-indigo/30 bg-brand-indigo/10' : 'border-glass bg-surface-raised/50',
          locked ? 'cursor-not-allowed opacity-60' : 'hover:border-white/20 hover:bg-surface-raised/70'
        )}
      >
        <RankDisc rank={rank} />
        <AvatarCircle name={entry.display_name} src={entry.avatar_url} size={36} className="hidden sm:inline-flex" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-body font-semibold text-white">{entry.display_name}</span>
            {isCreator && <Crown className="h-3.5 w-3.5 shrink-0 text-brand-yellow" aria-label="Circle owner" />}
            {isYou && (
              <span className="shrink-0 rounded-full bg-brand-indigo/20 px-1.5 py-0.5 text-caption font-semibold text-brand-indigo">
                You
              </span>
            )}
            {checkedInToday && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand-green" aria-label="Checked in today" />}
            {locked && <Lock className="h-3.5 w-3.5 shrink-0 text-fg-tertiary" aria-label="Private" />}
          </span>
          <span className="block truncate text-caption text-fg-secondary">{goal}</span>
        </span>
        <span className="flex w-[76px] shrink-0 flex-col items-end gap-1.5">
          <span className="text-title3 font-bold tabular-nums text-white">{Math.round(entry.progress)}%</span>
          <ProgressBar value={entry.progress} className="w-[60px]" />
          {detail && <span className="w-full truncate text-right text-[11px] text-fg-tertiary">{detail}</span>}
        </span>
      </button>
    </li>
  );
}

export function LeaderboardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="space-y-2" aria-busy="true" data-testid="leaderboard-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 rounded-xl border border-glass bg-surface-raised/50 p-3 sm:p-4">
          <Skeleton className="h-11 w-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <div className="flex w-[76px] flex-col items-end gap-1.5">
            <Skeleton className="h-5 w-10" />
            <Skeleton className="h-1.5 w-[60px] rounded-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}
