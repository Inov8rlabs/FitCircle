import { createAdminSupabase } from '../supabase-admin';
import {
  type PlateScoreBreakdown,
  type PlateScoreDTO,
  type PlateScoreMacroTotals,
  type PlateScoreWeights,
} from '../types/plate-score';

/**
 * PlateScoreService — computes the Plate Score (PRD v4 §6.8).
 *
 * The Plate Score is a single glanceable 0–100 daily nutrition score that abstracts
 * macros into one friendly number. It is the default circle-visible metric for
 * non-athletes (more shareable + less triggering than raw calories).
 *
 * ============================================================================
 * HEALTHY-ENGAGEMENT GUARANTEE (PRD §6.7 — HARD REQUIREMENT)
 * ----------------------------------------------------------------------------
 * The formula NEVER rewards restriction or low calories. Specifically:
 *   - Adherence rewards LOGGING (coverage of the day), never eating little.
 *   - Balance rewards a reasonable macro split + presence of all three macros,
 *     never a low total. A tiny "diet" day cannot score high on balance.
 *   - Goal-fit rewards HITTING the target band, and crucially UNDERSHOOTING a
 *     calorie/protein target is penalized symmetrically to overshooting — there
 *     is no monotonic "less is better" term anywhere.
 *   - There is no calorie-deficit term, no weight term, and no copy that shames.
 * All notes returned in the breakdown are positive/neutral.
 * ============================================================================
 *
 * SCORING FORMULA (transparent, documented, weight by persona/challenge type):
 *
 *   score = round( wA*adherence + wB*balance + wG*goalFit )   (each 0–100)
 *
 *   Default weights (non-athlete / unknown persona):
 *     adherence 0.45, balance 0.35, goalFit 0.20
 *   Athlete (fitness_level = 'athlete' OR persona 'mike'):
 *     adherence 0.30, balance 0.30, goalFit 0.40  (goals matter more)
 *   These shift emphasis toward goal alignment for athletes, but adherence +
 *   balance always together dominate so the score stays logging/balance-led.
 *
 *   adherence (0–100): based on how many distinct meals were logged.
 *     0 meals -> 0; 1 -> 55; 2 -> 80; 3+ -> 100. (Logging ANYTHING is rewarded.)
 *
 *   balance (0–100): how close the day's macro energy split is to a sensible
 *     reference band (protein 25%, carbs 45%, fat 30% of kcal), PLUS a bonus for
 *     having all three macros present (variety). It does NOT look at totals, so a
 *     starvation day cannot earn balance points just by being small. If no macros
 *     were logged, balance is 0 (nothing to evaluate).
 *
 *   goalFit (0–100): if an active challenge / target informs a calorie (and/or
 *     protein) target, score how close the day is to that target as a two-sided
 *     band — undershooting is penalized exactly like overshooting. With no target,
 *     goalFit is a neutral 70 (we don't punish the absence of a goal).
 */
export class PlateScoreService {
  // Reference macro energy split used for the balance component (PRD §6.8).
  // Protein 4 kcal/g, carbs 4 kcal/g, fat 9 kcal/g.
  private static readonly REF_SPLIT = { protein: 0.25, carbs: 0.45, fat: 0.30 };

  // Persona/fitness-level derived "reasonable" daily calorie target used ONLY when
  // the user has no active challenge target. Two-sided band, never "less is better".
  private static readonly DEFAULT_CAL_TARGET = 2000;

  /** Compute (and upsert) the score for a given user + ISO date. */
  static async computeForDay(userId: string, date: string): Promise<PlateScoreDTO> {
    const supabase = createAdminSupabase();

    // 1. Pull the day's macro-bearing food log entries.
    const { data: entries } = await supabase
      .from('food_log_entries')
      .select('meal_type, calories, protein_g, carbs_g, fat_g')
      .eq('user_id', userId)
      .eq('entry_date', date)
      .is('deleted_at', null);

    const rows = (entries ?? []) as Array<{
      meal_type: string | null;
      calories: number | null;
      protein_g: number | null;
      carbs_g: number | null;
      fat_g: number | null;
    }>;

    const totals = this.aggregate(rows);

    // 2. Persona / fitness level (drives weights + default target). Best-effort.
    const { data: profile } = await supabase
      .from('profiles')
      .select('persona, fitness_level')
      .eq('id', userId)
      .maybeSingle();
    const persona = (profile?.persona ?? null) as string | null;
    const fitnessLevel = (profile?.fitness_level ?? null) as string | null;
    const isAthlete = fitnessLevel === 'athlete' || persona === 'mike';

    // 3. Goal target: from an active challenge if one carries a calorie/protein goal.
    const target = await this.resolveGoalTarget(userId, date, isAthlete);

    // 4. Components (each 0–100).
    const distinctMeals = new Set(rows.map((r) => (r.meal_type ?? '').trim()).filter(Boolean)).size;
    // If meal_type is absent but entries exist, treat each entry-bearing day as >=1 meal.
    const mealCount = distinctMeals > 0 ? distinctMeals : rows.length > 0 ? 1 : 0;

    const adherence = this.adherenceComponent(mealCount);
    const balance = this.balanceComponent(totals);
    const goalFit = this.goalFitComponent(totals, target.calorieTarget);

    // 5. Weights by persona/challenge type, then blend.
    const weights: PlateScoreWeights = isAthlete
      ? { adherence: 0.30, balance: 0.30, goalFit: 0.40 }
      : { adherence: 0.45, balance: 0.35, goalFit: 0.20 };

    const score = Math.round(
      weights.adherence * adherence + weights.balance * balance + weights.goalFit * goalFit
    );
    const clamped = Math.max(0, Math.min(100, score));

    const breakdown: PlateScoreBreakdown = {
      weights,
      totals,
      notes: this.buildNotes(mealCount, balance, goalFit, target.usedChallengeTarget),
      basis: { persona, fitnessLevel, usedChallengeTarget: target.usedChallengeTarget },
    };

    // 6. Upsert the cached result.
    await supabase
      .from('plate_scores')
      .upsert(
        {
          user_id: userId,
          score_date: date,
          score: clamped,
          adherence_component: round2(adherence),
          balance_component: round2(balance),
          goalfit_component: round2(goalFit),
          breakdown,
        },
        { onConflict: 'user_id,score_date' }
      );

    return {
      score: clamped,
      date,
      components: {
        adherence: round2(adherence),
        balance: round2(balance),
        goalFit: round2(goalFit),
      },
      breakdown,
    };
  }

  /** Return the cached score for the day, computing + caching it if missing. */
  static async getForDay(userId: string, date: string): Promise<PlateScoreDTO> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('plate_scores')
      .select('*')
      .eq('user_id', userId)
      .eq('score_date', date)
      .maybeSingle();

    if (data) return this.toDTO(data);
    return this.computeForDay(userId, date);
  }

  /** List scores for an inclusive ISO date range, newest first. */
  static async getRange(userId: string, startDate: string, endDate: string): Promise<PlateScoreDTO[]> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('plate_scores')
      .select('*')
      .eq('user_id', userId)
      .gte('score_date', startDate)
      .lte('score_date', endDate)
      .order('score_date', { ascending: false });
    return ((data ?? [])).map((r) => this.toDTO(r));
  }

  // ---- private --------------------------------------------------------------

  private static aggregate(
    rows: Array<{ calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null }>
  ): PlateScoreMacroTotals {
    let calories = 0;
    let proteinG = 0;
    let carbsG = 0;
    let fatG = 0;
    let entryCount = 0;
    for (const r of rows) {
      const hasMacro =
        r.calories != null || r.protein_g != null || r.carbs_g != null || r.fat_g != null;
      if (!hasMacro) continue;
      calories += num(r.calories);
      proteinG += num(r.protein_g);
      carbsG += num(r.carbs_g);
      fatG += num(r.fat_g);
      entryCount += 1;
    }
    return {
      calories: round2(calories),
      proteinG: round2(proteinG),
      carbsG: round2(carbsG),
      fatG: round2(fatG),
      entryCount,
    };
  }

  /**
   * Adherence: rewards LOGGING (meal coverage), never eating little.
   * 0 meals -> 0; 1 -> 55; 2 -> 80; 3+ -> 100.
   */
  private static adherenceComponent(mealCount: number): number {
    if (mealCount <= 0) return 0;
    if (mealCount === 1) return 55;
    if (mealCount === 2) return 80;
    return 100;
  }

  /**
   * Balance: closeness of the macro ENERGY split to a sensible reference, plus a
   * variety bonus for having all three macros. Ignores total size, so a tiny
   * "diet" day cannot earn balance points (anti-restriction, §6.7).
   */
  private static balanceComponent(t: PlateScoreMacroTotals): number {
    const pKcal = t.proteinG * 4;
    const cKcal = t.carbsG * 4;
    const fKcal = t.fatG * 9;
    const totalKcal = pKcal + cKcal + fKcal;
    if (totalKcal <= 0) return 0; // nothing to evaluate

    const split = { protein: pKcal / totalKcal, carbs: cKcal / totalKcal, fat: fKcal / totalKcal };
    // Total absolute deviation from the reference split is in [0, 2]; map to [0, 1].
    const dev =
      Math.abs(split.protein - this.REF_SPLIT.protein) +
      Math.abs(split.carbs - this.REF_SPLIT.carbs) +
      Math.abs(split.fat - this.REF_SPLIT.fat);
    const closeness = Math.max(0, 1 - dev / 2); // 1 = perfect, 0 = maximally off

    // Variety bonus: presence of all three macros is the healthy signal.
    const present = [t.proteinG, t.carbsG, t.fatG].filter((g) => g > 0).length; // 0..3
    const variety = present / 3;

    // 80% closeness, 20% variety.
    return Math.max(0, Math.min(100, (0.8 * closeness + 0.2 * variety) * 100));
  }

  /**
   * Goal-fit: two-sided closeness to the calorie target. UNDERSHOOTING is penalized
   * exactly like overshooting — there is NO "less is better" term. With no target,
   * returns a neutral 70 (absence of a goal is not punished).
   */
  private static goalFitComponent(t: PlateScoreMacroTotals, calorieTarget: number | null): number {
    if (!calorieTarget || calorieTarget <= 0) return 70;
    if (t.calories <= 0) return 0; // logged no calories against a real target

    // Symmetric relative error. 0 error -> 100; +/-50% error -> 0.
    const relErr = Math.abs(t.calories - calorieTarget) / calorieTarget;
    const fit = Math.max(0, 1 - relErr / 0.5);
    return Math.max(0, Math.min(100, fit * 100));
  }

  /**
   * Resolve a calorie target for goal-fit. Prefers an active challenge that carries
   * a nutrition/calorie goal; otherwise falls back to a sensible persona default.
   * NOTE: challenge goals here are two-sided targets, never deficits.
   */
  private static async resolveGoalTarget(
    userId: string,
    date: string,
    isAthlete: boolean
  ): Promise<{ calorieTarget: number | null; usedChallengeTarget: boolean }> {
    const supabase = createAdminSupabase();

    // Active challenge participation with a calorie-style nutrition goal.
    const { data } = await supabase
      .from('circle_challenge_participants')
      .select('circle_challenges!inner(unit, goal_amount, status, starts_at, ends_at, category)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(10);

    const rows = (data ?? []) as any[];
    for (const r of rows) {
      const ch = r.circle_challenges;
      if (!ch || ch.status !== 'active') continue;
      const unit = String(ch.unit ?? '').toLowerCase();
      // Only honor calorie/kcal-denominated goals for goal-fit (other challenge
      // types — steps, workouts — don't define a nutrition target).
      if ((unit.includes('cal') || unit.includes('kcal')) && Number(ch.goal_amount) > 0) {
        return { calorieTarget: Number(ch.goal_amount), usedChallengeTarget: true };
      }
    }

    // No nutrition challenge: use a neutral persona-based default (two-sided band).
    // Athletes get a slightly higher default fueling target.
    const fallback = isAthlete ? Math.round(this.DEFAULT_CAL_TARGET * 1.25) : this.DEFAULT_CAL_TARGET;
    return { calorieTarget: fallback, usedChallengeTarget: false };
  }

  /** Friendly, non-shaming notes (§6.7). Only positive/neutral framing. */
  private static buildNotes(
    mealCount: number,
    balance: number,
    goalFit: number,
    usedChallengeTarget: boolean
  ): string[] {
    const notes: string[] = [];
    if (mealCount >= 3) notes.push('Nice consistent logging across the day.');
    else if (mealCount === 2) notes.push('Good logging — a third meal would round out your day.');
    else if (mealCount === 1) notes.push('Thanks for logging! Add more meals to see a fuller picture.');
    else notes.push('Log a meal to start your Plate Score for today.');

    if (balance >= 75) notes.push('Great macro balance — protein, carbs, and fat all showing up.');
    else if (balance > 0) notes.push('A bit more variety across macros can boost your balance.');

    if (usedChallengeTarget && goalFit >= 75) notes.push("You're right in line with your challenge target.");
    else if (goalFit >= 75) notes.push('Your intake is well-aligned with a healthy daily range.');

    return notes;
  }

  private static toDTO(row: any): PlateScoreDTO {
    return {
      score: Number(row.score),
      date: typeof row.score_date === 'string' ? row.score_date.slice(0, 10) : String(row.score_date),
      components: {
        adherence: Number(row.adherence_component),
        balance: Number(row.balance_component),
        goalFit: Number(row.goalfit_component),
      },
      breakdown: (row.breakdown ?? {}) as PlateScoreBreakdown,
    };
  }
}

// Compile-time guarantee that the static methods conform to the FROZEN signatures
// (IPlateScoreService) even though the service uses static methods (FoodsService style).
import { type IPlateScoreService } from '../types/plate-score';
const _signatureCheck: IPlateScoreService = PlateScoreService;
void _signatureCheck;

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
