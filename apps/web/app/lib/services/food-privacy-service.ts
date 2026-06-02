import { createAdminSupabase } from '../supabase-admin';
import {
  DEFAULT_FOOD_PRIVACY_TIER,
  type FilteredFoodEntry,
  type FilteredFoodResult,
  type FoodDailySummary,
  type FoodPrivacyTier,
  FOOD_PRIVACY_TIERS,
  type IFoodPrivacyService,
  type MemberFoodTier,
  type OwnerFoodEntry,
} from '../types/food-privacy';

/**
 * FoodPrivacyService — three-tier per-circle food privacy (PRD §6.4) and its single
 * server-side, FAIL-CLOSED filter (§7.2.1, §7.7).
 *
 * Authorization model mirrors FoodsService: the service uses the admin (service-role)
 * client and enforces visibility EXPLICITLY in code. The filter is the one place that
 * decides what a viewer may see; clients only ever receive its already-stripped output,
 * so a client cannot leak food data it was never sent. This is the keystone property.
 */
export class FoodPrivacyService implements IFoodPrivacyService {
  // ---- tier read/write ------------------------------------------------------

  /**
   * The user's tier for a circle. Returns DEFAULT_FOOD_PRIVACY_TIER ('summary') when no
   * explicit row exists. On ANY error or an unrecognized stored value we also fall back to
   * the default — i.e. we never throw a less-restrictive tier out of an uncertain read.
   */
  async getTier(fitcircleId: string, userId: string): Promise<FoodPrivacyTier> {
    if (!fitcircleId || !userId) return DEFAULT_FOOD_PRIVACY_TIER;
    const supabase = createAdminSupabase();
    const { data, error } = await supabase
      .from('circle_food_privacy')
      .select('tier')
      .eq('fitcircle_id', fitcircleId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return DEFAULT_FOOD_PRIVACY_TIER;
    return normalizeTier(data.tier);
  }

  /** Upsert the user's tier for a circle. Validates the tier value before writing. */
  async setTier(fitcircleId: string, userId: string, tier: FoodPrivacyTier): Promise<FoodPrivacyTier> {
    if (!isValidTier(tier)) throw new Error('invalid_tier');
    const supabase = createAdminSupabase();
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('circle_food_privacy')
      .upsert(
        { fitcircle_id: fitcircleId, user_id: userId, tier, updated_at: nowIso },
        { onConflict: 'fitcircle_id,user_id' }
      )
      .select('tier')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'set_tier_failed');
    return normalizeTier(data.tier);
  }

  // ---- the keystone: fail-closed filter -------------------------------------

  /**
   * Return what `viewerUserId` may see of `ownerUserId`'s `entries` in `fitcircleId`,
   * based on the OWNER's tier for that circle.
   *
   * Reads the owner's tier (the only side effect), then defers to the pure
   * {@link FoodPrivacyService.applyTierFilter} for all stripping logic.
   */
  async filterEntriesForCircle(
    ownerUserId: string,
    viewerUserId: string,
    fitcircleId: string,
    entries: OwnerFoodEntry[]
  ): Promise<FilteredFoodResult> {
    // The owner can always see their own entries in full (no stripping for self-views).
    if (ownerUserId && viewerUserId && ownerUserId === viewerUserId) {
      return FoodPrivacyService.applyTierFilter('full', ownerUserId, entries);
    }

    // Resolve the owner's tier. getTier() already fails closed to 'summary' on uncertainty;
    // any thrown error here is downgraded to the MOST restrictive tier, 'private'.
    let tier: FoodPrivacyTier;
    try {
      tier = await this.getTier(fitcircleId, ownerUserId);
    } catch {
      return { tier: 'private' };
    }
    return FoodPrivacyService.applyTierFilter(tier, ownerUserId, entries);
  }

  /**
   * PURE, unit-testable core of the fail-closed filter. No I/O. Given a resolved tier and
   * the owner's raw entries, produce exactly what a viewer is allowed to see.
   *
   * Fail-closed rules:
   *  - Any tier that is not strictly 'full' or 'summary' (incl. 'private', unknown, or a
   *    malformed value) yields { tier: 'private' } — nothing food-related. The default is
   *    the MOST restrictive branch, reached unless a tier explicitly opts into more.
   *  - Per-log override: entries with hiddenByUser === true are dropped BEFORE any tier
   *    logic, so they are never exposed and never counted in summary totals.
   *  - 'full'    -> per-entry FilteredFoodEntry rows (photo, name, calories, macros).
   *  - 'summary' -> per-day aggregated totals only; NO per-meal rows, photos, or names.
   */
  static applyTierFilter(
    tier: FoodPrivacyTier,
    ownerUserId: string,
    entries: OwnerFoodEntry[]
  ): FilteredFoodResult {
    // Defensive: never trust the input array shape.
    const safeEntries = Array.isArray(entries) ? entries : [];

    // Drop per-log "hide this" overrides up front — applies to every non-private tier.
    const visible = safeEntries.filter((e) => e && e.hiddenByUser !== true);

    if (tier === 'full') {
      return {
        tier: 'full',
        entries: visible.map((e) => toFilteredEntry(ownerUserId, e)),
      };
    }

    if (tier === 'summary') {
      return {
        tier: 'summary',
        summaries: aggregateDaily(ownerUserId, visible),
      };
    }

    // FAIL-CLOSED DEFAULT: 'private', unknown, or any unexpected value -> expose nothing.
    return { tier: 'private' };
  }

  // ---- feed helper ----------------------------------------------------------

  /**
   * Each ACTIVE member's tier in the circle, so a feed can decide what to fetch per member.
   * Members without an explicit row are reported at the default ('summary'). The viewer
   * argument is accepted for parity with the frozen contract / future per-viewer rules;
   * tiers themselves are owner-defined and identical regardless of who asks.
   */
  async getTiersForCircle(fitcircleId: string, _viewerUserId: string): Promise<MemberFoodTier[]> {
    if (!fitcircleId) return [];
    const supabase = createAdminSupabase();

    // Active members of the circle.
    const { data: members, error: membersErr } = await supabase
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', fitcircleId)
      .eq('status', 'active');
    if (membersErr || !members) return [];

    // Their explicit tier rows (absent => default).
    const { data: rows } = await supabase
      .from('circle_food_privacy')
      .select('user_id, tier')
      .eq('fitcircle_id', fitcircleId);

    const tierByUser = new Map<string, FoodPrivacyTier>();
    for (const r of rows ?? []) {
      tierByUser.set(r.user_id as string, normalizeTier((r as { tier: unknown }).tier));
    }

    return members.map((m) => ({
      userId: m.user_id as string,
      tier: tierByUser.get(m.user_id as string) ?? DEFAULT_FOOD_PRIVACY_TIER,
    }));
  }
}

// ---- pure helpers -----------------------------------------------------------

/** True iff `t` is one of the three known tiers. */
function isValidTier(t: unknown): t is FoodPrivacyTier {
  return typeof t === 'string' && (FOOD_PRIVACY_TIERS as readonly string[]).includes(t);
}

/** Map an arbitrary stored value to a known tier, failing closed to the default. */
function normalizeTier(t: unknown): FoodPrivacyTier {
  return isValidTier(t) ? t : DEFAULT_FOOD_PRIVACY_TIER;
}

/** Shape a single owner entry into the viewer-visible 'full' row. */
function toFilteredEntry(ownerUserId: string, e: OwnerFoodEntry): FilteredFoodEntry {
  return {
    id: e.id,
    ownerUserId,
    entryDate: e.entryDate,
    mealType: e.mealType ?? null,
    foodName: e.foodName ?? null,
    photoUrl: e.photoUrl ?? null,
    calories: e.calories ?? null,
    proteinG: e.proteinG ?? null,
    carbsG: e.carbsG ?? null,
    fatG: e.fatG ?? null,
  };
}

/** Aggregate entries into one FoodDailySummary per day (no per-meal data leaks through). */
function aggregateDaily(ownerUserId: string, entries: OwnerFoodEntry[]): FoodDailySummary[] {
  const byDay = new Map<string, FoodDailySummary>();
  for (const e of entries) {
    const day = e.entryDate;
    if (!day) continue; // can't attribute to a day -> drop (fail closed, don't bucket loosely)
    let s = byDay.get(day);
    if (!s) {
      s = {
        ownerUserId,
        entryDate: day,
        totalCalories: 0,
        totalProteinG: 0,
        totalCarbsG: 0,
        totalFatG: 0,
        entryCount: 0,
      };
      byDay.set(day, s);
    }
    s.totalCalories += num(e.calories);
    s.totalProteinG += num(e.proteinG);
    s.totalCarbsG += num(e.carbsG);
    s.totalFatG += num(e.fatG);
    s.entryCount += 1;
  }
  return Array.from(byDay.values()).sort((a, b) => a.entryDate.localeCompare(b.entryDate));
}

/** Coerce a possibly-null/NaN macro to a finite number (0 otherwise). */
function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
