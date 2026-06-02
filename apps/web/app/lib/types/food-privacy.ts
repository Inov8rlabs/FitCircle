/**
 * Three-tier per-circle food privacy — types & frozen service contract.
 * PRD v4 §6.4 (tiers) / §7.2.1, §7.7 (the fail-closed, server-side filter).
 *
 * The keystone property (§7.7): clients receive ONLY what the server-side filter has
 * already stripped. A viewer can never leak food data they were never sent. These types
 * describe (a) the tiers, (b) the raw owner entry the filter consumes, and (c) the
 * FilteredFoodEntry / summary shapes — i.e. exactly what a viewer is allowed to see.
 */

/** The three privacy tiers, ordered loosest -> strictest. */
export type FoodPrivacyTier = 'full' | 'summary' | 'private';

export const FOOD_PRIVACY_TIERS: readonly FoodPrivacyTier[] = ['full', 'summary', 'private'] as const;

/** The default tier for any (circle, user) without an explicit row (§6.4). */
export const DEFAULT_FOOD_PRIVACY_TIER: FoodPrivacyTier = 'summary';

/** A stored per-circle tier row (mirrors the circle_food_privacy table). */
export interface CircleFoodPrivacyRow {
  fitcircleId: string;
  userId: string;
  tier: FoodPrivacyTier;
  createdAt: string;
  updatedAt: string;
}

/**
 * A raw owner-side food entry as the filter consumes it. Macros come from the 054 columns.
 * `hiddenByUser` is the retained per-log "hide this" override; such entries are NEVER shown
 * to anyone but the owner regardless of tier, and are excluded from summary aggregation.
 */
export interface OwnerFoodEntry {
  id: string;
  userId: string;
  entryDate: string; // YYYY-MM-DD
  mealType: string | null;
  foodName: string | null;
  photoUrl: string | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  /** Per-log override: the owner chose to hide this single entry from circles. */
  hiddenByUser: boolean;
}

/**
 * What a viewer is allowed to see for a SINGLE entry under the `full` tier.
 * (Owner identity is included so the feed can attribute the entry; nothing else is added
 * beyond what `full` permits.)
 */
export interface FilteredFoodEntry {
  id: string;
  ownerUserId: string;
  entryDate: string;
  mealType: string | null;
  foodName: string | null;
  photoUrl: string | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

/**
 * What a viewer is allowed to see under the `summary` tier: daily totals only, no per-meal
 * rows, no photos, no food names. One object per (owner, day).
 */
export interface FoodDailySummary {
  ownerUserId: string;
  entryDate: string;
  totalCalories: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
  entryCount: number;
}

/**
 * The discriminated result of filtering one owner's entries for one viewer in one circle.
 * - 'full'    -> entries[] (FilteredFoodEntry)
 * - 'summary' -> summaries[] (FoodDailySummary), one per day
 * - 'private' -> nothing food-related
 * The `tier` is echoed so callers can render the correct surface without re-deriving it.
 */
export type FilteredFoodResult =
  | { tier: 'full'; entries: FilteredFoodEntry[] }
  | { tier: 'summary'; summaries: FoodDailySummary[] }
  | { tier: 'private' };

/** A circle member's tier, for the feed's "what should I fetch" decision. */
export interface MemberFoodTier {
  userId: string;
  tier: FoodPrivacyTier;
}

/**
 * FROZEN FoodPrivacyService contract (do not change these signatures — clients & feed code
 * depend on them). Implementation lives in lib/services/food-privacy-service.ts.
 */
export interface IFoodPrivacyService {
  /** The user's tier for that circle; DEFAULT_FOOD_PRIVACY_TIER if no row / on uncertainty. */
  getTier(fitcircleId: string, userId: string): Promise<FoodPrivacyTier>;

  /** Upsert the user's tier for that circle. */
  setTier(fitcircleId: string, userId: string, tier: FoodPrivacyTier): Promise<FoodPrivacyTier>;

  /**
   * THE fail-closed filter. Returns what `viewerUserId` may see of `ownerUserId`'s `entries`
   * in `fitcircleId`, based on the owner's tier. Defaults to the MOST restrictive outcome on
   * any uncertainty. Pure aside from the single tier read.
   */
  filterEntriesForCircle(
    ownerUserId: string,
    viewerUserId: string,
    fitcircleId: string,
    entries: OwnerFoodEntry[]
  ): Promise<FilteredFoodResult>;

  /** Each active member's tier in the circle (so a feed can decide what to fetch). */
  getTiersForCircle(fitcircleId: string, viewerUserId: string): Promise<MemberFoodTier[]>;
}
