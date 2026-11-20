/**
 * Streak milestone celebrations (docs/ENGAGEMENT_115_SPEC.md §5.4). PURE.
 *
 * In-app ownership: a 1.1.5 app declares X-Client-Features `streak_celebration_v1` and shows the
 * full-screen celebration from `meta.streak.milestone` (foreground manual routes) and from
 * GET /api/mobile/streaks/celebrations. Only when the app did NOT show it does the server push
 * `milestone_achieved` (old builds always get it: they never declare the feature).
 */
import { CLIENT_FEATURES_HEADER } from '../design/icon-compat';

export const STREAK_CELEBRATION_FEATURE = 'streak_celebration_v1';
/** A pending celebration is offered for this long after the milestone was reached. */
export const PENDING_CELEBRATION_TTL_HOURS = 72;

type HeaderSource = { headers: { get(name: string): string | null } };

export function clientShowsStreakCelebration(features: string | null | undefined): boolean {
  return (features ?? '').split(',').some((f) => f.trim().toLowerCase() === STREAK_CELEBRATION_FEATURE);
}

/** True for a foreground request from an app that shows the celebration in-app. */
export function requestShowsStreakCelebration(request: HeaderSource | null | undefined): boolean {
  return !!request && clientShowsStreakCelebration(request.headers.get(CLIENT_FEATURES_HEADER));
}

/** Stored on the milestone_shield streak_shields.metadata row. */
export interface PendingCelebration {
  days: number;
  name: string;
  icon: string | null;
  /** The calendar day the milestone was reached (boundary day). */
  day: string;
  /** When it was recorded (ISO). */
  at: string;
  shieldsGranted: number;
}

export interface PendingCelebrationDto {
  milestone: number;
  name: string;
  icon: string | null;
  shields_granted: number;
  reached_on: string;
}

/** The pending celebration in a metadata blob, if still within the TTL. */
export function pendingCelebrationFrom(metadata: unknown, now: Date = new Date()): PendingCelebrationDto | null {
  const p = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).pending_celebration : null;
  if (!p || typeof p !== 'object') return null;
  const c = p as Partial<PendingCelebration>;
  if (typeof c.days !== 'number' || typeof c.at !== 'string') return null;
  const at = Date.parse(c.at);
  if (!Number.isFinite(at) || now.getTime() - at > PENDING_CELEBRATION_TTL_HOURS * 3_600_000) return null;
  return {
    milestone: c.days,
    name: typeof c.name === 'string' ? c.name : `${c.days}-day streak`,
    icon: typeof c.icon === 'string' ? c.icon : null,
    shields_granted: typeof c.shieldsGranted === 'number' ? c.shieldsGranted : 0,
    reached_on: typeof c.day === 'string' ? c.day : c.at.slice(0, 10),
  };
}

/** milestone_achieved copy: "{n}-day streak" / "{name}: {n} days in a row. Tap to celebrate." */
export function milestonePushCopy(input: { days: number; name: string; shieldsGranted: number }): { title: string; body: string } {
  const shield = input.shieldsGranted > 0 ? ' You earned a streak shield.' : '';
  return { title: `${input.days}-day streak`, body: `${input.name}: ${input.days} days in a row. Tap to celebrate.${shield}` };
}

export const milestoneDedupeKey = (days: number, boundaryDay: string): string => `streak_milestone:${days}:${boundaryDay}`;
