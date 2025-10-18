/**
 * Check-In Service
 *
 * Business logic for daily tracking check-ins including:
 * - Filtering by challenge type
 * - Permission checks for viewing others' check-ins
 * - Privacy controls
 *
 * Part of Progress History & Check-In Detail Enhancement (Phase 1)
 * PRD: /docs/progress-history-checkin-detail-prd.md
 */

import { SupabaseClient } from '@supabase/supabase-js';

// Types
export type ChallengeType = 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom';

export interface CheckIn {
  id: string;
  user_id: string;
  tracking_date: string;
  weight_kg: number | null;
  steps: number | null;
  mood_score: number | null;
  energy_level: number | null;
  notes: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

export interface CheckInWithProfile extends CheckIn {
  profile: {
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
}

export interface Challenge {
  id: string;
  type: ChallengeType;
  creator_id: string;
  name: string;
  description: string;
  start_date: string;
  end_date: string;
}

export interface User {
  id: string;
  email?: string;
}

/**
 * Filter check-ins based on challenge type
 *
 * Rules:
 * - weight_loss: Only show check-ins with weight data
 * - step_count/workout_frequency: Only show check-ins with steps data
 * - custom: Show all check-ins (both weight and steps)
 */
export function filterCheckInsByType(
  checkIns: CheckIn[],
  challengeType: ChallengeType
): CheckIn[] {
  switch (challengeType) {
    case 'weight_loss':
      return checkIns.filter(c => c.weight_kg != null);

    case 'step_count':
    case 'workout_frequency':
      return checkIns.filter(c => c.steps != null);

    case 'custom':
      // Show all check-ins for custom challenges
      return checkIns;

    default:
      return checkIns;
  }
}

/**
 * Determine if a viewer can access a specific check-in
 *
 * Permission rules:
 * - User can always view their own check-ins (public or private)
 * - Public check-ins are viewable by circle members
 * - Private check-ins are only viewable by owner and challenge creator
 * - Non-members cannot view check-ins
 */
export function canViewCheckIn(
  checkIn: CheckIn,
  viewer: User,
  challenge: Challenge,
  isCircleMember: boolean
): boolean {
  // Own check-ins are always viewable
  if (checkIn.user_id === viewer.id) {
    return true;
  }

  // Private check-ins: only owner or challenge creator can view
  if (!checkIn.is_public) {
    return challenge.creator_id === viewer.id;
  }

  // Public check-ins: viewable by circle members
  return isCircleMember;
}

/**
 * Determine if a viewer can edit a check-in
 *
 * Only the owner can edit their check-ins
 */
export function canEditCheckIn(checkIn: CheckIn, viewer: User): boolean {
  return checkIn.user_id === viewer.id;
}

/**
 * Get a single check-in with user profile data
 *
 * @param checkInId - ID of the check-in to retrieve
 * @param supabaseClient - Authenticated Supabase client
 */
export async function getCheckInWithDetails(
  checkInId: string,
  supabaseClient: SupabaseClient
): Promise<{ data: CheckInWithProfile | null; error: Error | null }> {
  try {
    const { data, error } = await supabaseClient
      .from('daily_tracking')
      .select(`
        *,
        profile:user_id (
          username,
          display_name,
          avatar_url
        )
      `)
      .eq('id', checkInId)
      .single();

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    if (!data) {
      return { data: null, error: new Error('Check-in not found') };
    }

    // Transform the data to match our interface
    const checkInWithProfile: CheckInWithProfile = {
      id: data.id,
      user_id: data.user_id,
      tracking_date: data.tracking_date,
      weight_kg: data.weight_kg,
      steps: data.steps,
      mood_score: data.mood_score,
      energy_level: data.energy_level,
      notes: data.notes,
      is_public: data.is_public ?? true, // Default to true for existing data
      created_at: data.created_at,
      updated_at: data.updated_at,
      profile: {
        username: data.profile?.username || 'Unknown',
        display_name: data.profile?.display_name || 'User',
        avatar_url: data.profile?.avatar_url || null,
      },
    };

    return { data: checkInWithProfile, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error : new Error('Unknown error')
    };
  }
}

/**
 * Get filtered check-ins for a user in a specific challenge
 *
 * @param userId - User whose check-ins to retrieve
 * @param challengeType - Type of challenge (determines filtering)
 * @param supabaseClient - Authenticated Supabase client
 * @param limit - Maximum number of check-ins to return (default: 20)
 * @param offset - Number of check-ins to skip (default: 0)
 */
export async function getFilteredCheckIns(
  userId: string,
  challengeType: ChallengeType,
  supabaseClient: SupabaseClient,
  limit: number = 20,
  offset: number = 0
): Promise<{ data: CheckIn[]; error: Error | null; hasMore: boolean }> {
  try {
    // Fetch more than needed to account for filtering
    const fetchLimit = limit * 2;

    const { data, error } = await supabaseClient
      .from('daily_tracking')
      .select('*')
      .eq('user_id', userId)
      .order('tracking_date', { ascending: false })
      .range(offset, offset + fetchLimit - 1);

    if (error) {
      return { data: [], error: new Error(error.message), hasMore: false };
    }

    if (!data) {
      return { data: [], error: null, hasMore: false };
    }

    // Apply type-based filtering
    const filtered = filterCheckInsByType(data, challengeType);

    // Apply pagination to filtered results
    const paginated = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;

    return { data: paginated, error: null, hasMore };
  } catch (error) {
    return {
      data: [],
      error: error instanceof Error ? error : new Error('Unknown error'),
      hasMore: false
    };
  }
}

/**
 * Check if user is a member of a specific challenge/circle
 *
 * @param userId - User to check membership for
 * @param challengeId - Challenge/circle ID
 * @param supabaseClient - Authenticated Supabase client
 */
export async function isUserInChallenge(
  userId: string,
  challengeId: string,
  supabaseClient: SupabaseClient
): Promise<boolean> {
  try {
    const { data, error } = await supabaseClient
      .from('circle_members')
      .select('id')
      .eq('user_id', userId)
      .eq('circle_id', challengeId)
      .eq('is_active', true)
      .single();

    return !error && data !== null;
  } catch (error) {
    return false;
  }
}

/**
 * Toggle privacy status of a check-in
 *
 * @param checkInId - ID of check-in to update
 * @param isPublic - New privacy status
 * @param userId - User making the request (must be owner)
 * @param supabaseClient - Authenticated Supabase client
 */
export async function toggleCheckInPrivacy(
  checkInId: string,
  isPublic: boolean,
  userId: string,
  supabaseClient: SupabaseClient
): Promise<{ success: boolean; error: Error | null }> {
  try {
    const { error } = await supabaseClient
      .from('daily_tracking')
      .update({ is_public: isPublic })
      .eq('id', checkInId)
      .eq('user_id', userId); // Ensure ownership

    if (error) {
      return { success: false, error: new Error(error.message) };
    }

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Delete a check-in
 *
 * @param checkInId - ID of check-in to delete
 * @param userId - User making the request (must be owner)
 * @param supabaseClient - Authenticated Supabase client
 */
export async function deleteCheckIn(
  checkInId: string,
  userId: string,
  supabaseClient: SupabaseClient
): Promise<{ success: boolean; error: Error | null }> {
  try {
    const { error } = await supabaseClient
      .from('daily_tracking')
      .delete()
      .eq('id', checkInId)
      .eq('user_id', userId); // Ensure ownership

    if (error) {
      return { success: false, error: new Error(error.message) };
    }

    return { success: true, error: null };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Calculate delta from previous check-in
 *
 * @param checkIn - Current check-in
 * @param previousCheckIn - Previous check-in for comparison
 * @param metric - Which metric to calculate delta for
 */
export function calculateDelta(
  checkIn: CheckIn,
  previousCheckIn: CheckIn | null,
  metric: 'weight' | 'steps'
): {
  value: number | null;
  direction: 'up' | 'down' | 'same';
  formatted: string;
} | null {
  if (!previousCheckIn) {
    return null;
  }

  let currentValue: number | null = null;
  let previousValue: number | null = null;
  let unit = '';

  if (metric === 'weight') {
    currentValue = checkIn.weight_kg;
    previousValue = previousCheckIn.weight_kg;
    unit = ' kg';
  } else if (metric === 'steps') {
    currentValue = checkIn.steps;
    previousValue = previousCheckIn.steps;
    unit = ' steps';
  }

  if (currentValue === null || previousValue === null) {
    return null;
  }

  const delta = currentValue - previousValue;
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
  const formatted = `${delta > 0 ? '+' : ''}${delta.toFixed(metric === 'weight' ? 1 : 0)}${unit}`;

  return {
    value: delta,
    direction,
    formatted,
  };
}

/**
 * Get check-in type based on data present
 *
 * @param checkIn - Check-in to classify
 */
export function getCheckInType(checkIn: CheckIn): 'weight' | 'steps' | 'mixed' {
  const hasWeight = checkIn.weight_kg !== null;
  const hasSteps = checkIn.steps !== null;

  if (hasWeight && hasSteps) {
    return 'mixed';
  } else if (hasWeight) {
    return 'weight';
  } else if (hasSteps) {
    return 'steps';
  }

  // Default to mixed if no data
  return 'mixed';
}

/**
 * Get check-ins for a specific user with circle membership validation
 *
 * This function replaces the complex RLS policy with TypeScript logic.
 * Only returns check-ins if the viewer and target user share at least one circle.
 *
 * @param targetUserId - User whose check-ins to retrieve
 * @param viewerId - User requesting the check-ins
 * @param supabaseClient - Authenticated Supabase client
 */
export async function getCheckInsForUser(
  targetUserId: string,
  viewerId: string,
  supabaseClient: SupabaseClient
): Promise<{ data: CheckIn[]; error: Error | null }> {
  try {
    // 1. Check if users share any circles
    const { data: viewerCircles } = await supabaseClient
      .from('circle_members')
      .select('circle_id')
      .eq('user_id', viewerId)
      .eq('is_active', true);

    const { data: targetCircles } = await supabaseClient
      .from('circle_members')
      .select('circle_id')
      .eq('user_id', targetUserId)
      .eq('is_active', true);

    const sharedCircleIds = viewerCircles
      ?.filter(vc => targetCircles?.some(tc => tc.circle_id === vc.circle_id))
      .map(c => c.circle_id) || [];

    // 2. If no shared circles, return empty
    if (sharedCircleIds.length === 0) {
      return { data: [], error: null };
    }

    // 3. Fetch public check-ins
    const { data, error } = await supabaseClient
      .from('daily_tracking')
      .select('*')
      .eq('user_id', targetUserId)
      .eq('is_public', true)
      .order('tracking_date', { ascending: false });

    if (error) {
      return { data: [], error: new Error(error.message) };
    }

    return { data: data || [], error: null };
  } catch (error) {
    return {
      data: [],
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}
