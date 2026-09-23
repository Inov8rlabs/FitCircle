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

import { ChatNotificationService } from './chat-notification-service';
import { CircleChatService } from './circle-chat-service';
import { FoodPrivacyService } from './food-privacy-service';

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
}

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
  meal_type?: string | null;
  logged_at: string;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  has_images?: boolean | null;
  deleted_at?: string | null;
}

const SHAREABLE_VISIBILITY = new Set(['circle', 'shared']);
// food_log_entries.entry_type is 'food' | 'water' | 'supplement' (the meal slot
// lives in meal_type). 'meal'/'snack' are accepted for older rows/clients.
// Shipped with only 'meal'/'snack' on 2026-09-22 → zero posts for a day.
const MEAL_ENTRY_TYPES = new Set(['food', 'meal', 'snack']);

export class CircleMealPostService {
  // ==========================================================================
  // PURE HELPERS (unit-tested)
  // ==========================================================================

  /** Only meals/snacks that the owner shares (not water/supplements, not private, not deleted). */
  static isShareableMeal(entry: EntryLike): boolean {
    if (!entry || entry.deleted_at) return false;
    if (!MEAL_ENTRY_TYPES.has(entry.entry_type)) return false;
    if (entry.is_private) return false;
    return SHAREABLE_VISIBILITY.has(entry.visibility ?? '');
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
    const description = (entry.description ?? '').trim();
    if (description) return description.split('\n')[0].replace(/^•\s*/, '').slice(0, 80);
    return '';
  }

  static photoPath(imageId: string | null): string | null {
    return imageId ? `/api/mobile/food-log/images/${imageId}?size=medium` : null;
  }

  static buildPayload(entry: EntryLike, imageId: string | null): MealPostPayload {
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
    return {
      entry_id: entry.id,
      title: this.titleOf(entry) || this.slotLabel(entry.meal_type),
      meal_type: entry.meal_type ?? null,
      logged_at: entry.logged_at,
      calories: num(entry.calories),
      protein_g: num(entry.protein_g),
      carbs_g: num(entry.carbs_g),
      fat_g: num(entry.fat_g),
      image_id: imageId,
      photo_path: this.photoPath(imageId),
    };
  }

  // ==========================================================================
  // HOOKS (fire-and-forget from the food-log write path)
  // ==========================================================================

  /** A meal was created. Post it to every circle the owner shares meals with. */
  static async onMealLogged(entry: EntryLike): Promise<void> {
    try {
      if (!this.isShareableMeal(entry)) return;
      const circleIds = await this.circlesSharingFull(entry.user_id);
      if (circleIds.length === 0) return;

      const [actorName, imageId] = await Promise.all([
        this.actorName(entry.user_id),
        entry.has_images ? this.primaryImageId(entry.id) : Promise.resolve(null),
      ]);
      const body = this.renderBody(actorName, entry);
      const payload = this.buildPayload(entry, imageId);

      await Promise.all(
        circleIds.map(async (circleId) => {
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
            const circleName = await this.circleName(circleId);
            // Same push as a typed message: excludes the poster, honours mutes.
            void ChatNotificationService.notifyNewMessage(
              circleId,
              entry.user_id,
              actorName,
              circleName,
              post.id,
              body.replace(`${actorName} `, '')
            ).catch(() => {});
          } catch (err) {
            console.error(`[CircleMealPostService.onMealLogged] circle ${circleId}:`, err);
          }
        })
      );
    } catch (err) {
      console.error('[CircleMealPostService.onMealLogged] swallowed:', err);
    }
  }

  /**
   * The first photo landed on an entry (photos upload AFTER the entry row is
   * created). Fill the card's image in place; realtime UPDATE re-renders it.
   */
  static async onMealPhotoAttached(entryId: string, imageId: string): Promise<void> {
    try {
      const posts = await this.postsFor(entryId);
      if (posts.length === 0) return;
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
      const posts = await this.postsFor(entry.id);
      if (posts.length === 0) {
        // Became shareable (e.g. private → circle) after creation: post it now.
        if (this.isShareableMeal(entry)) await this.onMealLogged(entry);
        return;
      }
      if (!this.isShareableMeal(entry)) {
        await this.tombstone(posts.map((p) => p.id));
        return;
      }
      const actorName = await this.actorName(entry.user_id);
      const body = this.renderBody(actorName, entry);
      const supabaseAdmin = createAdminSupabase();
      await Promise.all(
        posts.map((p) => {
          const existing = (p.system_payload ?? {}) as Partial<MealPostPayload>;
          const imageId = existing.image_id ?? null;
          return supabaseAdmin
            .from('circle_messages')
            .update({
              body,
              system_payload: { ...existing, ...this.buildPayload(entry, imageId) },
              updated_at: new Date().toISOString(),
            })
            .eq('id', p.id);
        })
      );
    } catch (err) {
      console.error('[CircleMealPostService.onMealUpdated] swallowed:', err);
    }
  }

  /** The entry was deleted: its cards disappear from every chat. */
  static async onMealDeleted(entryId: string): Promise<void> {
    try {
      const posts = await this.postsFor(entryId);
      if (posts.length > 0) await this.tombstone(posts.map((p) => p.id));
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
    const privacy = new FoodPrivacyService();
    for (const circleId of shared) {
      if ((await privacy.getTier(circleId, entry.user_id)) === 'full') return true;
    }
    return false;
  }

  // ==========================================================================
  // PRIVATE
  // ==========================================================================

  private static async circlesSharingFull(userId: string): Promise<string[]> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('fitcircle_members')
      .select('fitcircle_id')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) throw error;
    const ids = (data ?? []).map((r) => r.fitcircle_id as string).filter(Boolean);
    const privacy = new FoodPrivacyService();
    const tiers = await Promise.all(ids.map((id) => privacy.getTier(id, userId)));
    return ids.filter((_, i) => tiers[i] === 'full');
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

  private static async postsFor(
    entryId: string
  ): Promise<Array<{ id: string; system_payload: Record<string, unknown> | null }>> {
    const supabaseAdmin = createAdminSupabase();
    const { data, error } = await supabaseAdmin
      .from('circle_messages')
      .select('id, system_payload')
      .eq('system_event_type', 'meal_logged')
      .eq('system_event_ref', entryId)
      .is('deleted_at', null);
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; system_payload: Record<string, unknown> | null }>;
  }

  private static async tombstone(messageIds: string[]): Promise<void> {
    const supabaseAdmin = createAdminSupabase();
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('circle_messages')
      .update({ deleted_at: now, updated_at: now })
      .in('id', messageIds);
    if (error) throw error;
  }

  private static async primaryImageId(entryId: string): Promise<string | null> {
    const supabaseAdmin = createAdminSupabase();
    const { data } = await supabaseAdmin
      .from('food_log_images')
      .select('id')
      .eq('food_log_entry_id', entryId)
      .is('deleted_at', null)
      .order('display_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }

  private static async actorName(userId: string): Promise<string> {
    const supabaseAdmin = createAdminSupabase();
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle();
    return (data?.display_name as string | null) ?? 'Someone';
  }

  private static async circleName(circleId: string): Promise<string> {
    const supabaseAdmin = createAdminSupabase();
    const { data } = await supabaseAdmin
      .from('fitcircles')
      .select('name')
      .eq('id', circleId)
      .maybeSingle();
    return (data?.name as string | null) ?? 'your circle';
  }
}
