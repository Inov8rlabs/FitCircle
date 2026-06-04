// Dining-Out & Group Meal Mode — shared contract (FROZEN).
// PRD v4 §6.12. Mirrors migration 062 (group_meals, group_meal_tags).
//
// One circle member logs a SHARED meal and TAGS others; each tagged member ACCEPTS it into
// their own diary with one tap (creating a food_log_entry, input_method='group_meal').
// Macro math / authorization all live server-side (§7.2.1); clients render DTOs, never re-derive.

import { z } from 'zod';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'other';
export type GroupMealTagStatus = 'pending' | 'accepted' | 'declined';

export const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack', 'other'];

// ============================================================================
// DB row shapes (snake_case) — mirror migration 062.
// ============================================================================
export interface GroupMealRow {
  id: string;
  fitcircle_id: string;
  creator_id: string;
  name: string;
  restaurant_name: string | null;
  logged_at: string;
  meal_type: MealType;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface GroupMealTagRow {
  id: string;
  group_meal_id: string;
  tagged_user_id: string;
  status: GroupMealTagStatus;
  accepted_food_log_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// API DTOs (camelCase) — what the group-meals endpoints return.
// ============================================================================
export interface Macros {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export interface GroupMealTagDTO {
  id: string;
  groupMealId: string;
  taggedUserId: string;
  status: GroupMealTagStatus;
  acceptedFoodLogEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMealDTO {
  id: string;
  fitcircleId: string;
  creatorId: string;
  name: string;
  restaurantName: string | null;
  loggedAt: string;
  mealType: MealType;
  macros: Macros;
  photoUrl: string | null;
  createdAt: string;
  // Present on create/detail reads; the per-member tag rows for this meal.
  tags: GroupMealTagDTO[];
}

// A pending-inbox item: the group meal + the viewer's own tag for it.
export interface PendingGroupMealTagDTO {
  tag: GroupMealTagDTO;
  groupMeal: GroupMealDTO;
}

// ============================================================================
// Service inputs (validated at the route).
// ============================================================================
export const macrosInputSchema = z.object({
  calories: z.number().nonnegative(),
  proteinG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  fatG: z.number().nonnegative(),
});

export const createGroupMealSchema = z.object({
  fitcircleId: z.string().uuid(),
  name: z.string().min(1).max(200),
  restaurantName: z.string().max(200).optional(),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'other']),
  // Per-person macros for the shared item. Optional: a tag-only "we ate at X" meal may omit them.
  macros: macrosInputSchema.optional(),
  photoUrl: z.string().max(2048).optional(),
  // Circle members to tag (must each be active members of fitcircleId). May be empty.
  taggedUserIds: z.array(z.string().uuid()).default([]),
});
export type CreateGroupMealInput = z.infer<typeof createGroupMealSchema>;

// ============================================================================
// GroupMealService API surface (FROZEN signatures)
// ----------------------------------------------------------------------------
// class GroupMealService {
//   // Create a shared meal: verify creator is an active member of the circle, verify each
//   // tagged user is an active member too, insert group_meals + one pending group_meal_tags
//   // per tagged user, AND create the creator's own food_log_entry immediately. Returns the DTO.
//   static async createGroupMeal(creatorId: string, input: CreateGroupMealInput): Promise<GroupMealDTO>
//
//   // The viewer's "accept into diary" inbox: group meals they're tagged in with status='pending'.
//   static async getPendingTags(userId: string): Promise<PendingGroupMealTagDTO[]>
//
//   // Accept a tag: verify the tag belongs to userId, create a food_log_entry from the meal's
//   // macros (input_method='group_meal'), set status='accepted' + link the entry. Idempotent:
//   // re-accepting returns the existing accepted tag without creating a duplicate entry.
//   static async acceptTag(tagId: string, userId: string): Promise<GroupMealTagDTO>
//
//   // Decline a tag: verify ownership, set status='declined'.
//   static async declineTag(tagId: string, userId: string): Promise<GroupMealTagDTO>
//
//   // Active-member-gated read of a group meal with all its tag statuses.
//   static async getGroupMeal(groupMealId: string, viewerUserId: string): Promise<GroupMealDTO>
// }
//
// Uses createAdminSupabase() and authorizes explicitly (membership checks against
// fitcircle_members status='active'; tag ownership against tagged_user_id = userId).
// Errors thrown by message: 'Forbidden' | 'NotFound' (mapped to 403/404 at the route).
// ============================================================================
