import { createAdminSupabase } from '../supabase-admin';
import {
  type CreateGroupMealInput,
  type GroupMealDTO,
  type GroupMealRow,
  type GroupMealTagDTO,
  type GroupMealTagRow,
  type PendingGroupMealTagDTO,
} from '../types/group-meal';

/**
 * GroupMealService — Dining-Out & Group Meal Mode (PRD §6.12).
 *
 * One circle member logs a SHARED meal and tags other members; each tagged member accepts it
 * into their own diary with one tap (creating a food_log_entry, input_method='group_meal').
 *
 * Authorization is explicit in-code (the service uses the admin client): every read/write is
 * gated on active circle membership (fitcircle_members.status='active') and, for tag mutations,
 * on tag ownership (group_meal_tags.tagged_user_id = userId). Errors are thrown by message
 * ('Forbidden' | 'NotFound') and mapped to HTTP status at the route.
 */
export class GroupMealService {
  /**
   * Create a shared meal: verify creator is an active member of the circle, verify each tagged
   * user is an active member of the SAME circle, insert group_meals + one pending tag per tagged
   * user, and create the creator's own food_log_entry immediately. Returns the DTO with tags.
   */
  static async createGroupMeal(creatorId: string, input: CreateGroupMealInput): Promise<GroupMealDTO> {
    const supabase = createAdminSupabase();

    // Creator must be an active member of the circle.
    const creatorActive = await this.isActiveMember(input.fitcircleId, creatorId);
    if (!creatorActive) throw new Error('Forbidden');

    // De-dupe tagged users; the creator never tags themselves (they get a diary entry directly).
    const taggedUserIds = Array.from(new Set(input.taggedUserIds)).filter((id) => id !== creatorId);

    // Every tagged user must be an active member of THIS circle.
    if (taggedUserIds.length > 0) {
      const { data: members } = await supabase
        .from('fitcircle_members')
        .select('user_id')
        .eq('fitcircle_id', input.fitcircleId)
        .eq('status', 'active')
        .in('user_id', taggedUserIds);
      const activeSet = new Set((members ?? []).map((m: { user_id: string }) => m.user_id));
      const allActive = taggedUserIds.every((id) => activeSet.has(id));
      if (!allActive) throw new Error('Forbidden');
    }

    const loggedAt = new Date().toISOString();
    const macros = input.macros ?? null;

    // 1. Insert the shared meal definition.
    const { data: mealData, error: mealErr } = await supabase
      .from('group_meals')
      .insert({
        fitcircle_id: input.fitcircleId,
        creator_id: creatorId,
        name: input.name,
        restaurant_name: input.restaurantName ?? null,
        logged_at: loggedAt,
        meal_type: input.mealType,
        calories: macros?.calories ?? null,
        protein_g: macros?.proteinG ?? null,
        carbs_g: macros?.carbsG ?? null,
        fat_g: macros?.fatG ?? null,
        photo_url: input.photoUrl ?? null,
      })
      .select('*')
      .single();
    if (mealErr || !mealData) throw new Error(mealErr?.message ?? 'create_failed');
    const meal = mealData as GroupMealRow;

    // 2. Insert one pending tag per tagged user.
    let tagRows: GroupMealTagRow[] = [];
    if (taggedUserIds.length > 0) {
      const { data: tagsData, error: tagsErr } = await supabase
        .from('group_meal_tags')
        .insert(taggedUserIds.map((uid) => ({ group_meal_id: meal.id, tagged_user_id: uid })))
        .select('*');
      if (tagsErr) throw new Error(tagsErr.message);
      tagRows = (tagsData ?? []) as GroupMealTagRow[];
    }

    // 3. Create the creator's OWN diary entry immediately (they did the logging for the table).
    await this.insertDiaryEntry(creatorId, meal);

    return this.toMealDTO(meal, tagRows);
  }

  /**
   * The viewer's "accept into diary" inbox: group meals they're tagged in with status='pending'.
   * Newest meal first.
   */
  static async getPendingTags(userId: string): Promise<PendingGroupMealTagDTO[]> {
    const supabase = createAdminSupabase();

    const { data: tagsData } = await supabase
      .from('group_meal_tags')
      .select('*')
      .eq('tagged_user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    const tags = (tagsData ?? []) as GroupMealTagRow[];
    if (tags.length === 0) return [];

    const mealIds = Array.from(new Set(tags.map((t) => t.group_meal_id)));
    const { data: mealsData } = await supabase
      .from('group_meals')
      .select('*')
      .in('id', mealIds);
    const mealsById = new Map<string, GroupMealRow>(
      ((mealsData ?? []) as GroupMealRow[]).map((m) => [m.id, m])
    );

    return tags
      .map((tag) => {
        const meal = mealsById.get(tag.group_meal_id);
        if (!meal) return null;
        return { tag: this.toTagDTO(tag), groupMeal: this.toMealDTO(meal, []) };
      })
      .filter((x): x is PendingGroupMealTagDTO => x !== null)
      .sort((a, b) => b.groupMeal.loggedAt.localeCompare(a.groupMeal.loggedAt));
  }

  /**
   * Accept a tag: verify it belongs to userId, create a food_log_entry from the meal's macros
   * (input_method='group_meal'), set status='accepted' and link the entry.
   * Idempotent: re-accepting returns the existing accepted tag without a duplicate diary entry.
   */
  static async acceptTag(tagId: string, userId: string): Promise<GroupMealTagDTO> {
    const supabase = createAdminSupabase();

    const tag = await this.requireOwnedTag(tagId, userId);

    // Idempotency: already accepted → return as-is, never create a second diary entry.
    if (tag.status === 'accepted') return this.toTagDTO(tag);

    const { data: mealData } = await supabase
      .from('group_meals')
      .select('*')
      .eq('id', tag.group_meal_id)
      .maybeSingle();
    if (!mealData) throw new Error('NotFound');
    const meal = mealData as GroupMealRow;

    const entryId = await this.insertDiaryEntry(userId, meal);

    const { data: updated, error: updErr } = await supabase
      .from('group_meal_tags')
      .update({ status: 'accepted', accepted_food_log_entry_id: entryId })
      .eq('id', tagId)
      .eq('tagged_user_id', userId)
      .select('*')
      .single();
    if (updErr || !updated) throw new Error(updErr?.message ?? 'accept_failed');
    return this.toTagDTO(updated as GroupMealTagRow);
  }

  /** Decline a tag: verify ownership, set status='declined'. */
  static async declineTag(tagId: string, userId: string): Promise<GroupMealTagDTO> {
    const supabase = createAdminSupabase();

    await this.requireOwnedTag(tagId, userId);

    const { data: updated, error } = await supabase
      .from('group_meal_tags')
      .update({ status: 'declined' })
      .eq('id', tagId)
      .eq('tagged_user_id', userId)
      .select('*')
      .single();
    if (error || !updated) throw new Error(error?.message ?? 'decline_failed');
    return this.toTagDTO(updated as GroupMealTagRow);
  }

  /** Active-member-gated read of a group meal with all its tag statuses. */
  static async getGroupMeal(groupMealId: string, viewerUserId: string): Promise<GroupMealDTO> {
    const supabase = createAdminSupabase();

    const { data: mealData } = await supabase
      .from('group_meals')
      .select('*')
      .eq('id', groupMealId)
      .maybeSingle();
    if (!mealData) throw new Error('NotFound');
    const meal = mealData as GroupMealRow;

    const viewerActive = await this.isActiveMember(meal.fitcircle_id, viewerUserId);
    if (!viewerActive) throw new Error('Forbidden');

    const { data: tagsData } = await supabase
      .from('group_meal_tags')
      .select('*')
      .eq('group_meal_id', groupMealId)
      .order('created_at', { ascending: true });

    return this.toMealDTO(meal, (tagsData ?? []) as GroupMealTagRow[]);
  }

  // ---- private --------------------------------------------------------------

  /** True iff userId is an active member of the circle. */
  private static async isActiveMember(fitcircleId: string, userId: string): Promise<boolean> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', fitcircleId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    return !!data;
  }

  /** Load a tag and assert it is owned by userId. Throws NotFound / Forbidden. */
  private static async requireOwnedTag(tagId: string, userId: string): Promise<GroupMealTagRow> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('group_meal_tags')
      .select('*')
      .eq('id', tagId)
      .maybeSingle();
    if (!data) throw new Error('NotFound');
    const tag = data as GroupMealTagRow;
    if (tag.tagged_user_id !== userId) throw new Error('Forbidden');
    return tag;
  }

  /** Insert a food_log_entry for `userId` from a group meal's macros. Returns the new entry id. */
  private static async insertDiaryEntry(userId: string, meal: GroupMealRow): Promise<string> {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase
      .from('food_log_entries')
      .insert({
        user_id: userId,
        entry_type: 'food',
        title: meal.name,
        logged_at: meal.logged_at,
        entry_date: meal.logged_at.slice(0, 10),
        meal_type: meal.meal_type,
        calories: meal.calories,
        protein_g: meal.protein_g,
        carbs_g: meal.carbs_g,
        fat_g: meal.fat_g,
        input_method: 'group_meal',
        nutrition_source: 'user',
        visibility: 'private',
        source: 'manual',
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'diary_entry_failed');
    return (data as { id: string }).id;
  }

  private static toMealDTO(m: GroupMealRow, tags: GroupMealTagRow[]): GroupMealDTO {
    return {
      id: m.id,
      fitcircleId: m.fitcircle_id,
      creatorId: m.creator_id,
      name: m.name,
      restaurantName: m.restaurant_name,
      loggedAt: m.logged_at,
      mealType: m.meal_type,
      macros: {
        calories: m.calories,
        proteinG: m.protein_g,
        carbsG: m.carbs_g,
        fatG: m.fat_g,
      },
      photoUrl: m.photo_url,
      createdAt: m.created_at,
      tags: tags.map((t) => this.toTagDTO(t)),
    };
  }

  private static toTagDTO(t: GroupMealTagRow): GroupMealTagDTO {
    return {
      id: t.id,
      groupMealId: t.group_meal_id,
      taggedUserId: t.tagged_user_id,
      status: t.status,
      acceptedFoodLogEntryId: t.accepted_food_log_entry_id,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    };
  }
}
