/**
 * Plate Score types (PRD v4 §6.8).
 *
 * The Plate Score is a single glanceable 0–100 daily nutrition score that abstracts
 * macros into one friendly, non-triggering number. It blends three transparent inputs:
 *   - adherence: did the user log today (scaled by meal coverage)
 *   - balance:   how reasonable / varied the macro distribution is
 *   - goalFit:   alignment to the user's active challenge/goal target
 *
 * HEALTHY-ENGAGEMENT (PRD §6.7): the score rewards logging + balance + HITTING goals.
 * It never rewards restriction or low calories. The breakdown is returned verbatim for
 * full transparency and contains only friendly, non-shaming copy.
 */

/** A single transparent component, normalized 0–100. */
export type PlateScoreComponents = {
  /** Did they log today, scaled by how much of the day is covered. 0–100. */
  adherence: number;
  /** Macro distribution reasonableness / variety. 0–100. */
  balance: number;
  /** Alignment to active goal/challenge target (rewards hitting, not undershooting). 0–100. */
  goalFit: number;
};

/** Raw macro totals for the day, surfaced for transparency (never used to shame). */
export type PlateScoreMacroTotals = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** Number of food_log_entries that contributed macros that day. */
  entryCount: number;
};

/** The weights applied to each component, surfaced so the score is fully explainable. */
export type PlateScoreWeights = {
  adherence: number;
  balance: number;
  goalFit: number;
};

/**
 * Full transparency payload persisted in `plate_scores.breakdown` and returned to clients.
 * Contains only positive / neutral, non-punitive notes (§6.7).
 */
export type PlateScoreBreakdown = {
  weights: PlateScoreWeights;
  totals: PlateScoreMacroTotals;
  /** Friendly, non-shaming one-liners explaining what helped the score. */
  notes: string[];
  /** Persona/fitness-level basis used to pick targets + weights, for transparency. */
  basis: {
    persona: string | null;
    fitnessLevel: string | null;
    /** Whether an active challenge target informed goalFit. */
    usedChallengeTarget: boolean;
  };
};

/** The DTO returned by every PlateScoreService method and the mobile routes. */
export type PlateScoreDTO = {
  /** Final glanceable score, integer 0–100. */
  score: number;
  /** ISO date (YYYY-MM-DD) the score is for. */
  date: string;
  components: PlateScoreComponents;
  breakdown: PlateScoreBreakdown;
};

/**
 * FROZEN PlateScoreService signatures. Other services / routes depend on these exact
 * shapes — do not change without a coordinated migration.
 */
export interface IPlateScoreService {
  /** Compute (and upsert) the score for a given user + ISO date. */
  computeForDay(userId: string, date: string): Promise<PlateScoreDTO>;
  /** Return the cached score for the day, computing + caching it if missing. */
  getForDay(userId: string, date: string): Promise<PlateScoreDTO>;
  /** List scores for an inclusive ISO date range, newest first. */
  getRange(userId: string, startDate: string, endDate: string): Promise<PlateScoreDTO[]>;
}
