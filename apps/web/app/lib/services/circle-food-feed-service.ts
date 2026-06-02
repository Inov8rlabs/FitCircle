import { createAdminSupabase } from '../supabase-admin';
import { FoodPrivacyService } from './food-privacy-service';
import {
  type FoodFeedCardDTO,
  type FoodFeedMacros,
  type FoodFeedOwner,
  type FoodFeedParams,
  type FoodFeedResult,
  type LogReactionRow,
  type LogReactionSummary,
  type NutritionLeaderboardResult,
  type NutritionLeaderboardRow,
  type ReactionKind,
  FOOD_FEED_DEFAULT_LIMIT,
  FOOD_FEED_MAX_LIMIT,
  REACTION_KINDS,
} from '../types/food-feed';

/**
 * CircleFoodFeedService — promotes food logs into circle content (PRD v4 §6.3).
 *
 * Surfaces:
 *   1. A reverse-chronological, paginated circle food feed assembled from active
 *      members' food_log_entries (avatar, optional meal photo, food name, time,
 *      macros [privacy-gated], reactions).
 *   2. Six-emoji log reactions (flame|clap|eyes|same|heart|laugh) — the SAME tapback
 *      vocabulary as circle chat (ReactionKind reused from circle-chat types).
 *   3. Leaderboard nutrition metrics (adherence %, calorie-goal hit rate, log streak)
 *      that LAYER ONTO the existing leaderboard. §6.7: consistency/showing-up signals
 *      only — never "fewest calories" / "fastest loss".
 *
 * Authorization is explicit in-code (the service uses the admin client; RLS in 058 is
 * defense in depth). All circle reads are gated to active membership.
 */

// Columns selected from food_log_entries for the feed.
const FEED_ENTRY_COLUMNS =
  'id, user_id, title, description, logged_at, entry_date, visibility, has_images, calories, protein_g, carbs_g, fat_g, deleted_at';

// Visibility tiers exposed in THIS slice (existing column from migration 031).
// TODO(§6.4): wire FoodPrivacyService.filterEntriesForCircle here once available to
// enforce the full/summary/private tiers (and to decide whether macros are exposed).
const FEED_VISIBLE_TIERS = ['circle', 'shared'] as const;

const SIGNED_URL_TTL_SECONDS = 3600;

interface FeedEntryRow {
  id: string;
  user_id: string;
  title: string | null;
  description: string | null;
  logged_at: string;
  entry_date: string;
  visibility: string | null;
  has_images: boolean | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  deleted_at: string | null;
}

export class CircleFoodFeedService {
  // ==========================================================================
  // AUTHORIZATION
  // ==========================================================================

  /** Throws Error('Forbidden') if the user is not an active member of the circle. */
  static async assertActiveMember(circleId: string, userId: string): Promise<void> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', circleId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Forbidden');
  }

  /** Resolve a food log entry's owner. Throws Error('NotFound') if missing/deleted. */
  static async getEntryOwnerId(entryId: string): Promise<string> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('food_log_entries')
      .select('user_id, deleted_at')
      .eq('id', entryId)
      .maybeSingle();

    if (error) throw error;
    if (!data || data.deleted_at) throw new Error('NotFound');
    return data.user_id as string;
  }

  /**
   * Throws Error('Forbidden') unless the reactor shares at least one active circle
   * with the entry owner (a reactor may always react to their own entry). Mirrors the
   * RLS predicate in 058 so the API and DB agree on who may react.
   */
  private static async assertSharesActiveCircle(
    reactorId: string,
    ownerId: string
  ): Promise<void> {
    if (reactorId === ownerId) return;

    const supabaseAdmin = createAdminSupabase();

    // Active circles the owner belongs to.
    const { data: ownerCircles, error: ownerErr } = await supabaseAdmin
      .from('fitcircle_members')
      .select('fitcircle_id')
      .eq('user_id', ownerId)
      .eq('status', 'active');
    if (ownerErr) throw ownerErr;

    const ownerCircleIds = (ownerCircles ?? []).map((r) => r.fitcircle_id as string);
    if (ownerCircleIds.length === 0) throw new Error('Forbidden');

    // Does the reactor share any of them (active)?
    const { data: shared, error: sharedErr } = await supabaseAdmin
      .from('fitcircle_members')
      .select('fitcircle_id')
      .eq('user_id', reactorId)
      .eq('status', 'active')
      .in('fitcircle_id', ownerCircleIds)
      .limit(1);
    if (sharedErr) throw sharedErr;

    if (!shared || shared.length === 0) throw new Error('Forbidden');
  }

  // ==========================================================================
  // FEED
  // ==========================================================================

  /**
   * GET /circles/:id/food-feed — reverse-chronological page of food cards from the
   * circle's active members. Active-member gated; batched reaction + photo lookups
   * (no N+1).
   */
  static async getFeed(
    fitcircleId: string,
    viewerUserId: string,
    params: FoodFeedParams
  ): Promise<FoodFeedResult> {
    await this.assertActiveMember(fitcircleId, viewerUserId);

    const supabaseAdmin = createAdminSupabase();
    const limit = this.clampLimit(params.limit);

    // Active members of THIS circle (the feed is scoped to the circle's roster).
    const { data: members, error: membersErr } = await supabaseAdmin
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', fitcircleId)
      .eq('status', 'active');
    if (membersErr) throw membersErr;

    const allMemberIds = (members ?? []).map((m) => m.user_id as string);
    if (allMemberIds.length === 0) {
      return { cards: [], hasMore: false, nextBefore: null };
    }

    // PRIVACY (§6.4) — fail-closed at the FEED level. A per-meal feed only shows members on the
    // 'full' tier; 'summary' (daily totals only, no individual meals) and 'private' members do
    // NOT contribute meal cards here (their summary surfaces elsewhere). The viewer always sees
    // their OWN entries regardless of tier. FoodPrivacyService.getTiersForCircle defaults missing
    // rows to 'summary' and is the single source of truth for the tier decision.
    const tiers = await new FoodPrivacyService().getTiersForCircle(fitcircleId, viewerUserId);
    const tierByUser = new Map(tiers.map((t) => [t.userId, t.tier]));
    const memberIds = allMemberIds.filter(
      (uid) => uid === viewerUserId || tierByUser.get(uid) === 'full'
    );
    if (memberIds.length === 0) {
      return { cards: [], hasMore: false, nextBefore: null };
    }

    // Reverse-chron entries from the tier-allowed members, still gated by the per-log
    // visibility column ('circle'|'shared') and the per-log "hide this" (deleted_at) override.
    let query = supabaseAdmin
      .from('food_log_entries')
      .select(FEED_ENTRY_COLUMNS)
      .in('user_id', memberIds)
      .is('deleted_at', null)
      .in('visibility', FEED_VISIBLE_TIERS as unknown as string[])
      .order('logged_at', { ascending: false })
      .limit(limit + 1);

    if (params.before) {
      query = query.lt('logged_at', params.before);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as FeedEntryRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const cards = await this.mapRowsToCards(pageRows, viewerUserId);

    const nextBefore =
      hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].logged_at : null;

    return { cards, hasMore, nextBefore };
  }

  // ==========================================================================
  // REACTIONS (six-emoji; same set as chat)
  // ==========================================================================

  /**
   * POST /food-log/:id/reactions — add a reaction (idempotent on the PK).
   * Returns the recomputed reaction summary for the entry.
   */
  static async addReaction(
    entryId: string,
    userId: string,
    reaction: ReactionKind
  ): Promise<LogReactionSummary[]> {
    this.assertValidReaction(reaction);
    const ownerId = await this.getEntryOwnerId(entryId);
    await this.assertSharesActiveCircle(userId, ownerId);

    const supabaseAdmin = createAdminSupabase();
    const { error } = await supabaseAdmin
      .from('log_reactions')
      .upsert(
        { food_log_entry_id: entryId, user_id: userId, reaction },
        { onConflict: 'food_log_entry_id,user_id,reaction', ignoreDuplicates: true }
      );
    if (error) throw error;

    const summaries = await this.buildReactionSummaries([entryId], userId);
    return summaries.get(entryId) ?? [];
  }

  /**
   * DELETE /food-log/:id/reactions/:reaction — remove a reaction.
   * Returns the recomputed reaction summary for the entry.
   */
  static async removeReaction(
    entryId: string,
    userId: string,
    reaction: ReactionKind
  ): Promise<LogReactionSummary[]> {
    this.assertValidReaction(reaction);
    const ownerId = await this.getEntryOwnerId(entryId);
    await this.assertSharesActiveCircle(userId, ownerId);

    const supabaseAdmin = createAdminSupabase();
    const { error } = await supabaseAdmin
      .from('log_reactions')
      .delete()
      .eq('food_log_entry_id', entryId)
      .eq('user_id', userId)
      .eq('reaction', reaction);
    if (error) throw error;

    const summaries = await this.buildReactionSummaries([entryId], userId);
    return summaries.get(entryId) ?? [];
  }

  // ==========================================================================
  // LEADERBOARD NUTRITION METRICS (additive — PRD §6.3, healthy-engagement §6.7)
  // ==========================================================================

  /**
   * GET /circles/:id/nutrition-leaderboard — per active member:
   *   - adherencePct: distinct days with >=1 calorie-bearing entry / challenge days elapsed
   *   - calorieGoalHitRatePct: share of elapsed days with logged calories (showing-up signal)
   *   - nutritionLogStreak: current run of consecutive calorie-logged days
   *
   * §6.7: every metric ranks consistency/adherence/showing-up — NEVER intake minimization.
   * Additive: this does not replace leaderboard-service; it layers nutrition metrics on top.
   */
  static async nutritionLeaderboard(
    fitcircleId: string,
    viewerUserId: string
  ): Promise<NutritionLeaderboardResult> {
    await this.assertActiveMember(fitcircleId, viewerUserId);

    const supabaseAdmin = createAdminSupabase();

    // Circle date range.
    const { data: circle, error: circleErr } = await supabaseAdmin
      .from('fitcircles')
      .select('start_date, end_date')
      .eq('id', fitcircleId)
      .maybeSingle();
    if (circleErr) throw circleErr;

    const today = this.toDateOnly(new Date().toISOString());
    const rangeStart = circle?.start_date ? this.toDateOnly(circle.start_date) : null;
    // End of the *elapsed* window = min(circle end_date, today).
    const circleEnd = circle?.end_date ? this.toDateOnly(circle.end_date) : null;
    const rangeEnd =
      circleEnd && circleEnd < today ? circleEnd : rangeStart ? today : circleEnd ?? today;

    // Challenge days elapsed so far (inclusive), >= 1 to avoid div-by-zero.
    const challengeDays =
      rangeStart && rangeEnd ? Math.max(this.daysInclusive(rangeStart, rangeEnd), 1) : 0;

    // Active members + their profiles.
    const { data: members, error: membersErr } = await supabaseAdmin
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', fitcircleId)
      .eq('status', 'active');
    if (membersErr) throw membersErr;

    const memberIds = (members ?? []).map((m) => m.user_id as string);
    if (memberIds.length === 0) {
      return { fitcircleId, rangeStart, rangeEnd, rows: [] };
    }

    const ownerById = await this.fetchOwners(memberIds);

    // All calorie-bearing entry-days for these members within the range, in ONE query.
    let entryQuery = supabaseAdmin
      .from('food_log_entries')
      .select('user_id, entry_date')
      .in('user_id', memberIds)
      .is('deleted_at', null)
      .not('calories', 'is', null);
    if (rangeStart) entryQuery = entryQuery.gte('entry_date', rangeStart);
    if (rangeEnd) entryQuery = entryQuery.lte('entry_date', rangeEnd);

    const { data: entries, error: entriesErr } = await entryQuery;
    if (entriesErr) throw entriesErr;

    // user_id -> set of distinct logged dates (YYYY-MM-DD).
    const daysByUser = new Map<string, Set<string>>();
    for (const e of entries ?? []) {
      const uid = e.user_id as string;
      const day = this.toDateOnly(e.entry_date as string);
      let set = daysByUser.get(uid);
      if (!set) {
        set = new Set<string>();
        daysByUser.set(uid, set);
      }
      set.add(day);
    }

    const rows: NutritionLeaderboardRow[] = memberIds.map((uid) => {
      const days = daysByUser.get(uid) ?? new Set<string>();
      const daysLogged = days.size;
      const adherencePct =
        challengeDays > 0 ? Math.round((daysLogged / challengeDays) * 100) : 0;
      // For this slice "goal hit" == "logged calories" (a showing-up signal, §6.7).
      const calorieGoalHitRatePct = adherencePct;
      const nutritionLogStreak = this.currentStreak(days, rangeEnd ?? today);

      return {
        user: ownerById.get(uid) ?? { id: uid, name: 'Member', avatarUrl: null },
        adherencePct,
        daysLogged,
        challengeDays,
        calorieGoalHitRatePct,
        nutritionLogStreak,
      };
    });

    // Rank: adherence desc, then streak desc, then name asc (stable, friendly).
    rows.sort(
      (a, b) =>
        b.adherencePct - a.adherencePct ||
        b.nutritionLogStreak - a.nutritionLogStreak ||
        a.user.name.localeCompare(b.user.name)
    );

    return { fitcircleId, rangeStart, rangeEnd, rows };
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private static clampLimit(limit?: number): number {
    if (limit === undefined || limit === null || Number.isNaN(limit)) {
      return FOOD_FEED_DEFAULT_LIMIT;
    }
    return Math.min(Math.max(Math.floor(limit), 1), FOOD_FEED_MAX_LIMIT);
  }

  private static assertValidReaction(reaction: ReactionKind): void {
    if (!REACTION_KINDS.includes(reaction)) {
      throw new Error('BadRequest');
    }
  }

  /** Map food_log_entries rows -> FoodFeedCardDTO[], batching owner/photo/reaction lookups. */
  private static async mapRowsToCards(
    rows: FeedEntryRow[],
    viewerUserId: string
  ): Promise<FoodFeedCardDTO[]> {
    if (rows.length === 0) return [];

    const ownerIds = Array.from(new Set(rows.map((r) => r.user_id)));
    const entryIds = rows.map((r) => r.id);

    const [ownerById, photoByEntry, reactionsByEntry] = await Promise.all([
      this.fetchOwners(ownerIds),
      this.fetchPhotos(rows.filter((r) => r.has_images).map((r) => r.id)),
      this.buildReactionSummaries(entryIds, viewerUserId),
    ]);

    return rows.map((row) => {
      const owner =
        ownerById.get(row.user_id) ?? { id: row.user_id, name: 'Member', avatarUrl: null };

      // §6.4 TODO: privacy may null out macros per tier; for this slice visible => macros shown.
      const macros: FoodFeedMacros | null =
        row.calories === null &&
        row.protein_g === null &&
        row.carbs_g === null &&
        row.fat_g === null
          ? null
          : {
              calories: row.calories,
              proteinG: row.protein_g,
              carbsG: row.carbs_g,
              fatG: row.fat_g,
            };

      return {
        id: row.id,
        owner,
        foodName: this.deriveFoodName(row),
        loggedAt: row.logged_at,
        photoUrl: photoByEntry.get(row.id) ?? null,
        macros,
        reactions: reactionsByEntry.get(row.id) ?? [],
      };
    });
  }

  private static deriveFoodName(row: FeedEntryRow): string {
    const title = (row.title ?? '').trim();
    if (title) return title;
    const desc = (row.description ?? '').trim();
    if (desc) return desc;
    return 'Logged a meal';
  }

  /** Batch-fetch owner profiles -> FoodFeedOwner. */
  private static async fetchOwners(userIds: string[]): Promise<Map<string, FoodFeedOwner>> {
    const byId = new Map<string, FoodFeedOwner>();
    if (userIds.length === 0) return byId;

    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, username, avatar_url')
      .in('id', userIds);
    if (error) throw error;

    for (const p of data ?? []) {
      byId.set(p.id, {
        id: p.id,
        name: (p.display_name as string | null) ?? (p.username as string | null) ?? 'Member',
        avatarUrl: (p.avatar_url as string | null) ?? null,
      });
    }
    return byId;
  }

  /**
   * Batch-fetch the primary (display_order=0/lowest) image per entry and produce a
   * signed medium-size URL. Mirrors food-log-image-service's signed-URL convention.
   */
  private static async fetchPhotos(entryIds: string[]): Promise<Map<string, string>> {
    const byEntry = new Map<string, string>();
    if (entryIds.length === 0) return byEntry;

    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('food_log_images')
      .select('food_log_entry_id, storage_path, storage_bucket, display_order')
      .in('food_log_entry_id', entryIds)
      .is('deleted_at', null)
      .order('display_order', { ascending: true });
    if (error) throw error;

    // Keep the first (lowest display_order) image per entry.
    const primaryByEntry = new Map<
      string,
      { storage_path: string; storage_bucket: string }
    >();
    for (const img of data ?? []) {
      const eid = img.food_log_entry_id as string;
      if (!primaryByEntry.has(eid)) {
        primaryByEntry.set(eid, {
          storage_path: img.storage_path as string,
          storage_bucket: img.storage_bucket as string,
        });
      }
    }

    await Promise.all(
      Array.from(primaryByEntry.entries()).map(async ([eid, img]) => {
        const mediumPath = img.storage_path.replace('_original.', '_medium.');
        const { data: signed } = await supabaseAdmin.storage
          .from(img.storage_bucket)
          .createSignedUrl(mediumPath, SIGNED_URL_TTL_SECONDS);
        if (signed?.signedUrl) {
          byEntry.set(eid, signed.signedUrl);
        }
      })
    );

    return byEntry;
  }

  /** Aggregate log_reactions into LogReactionSummary[] per entry in a single query. */
  private static async buildReactionSummaries(
    entryIds: string[],
    userId: string
  ): Promise<Map<string, LogReactionSummary[]>> {
    const result = new Map<string, LogReactionSummary[]>();
    if (entryIds.length === 0) return result;

    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('log_reactions')
      .select('food_log_entry_id, user_id, reaction')
      .in('food_log_entry_id', entryIds);
    if (error) throw error;

    const rows = (data ?? []) as Pick<
      LogReactionRow,
      'food_log_entry_id' | 'user_id' | 'reaction'
    >[];

    // entry_id -> reaction -> { count, reactedByMe }
    const agg = new Map<string, Map<ReactionKind, { count: number; reactedByMe: boolean }>>();
    for (const row of rows) {
      let perEntry = agg.get(row.food_log_entry_id);
      if (!perEntry) {
        perEntry = new Map();
        agg.set(row.food_log_entry_id, perEntry);
      }
      const entry = perEntry.get(row.reaction) ?? { count: 0, reactedByMe: false };
      entry.count += 1;
      if (row.user_id === userId) entry.reactedByMe = true;
      perEntry.set(row.reaction, entry);
    }

    for (const entryId of entryIds) {
      const perEntry = agg.get(entryId);
      if (!perEntry) {
        result.set(entryId, []);
        continue;
      }
      // Emit in the canonical six-emoji order so clients render a stable row.
      const summaries: LogReactionSummary[] = [];
      for (const reaction of REACTION_KINDS) {
        const tally = perEntry.get(reaction);
        if (tally) {
          summaries.push({ reaction, count: tally.count, reactedByMe: tally.reactedByMe });
        }
      }
      result.set(entryId, summaries);
    }

    return result;
  }

  // ---- date math (UTC date-only; no stored procs, all in TS) ----------------

  private static toDateOnly(iso: string): string {
    // Accepts 'YYYY-MM-DD' or a full timestamp; returns 'YYYY-MM-DD'.
    return iso.slice(0, 10);
  }

  private static daysInclusive(startDate: string, endDate: string): number {
    const start = Date.parse(`${startDate}T00:00:00Z`);
    const end = Date.parse(`${endDate}T00:00:00Z`);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
    return Math.floor((end - start) / 86_400_000) + 1;
  }

  /**
   * Current consecutive-day streak of calorie-logged days ending at `lastDay`
   * (or the most recent prior day). If the member logged neither lastDay nor the day
   * before, the streak is 0.
   */
  private static currentStreak(days: Set<string>, lastDay: string): number {
    if (days.size === 0) return 0;

    let cursor = Date.parse(`${lastDay}T00:00:00Z`);
    if (Number.isNaN(cursor)) return 0;

    // Allow the streak to "end" yesterday if today isn't logged yet.
    if (!days.has(this.dateFromMs(cursor))) {
      cursor -= 86_400_000;
      if (!days.has(this.dateFromMs(cursor))) return 0;
    }

    let streak = 0;
    while (days.has(this.dateFromMs(cursor))) {
      streak += 1;
      cursor -= 86_400_000;
    }
    return streak;
  }

  private static dateFromMs(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }
}
