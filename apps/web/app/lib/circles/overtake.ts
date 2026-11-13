/**
 * "Someone moved past you on your circle leaderboard" (docs/PUSH_NOTIFICATIONS.md §8.6). PURE.
 *
 * Detection compares two daily snapshots of the circle's own leaderboard metric,
 * taken at the same local time (18:00 circle time) on consecutive days:
 *   - total_steps     steps circles (CircleStepsLeaderboardService, cumulative over the circle)
 *   - goal_progress   every other circle (CircleService.getLeaderboard progress %, members with a goal)
 * A pass is GENUINE when the overtaker was strictly behind the recipient
 * yesterday and is strictly ahead today. Ties either day, members missing from
 * either snapshot (joined / left / hid their progress) and test accounts never
 * count. Because both values are day-over-day, a pass has to hold for a day
 * before anyone hears about it (no flapping on a sync).
 */
export type OvertakeMetric = 'total_steps' | 'goal_progress';

export interface SnapshotEntry {
  userId: string;
  value: number;
}

export interface Overtake {
  recipientId: string;
  overtakerId: string;
  /** Today's gap, overtaker − recipient (> 0), in metric units. */
  gap: number;
  /** Competition ranks today. */
  overtakerRank: number;
  recipientRank: number;
}

/** Competition ranking (1, 1, 3) by value, highest first. */
export function competitionRanks(entries: readonly SnapshotEntry[]): Map<string, number> {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const out = new Map<string, number>();
  sorted.forEach((e, i) => {
    const prev = sorted[i - 1];
    out.set(e.userId, prev && prev.value === e.value ? out.get(prev.userId)! : i + 1);
  });
  return out;
}

/**
 * Genuine passes between two snapshots, at most one per recipient (the overtaker
 * now closest ahead). `real` = non-test members; `recipients` = who may be told.
 */
export function detectOvertakes(input: {
  previous: readonly SnapshotEntry[];
  current: readonly SnapshotEntry[];
  real: ReadonlySet<string>;
  recipients: ReadonlySet<string>;
}): Overtake[] {
  const prev = new Map(input.previous.map((e) => [e.userId, e.value] as const));
  const cur = new Map(input.current.map((e) => [e.userId, e.value] as const));
  const ranks = competitionRanks(input.current);
  const best = new Map<string, Overtake>();
  for (const r of input.current) {
    if (!input.recipients.has(r.userId) || !input.real.has(r.userId) || !prev.has(r.userId)) continue;
    const rPrev = prev.get(r.userId)!;
    const rCur = r.value;
    for (const o of input.current) {
      if (o.userId === r.userId || !input.real.has(o.userId) || !prev.has(o.userId)) continue;
      const oPrev = prev.get(o.userId)!;
      const oCur = cur.get(o.userId)!;
      if (!(oPrev < rPrev && oCur > rCur)) continue;
      const pass: Overtake = {
        recipientId: r.userId,
        overtakerId: o.userId,
        gap: oCur - rCur,
        overtakerRank: ranks.get(o.userId)!,
        recipientRank: ranks.get(r.userId)!,
      };
      const kept = best.get(r.userId);
      if (!kept || pass.gap < kept.gap) best.set(r.userId, pass);
    }
  }
  return [...best.values()];
}

export interface OvertakeCopy {
  title: string;
  body: string;
  variant: string;
}

/** Steps per minute of walking used for the "minutes of walking" estimate (≈100 at a normal pace). */
export const STEPS_PER_WALKING_MINUTE = 100;
/** Above this gap the copy does not put a number of minutes on it. */
export const MAX_WALK_MINUTES = 30;

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function overtakeCopy(input: {
  metric: OvertakeMetric;
  overtakerName: string;
  circleName: string;
  gap: number;
  overtakerRank: number;
  /** goal_progress only: the recipient's goal type (weight_loss → a weigh-in is the action). */
  goalType?: string | null;
}): OvertakeCopy | null {
  const name = input.overtakerName.trim();
  const circle = input.circleName.trim() || 'your circle';
  if (!name || !(input.gap > 0)) return null;
  const title = `${name} just moved past you in ${circle}`;
  const spot = `#${input.overtakerRank}`;
  if (input.metric === 'total_steps') {
    const steps = Math.ceil(input.gap);
    const minutes = Math.ceil(steps / STEPS_PER_WALKING_MINUTE);
    if (minutes <= MAX_WALK_MINUTES) {
      return {
        title,
        body: `You're ${fmt(steps)} steps behind ${spot}. About ${minutes} minute${minutes === 1 ? '' : 's'} of walking gets it back.`,
        variant: 'steps_walk',
      };
    }
    return { title, body: `You're ${fmt(steps)} steps behind ${spot}. A walk today closes the gap.`, variant: 'steps_gap' };
  }
  const points = Math.round(input.gap);
  const action = input.goalType === 'weight_loss' || input.goalType === 'weight_gain' ? "Log today's weigh-in to update your spot." : 'Check in today to update your progress.';
  if (points < 1) return { title, body: `It's close. ${action}`, variant: 'goal_close' };
  return { title, body: `You're ${points} point${points === 1 ? '' : 's'} behind ${spot} on goal progress. ${action}`, variant: 'goal_gap' };
}

export function overtakeDedupeKey(circleId: string, overtakerId: string, localDate: string): string {
  return `overtake:${circleId}:${overtakerId}:${localDate}`;
}
