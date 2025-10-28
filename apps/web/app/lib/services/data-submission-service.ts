/**
 * Data Submission Service
 *
 * Business logic for FitCircle data submission including:
 * - Manual data submission to FitCircles
 * - Multi-circle submission handling
 * - Submission validation and duplicate prevention
 * - Activity feed integration
 *
 * Part of User Engagement Infrastructure (Phase 1)
 * PRD: /docs/PRD-ENGAGEMENT-V2.md
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { updateUserRankAfterSubmission } from './leaderboard-service-v2';

// ============================================================================
// TYPES
// ============================================================================

export interface DataSubmission {
  id: string;
  fitcircle_id: string;
  user_id: string;
  submission_date: string;
  steps: number | null;
  weight: number | null;
  submitted_at: string;
  rank_after_submission: number | null;
  rank_change: number;
  created_at: string;
}

export interface SubmissionResult {
  fitcircle_id: string;
  success: boolean;
  rank: number | null;
  rank_change: number;
  error: string | null;
}

export interface PendingSubmission {
  fitcircle_id: string;
  fitcircle_name: string;
  can_submit: boolean;
  already_submitted: boolean;
}

// ============================================================================
// SUBMISSION VALIDATION
// ============================================================================

/**
 * Check if user already submitted data today for a FitCircle
 */
export async function hasSubmittedToday(
  userId: string,
  fitcircleId: string,
  date: string,
  supabase: SupabaseClient
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('fitcircle_data_submissions')
      .select('id')
      .eq('user_id', userId)
      .eq('fitcircle_id', fitcircleId)
      .eq('submission_date', date)
      .single();

    return !error && data !== null;
  } catch (error) {
    return false;
  }
}

/**
 * Check if user has tracking data for today
 */
export async function hasTodayTrackingData(
  userId: string,
  date: string,
  supabase: SupabaseClient
): Promise<{ hasData: boolean; steps: number | null; weight: number | null }> {
  try {
    const { data, error } = await supabase
      .from('daily_tracking')
      .select('steps, weight_kg')
      .eq('user_id', userId)
      .eq('tracking_date', date)
      .single();

    if (error || !data) {
      return { hasData: false, steps: null, weight: null };
    }

    const hasSteps = data.steps !== null && data.steps > 0;
    const hasWeight = data.weight_kg !== null && data.weight_kg > 0;

    return {
      hasData: hasSteps || hasWeight,
      steps: data.steps,
      weight: data.weight_kg,
    };
  } catch (error) {
    return { hasData: false, steps: null, weight: null };
  }
}

/**
 * Check if user is within submission window (before midnight)
 */
export function isWithinSubmissionWindow(): boolean {
  const now = new Date();
  const hours = now.getHours();

  // Allow submission from 00:00 to 23:59 same day
  // Grace period until 00:30 AM for timezone edge cases
  return hours < 24 || (hours === 0 && now.getMinutes() <= 30);
}

// ============================================================================
// DATA SUBMISSION
// ============================================================================

/**
 * Submit today's data to a specific FitCircle
 */
export async function submitToFitCircle(
  userId: string,
  fitcircleId: string,
  date: string,
  supabase: SupabaseClient
): Promise<{ submission: DataSubmission | null; error: Error | null }> {
  try {
    // 1. Check if already submitted
    const alreadySubmitted = await hasSubmittedToday(userId, fitcircleId, date, supabase);
    if (alreadySubmitted) {
      return { submission: null, error: new Error('Already submitted today') };
    }

    // 2. Check if within submission window
    if (!isWithinSubmissionWindow()) {
      return { submission: null, error: new Error('Submission window closed') };
    }

    // 3. Get today's tracking data
    const { hasData, steps, weight } = await hasTodayTrackingData(userId, date, supabase);
    if (!hasData) {
      return { submission: null, error: new Error('No tracking data for today') };
    }

    // 4. Create submission
    const submissionData = {
      fitcircle_id: fitcircleId,
      user_id: userId,
      submission_date: date,
      steps,
      weight,
      submitted_at: new Date().toISOString(),
      rank_after_submission: null,
      rank_change: 0,
    };

    const { data: submission, error: insertError } = await supabase
      .from('fitcircle_data_submissions')
      .insert(submissionData)
      .select()
      .single();

    if (insertError) {
      return { submission: null, error: new Error(insertError.message) };
    }

    // 5. Update daily_tracking to mark as submitted
    await supabase
      .from('daily_tracking')
      .update({
        submitted_to_fitcircles: true,
        submission_timestamp: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('tracking_date', date);

    // 6. Update leaderboard and get new rank
    if (steps !== null && steps > 0) {
      const { newRank, rankChange } = await updateUserRankAfterSubmission(
        userId,
        fitcircleId,
        steps,
        supabase
      );

      // Update submission with rank info
      if (newRank !== null) {
        const { data: updated } = await supabase
          .from('fitcircle_data_submissions')
          .update({
            rank_after_submission: newRank,
            rank_change: rankChange,
          })
          .eq('id', submission.id)
          .select()
          .single();

        if (updated) {
          return { submission: updated, error: null };
        }
      }
    }

    return { submission, error: null };
  } catch (error) {
    return {
      submission: null,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Submit today's data to all user's FitCircles
 */
export async function submitToAllFitCircles(
  userId: string,
  date: string,
  supabase: SupabaseClient
): Promise<{ results: SubmissionResult[]; error: Error | null }> {
  try {
    // Get all active FitCircles user belongs to
    const { data: memberships, error: memberError } = await supabase
      .from('circle_members')
      .select('circle_id')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (memberError || !memberships) {
      return { results: [], error: new Error('Failed to fetch FitCircles') };
    }

    // Submit to each FitCircle
    const results: SubmissionResult[] = [];
    for (const membership of memberships) {
      const { submission, error } = await submitToFitCircle(
        userId,
        membership.circle_id,
        date,
        supabase
      );

      results.push({
        fitcircle_id: membership.circle_id,
        success: !error && submission !== null,
        rank: submission?.rank_after_submission || null,
        rank_change: submission?.rank_change || 0,
        error: error?.message || null,
      });
    }

    return { results, error: null };
  } catch (error) {
    return {
      results: [],
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

// ============================================================================
// SUBMISSION STATUS
// ============================================================================

/**
 * Get pending submissions for a user (FitCircles they haven't submitted to today)
 */
export async function getPendingSubmissions(
  userId: string,
  date: string,
  supabase: SupabaseClient
): Promise<{ pending: PendingSubmission[]; error: Error | null }> {
  try {
    // Check if user has tracking data for today
    const { hasData } = await hasTodayTrackingData(userId, date, supabase);

    // Get all active FitCircles
    const { data: memberships, error: memberError } = await supabase
      .from('circle_members')
      .select(`
        circle_id,
        circles:circle_id (
          id,
          name
        )
      `)
      .eq('user_id', userId)
      .eq('is_active', true);

    if (memberError || !memberships) {
      return { pending: [], error: new Error('Failed to fetch FitCircles') };
    }

    // Check submission status for each FitCircle
    const pending: PendingSubmission[] = [];
    for (const membership of memberships) {
      const alreadySubmitted = await hasSubmittedToday(userId, membership.circle_id, date, supabase);

      pending.push({
        fitcircle_id: membership.circle_id,
        fitcircle_name: (membership.circles as any)?.name || 'Unknown',
        can_submit: hasData && !alreadySubmitted,
        already_submitted: alreadySubmitted,
      });
    }

    return { pending, error: null };
  } catch (error) {
    return {
      pending: [],
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Get today's submissions for a FitCircle (who submitted today)
 */
export async function getTodaySubmissions(
  fitcircleId: string,
  date: string,
  supabase: SupabaseClient
): Promise<{
  submissions: Array<{
    user_id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    steps: number | null;
    submitted_at: string;
    rank: number | null;
  }>;
  error: Error | null;
}> {
  try {
    const { data, error } = await supabase
      .from('fitcircle_data_submissions')
      .select(`
        user_id,
        steps,
        submitted_at,
        rank_after_submission,
        profile:user_id (
          username,
          display_name,
          avatar_url
        )
      `)
      .eq('fitcircle_id', fitcircleId)
      .eq('submission_date', date)
      .order('submitted_at', { ascending: false });

    if (error) {
      return { submissions: [], error: new Error(error.message) };
    }

    const submissions = (data || []).map(d => ({
      user_id: d.user_id,
      username: (d.profile as any)?.username || 'Unknown',
      display_name: (d.profile as any)?.display_name || 'User',
      avatar_url: (d.profile as any)?.avatar_url || null,
      steps: d.steps,
      submitted_at: d.submitted_at,
      rank: d.rank_after_submission,
    }));

    return { submissions, error: null };
  } catch (error) {
    return {
      submissions: [],
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}

/**
 * Get submission statistics for a FitCircle
 */
export async function getSubmissionStats(
  fitcircleId: string,
  date: string,
  supabase: SupabaseClient
): Promise<{
  total_members: number;
  submitted_count: number;
  submission_rate: number;
  error: Error | null;
}> {
  try {
    // Get total members
    const { data: members, error: memberError } = await supabase
      .from('circle_members')
      .select('user_id')
      .eq('circle_id', fitcircleId)
      .eq('is_active', true);

    if (memberError) {
      return { total_members: 0, submitted_count: 0, submission_rate: 0, error: new Error(memberError.message) };
    }

    const totalMembers = (members || []).length;

    // Get submission count
    const { data: submissions, error: submissionError } = await supabase
      .from('fitcircle_data_submissions')
      .select('id')
      .eq('fitcircle_id', fitcircleId)
      .eq('submission_date', date);

    if (submissionError) {
      return { total_members: totalMembers, submitted_count: 0, submission_rate: 0, error: new Error(submissionError.message) };
    }

    const submittedCount = (submissions || []).length;
    const submissionRate = totalMembers > 0 ? (submittedCount / totalMembers) * 100 : 0;

    return {
      total_members: totalMembers,
      submitted_count: submittedCount,
      submission_rate: Math.round(submissionRate),
      error: null,
    };
  } catch (error) {
    return {
      total_members: 0,
      submitted_count: 0,
      submission_rate: 0,
      error: error instanceof Error ? error : new Error('Unknown error'),
    };
  }
}
