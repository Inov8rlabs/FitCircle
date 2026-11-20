// Circle Chat — meals as chat posts.
//
// Product decision 2026-09-22: the per-circle "Food Feed" sub-screen is gone.
// When a member logs a meal, every circle they share it with gets ONE chat post
// of kind 'system_event' / system_event_type 'meal_logged' rendered as a meal
// card (photo, name, calories + macros) with the same privacy gating the feed
// had: the owner's per-circle tier must be 'full' and the entry must not be
// private. The post mirrors the entry afterwards — photo attached later, entry
// edited, entry deleted — and every member gets a chat push, like a message.
//
// These posts are the member's own content, so they bypass SystemPostEngine's
// routine caps / bundling (a fourth meal in a day must not be "dropped to
// summary"). Every entrypoint is fire-and-forget safe: it never throws back
// into the food-log write.

import { createAdminSupabase } from '../supabase-admin';

import { ChatNotificationService, type SystemPushIntent } from './chat-notification-service';
import { CircleChatService } from './circle-chat-service';
import { explicitShareList, isEntryPrivate, isRecentMeal, isShareableType, mealVisibleInCircle, scrubbedMealPayload } from './food-entry-privacy';

export { scrubbedMealPayload };
import { FoodPrivacyService } from './food-privacy-service';

import { logIgnoredQueryError } from '@/lib/api/route-errors';
import { isDraftEntry } from '@/lib/meal-drafts/config';

/** What the meal card renders. Snake_case like every other system payload. */
export interface MealPostPayload {
  entry_id: string;
  title: string;
  meal_type: string | null;
  logged_at: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  /** Primary image, when the entry has one. Served by the authenticated image proxy. */
  image_id: string | null;
  /** App-relative proxy path the client resolves against its API base. */
  photo_path: string | null;
  /** 1.1.5 additive (ENGAGEMENT_115_SPEC §4.4): primary image size, so clients size the thumbnail before it loads. */
  image_width: number | null;
  image_height: number | null;
}

type MealPost = { id: string; fitcircle_id?: string | null; system_payload: Record<string, unknown> | null };
type ImageDims = { width: number | null; height: number | null };

/**
 * The slice of a food_log_entries row this service reads. Deliberately loose
 * (raw Supabase rows and the typed FoodLogEntry both satisfy it) so the hooks
 * accept whatever the write path has in hand.
 */
export interface EntryLike {
  id: string;
  user_id: string;
  entry_type: string;
  visibility?: string | null;
  is_private?: boolean | null;
  title?: string | null;
  description?: string | null;
  notes?: string | null;
  meal_type?: string | null;
  logged_at: string;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  has_images?: boolean | null;
  deleted_at?: string | null;
  /** Migration 138: explicit per-meal circle list; null / absent = legacy rule (tier 'full'). */
  share_circle_ids?: string[] | null;
}

// food_log_entries.entry_type is 'food' | 'water' | 'supplement' (the meal slot
// lives in meal_type). 'meal'/'snack' are accepted for older rows/clients.
// Shipped with only 'meal'/'snack' on 2026-09-22 → zero posts for a day.
// Privacy (docs/FOOD_ENTRY_PRIVACY_SPEC.md): a meal is shared only when BOTH
// columns say so — is_private === false AND visibility in (circle, shared).


export class CircleMealPostService {
  // ==========================================================================
  // PURE HELPERS (unit-tested)
  // ==========================================================================

  /** Only meals/snacks that the owner shares (not water/supplements, not private, not deleted). */
  static isShareableMeal(entry: EntryLike): boolean {
    if (!entry || entry.deleted_at) return false;
    // A Draft meal (ENGAGEMENT_115_SPEC §14.6) is never shared, whatever its privacy says.
    if (isDraftEntry(entry as { entry_status?: unknown })) return false;
    if (!isShareableType(entry.entry_type)) return false;
    // Fail closed: a missing is_private is the column default (private).
    return !isEntryPrivate(entry);
  }

  /** "Anki logged breakfast: Pancakes with fruit" — the plain-text fallback every client can show. */
  static renderBody(actorName: string, entry: EntryLike): string {
    const slot = this.slotLabel(entry.meal_type);
    const title = this.titleOf(entry);
    return title ? `${actorName} logged ${slot}: ${title}` : `${actorName} logged ${slot}`;
  }

  static slotLabel(mealType: string | null | undefined): string {
    switch (mealType) {
      case 'breakfast':
      case 'lunch':
      case 'dinner':
        return mealType;
      case 'snack':
        return 'a snack';
      default:
        return 'a meal';
    }
  }

  static titleOf(entry: EntryLike): string {
    const title = (entry.title ?? '').trim();
    if (title) return title;
    // A meal logged with only a note ("Apple with peanut butter") uses the note.
    for (const text of [entry.description, entry.notes]) {
      const first = (text ?? '').trim();
      // Item lines read "• 170 g Greek yogurt (164.9 kcal)"; the card shows calories itself.
      if (first) {
        return first.split('\n')[0]
          .replace(/^•\s*/, '')
          .replace(/\s*\(\s*[\d.,]+\s*kcal\s*\)\s*$/i, '')
          .trim()
          .slice(0, 80);
      }
    }
    return '';
  }

  /** Card heading when the meal has no title of its own: "Snack", "Breakfast", "Meal". */
  static slotTitle(mealType: string | null | undefined): string {
    switch (mealType) {
      case 'breakfast': return 'Breakfast';
      case 'lunch': return 'Lunch';
      case 'dinner': return 'Dinner';
      case 'snack': return 'Snack';
      default: return 'Meal';
    }
  }

  static photoPath(imageId: string | null): string | null {
    return imageId ? `/api/mobile/food-log/images/${imageId}?size=medium` : null;
  }

  static buildPayload(entry: EntryLike, imageId: string | null, dims: ImageDims = { width: null, height: null }): MealPostPayload {
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
    const dim = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
    return {
      entry_id: entry.id,
      title: this.titleOf(entry) || this.slotTitle(entry.meal_type),
      meal_type: entry.meal_type ?? null,
      logged_at: entry.logged_at,
      calories: num(entry.calories),
      protein_g: num(entry.protein_g),
      carbs_g: num(entry.carbs_g),
      fat_g: num(entry.fat_g),
      image_id: imageId,
      photo_path: this.photoPath(imageId),
      image_width: imageId ? dim(dims.width) : null,
      image_height: imageId ? dim(dims.height) : null,
    };
  }

  // ==========================================================================
  // HOOKS (fire-and-forget from the food-log write path)
  // ==========================================================================

  /**
   * A meal was created (or just became shared). Post it to every circle the
   * owner shares meals with. Members get a push only when `notify` — by
   * default, only for a meal eaten within the last 2 hours (a back-dated or
   * old meal posts silently).
   */
  static async onMealLogged(entry: EntryLike, opts: { notify?: boolean } = {}): Promise<void> {
    try {
      if (!this.isShareableMeal(entry)) return;
      const notify = opts.notify ?? isRecentMeal(entry.logged_at);
      const circleIds = await this.targetCircles(entry);
      if (circleIds.length === 0) return;
      await this.postToCircles(entry, circleIds, notify);
    } catch (err) {
      console.error('[CircleMealPostService.onMealLogged] swallowed:', err);
    }
  }

  /**
   * Make the live cards match the entry's target circles (ENGAGEMENT_115_SPEC §4.4): retract
   * cards in circles no longer targeted FIRST (throws, so the caller can fail the request and
   * the client retry), then post to targeted circles without a live card. Push only for a meal
   * eaten in the last 2 hours that was never posted before (L10 / L11, unchanged).
   */
  static async syncMealCircles(entry: EntryLike): Promise<{ posted: number; retracted: number; targetCircleIds: string[] }> {
    const posts = await this.postsFor(entry.id);
    const targets = this.isShareableMeal(entry) ? await this.targetCircles(entry) : [];
    const targetSet = new Set(targets);
    const stale = posts.filter((p) => !p.fitcircle_id || !targetSet.has(p.fitcircle_id));
    if (stale.length > 0) await this.tombstone(stale.map((p) => p.id), stale);
    const live = new Set(posts.filter((p) => p.fitcircle_id && targetSet.has(p.fitcircle_id)).map((p) => p.fitcircle_id as string));
    const missing = targets.filter((id) => !live.has(id));
    let posted = 0;
    if (missing.length > 0) {
      const notify = isRecentMeal(entry.logged_at) && !(await this.everPosted(entry.id));
      posted = await this.postToCircles(entry, missing, notify);
    }
    return { posted, retracted: stale.length, targetCircleIds: targets };
  }

  /** One card per circle, ONE push per recipient however many circles they share with the poster. */
  private static async postToCircles(entry: EntryLike, circleIds: string[], notify: boolean): Promise<number> {
    const [actorName, image] = await Promise.all([
      this.actorName(entry.user_id),
      entry.has_images ? this.primaryImage(entry.id) : Promise.resolve(null),
    ]);
    const body = this.renderBody(actorName, entry);
    const payload = this.buildPayload(entry, image?.id ?? null, image ?? undefined);

    // docs/PUSH_NOTIFICATIONS.md §2.
    const intents = await Promise.all(
      circleIds.map(async (circleId): Promise<SystemPushIntent | null> => {
        try {
          const post = await CircleChatService.emitSystemPost({
            fitcircleId: circleId,
            eventType: 'meal_logged',
            priority: 'p1',
            renderHint: 'meal_card',
            body,
            refId: entry.id,
            actorUserIds: [entry.user_id],
            systemPayload: payload as unknown as Record<string, unknown>,
          });
          return {
            kind: 'member_post',
            eventKey: `meal_logged:${entry.user_id}:${entry.id}`,
            circleId,
            circleName: await this.circleName(circleId),
            // Same push as a typed message: excludes the poster, honours mutes.
            body: body.replace(`${actorName} `, ''),
            eventType: 'meal_logged',
            actorUserIds: [entry.user_id],
            actorName,
            senderUserId: entry.user_id,
            messageId: post.id,
          };
        } catch (err) {
          console.error(`[CircleMealPostService.postToCircles] circle ${circleId}:`, err);
          return null;
        }
      })
    );
    const posted = intents.filter((i): i is SystemPushIntent => i !== null);
    if (notify && posted.length > 0) void ChatNotificationService.notifySystemEvent(posted).catch(() => {});
    return posted.length;
  }

  /**
   * The first photo landed on an entry (photos upload AFTER the entry row is
   * created). Fill the card's image in place; realtime UPDATE re-renders it.
   */
  static async onMealPhotoAttached(entryId: string, imageId: string): Promise<void> {
    try {
      const posts = await this.postsFor(entryId);
      if (posts.length === 0) return;
      const dims = await this.imageDims(imageId);
      const supabaseAdmin = createAdminSupabase();
      await Promise.all(
        posts
          .filter((p) => !(p.system_payload as MealPostPayload | null)?.image_id)
          .map((p) =>
            supabaseAdmin
              .from('circle_messages')
              .update({
                system_payload: {
                  ...(p.system_payload ?? {}),
                  image_id: imageId,
                  photo_path: this.photoPath(imageId),
                  image_width: dims.width,
                  image_height: dims.height,
                },
                updated_at: new Date().toISOString(),
              })
              .eq('id', p.id)
          )
      );
    } catch (err) {
      console.error('[CircleMealPostService.onMealPhotoAttached] swallowed:', err);
    }
  }

  /** The entry changed. Update the card, or tombstone it if it became private. */
  static async onMealUpdated(entry: EntryLike): Promise<void> {
    try {
      // An explicit per-meal list (1.1.5): make the cards match it, then refresh them below.
      if (explicitShareList(entry) && this.isShareableMeal(entry)) await this.syncMealCircles(entry);
      const posts = await this.postsFor(entry.id);
      if (posts.length === 0) {
        // Became shareable (e.g. private → circle) after creation: post it now.
        // Push only for a meal eaten in the last 2 hours that was never posted
        // before (re-sharing an old or once-retracted meal is silent).
        if (this.isShareableMeal(entry)) {
          const notify = isRecentMeal(entry.logged_at) && !(await this.everPosted(entry.id));
          await this.onMealLogged(entry, { notify });
        }
        return;
      }
      if (!this.isShareableMeal(entry)) {
        await this.tombstone(posts.map((p) => p.id), posts);
        return;
      }
      const actorName = await this.actorName(entry.user_id);
      const body = this.renderBody(actorName, entry);
      const supabaseAdmin = createAdminSupabase();
      await Promise.all(
        posts.map((p) => {
          const existing = (p.system_payload ?? {}) as Partial<MealPostPayload>;
          const imageId = existing.image_id ?? null;
          const dims = { width: existing.image_width ?? null, height: existing.image_height ?? null };
          return supabaseAdmin
            .from('circle_messages')
            .update({
              body,
              system_payload: { ...existing, ...this.buildPayload(entry, imageId, dims) },
              updated_at: new Date().toISOString(),
            })
            .eq('id', p.id);
        })
      );
    } catch (err) {
      console.error('[CircleMealPostService.onMealUpdated] swallowed:', err);
    }
  }

  /**
   * The entry went private: its cards disappear from every chat now. Unlike the
   * other hooks this THROWS, so the caller can fail the request (and the client
   * retry) rather than report "Private" while a card is still up.
   */
  static async retractMeal(entryId: string): Promise<number> {
    const posts = await this.postsFor(entryId);
    if (posts.length > 0) await this.tombstone(posts.map((p) => p.id), posts);
    return posts.length;
  }

  /**
   * Bulk "make all my meals private": retract every live meal card of these
   * entries. Throws on failure. Returns how many cards were removed.
   */
  static async retractMeals(entryIds: string[]): Promise<number> {
    let removed = 0;
    for (let i = 0; i < entryIds.length; i += 200) {
      const chunk = entryIds.slice(i, i + 200);
      const supabaseAdmin = createAdminSupabase();
      const { data, error } = await supabaseAdmin
        .from('circle_messages')
        .select('id, system_payload')
        .eq('system_event_type', 'meal_logged')
        .in('system_event_ref', chunk)
        .is('deleted_at', null);
      if (error) throw error;
      const posts = (data ?? []) as Array<{ id: string; system_payload: Record<string, unknown> | null }>;
      if (posts.length > 0) await this.tombstone(posts.map((p) => p.id), posts);
      removed += posts.length;
    }
    return removed;
  }

  /** The entry was deleted: its cards disappear from every chat. */
  static async onMealDeleted(entryId: string): Promise<void> {
    try {
      const posts = await this.postsFor(entryId);
      if (posts.length > 0) await this.tombstone(posts.map((p) => p.id), posts);
    } catch (err) {
      console.error('[CircleMealPostService.onMealDeleted] swallowed:', err);
    }
  }

  // ==========================================================================
  // ACCESS (used by the image proxy so members can load the card's photo)
  // ==========================================================================

  /**
   * Can `viewerId` see `entry`? True for the owner; otherwise the entry must be
   * shareable and the two must share an active circle in which the owner's
   * tier is 'full' — exactly the rule the meal post itself was created under.
   */
  static async viewerCanSeeEntry(viewerId: string, entry: EntryLike): Promise<boolean> {
    if (entry.user_id === viewerId) return true;
    if (!this.isShareableMeal(entry)) return false;
    const shared = await this.sharedActiveCircles(entry.user_id, viewerId);
    if (shared.length === 0) return false;
    const list = explicitShareList(entry);
    if (list) return shared.some((circleId) => list.includes(circleId));
    const privacy = new FoodPrivacyService();
    for (const circleId of shared) {
      if (mealVisibleInCircle(entry, circleId, await privacy.getTier(circleId, entry.user_id))) return true;
    }
    return false;
  }

  // ==========================================================================
  // PRIVATE
  // ==========================================================================

  /**
   * Active circles of the owner where this meal is shown (mealVisibleInCircle): the explicit
   * per-meal list ∩ active memberships, else every active circle with tier 'full' (legacy).
   */
  static async targetCircles(entry: Pick<EntryLike, 'user_id' | 'share_circle_ids'>): Promise<string[]> {
    const userId = entry.user_id;
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('fitcircle_members')
      .select('fitcircle_id')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) throw error;
    const ids = (data ?? []).map((r) => r.fitcircle_id as string).filter(Boolean);
    const list = explicitShareList(entry);
    if (list) return ids.filter((id) => list.includes(id));
    const privacy = new FoodPrivacyService();
    const tiers = await Promise.all(ids.map((id) => privacy.getTier(id, userId)));
    return ids.filter((id, i) => mealVisibleInCircle(entry, id, tiers[i]));
  }

  private static async sharedActiveCircles(ownerId: string, viewerId: string): Promise<string[]> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('fitcircle_members')
      .select('fitcircle_id, user_id')
      .in('user_id', [ownerId, viewerId])
      .eq('status', 'active');
    if (error) throw error;
    const byCircle = new Map<string, Set<string>>();
    for (const row of data ?? []) {
      const set = byCircle.get(row.fitcircle_id as string) ?? new Set<string>();
      set.add(row.user_id as string);
      byCircle.set(row.fitcircle_id as string, set);
    }
    return Array.from(byCircle.entries())
      .filter(([, users]) => users.has(ownerId) && users.has(viewerId))
      .map(([id]) => id);
  }

  private static async postsFor(entryId: string): Promise<MealPost[]> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('circle_messages')
      .select('id, fitcircle_id, system_payload')
      .eq('system_event_type', 'meal_logged')
      .eq('system_event_ref', entryId)
      .is('deleted_at', null);
    if (error) throw error;
    return (data ?? []) as MealPost[];
  }

  /**
   * Tombstone meal posts AND strip the meal from the stored row: members can
   * read circle_messages directly (RLS member_select + Realtime UPDATE events),
   * so a deleted_at alone would still ship the title, macros and photo path.
   */
  private static async tombstone(
    messageIds: string[],
    posts: Array<{ id: string; system_payload: Record<string, unknown> | null }> = []
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();
    const now = new Date().toISOString();
    const payloadById = new Map(posts.map((p) => [p.id, p.system_payload]));
    // Group by scrubbed payload so the common case stays one UPDATE.
    const groups = new Map<string, { payload: Record<string, unknown>; ids: string[] }>();
    for (const id of messageIds) {
      const payload = scrubbedMealPayload(payloadById.get(id));
      const key = JSON.stringify(payload);
      const g = groups.get(key) ?? { payload, ids: [] };
      g.ids.push(id);
      groups.set(key, g);
    }
    for (const { payload, ids } of groups.values()) {
      const { error } = await supabaseAdmin
        .from('circle_messages')
        .update({ deleted_at: now, updated_at: now, body: null, system_payload: payload })
        .in('id', ids);
      if (error) throw error;
    }
  }

  /** Was this entry ever posted to a chat (live or retracted)? */
  private static async everPosted(entryId: string): Promise<boolean> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('circle_messages')
      .select('id')
      .eq('system_event_type', 'meal_logged')
      .eq('system_event_ref', entryId)
      .limit(1);
    // Unsure → treat as posted (no push): a missed push is better than a repeat.
    if (error) return true;
    return (data ?? []).length > 0;
  }

  /** The entry's primary image with its stored size (food_log_images.width / height). */
  private static async primaryImage(entryId: string): Promise<{ id: string; width: number | null; height: number | null } | null> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error: dataError } = await supabaseAdmin
      .from('food_log_images')
      .select('id, width, height')
      .eq('food_log_entry_id', entryId)
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    logIgnoredQueryError('CircleMealPostService.primaryImage', dataError);
    if (!data?.id) return null;
    const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
    return { id: data.id as string, width: n((data as any).width), height: n((data as any).height) };
  }

  private static async imageDims(imageId: string): Promise<ImageDims> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin.from('food_log_images').select('width, height').eq('id', imageId).maybeSingle();
    logIgnoredQueryError('CircleMealPostService.imageDims', error);
    const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
    return { width: n((data as any)?.width), height: n((data as any)?.height) };
  }

  private static async actorName(userId: string): Promise<string> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error: dataError } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();
    logIgnoredQueryError('CircleMealPostService.actorName', dataError);
    return (data?.display_name as string | null) ?? 'Someone';
  }

  private static async circleName(circleId: string): Promise<string> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error: dataError } = await supabaseAdmin
      .from('fitcircles')
      .select('name')
      .eq('id', circleId)
      .maybeSingle();
    logIgnoredQueryError('CircleMealPostService.circleName', dataError);
    return (data?.name as string | null) ?? 'your circle';
  }
}
