import { createAdminSupabase } from '../supabase-admin';
import {
  type NutritionMetricType,
  type NutritionChallengeConfigRow,
  type NutritionChallengeConfigDTO,
  type NutritionChallengeMember,
  type NutritionChallengeMemberProgress,
  type NutritionChallengeProgressDTO,
  type NutritionChallengeServiceContract,
  NUTRITION_METRIC_TYPES,
  TARGET_REQUIRED_METRICS,
  MAX_TARGET_VALUE,
} from '../types/nutrition-challenge';

/**
 * NutritionChallengeService — nutrition-driven challenge metrics (PRD v4 §6.5).
 *
 * Makes nutrition a first-class metric for the EXISTING challenge system. It REUSES
 * the existing challenge library (fitcircles + fitcircle_members); it does NOT modify
 * the challenge services. Per-member progress for the configured metric is computed
 * here, in TypeScript (no stored procs), over the challenge window.
 *
 * Authorization is explicit in-code (admin client): config writes require the circle
 * creator; reads + progress require active membership. RLS on the table is defense in
 * depth for any direct authenticated access.
 *
 * §6.7 (hard rule): ranking is ALWAYS on adherence / consistency — HITTING targets
 * and showing up. Never on eating least. target_value is a goal to reach, not a
 * less-is-better ceiling.
 */
export class NutritionChallengeService {
  // Tags that mark a food log entry as containing animal flesh, disqualifying that
  // day from counting as fully vegetarian (case-insensitive, substring match).
  private static readonly NON_VEG_TAGS = [
    'meat',
    'beef',
    'pork',
    'chicken',
    'poultry',
    'fish',
    'seafood',
    'shellfish',
    'lamb',
    'non-veg',
    'nonveg',
    'non_veg',
  ];

  // ==========================================================================
  // CONFIG
  // ==========================================================================

  /** Upsert the nutrition metric for a challenge. Caller MUST be the circle creator. */
  static async setConfig(
    fitcircleId: string,
    userId: string,
    metricType: NutritionMetricType,
    targetValue: number | null
  ): Promise<NutritionChallengeConfigDTO> {
    if (!NUTRITION_METRIC_TYPES.includes(metricType)) {
      throw new Error('BadRequest');
    }

    const normalizedTarget = this.normalizeTarget(metricType, targetValue);

    const supabaseAdmin = createAdminSupabase();

    // Only the circle creator may configure the metric.
    await this.assertCreator(fitcircleId, userId);

    const { data, error } = await supabaseAdmin
      .from('nutrition_challenge_config')
      .upsert(
        {
          fitcircle_id: fitcircleId,
          metric_type: metricType,
          target_value: normalizedTarget,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'fitcircle_id' }
      )
      .select('*')
      .single();

    if (error || !data) throw new Error(error?.message ?? 'config_upsert_failed');
    return this.toConfigDTO(data as NutritionChallengeConfigRow);
  }

  /** Read the config. Gated to active members. null when unconfigured. */
  static async getConfig(
    fitcircleId: string,
    userId: string
  ): Promise<NutritionChallengeConfigDTO | null> {
    const supabaseAdmin = createAdminSupabase();
    await this.assertActiveMember(fitcircleId, userId);

    const { data, error } = await supabaseAdmin
      .from('nutrition_challenge_config')
      .select('*')
      .eq('fitcircle_id', fitcircleId)
      .maybeSingle();

    if (error) throw error;
    return data ? this.toConfigDTO(data as NutritionChallengeConfigRow) : null;
  }

  // ==========================================================================
  // PROGRESS
  // ==========================================================================

  /**
   * Compute per-member progress for the configured metric over the challenge window.
   * Falls back to the 'standard' metric (logging adherence) when no config exists.
   */
  static async computeProgress(
    fitcircleId: string,
    userId: string
  ): Promise<NutritionChallengeProgressDTO> {
    const supabaseAdmin = createAdminSupabase();
    await this.assertActiveMember(fitcircleId, userId);

    // Challenge window from the existing challenge (fitcircles) row.
    const { data: circle, error: circleErr } = await supabaseAdmin
      .from('fitcircles')
      .select('id, start_date, end_date')
      .eq('id', fitcircleId)
      .maybeSingle();
    if (circleErr) throw circleErr;
    if (!circle) throw new Error('NotFound');

    const config = await this.getConfig(fitcircleId, userId);
    const metricType: NutritionMetricType = config?.metricType ?? 'standard';
    const targetValue = config?.targetValue ?? null;

    const today = this.todayDateOnly();
    const rangeStart = circle.start_date ? this.toDateOnly(circle.start_date as string) : null;
    const circleEnd = circle.end_date ? this.toDateOnly(circle.end_date as string) : null;
    // Cap the window at today so future days don't dilute adherence.
    const rangeEnd = circleEnd ? (circleEnd < today ? circleEnd : today) : today;

    const challengeDays =
      rangeStart && rangeEnd ? Math.max(this.daysInclusive(rangeStart, rangeEnd), 1) : 0;

    // Active members.
    const { data: members, error: membersErr } = await supabaseAdmin
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', fitcircleId)
      .eq('status', 'active');
    if (membersErr) throw membersErr;

    const memberIds = (members ?? []).map((m) => m.user_id as string);
    if (memberIds.length === 0) {
      return {
        fitcircleId,
        metricType,
        targetValue,
        rangeStart,
        rangeEnd,
        challengeDays,
        rows: [],
      };
    }

    const ownerById = await this.fetchMembers(memberIds);

    // Per-metric per-member computation.
    const computed =
      metricType === 'sober_days'
        ? await this.computeSoberDays(memberIds, rangeStart, rangeEnd)
        : await this.computeFromFoodLogs(metricType, targetValue, memberIds, rangeStart, rangeEnd);

    let rows: NutritionChallengeMemberProgress[] = memberIds.map((uid) => {
      const c = computed.get(uid) ?? { successDays: 0, daysLogged: 0, sum: 0 };
      const adherencePct =
        challengeDays > 0 ? Math.round((c.successDays / challengeDays) * 100) : 0;
      const averageValue =
        TARGET_REQUIRED_METRICS.includes(metricType) && c.daysLogged > 0
          ? Math.round((c.sum / c.daysLogged) * 10) / 10
          : null;

      return {
        member: ownerById.get(uid) ?? { id: uid, name: 'Member', avatarUrl: null },
        successDays: c.successDays,
        daysLogged: c.daysLogged,
        challengeDays,
        adherencePct,
        averageValue,
        rank: 0,
        isCurrentUser: uid === userId,
      };
    });

    // Rank: adherence desc, then days-logged (showing up) desc, then name asc.
    // §6.7: this is consistency-based; nothing here rewards eating least.
    rows.sort(
      (a, b) =>
        b.adherencePct - a.adherencePct ||
        b.daysLogged - a.daysLogged ||
        a.member.name.localeCompare(b.member.name)
    );
    rows = rows.map((r, i) => ({ ...r, rank: i + 1 }));

    return {
      fitcircleId,
      metricType,
      targetValue,
      rangeStart,
      rangeEnd,
      challengeDays,
      rows,
    };
  }

  // ==========================================================================
  // METRIC COMPUTATION
  // ==========================================================================

  /**
   * Food-log-backed metrics: calorie_target / protein_target / carb_target / veg_days
   * / standard. One query for the whole circle, aggregated per member per day in JS.
   *
   * successDays definition per metric:
   *  - calorie_target: days whose total calories are within ±tolerance of the target
   *    (a band around the goal — hitting it, not undershooting it; §6.7).
   *  - protein_target / carb_target: days whose total grams MEET-OR-EXCEED the target
   *    (reaching the goal).
   *  - veg_days: days that have >= 1 entry and NO entry tagged with a non-veg tag.
   *  - standard: days with any logged food entry (pure logging adherence).
   */
  private static async computeFromFoodLogs(
    metricType: NutritionMetricType,
    targetValue: number | null,
    memberIds: string[],
    rangeStart: string | null,
    rangeEnd: string | null
  ): Promise<Map<string, { successDays: number; daysLogged: number; sum: number }>> {
    const supabaseAdmin = createAdminSupabase();

    let query = supabaseAdmin
      .from('food_log_entries')
      .select('user_id, entry_date, calories, protein_g, carbs_g, tags')
      .in('user_id', memberIds)
      .is('deleted_at', null);
    if (rangeStart) query = query.gte('entry_date', rangeStart);
    if (rangeEnd) query = query.lte('entry_date', rangeEnd);

    const { data: entries, error } = await query;
    if (error) throw error;

    // user_id -> day -> aggregate { calories, protein, carbs, anyNonVeg, count }
    type DayAgg = {
      calories: number;
      protein: number;
      carbs: number;
      anyNonVeg: boolean;
      count: number;
    };
    const byUserDay = new Map<string, Map<string, DayAgg>>();

    for (const e of entries ?? []) {
      const uid = e.user_id as string;
      const day = this.toDateOnly(e.entry_date as string);
      let days = byUserDay.get(uid);
      if (!days) {
        days = new Map<string, DayAgg>();
        byUserDay.set(uid, days);
      }
      let agg = days.get(day);
      if (!agg) {
        agg = { calories: 0, protein: 0, carbs: 0, anyNonVeg: false, count: 0 };
        days.set(day, agg);
      }
      agg.calories += Number(e.calories ?? 0);
      agg.protein += Number(e.protein_g ?? 0);
      agg.carbs += Number(e.carbs_g ?? 0);
      agg.count += 1;
      if (this.isNonVegEntry(e.tags as string[] | null)) agg.anyNonVeg = true;
    }

    const result = new Map<string, { successDays: number; daysLogged: number; sum: number }>();

    for (const uid of memberIds) {
      const days = byUserDay.get(uid);
      let successDays = 0;
      let daysLogged = 0;
      let sum = 0;

      if (days) {
        for (const agg of days.values()) {
          daysLogged += 1;
          switch (metricType) {
            case 'calorie_target': {
              sum += agg.calories;
              if (targetValue != null && this.withinCalorieBand(agg.calories, targetValue)) {
                successDays += 1;
              }
              break;
            }
            case 'protein_target': {
              sum += agg.protein;
              if (targetValue != null && agg.protein >= targetValue) successDays += 1;
              break;
            }
            case 'carb_target': {
              sum += agg.carbs;
              if (targetValue != null && agg.carbs >= targetValue) successDays += 1;
              break;
            }
            case 'veg_days': {
              // A logged day with no animal-flesh-tagged entry counts as vegetarian.
              if (agg.count > 0 && !agg.anyNonVeg) successDays += 1;
              break;
            }
            case 'standard':
            default: {
              // Pure logging adherence: any logged day is a success.
              successDays += 1;
              break;
            }
          }
        }
      }

      result.set(uid, { successDays, daysLogged, sum });
    }

    return result;
  }

  /**
   * sober_days: a "yes/no" daily check-in derived from the absence of alcohol logs.
   * Healthy framing (§6.7): we count days the member stayed alcohol-free across the
   * elapsed window — successDays = challengeDays - daysWithAlcohol. daysLogged here
   * mirrors successDays (sober days are the "showing up" signal for this metric).
   *
   * An alcohol day = >= 1 beverage_logs row with category='alcohol' AND a positive
   * abv flag (customizations.abv_percent > 0).
   */
  private static async computeSoberDays(
    memberIds: string[],
    rangeStart: string | null,
    rangeEnd: string | null
  ): Promise<Map<string, { successDays: number; daysLogged: number; sum: number }>> {
    const supabaseAdmin = createAdminSupabase();

    const challengeDays =
      rangeStart && rangeEnd ? Math.max(this.daysInclusive(rangeStart, rangeEnd), 1) : 0;

    let query = supabaseAdmin
      .from('beverage_logs')
      .select('user_id, entry_date, category, customizations')
      .in('user_id', memberIds)
      .eq('category', 'alcohol')
      .is('deleted_at', null);
    if (rangeStart) query = query.gte('entry_date', rangeStart);
    if (rangeEnd) query = query.lte('entry_date', rangeEnd);

    const { data: bevs, error } = await query;
    if (error) throw error;

    // user_id -> set of distinct days with an alcohol log (abv flag positive).
    const alcoholDaysByUser = new Map<string, Set<string>>();
    for (const b of bevs ?? []) {
      const customizations = (b.customizations ?? {}) as { abv_percent?: number };
      const abv = Number(customizations.abv_percent ?? 0);
      if (!(abv > 0)) continue; // require a positive abv flag
      const uid = b.user_id as string;
      const day = this.toDateOnly(b.entry_date as string);
      let set = alcoholDaysByUser.get(uid);
      if (!set) {
        set = new Set<string>();
        alcoholDaysByUser.set(uid, set);
      }
      set.add(day);
    }

    const result = new Map<string, { successDays: number; daysLogged: number; sum: number }>();
    for (const uid of memberIds) {
      const alcoholDays = alcoholDaysByUser.get(uid)?.size ?? 0;
      const soberDays = Math.max(challengeDays - alcoholDays, 0);
      result.set(uid, { successDays: soberDays, daysLogged: soberDays, sum: 0 });
    }
    return result;
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /** ±15% band around the calorie target — rewards hitting the goal, not undershooting. */
  private static withinCalorieBand(total: number, target: number): boolean {
    if (target <= 0) return false;
    const tolerance = target * 0.15;
    return total >= target - tolerance && total <= target + tolerance;
  }

  private static isNonVegEntry(tags: string[] | null): boolean {
    if (!tags || tags.length === 0) return false;
    return tags.some((t) => {
      const lower = String(t).toLowerCase();
      return this.NON_VEG_TAGS.some((nv) => lower.includes(nv));
    });
  }

  private static normalizeTarget(
    metricType: NutritionMetricType,
    targetValue: number | null
  ): number | null {
    if (TARGET_REQUIRED_METRICS.includes(metricType)) {
      if (targetValue == null || Number.isNaN(targetValue) || targetValue <= 0) {
        throw new Error('BadRequest');
      }
      if (targetValue > MAX_TARGET_VALUE) throw new Error('BadRequest');
      return Math.round(targetValue * 100) / 100;
    }
    // veg_days / sober_days / standard ignore any provided target.
    return null;
  }

  private static async assertActiveMember(fitcircleId: string, userId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();
    const { count, error } = await supabaseAdmin
      .from('fitcircle_members')
      .select('*', { count: 'exact', head: true })
      .eq('fitcircle_id', fitcircleId)
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) throw error;
    if (!count || count === 0) throw new Error('Forbidden');
  }

  private static async assertCreator(fitcircleId: string, userId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('fitcircles')
      .select('creator_id')
      .eq('id', fitcircleId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('NotFound');
    if ((data.creator_id as string | null) !== userId) throw new Error('Forbidden');
  }

  private static async fetchMembers(
    userIds: string[]
  ): Promise<Map<string, NutritionChallengeMember>> {
    const byId = new Map<string, NutritionChallengeMember>();
    if (userIds.length === 0) return byId;

    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, username, avatar_url')
      .in('id', userIds);
    if (error) throw error;

    for (const p of data ?? []) {
      byId.set(p.id as string, {
        id: p.id as string,
        name:
          (p.display_name as string | null) ?? (p.username as string | null) ?? 'Member',
        avatarUrl: (p.avatar_url as string | null) ?? null,
      });
    }
    return byId;
  }

  private static toConfigDTO(row: NutritionChallengeConfigRow): NutritionChallengeConfigDTO {
    return {
      id: row.id,
      fitcircleId: row.fitcircle_id,
      metricType: row.metric_type,
      targetValue: row.target_value == null ? null : Number(row.target_value),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ---- date utils (UTC date-only, matching the food-feed service) ----------

  private static toDateOnly(value: string): string {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }

  private static todayDateOnly(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /** Inclusive day count between two YYYY-MM-DD dates. */
  private static daysInclusive(start: string, end: string): number {
    const s = Date.parse(`${start}T00:00:00Z`);
    const e = Date.parse(`${end}T00:00:00Z`);
    if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
    return Math.floor((e - s) / (1000 * 60 * 60 * 24)) + 1;
  }
}

// Compile-time assertion: the static surface satisfies the FROZEN contract (§6.5).
// (Methods are static here, matching the rest of the service layer; this guarantees
// their signatures stay in lock-step with NutritionChallengeServiceContract.)
const _contractCheck: NutritionChallengeServiceContract = {
  setConfig: NutritionChallengeService.setConfig.bind(NutritionChallengeService),
  getConfig: NutritionChallengeService.getConfig.bind(NutritionChallengeService),
  computeProgress: NutritionChallengeService.computeProgress.bind(NutritionChallengeService),
};
void _contractCheck;
