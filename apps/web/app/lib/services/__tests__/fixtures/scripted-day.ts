// Replay-eval fixture for the Circle Chat system-post engine.
//
// Data-only: a scripted day of ActivitySignals + small typed builders that compose
// EnginePlanInput so the eval can drive SystemPostEngine.plan() deterministically.
// All assertions live in ../system-post-engine.eval.test.ts — this file holds NO
// expect()s, just the inputs and the expected-copy table.

import {
  DEFAULT_ENGINE_CONFIG,
  type ActivitySignal,
  type EngineConfig,
  type EnginePlanInput,
  type RecentPostStats,
} from '../../../types/circle-chat-engine';
import type { SystemEventType } from '../../../types/circle-chat';

// ----------------------------------------------------------------------------
// Stable IDs for a single circle + its members.
// ----------------------------------------------------------------------------
export const CIRCLE_ID = 'circle-spring-cut';

export const MIKE = { id: 'user-mike', name: 'Mike' };
export const SARAH = { id: 'user-sarah', name: 'Sarah' };
export const PRIYA = { id: 'user-priya', name: 'Priya' };

// ----------------------------------------------------------------------------
// A realistic scripted day (all timestamps explicit so the eval is deterministic).
//   * Morning: three members log workouts within the bundle window.
//   * Midday: Priya is hyperactive (extra workout that will hit the per-member cap).
//   * A weight log enters the pipeline (hard-excluded — must NEVER post).
//   * Evening: Mike hits a streak milestone (p0 — always posts).
//   * A member joins.
// ----------------------------------------------------------------------------
export const scriptedDaySignals: ActivitySignal[] = [
  // --- Morning workout bundle (within 30-min default window) ---
  {
    fitcircleId: CIRCLE_ID,
    actorUserId: MIKE.id,
    actorName: MIKE.name,
    eventType: 'workout_done',
    refId: 'wo-mike-am',
    occurredAt: '2026-06-01T07:00:00.000Z',
  },
  {
    fitcircleId: CIRCLE_ID,
    actorUserId: SARAH.id,
    actorName: SARAH.name,
    eventType: 'workout_done',
    refId: 'wo-sarah-am',
    occurredAt: '2026-06-01T07:12:00.000Z',
  },
  {
    fitcircleId: CIRCLE_ID,
    actorUserId: PRIYA.id,
    actorName: PRIYA.name,
    eventType: 'workout_done',
    refId: 'wo-priya-am',
    occurredAt: '2026-06-01T07:25:00.000Z',
  },

  // --- Midday: Priya's 4th workout of the day (will hit per-member cap) ---
  {
    fitcircleId: CIRCLE_ID,
    actorUserId: PRIYA.id,
    actorName: PRIYA.name,
    eventType: 'workout_done',
    refId: 'wo-priya-midday',
    occurredAt: '2026-06-01T12:30:00.000Z',
  },

  // --- A weight log flows in from the body-metrics service. Hard-excluded:
  //     never a post. Modeled as a signal whose eventType is a hard-excluded source. ---
  {
    fitcircleId: CIRCLE_ID,
    actorUserId: MIKE.id,
    actorName: MIKE.name,
    // intentionally a HARD_EXCLUDED_SOURCES kind, not a taxonomy eventType:
    eventType: 'weight' as unknown as SystemEventType,
    refId: 'weigh-mike-eve',
    occurredAt: '2026-06-01T18:00:00.000Z',
    payload: { streakDays: 0 },
  },

  // --- Evening: Mike's 14-day streak milestone (p0 — always posts) ---
  {
    fitcircleId: CIRCLE_ID,
    actorUserId: PRIYA.id,
    actorName: PRIYA.name,
    eventType: 'streak_milestone',
    refId: 'streak-priya-14',
    occurredAt: '2026-06-01T20:00:00.000Z',
    payload: { streakDays: 14 },
  },

  // --- A new member joins ---
  {
    fitcircleId: CIRCLE_ID,
    actorUserId: SARAH.id,
    actorName: SARAH.name,
    eventType: 'member_joined',
    refId: null,
    occurredAt: '2026-06-01T21:00:00.000Z',
  },
];

// Convenience accessors for the test (by refId / eventType).
export const signalByRef = (refId: string): ActivitySignal => {
  const found = scriptedDaySignals.find((s) => s.refId === refId);
  if (!found) throw new Error(`fixture: no scripted signal with refId=${refId}`);
  return found;
};

// ----------------------------------------------------------------------------
// Builders for EnginePlanInput. Defaults are "wide open" (nothing posted yet, not
// quiet, event enabled) so each test only sets the knob it cares about.
// ----------------------------------------------------------------------------
export const emptyStats = (): RecentPostStats => ({
  perMemberRoutineToday: {},
  circlePostsThisHour: 0,
  recentSameTypeInWindow: [],
});

export interface PlanOverrides {
  config?: EngineConfig;
  stats?: Partial<RecentPostStats>;
  nowISO?: string;
  isQuietHours?: boolean;
  eventEnabled?: boolean;
}

export const buildPlanInput = (
  signal: ActivitySignal,
  overrides: PlanOverrides = {}
): EnginePlanInput => ({
  signal,
  config: overrides.config ?? { ...DEFAULT_ENGINE_CONFIG },
  stats: { ...emptyStats(), ...(overrides.stats ?? {}) },
  // Default to the signal's own occurredAt so "now" is sensible without wall clock.
  nowISO: overrides.nowISO ?? signal.occurredAt,
  isQuietHours: overrides.isQuietHours ?? false,
  // Default true so non-config-gated cases don't have to think about it; the
  // config-gated test passes false explicitly.
  eventEnabled: overrides.eventEnabled ?? true,
});

// Turn an emitted/earlier signal into the "recent same-type in window" shape the
// engine expects for bundling.
export const asRecentSameType = (...signals: ActivitySignal[]): ActivitySignal[] => signals;

// ----------------------------------------------------------------------------
// Expected friendly copy — the PINNED examples from the contract (section 4).
// If someone turns the copy into a dry journal log, these break.
// Each entry: a CopyContext-ish input + the EXACT expected string.
// ----------------------------------------------------------------------------
export interface PinnedCopyCase {
  label: string;
  eventType: SystemEventType;
  actors: { name: string }[];
  payload?: ActivitySignal['payload'] & Record<string, unknown>;
  expected: string;
}

export const pinnedCopyCases: PinnedCopyCase[] = [
  {
    label: 'workout_done (1 actor)',
    eventType: 'workout_done',
    actors: [{ name: 'Mike' }],
    expected: 'Mike just logged a workout 💪',
  },
  {
    label: 'workout_done (3 actors)',
    eventType: 'workout_done',
    actors: [{ name: 'Mike' }, { name: 'Sarah' }, { name: 'Priya' }],
    expected: 'Mike, Sarah & Priya all got moving today 🔥',
  },
  {
    label: 'streak_milestone',
    eventType: 'streak_milestone',
    actors: [{ name: 'Priya' }],
    payload: { streakDays: 14 },
    expected: "Priya's on a 14-day streak — nice 🔥",
  },
  {
    label: 'quest_done',
    eventType: 'quest_done',
    actors: [{ name: 'Sarah' }],
    payload: { questName: 'Hydration Quest' },
    expected: 'Sarah finished the Hydration Quest 🎉',
  },
  {
    label: 'challenge_milestone (halfway)',
    eventType: 'challenge_milestone',
    actors: [{ name: 'Mike' }],
    payload: { challengeMilestone: 'halfway', challengeName: 'Spring Cut' },
    expected: "Halfway through the Spring Cut — here's how everyone's doing",
  },
  {
    label: 'challenge_resolved',
    eventType: 'challenge_resolved',
    actors: [{ name: 'Mike' }],
    payload: { challengeName: 'Spring Cut' },
    expected: "That's a wrap on the Spring Cut! Tap to see how it went 🏆",
  },
  {
    label: 'member_joined (1 actor)',
    eventType: 'member_joined',
    actors: [{ name: 'Mike' }],
    expected: 'Mike just joined — say hi 👋',
  },
  {
    label: 'member_joined (2 actors)',
    eventType: 'member_joined',
    actors: [{ name: 'Mike' }, { name: 'Sarah' }],
    expected: 'Mike & Sarah just joined — say hi 👋',
  },
  {
    label: 'new_challenge',
    eventType: 'new_challenge',
    actors: [{ name: 'Mike' }],
    payload: { challengeName: '30-Day Clean Eating' },
    expected: "New challenge just dropped: 30-Day Clean Eating. Who's in?",
  },
  {
    label: 'daily_summary',
    eventType: 'daily_summary',
    actors: [],
    payload: { checkedIn: 4, total: 5 } as Record<string, unknown>,
    expected: "Today's circle: 4 of 5 checked in. Nice momentum 👏",
  },
  {
    label: 'notable_meal (no number)',
    eventType: 'notable_meal',
    actors: [{ name: 'Priya' }],
    payload: { mealDescriptor: 'high-protein lunch' },
    expected: 'Priya logged a high-protein lunch 🍽️',
  },
  {
    label: 'circle_streak',
    eventType: 'circle_streak',
    actors: [],
    payload: { loggedAtCount: 9 },
    expected: "The circle's kept it going 9 days strong 🔥",
  },
];

// Every event type, with a benign payload, for the safety scan. Covers the full
// taxonomy so the forbidden-substring check sees every template.
export const allEventTypeCopyInputs: {
  eventType: SystemEventType;
  actors: { name: string }[];
  payload?: Record<string, unknown>;
}[] = [
  { eventType: 'workout_done', actors: [{ name: 'Mike' }] },
  { eventType: 'workout_done', actors: [{ name: 'Mike' }, { name: 'Sarah' }, { name: 'Priya' }] },
  { eventType: 'notable_meal', actors: [{ name: 'Priya' }], payload: { mealDescriptor: 'high-protein lunch' } },
  { eventType: 'streak_milestone', actors: [{ name: 'Priya' }], payload: { streakDays: 14 } },
  { eventType: 'circle_streak', actors: [], payload: { loggedAtCount: 9 } },
  { eventType: 'quest_done', actors: [{ name: 'Sarah' }], payload: { questName: 'Hydration Quest' } },
  { eventType: 'challenge_milestone', actors: [{ name: 'Mike' }], payload: { challengeMilestone: 'one_week_left', challengeName: 'Spring Cut' } },
  { eventType: 'challenge_resolved', actors: [{ name: 'Mike' }], payload: { challengeName: 'Spring Cut' } },
  { eventType: 'daily_summary', actors: [], payload: { checkedIn: 4, total: 5 } },
  { eventType: 'member_joined', actors: [{ name: 'Mike' }] },
  { eventType: 'new_challenge', actors: [{ name: 'Mike' }], payload: { challengeName: '30-Day Clean Eating' } },
];
