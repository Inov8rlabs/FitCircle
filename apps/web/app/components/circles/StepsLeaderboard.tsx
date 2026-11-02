'use client';

import { CalendarClock, Footprints, Lock } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AvatarCircle, GlassCard, ProgressBar } from '@/components/ui/ios';
import { AnalyticsEvents, analytics } from '@/lib/analytics';
import { cn } from '@/lib/utils';

/** Body of GET /api/fitcircles/[id]/steps-leaderboard (docs/CIRCLE_STEPS_LEADERBOARD.md). */
export type StepsMetric = 'today_steps' | 'total_steps' | 'goal_pct_today';

export interface StepsMemberRow {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  is_me: boolean;
  steps_visible: boolean;
  today_steps: number | null;
  total_steps: number | null;
  daily_goal_steps: number;
  goal_source: 'challenge' | 'member' | 'default';
  goal_pct_today: number | null;
  days_goal_met: number | null;
  steps_synced_recently: boolean | null;
  ranks: Record<StepsMetric, number | null>;
  days: Array<{ date: string; steps: number | null }>;
}

export interface StepsBoard {
  is_steps_circle: boolean;
  phase: 'upcoming' | 'active' | 'completed';
  start_date: string;
  end_date: string;
  total_days: number;
  day_number: number | null;
  days_until_start: number;
  daily_goal: { steps: number } | null;
  default_metric: StepsMetric;
  member_count: number;
  members: StepsMemberRow[];
}

const METRICS: Array<{ key: StepsMetric; label: string }> = [
  { key: 'today_steps', label: 'Today' },
  { key: 'total_steps', label: 'Total' },
  { key: 'goal_pct_today', label: '% Goal' },
];

const fmt = (n: number) => n.toLocaleString('en-US');

const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Rank ascending, unranked last, then name — the server's order rule. */
export function sortStepsRows(rows: StepsMemberRow[], metric: StepsMetric): StepsMemberRow[] {
  return [...rows].sort((a, b) => {
    const ra = a.ranks[metric];
    const rb = b.ranks[metric];
    if (ra !== rb) {
      if (ra === null) return 1;
      if (rb === null) return -1;
      return ra - rb;
    }
    return a.display_name.localeCompare(b.display_name);
  });
}

export function stepsHeadline(board: StepsBoard): string {
  if (board.phase === 'upcoming') {
    return board.days_until_start === 1 ? 'Starts tomorrow' : `Starts in ${board.days_until_start} days`;
  }
  if (board.phase === 'completed') return 'Final results';
  return `Day ${board.day_number} of ${board.total_days}`;
}

function primaryValue(row: StepsMemberRow, metric: StepsMetric): string {
  if (metric === 'goal_pct_today') return `${row.goal_pct_today ?? 0}%`;
  const v = metric === 'today_steps' ? row.today_steps : row.total_steps;
  return fmt(v ?? 0);
}

function secondaryLine(row: StepsMemberRow, metric: StepsMetric): string {
  const today = fmt(row.today_steps ?? 0);
  const total = fmt(row.total_steps ?? 0);
  if (metric === 'today_steps') return `Total ${total}`;
  if (metric === 'total_steps') return `Today ${today}`;
  return `${today} / ${fmt(row.daily_goal_steps)} today`;
}

/**
 * Steps board for a steps circle: Today | Total | % Goal, ranked by the server.
 * Renders `fallback` (the goal leaderboard) for other circles or when the board
 * cannot be loaded.
 */
export function StepsLeaderboard({ circleId, fallback }: { circleId: string; fallback: ReactNode }) {
  const [board, setBoard] = useState<StepsBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [metric, setMetric] = useState<StepsMetric>('today_steps');
  const [selected, setSelected] = useState<StepsMemberRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fetch(`/api/fitcircles/${circleId}/steps-leaderboard`, { headers: tz ? { 'X-Client-Timezone': tz } : {} })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: StepsBoard) => {
        if (cancelled) return;
        setBoard(data);
        setMetric(data.default_metric ?? 'today_steps');
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [circleId]);

  if (failed || (board && !board.is_steps_circle)) return <>{fallback}</>;
  if (!board) return null;

  const upcoming = board.phase === 'upcoming';
  const rows = upcoming
    ? [...board.members].sort((a, b) => a.display_name.localeCompare(b.display_name))
    : sortStepsRows(board.members, metric);
  const syncing = board.members.filter((m) => m.steps_synced_recently).length;
  const goalLine = board.daily_goal ? `Goal ${fmt(board.daily_goal.steps)} steps/day` : "Each member's own step goal";

  const choose = (next: StepsMetric) => {
    if (next === metric) return;
    setMetric(next);
    analytics.track(AnalyticsEvents.leaderboardMetricChanged({ metric: next, circle_phase: board.phase }));
  };

  return (
    <div data-testid="steps-leaderboard" className="space-y-3">
      <div className="flex items-center gap-2 text-caption text-fg-secondary">
        {upcoming ? <CalendarClock className="h-4 w-4 text-brand-indigo" aria-hidden /> : <Footprints className="h-4 w-4 text-brand-indigo" aria-hidden />}
        <span className="font-semibold text-white">{stepsHeadline(board)}</span>
        <span aria-hidden>·</span>
        <span>{goalLine}</span>
      </div>

      {upcoming ? (
        <GlassCard>
          <p className="text-body text-white">
            {board.member_count} {board.member_count === 1 ? 'member' : 'members'} ready
            {syncing > 0 && <span className="text-fg-secondary"> · {syncing} syncing steps</span>}
          </p>
          <p className="mt-1 text-caption text-fg-secondary">
            Rankings start on {dayLabel(board.start_date)}. Steps sync from Apple Health or Health Connect.
          </p>
        </GlassCard>
      ) : (
        <div role="tablist" aria-label="Rank by" className="flex rounded-lg border border-glass bg-surface-raised/50 p-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={metric === m.key}
              onClick={() => choose(m.key)}
              className={cn(
                'flex-1 rounded-md px-3 py-1.5 text-subhead font-semibold transition duration-200 ease-ios',
                metric === m.key ? 'bg-brand-indigo text-white' : 'text-fg-secondary hover:text-white'
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <ul className="space-y-2">
        {rows.map((row) => {
          const rank = upcoming ? null : row.ranks[metric];
          const canOpen = row.steps_visible && row.days.length > 0;
          return (
            <li key={row.user_id}>
              <button
                type="button"
                data-testid="steps-leaderboard-row"
                disabled={!canOpen}
                onClick={() => setSelected(row)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition duration-200 ease-ios',
                  row.is_me ? 'border-brand-indigo/30 bg-brand-indigo/10' : 'border-glass bg-surface-raised/50',
                  canOpen ? 'hover:border-white/20' : 'cursor-default'
                )}
              >
                {!upcoming && (
                  <span className="w-7 shrink-0 text-center text-headline font-bold tabular-nums text-fg-secondary">
                    {rank ?? '–'}
                  </span>
                )}
                <AvatarCircle name={row.display_name} src={row.avatar_url} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-body font-semibold text-white">{row.display_name}</span>
                    {row.is_me && (
                      <span className="shrink-0 rounded-full bg-brand-indigo/20 px-1.5 py-0.5 text-caption font-semibold text-brand-indigo">You</span>
                    )}
                  </span>
                  <span className="block truncate text-caption text-fg-secondary">
                    {!row.steps_visible
                      ? 'Private'
                      : upcoming
                        ? row.steps_synced_recently
                          ? 'Steps syncing'
                          : 'No steps synced yet'
                        : secondaryLine(row, metric)}
                  </span>
                </span>
                {!upcoming && (
                  <span className="flex w-[84px] shrink-0 flex-col items-end gap-1.5">
                    {row.steps_visible ? (
                      <>
                        <span className="text-title3 font-bold tabular-nums text-white">{primaryValue(row, metric)}</span>
                        <ProgressBar value={row.goal_pct_today ?? 0} className="w-[64px]" />
                      </>
                    ) : (
                      <Lock className="h-4 w-4 text-fg-tertiary" aria-label="Private" />
                    )}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.display_name}</DialogTitle>
                <DialogDescription>
                  {fmt(selected.total_steps ?? 0)} steps total · goal met {selected.days_goal_met ?? 0} of {selected.days.length} days
                </DialogDescription>
              </DialogHeader>
              <ul className="max-h-[50vh] space-y-1 overflow-y-auto" data-testid="steps-day-breakdown">
                {[...selected.days].reverse().map((d) => (
                  <li key={d.date} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-body">
                    <span className="text-fg-secondary">{dayLabel(d.date)}</span>
                    <span
                      className={cn(
                        'tabular-nums font-semibold',
                        d.steps !== null && d.steps >= selected.daily_goal_steps ? 'text-brand-green' : 'text-white'
                      )}
                    >
                      {d.steps === null ? '—' : fmt(d.steps)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
