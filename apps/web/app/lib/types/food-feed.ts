// Social Food Feed + Log Reactions — shared type contract (FROZEN).
// PRD v4 §6.3 (circle food feed + reactions, leaderboard nutrition metrics) / §6.7
// (healthy engagement). Mirrors migration 058_food_feed_reactions.sql.
//
// This file is the single source of truth for the food-feed feature's shapes and the
// CircleFoodFeedService API surface. The service and every route handler build against
// it; nothing here changes without updating the service + all routes together.
//
// The six-emoji reaction vocabulary is REUSED from circle chat — it is the SAME tapback
// set (flame|clap|eyes|same|heart|laugh). We import ReactionKind/REACTION_KINDS rather
// than re-declaring, so the feed and chat can never drift apart.

import { type ReactionKind, REACTION_KINDS } from './circle-chat';

export { type ReactionKind, REACTION_KINDS };

// ============================================================================
// DB row shape (snake_case — as stored; mirrors 058)
// ============================================================================

export interface LogReactionRow {
  food_log_entry_id: string;
  user_id: string;
  reaction: ReactionKind;
  created_at: string;
}

// ============================================================================
// API DTO (camelCase — what the client contract returns; PRD §6.3)
// The service maps rows -> this shape. Clients render this; never re-derive.
// ============================================================================

/** Owner of a food log surfaced into the feed. */
export interface FoodFeedOwner {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Macros for a feed card. SUBJECT TO PRIVACY (§6.4): this is null when the entry's
 * privacy tier does not expose macros to the viewer. For this slice macros are
 * present whenever the entry is visible (visibility 'circle'|'shared'); the full
 * full/summary/private tiering arrives once FoodPrivacyService is wired in.
 */
export interface FoodFeedMacros {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

/** A reaction tally on a feed card (one entry per reaction kind that has >=1 count). */
export interface LogReactionSummary {
  reaction: ReactionKind;
  count: number;
  reactedByMe: boolean;
}

/** A single card in the circle food feed (one per surfaced food_log_entry). */
export interface FoodFeedCardDTO {
  id: string; // food_log_entries.id
  owner: FoodFeedOwner;
  foodName: string;
  loggedAt: string; // ISO timestamp (food_log_entries.logged_at)
  photoUrl: string | null; // signed URL to the meal photo, or null
  macros: FoodFeedMacros | null; // null when privacy hides macros (§6.4)
  reactions: LogReactionSummary[];
}

// ============================================================================
// Service input / output shapes
// ============================================================================

export interface FoodFeedParams {
  before?: string; // ISO timestamp; return entries logged strictly before this (reverse-chron paging)
  limit?: number; // default 20, max 50
}

export interface FoodFeedResult {
  cards: FoodFeedCardDTO[]; // reverse-chronological (newest first)
  hasMore: boolean;
  nextBefore: string | null; // pass back as `before` for the next page
}

export const FOOD_FEED_DEFAULT_LIMIT = 20;
export const FOOD_FEED_MAX_LIMIT = 50;

// ============================================================================
// Leaderboard nutrition metrics (PRD §6.3 — ADDITIVE to the existing leaderboard).
// §6.7: ranks on consistency / adherence / showing-up — NEVER "fewest calories" or
// "fastest loss". No restriction ranking. Every metric below is a higher-is-better
// "did you show up and log" signal, not an intake-minimization signal.
// ============================================================================

export interface NutritionLeaderboardRow {
  user: FoodFeedOwner;
  /**
   * Adherence %: (# distinct days in the circle's date range with >=1 calorie-bearing
   * food_log_entry) / (# challenge days elapsed so far), 0..100, rounded.
   */
  adherencePct: number;
  daysLogged: number; // numerator of adherence
  challengeDays: number; // denominator of adherence (days elapsed, clamped to range)
  /**
   * Calorie-goal hit rate: identical numerator semantics for this slice — the share of
   * elapsed days on which the member logged calories at all. (A true goal-comparison
   * lands once per-user calorie goals are wired; until then "hit" = "logged calories",
   * an adherence/showing-up signal, never a restriction signal — §6.7.)
   */
  calorieGoalHitRatePct: number;
  /** Nutrition log streak: current run of consecutive days (ending today/last range day) with a calorie-bearing entry. */
  nutritionLogStreak: number;
}

export interface NutritionLeaderboardResult {
  fitcircleId: string;
  rangeStart: string | null; // ISO date (inclusive) — the circle's start_date (date part)
  rangeEnd: string | null; // ISO date (inclusive) — min(circle end_date, today)
  rows: NutritionLeaderboardRow[]; // ranked by adherence desc, then streak desc
}

// ============================================================================
// CircleFoodFeedService API surface (FROZEN signatures)
// ----------------------------------------------------------------------------
// Implemented as a class of static methods (matching FoodsService / CircleChatService),
// using createAdminSupabase() (service_role; RLS is defense in depth — the service
// authorizes explicitly via an active-member check).
//
// REQUIRED methods (exact signatures — service impl + route handlers must agree):
//
//   class CircleFoodFeedService {
//     // Throws Error('Forbidden') if user is not an active member of the circle.
//     static async assertActiveMember(circleId: string, userId: string): Promise<void>
//
//     // Resolve the circle context for a food log entry's owner. Throws Error('NotFound').
//     // Returns the entry owner id (used to authorize reactions against shared circles).
//     static async getEntryOwnerId(entryId: string): Promise<string>
//
//     // GET /circles/:id/food-feed?before=&limit=
//     static async getFeed(fitcircleId: string, viewerUserId: string, params: FoodFeedParams): Promise<FoodFeedResult>
//
//     // POST /food-log/:id/reactions { reaction }
//     static async addReaction(entryId: string, userId: string, reaction: ReactionKind): Promise<LogReactionSummary[]>
//
//     // DELETE /food-log/:id/reactions/:reaction
//     static async removeReaction(entryId: string, userId: string, reaction: ReactionKind): Promise<LogReactionSummary[]>
//
//     // GET /circles/:id/nutrition-leaderboard
//     static async nutritionLeaderboard(fitcircleId: string, viewerUserId: string): Promise<NutritionLeaderboardResult>
//   }
//
// Error contract (service throws plain Error; routes map them):
//   'Unauthorized' -> 401   (from requireMobileAuth)
//   'Forbidden'    -> 403   (not an active member / not authorized to react)
//   'NotFound'     -> 404   (entry/circle missing)
//   'BadRequest'   -> 400   (invalid reaction / input)
//   else           -> 500
// ============================================================================
