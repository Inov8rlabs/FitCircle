/**
 * Circle streak status as GET /api/mobile/circles/[id]/streak returns it
 * (CircleStreakService.getStatus). The base fields are typed in
 * nutrition-client's CircleStreak; `today` / `saves` / `nextMilestone` are the
 * additive fields the iOS CircleStreakLiveCard renders.
 */
export interface CircleStreakMember {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  logged: boolean;
  covered: boolean;
  coveredBy: string | null;
}

export interface CircleStreakStatus {
  fitcircleId: string;
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
  updatedAt: string | null;
  today?: {
    date: string;
    loggedCount: number;
    activeCount: number;
    needed: number;
    qualified: boolean;
    members: CircleStreakMember[];
  };
  saves?: {
    poolRemaining: number;
    poolSize: number;
    mySaveAvailable: boolean;
    weekResetsAt?: string;
  };
  nextMilestone?: { days: number; remaining: number } | null;
}

/** "2 of 5 checked in today · 1 more keeps it alive" (iOS Today.progressLine). */
export function todayProgressLine(today: NonNullable<CircleStreakStatus['today']>): string {
  const base = `${today.loggedCount} of ${today.activeCount} checked in today`;
  if (today.qualified || today.loggedCount >= today.needed) return `${base} · streak safe for today 🔥`;
  return `${base} · ${today.needed - today.loggedCount} more keeps it alive`;
}

/** "2 left to close it" / "Everyone's in" for the circle card subtitle. */
export function leftToCloseLine(today: NonNullable<CircleStreakStatus['today']>): string {
  const left = Math.max(0, today.activeCount - today.loggedCount);
  return left === 0 ? "Everyone's in today" : `${left} left to close it`;
}

/** iOS Saves.poolLine. */
export function savesPoolLine(saves: NonNullable<CircleStreakStatus['saves']>): string {
  return `🛡️ ${saves.poolRemaining} ${saves.poolRemaining === 1 ? 'save' : 'saves'} left this week`;
}

/** iOS NextMilestone.line. */
export function milestoneLine(next: { days: number; remaining: number }): string {
  return `${next.remaining} more ${next.remaining === 1 ? 'day' : 'days'} to a ${next.days}-day streak`;
}

/** iOS canCover: a save is available, the member hasn't counted today, and it isn't you. */
export function canCover(status: CircleStreakStatus, member: CircleStreakMember, viewerId?: string | null): boolean {
  if (status.saves?.mySaveAvailable !== true) return false;
  if (member.logged || member.covered) return false;
  if (!viewerId) return true;
  return member.userId.toLowerCase() !== viewerId.toLowerCase();
}

export function daysLeft(endDate: string | null | undefined, now: Date = new Date()): number {
  if (!endDate) return 0;
  const diff = new Date(endDate).getTime() - now.getTime();
  return diff > 0 ? Math.ceil(diff / 86_400_000) : 0;
}

/** "17 weeks 1d" / "12 days" (iOS FitCircle.duration). */
export function durationLabel(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return '—';
  const days = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000));
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'}`;
  const weeks = Math.floor(days / 7);
  const rest = days % 7;
  return rest ? `${weeks} weeks ${rest}d` : `${weeks} weeks`;
}

const TYPE_LABELS: Record<string, string> = {
  weight_loss: 'Weight Loss',
  steps: 'Steps',
  workout_frequency: 'Workouts',
  workout_minutes: 'Workout Minutes',
  custom: 'Custom',
};

export function circleTypeLabel(type: string | null | undefined): string {
  if (!type) return 'Circle';
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
