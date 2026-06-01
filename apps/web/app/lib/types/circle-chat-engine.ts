// Circle Chat — System-Post Engine contract (FROZEN).
// Build Spec v1.2 §3 (taxonomy), §4 (bundling/rate-limiting), §7 (safety copy).
//
// The engine turns activity SIGNALS from across the product into system posts in the
// circle_messages timeline — filtered, bundled, rate-limited, and rendered with friendly
// "update" copy (never a dry journal log). This file is the single source of truth shared
// by the engine implementation, the source-service hooks, and the replay eval.

import type { SystemEventType, MessagePriority, RenderHint } from './circle-chat';

// ============================================================================
// 1. SIGNALS — what source services emit (NOT what gets posted; the engine decides that)
// ============================================================================

// Every signal names: the circle it concerns, the actor, the event, a ref to the source
// row, an ISO timestamp, and an optional typed payload used for copy + dedupe.
export interface ActivitySignal {
  fitcircleId: string;
  actorUserId: string;
  actorName: string;          // pre-resolved display name (engine doesn't re-query for copy)
  eventType: SystemEventType;
  refId: string | null;       // source row id (workout/meal/quest/challenge)
  occurredAt: string;         // ISO8601
  payload?: SignalPayload;
}

// Loosely-typed payload bag; only the fields a given eventType needs are set.
export interface SignalPayload {
  streakDays?: number;            // streak_milestone / circle_streak
  questName?: string;             // quest_done
  challengeName?: string;         // challenge_milestone / challenge_resolved / new_challenge
  challengeMilestone?: 'halfway' | 'one_week_left' | 'final_day';
  mealDescriptor?: string;        // notable_meal — e.g. "high-protein lunch" (NEVER calories)
  notableReason?: 'first_log_today' | 'advances_challenge'; // why a meal is notable
  loggedAtCount?: number;         // for circle_streak: "9 days strong"
  checkedIn?: number;             // daily_summary: "{checkedIn} of {total} checked in"
  total?: number;                 // daily_summary: circle member count
  // Hard rule: no weight, body measurements, alcohol/beverage, or raw calorie fields ever.
}

// ============================================================================
// 2. TAXONOMY — the authoritative allow-list (Build Spec §3)
// If an eventType is not a key here, it NEVER posts.
// ============================================================================

export interface EventPolicy {
  priority: MessagePriority;          // p0 bypasses all limits; p1 ceiling-bound; p2 bundle-aggressively
  bundleable: boolean;                // can collapse with same-type events in the window
  cappable: boolean;                  // counts against the per-member routine cap
  renderHint: RenderHint;
  /** config-gated OFF until a sibling workstream lands (Build Spec §8a) */
  enabledByDefault: boolean;
}

// The frozen taxonomy. enabledByDefault=false items ship dark until their dependency lands.
export const EVENT_TAXONOMY: Record<SystemEventType, EventPolicy> = {
  workout_done:        { priority: 'p2', bundleable: true,  cappable: true,  renderHint: 'text',            enabledByDefault: true  },
  notable_meal:        { priority: 'p1', bundleable: true,  cappable: true,  renderHint: 'text',            enabledByDefault: false }, // needs §6.8 Plate Score / nutrition
  streak_milestone:    { priority: 'p0', bundleable: false, cappable: false, renderHint: 'stat_card',       enabledByDefault: true  },
  circle_streak:       { priority: 'p0', bundleable: false, cappable: false, renderHint: 'stat_card',       enabledByDefault: false }, // needs §6.13 circle streak
  quest_done:          { priority: 'p1', bundleable: false, cappable: false, renderHint: 'text',            enabledByDefault: true  },
  challenge_milestone: { priority: 'p0', bundleable: false, cappable: false, renderHint: 'stat_card',       enabledByDefault: true  },
  challenge_resolved:  { priority: 'p0', bundleable: false, cappable: false, renderHint: 'completion_card', enabledByDefault: true  },
  daily_summary:       { priority: 'p1', bundleable: false, cappable: false, renderHint: 'summary_card',    enabledByDefault: true  },
  member_joined:       { priority: 'p1', bundleable: true,  cappable: false, renderHint: 'text',            enabledByDefault: true  },
  new_challenge:       { priority: 'p1', bundleable: false, cappable: false, renderHint: 'text',            enabledByDefault: true  },
};

// Hard exclusions — event/source kinds that must NEVER become a post, enforced
// independent of taxonomy (Build Spec §3, §7). The engine asserts none of these leak.
export const HARD_EXCLUDED_SOURCES = ['weight', 'body_measurement', 'beverage', 'alcohol'] as const;
export type HardExcludedSource = (typeof HARD_EXCLUDED_SOURCES)[number];

// ============================================================================
// 3. TUNING KNOBS (Build Spec §4.3 — config, not hardcoded magic numbers)
// ============================================================================

export interface EngineConfig {
  bundleWindowMinutes: number;        // same-type events within this collapse into one post
  perMemberDailyRoutineCap: number;   // routine (cappable) posts per member per day
  circleHourlyCeiling: number;        // total ceiling-bound posts per circle per hour
  quietHours: { startHour: number; endHour: number } | null; // local; posts queue, release after
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  bundleWindowMinutes: 30,
  perMemberDailyRoutineCap: 3,
  circleHourlyCeiling: 6,
  quietHours: null, // inherited per-circle from NotificationOrchestrator at runtime
};

// ============================================================================
// 4. COPY — friendly "update" voice, never a journal log (USER REQUIREMENT)
// ----------------------------------------------------------------------------
// Tone rules (enforced by template design + the eval's copy assertions):
//   * Reads like a friend's nudge, not a database row. "Mike just crushed a workout 💪"
//     NOT "Workout logged: Mike, 2026-06-01T09:00Z".
//   * Body- & food-NEUTRAL: never ranks by restriction, never shames, never labels food
//     good/bad, never shows calories/weight. (Build Spec §7, healthy-engagement gate.)
//   * Present-tense, active, a little warm. Light emoji ok (≤1), never required.
//   * Bundles read naturally: "Mike, Sarah & Priya all got moving tonight 🔥".
//   * Always set a plain-text `body` even for card renders (forward-compat fallback).
//
// Templates are pure functions of a typed input → string, so the eval can assert exact copy.
// ============================================================================

export interface CopyActor { name: string }

export interface CopyContext {
  eventType: SystemEventType;
  actors: CopyActor[];        // 1 actor normally; >1 when bundled
  payload?: SignalPayload;
}

// The engine calls renderCopy(ctx) -> body string. Implementations live in the engine file;
// the eval imports the engine's renderer and asserts output for fixed inputs.
// Example expected outputs (the eval pins these — keep them friendly):
//   workout_done (1):   "Mike just logged a workout 💪"
//   workout_done (3):   "Mike, Sarah & Priya all got moving today 🔥"
//   streak_milestone:   "Priya's on a 14-day streak — nice 🔥"
//   quest_done:         "Sarah finished the Hydration Quest 🎉"
//   challenge_milestone:"Halfway through the Spring Cut — here's how everyone's doing"
//   challenge_resolved: "That's a wrap on the Spring Cut! Tap to see how it went 🏆"
//   member_joined (1):  "Mike just joined — say hi 👋"
//   member_joined (2):  "Mike & Sarah just joined — say hi 👋"
//   new_challenge:      "New challenge just dropped: 30-Day Clean Eating. Who's in?"
//   daily_summary:      "Today's circle: 4 of 5 checked in. Nice momentum 👏"
//   notable_meal:       "Priya logged a high-protein lunch 🍽️"   (NEVER a number)
//   circle_streak:      "The circle's kept it going 9 days strong 🔥"

// ============================================================================
// 5. ENGINE API (FROZEN signatures)
// ----------------------------------------------------------------------------
// class SystemPostEngine {
//   constructor(config?: Partial<EngineConfig>)  // merges over DEFAULT_ENGINE_CONFIG
//
//   // PURE decision core — no DB, no clock, no randomness. Given the signals already
//   // in a window + the posts already made today/this-hour, decide the resulting posts.
//   // This is what the eval drives directly (deterministic).
//   plan(input: EnginePlanInput): PlannedPost[]
//
//   // renderCopy(ctx): friendly body string (pure; eval-asserted).
//   renderCopy(ctx: CopyContext): string
//
//   // Side-effectful entrypoint the hooks call (resolves circles, loads recent-post
//   // counts, calls plan(), writes via CircleChatService.emitSystemPost, broadcasts).
//   // Fire-and-forget / failure-isolated: never throws back into the source write.
//   async ingest(signal: ActivitySignal): Promise<void>
// }
// ============================================================================

export interface RecentPostStats {
  // Counts the engine needs to enforce caps/ceiling — supplied by ingest(), passed to plan().
  perMemberRoutineToday: Record<string, number>; // actorUserId -> routine posts already today
  circlePostsThisHour: number;                    // ceiling-bound posts already this hour
  recentSameTypeInWindow: ActivitySignal[];       // same-type signals within bundleWindow (for bundling)
}

export interface EnginePlanInput {
  signal: ActivitySignal;
  config: EngineConfig;
  stats: RecentPostStats;
  nowISO: string;                  // injected (no Date.now in core) so the eval is deterministic
  isQuietHours: boolean;           // resolved by ingest(); core just honors it
  eventEnabled: boolean;           // taxonomy enabledByDefault AND any runtime override
}

export type PostDisposition =
  | 'post'              // write a standalone post now
  | 'post_bundled'      // write/extend a bundle post
  | 'drop_to_summary'   // over cap/ceiling → roll into daily summary, no live post
  | 'suppressed'        // hard-excluded / disabled / not in taxonomy → nothing
  | 'queued_quiet';     // quiet hours → write timeline row but defer push (push handled elsewhere)

export interface PlannedPost {
  disposition: PostDisposition;
  // present when disposition is post / post_bundled / queued_quiet:
  eventType?: SystemEventType;
  priority?: MessagePriority;
  renderHint?: RenderHint;
  actorUserIds?: string[];        // >1 when bundled
  body?: string;                  // rendered friendly copy
  refId?: string | null;
  bundleOfRefIds?: string[];      // source refs folded into a bundle
  reason?: string;                // why this disposition (for eval readability)
}

// ============================================================================
// 6. SOURCE-SERVICE HOOK API (FROZEN)
// ----------------------------------------------------------------------------
// One thin module the source services import. Each helper builds the right
// ActivitySignal(s) — resolving the user's active circles — and fire-and-forgets
// to the engine. MUST NOT throw into the caller (mirror BoostService.recalculate...).
//
// class ChatActivityHooks {
//   static async onWorkoutCompleted(userId: string, workoutRefId: string): Promise<void>
//   static async onStreakMilestone(userId: string, streakDays: number): Promise<void>
//   static async onQuestCompleted(fitcircleId: string, userId: string, questId: string, questName: string): Promise<void>
//   static async onChallengeMilestone(fitcircleId: string, milestone: 'halfway'|'one_week_left'|'final_day', challengeName: string): Promise<void>
//   static async onChallengeResolved(fitcircleId: string, challengeId: string, challengeName: string): Promise<void>
//   static async onMemberJoined(fitcircleId: string, userId: string): Promise<void>
//   static async onNewChallenge(fitcircleId: string, challengeId: string, challengeName: string): Promise<void>
//   // notable_meal / circle_streak intentionally omitted until their deps land (§8a).
// }
//
// Each resolves circles via: select fitcircle_id from fitcircle_members
//   where user_id = $1 and status = 'active'  (the real membership shape).
// ============================================================================
