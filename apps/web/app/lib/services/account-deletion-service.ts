import { createAdminSupabase } from '../supabase-admin';
import { recalculateLeaderboard } from './leaderboard-service-v2';

// ============================================================================
// TYPES
// ============================================================================

export interface AccountDeletionResult {
  success: boolean;
  message: string;
  deleted_at: string;
  challenges_transferred: number;
  challenges_deleted: number;
  data_summary: {
    check_ins: number;
    challenge_participations: number;
    notifications: number;
    comments: number;
    reactions: number;
  };
}

export interface ChallengeWithMembers {
  id: string;
  name: string;
  creator_id: string;
  member_count: number;
  oldest_member_id: string | null;
  oldest_member_name: string | null;
}

// ============================================================================
// ACCOUNT DELETION SERVICE
// ============================================================================

/**
 * Service for handling account deletion with proper handling of shared resources.
 *
 * Key principles:
 * 1. Only delete the user's personal data
 * 2. Preserve FitCircles/challenges that have other members
 * 3. Transfer ownership of shared challenges to another member
 * 4. Maintain data integrity for other users
 *
 * Following FitCircle architecture: ALL business logic in TypeScript services, not stored procedures.
 */
export class AccountDeletionService {
  /**
   * Delete user account and all associated data
   * Handles shared resources (challenges/FitCircles) appropriately
   */
  static async deleteAccount(
    userId: string,
    options: {
      confirmEmail?: string;
      userEmail?: string;
      ipAddress?: string;
    } = {}
  ): Promise<AccountDeletionResult> {
    const supabaseAdmin = createAdminSupabase();
    const { confirmEmail, userEmail, ipAddress } = options;

    console.log(`🗑️ [AccountDeletionService] Starting account deletion for user: ${userId}`);

    // ========================================================================
    // STEP 1: Validate email confirmation (if provided)
    // ========================================================================
    if (confirmEmail && userEmail && confirmEmail !== userEmail) {
      throw new Error('Email confirmation does not match');
    }

    // ========================================================================
    // STEP 2: Log deletion request BEFORE deleting (for compliance audit)
    // ========================================================================
    console.log(`📝 [AccountDeletionService] Logging deletion request for audit trail`);

    await supabaseAdmin.from('user_consent').insert({
      user_id: userId,
      consent_type: 'data_deletion',
      consent_given: true,
      consent_version: 'deletion-request',
      consent_text: 'User requested account and data deletion under GDPR Article 17',
      consent_method: 'api',
      metadata: {
        deletion_timestamp: new Date().toISOString(),
        ip_address: ipAddress || 'unknown',
        user_email: userEmail,
      },
    });

    // Wait to ensure log is saved
    await new Promise((resolve) => setTimeout(resolve, 100));

    // ========================================================================
    // STEP 3: Handle challenges/FitCircles created by the user
    // ========================================================================
    console.log(`🔍 [AccountDeletionService] Checking for challenges created by user`);

    const challengesWithMembers = await this.getChallengesWithOtherMembers(userId);

    console.log(`📊 [AccountDeletionService] Found ${challengesWithMembers.length} challenges with other members`);

    let challengesTransferred = 0;
    let challengesDeleted = 0;

    // Handle each challenge
    for (const challenge of challengesWithMembers) {
      if (challenge.member_count > 1 && challenge.oldest_member_id) {
        // Transfer ownership to oldest/most active member
        console.log(
          `🔄 [AccountDeletionService] Transferring challenge "${challenge.name}" (${challenge.id}) ` +
          `to ${challenge.oldest_member_name} (${challenge.oldest_member_id})`
        );

        await this.transferChallengeOwnership(
          challenge.id,
          userId,
          challenge.oldest_member_id
        );
        challengesTransferred++;
      } else {
        // No other members - will be deleted by cascade
        console.log(
          `🗑️ [AccountDeletionService] Challenge "${challenge.name}" (${challenge.id}) ` +
          `will be deleted (no other members)`
        );
        challengesDeleted++;
      }
    }

    // ========================================================================
    // STEP 4: Count data to be deleted (for summary)
    // ========================================================================
    console.log(`📊 [AccountDeletionService] Counting data to be deleted`);

    const dataSummary = await this.countUserData(userId);

    console.log(`📊 [AccountDeletionService] Data summary:`, dataSummary);

    // ========================================================================
    // STEP 5: Get challenges user is participating in (for leaderboard update)
    // ========================================================================
    console.log(`🔍 [AccountDeletionService] Getting challenges for leaderboard recomputation`);

    const { data: userChallenges } = await supabaseAdmin
      .from('challenge_participants')
      .select('challenge_id')
      .eq('user_id', userId)
      .eq('status', 'active');

    const challengeIdsToUpdate = (userChallenges || []).map((p) => p.challenge_id);

    console.log(`📊 [AccountDeletionService] Found ${challengeIdsToUpdate.length} challenges to update leaderboards`);

    // ========================================================================
    // STEP 6: Remove user from challenges they're participating in
    // ========================================================================
    console.log(`🗑️ [AccountDeletionService] Removing user from challenge participations`);

    // This will cascade delete related data due to ON DELETE CASCADE
    await supabaseAdmin
      .from('challenge_participants')
      .delete()
      .eq('user_id', userId);

    // ========================================================================
    // STEP 7: Remove user from teams
    // ========================================================================
    console.log(`🗑️ [AccountDeletionService] Removing user from teams`);

    await supabaseAdmin
      .from('team_members')
      .delete()
      .eq('user_id', userId);

    // ========================================================================
    // STEP 8: Delete challenges created by user (that have no other members)
    // ========================================================================
    console.log(`🗑️ [AccountDeletionService] Deleting challenges with no other members`);

    // Delete challenges where user is creator and no other participants exist
    const { data: challengesToDelete } = await supabaseAdmin
      .from('challenges')
      .select('id, name')
      .eq('creator_id', userId);

    if (challengesToDelete) {
      for (const challenge of challengesToDelete) {
        // Check if there are any remaining participants
        const { count } = await supabaseAdmin
          .from('challenge_participants')
          .select('id', { count: 'exact', head: true })
          .eq('challenge_id', challenge.id);

        if (count === 0) {
          console.log(`🗑️ [AccountDeletionService] Deleting challenge "${challenge.name}" (${challenge.id})`);
          await supabaseAdmin
            .from('challenges')
            .delete()
            .eq('id', challenge.id);
        }
      }
    }

    // ========================================================================
    // STEP 9: Delete user-specific data (most will cascade, but being explicit)
    // ========================================================================
    console.log(`🗑️ [AccountDeletionService] Deleting user-specific data`);

    const deletionResults = await Promise.allSettled([
      // Notifications
      supabaseAdmin.from('notifications').delete().eq('user_id', userId),

      // Check-ins
      supabaseAdmin.from('check_ins').delete().eq('user_id', userId),

      // Daily tracking
      supabaseAdmin.from('daily_tracking').delete().eq('user_id', userId),

      // Comments
      supabaseAdmin.from('comments').delete().eq('user_id', userId),

      // Reactions
      supabaseAdmin.from('reactions').delete().eq('user_id', userId),

      // Achievements
      supabaseAdmin.from('achievements').delete().eq('user_id', userId),

      // Circle invites (as inviter)
      supabaseAdmin.from('circle_invites').delete().eq('inviter_id', userId),

      // Circle members
      supabaseAdmin.from('circle_members').delete().eq('user_id', userId),

      // Circle encouragements (sent)
      supabaseAdmin.from('circle_encouragements').delete().eq('from_user_id', userId),

      // Circle encouragements (received)
      supabaseAdmin.from('circle_encouragements').delete().eq('to_user_id', userId),

      // Circle check-ins
      supabaseAdmin.from('circle_check_ins').delete().eq('user_id', userId),

      // Daily high five limits
      supabaseAdmin.from('daily_high_five_limits').delete().eq('user_id', userId),

      // Engagement streaks
      supabaseAdmin.from('engagement_streaks').delete().eq('user_id', userId),

      // Engagement activities
      supabaseAdmin.from('engagement_activities').delete().eq('user_id', userId),

      // Metric streaks
      supabaseAdmin.from('metric_streaks').delete().eq('user_id', userId),

      // Food log entries
      supabaseAdmin.from('food_log_entries').delete().eq('user_id', userId),

      // Food log images
      supabaseAdmin.from('food_log_images').delete().eq('user_id', userId),

      // Food log shares
      supabaseAdmin.from('food_log_shares').delete().eq('owner_id', userId),

      // Food log audit
      supabaseAdmin.from('food_log_audit').delete().eq('user_id', userId),

      // Privacy settings
      supabaseAdmin.from('privacy_settings').delete().eq('user_id', userId),

      // Payments (keep for audit trail, but could be anonymized)
      // Note: We're NOT deleting payments for financial/legal record keeping
      // supabaseAdmin.from('payments').delete().eq('user_id', userId),
    ]);

    // Check for errors in data deletion
    const deletionErrors = deletionResults
      .filter((result) => result.status === 'rejected')
      .map((result: any) => result.reason);

    if (deletionErrors.length > 0) {
      console.warn('⚠️ [AccountDeletionService] Some data deletion operations failed:', deletionErrors);
      // Continue anyway - some tables might not exist or have no data
    }

    // ========================================================================
    // STEP 10: Recalculate leaderboards for affected challenges
    // ========================================================================
    console.log(`📊 [AccountDeletionService] Recalculating leaderboards for ${challengeIdsToUpdate.length} challenges`);

    for (const challengeId of challengeIdsToUpdate) {
      try {
        // Get challenge details to determine metric type
        const { data: challenge } = await supabaseAdmin
          .from('challenges')
          .select('type')
          .eq('id', challengeId)
          .single();

        if (challenge) {
          // Map challenge type to metric type
          const metricTypeMap: Record<string, 'steps' | 'weight_loss_pct' | 'checkin_streak'> = {
            step_count: 'steps',
            workout_frequency: 'checkin_streak',
            weight_loss: 'weight_loss_pct',
            custom: 'checkin_streak',
          };

          const metricType = metricTypeMap[challenge.type] || 'checkin_streak';

          console.log(`📊 [AccountDeletionService] Recalculating leaderboard for challenge ${challengeId} (metric: ${metricType})`);

          await recalculateLeaderboard(challengeId, 'daily', metricType, supabaseAdmin);
        }
      } catch (error) {
        console.error(`❌ [AccountDeletionService] Error recalculating leaderboard for challenge ${challengeId}:`, error);
        // Continue with deletion even if leaderboard update fails
      }
    }

    // ========================================================================
    // STEP 11: Delete consent records LAST (after all operations)
    // ========================================================================
    console.log(`🗑️ [AccountDeletionService] Deleting consent records`);

    await supabaseAdmin
      .from('user_consent')
      .delete()
      .eq('user_id', userId);

    // ========================================================================
    // STEP 12: Delete profile (will cascade remaining foreign keys)
    // ========================================================================
    console.log(`🗑️ [AccountDeletionService] Deleting profile`);

    const { error: profileDeleteError } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', userId);

    if (profileDeleteError) {
      console.error('❌ [AccountDeletionService] Error deleting profile:', profileDeleteError);
      throw new Error(`Failed to delete profile: ${profileDeleteError.message}`);
    }

    // ========================================================================
    // STEP 13: Delete auth user (Supabase Auth)
    // ========================================================================
    console.log(`🗑️ [AccountDeletionService] Deleting auth user`);

    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (authError) {
      console.error('❌ [AccountDeletionService] Error deleting auth user:', authError);
      throw new Error(`Failed to delete auth account: ${authError.message}`);
    }

    console.log(`✅ [AccountDeletionService] Account deleted successfully: ${userId}`);

    // ========================================================================
    // STEP 14: Return deletion summary
    // ========================================================================
    return {
      success: true,
      message: 'Your account and all associated data have been permanently deleted.',
      deleted_at: new Date().toISOString(),
      challenges_transferred: challengesTransferred,
      challenges_deleted: challengesDeleted,
      data_summary: dataSummary,
    };
  }

  // ==========================================================================
  // PRIVATE HELPER METHODS
  // ==========================================================================

  /**
   * Get challenges created by user that have other active members
   */
  private static async getChallengesWithOtherMembers(
    userId: string
  ): Promise<ChallengeWithMembers[]> {
    const supabaseAdmin = createAdminSupabase();

    // Get all challenges created by user
    const { data: challenges, error } = await supabaseAdmin
      .from('challenges')
      .select('id, name, creator_id')
      .eq('creator_id', userId);

    if (error || !challenges) {
      console.error('[AccountDeletionService] Error fetching challenges:', error);
      return [];
    }

    const challengesWithMembers: ChallengeWithMembers[] = [];

    for (const challenge of challenges) {
      // Count active members (excluding the user being deleted)
      const { data: participants, count } = await supabaseAdmin
        .from('challenge_participants')
        .select('user_id, joined_at, profiles!inner(display_name)', { count: 'exact' })
        .eq('challenge_id', challenge.id)
        .neq('user_id', userId)
        .eq('status', 'active')
        .order('joined_at', { ascending: true });

      if (count && count > 0 && participants && participants.length > 0) {
        // Get the oldest member (first to join)
        const oldestMember = participants[0];

        challengesWithMembers.push({
          id: challenge.id,
          name: challenge.name,
          creator_id: challenge.creator_id,
          member_count: count,
          oldest_member_id: oldestMember.user_id,
          oldest_member_name: (oldestMember.profiles as any)?.display_name || 'Unknown',
        });
      }
    }

    return challengesWithMembers;
  }

  /**
   * Transfer challenge ownership to another member
   */
  private static async transferChallengeOwnership(
    challengeId: string,
    oldCreatorId: string,
    newCreatorId: string
  ): Promise<void> {
    const supabaseAdmin = createAdminSupabase();

    console.log(
      `🔄 [AccountDeletionService] Transferring challenge ${challengeId} ` +
      `from ${oldCreatorId} to ${newCreatorId}`
    );

    // Update challenge creator
    const { error } = await supabaseAdmin
      .from('challenges')
      .update({
        creator_id: newCreatorId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', challengeId);

    if (error) {
      console.error('[AccountDeletionService] Error transferring challenge ownership:', error);
      throw new Error(`Failed to transfer challenge ownership: ${error.message}`);
    }

    // Optionally: Send notification to new owner
    await supabaseAdmin.from('notifications').insert({
      user_id: newCreatorId,
      type: 'system',
      channel: 'in_app',
      title: 'Challenge Ownership Transferred',
      body: `You are now the owner of a challenge. The previous owner deleted their account.`,
      related_challenge_id: challengeId,
      priority: 'high',
    });
  }

  /**
   * Count user data for deletion summary
   */
  private static async countUserData(userId: string): Promise<{
    check_ins: number;
    challenge_participations: number;
    notifications: number;
    comments: number;
    reactions: number;
  }> {
    const supabaseAdmin = createAdminSupabase();

    const [
      { count: checkInsCount },
      { count: participationsCount },
      { count: notificationsCount },
      { count: commentsCount },
      { count: reactionsCount },
    ] = await Promise.all([
      supabaseAdmin
        .from('check_ins')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabaseAdmin
        .from('challenge_participants')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabaseAdmin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabaseAdmin
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabaseAdmin
        .from('reactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
    ]);

    return {
      check_ins: checkInsCount || 0,
      challenge_participations: participationsCount || 0,
      notifications: notificationsCount || 0,
      comments: commentsCount || 0,
      reactions: reactionsCount || 0,
    };
  }

  /**
   * Export all user data (for GDPR Article 15: Right to Access)
   * This should be called BEFORE account deletion if user wants a data export
   */
  static async exportUserData(userId: string): Promise<any> {
    const supabaseAdmin = createAdminSupabase();

    console.log(`📥 [AccountDeletionService] Exporting data for user: ${userId}`);

    const [
      { data: profile },
      { data: checkIns },
      { data: dailyTracking },
      { data: challenges },
      { data: participations },
      { data: notifications },
      { data: comments },
      { data: reactions },
      { data: achievements },
      { data: consents },
    ] = await Promise.all([
      supabaseAdmin.from('profiles').select('*').eq('id', userId).single(),
      supabaseAdmin.from('check_ins').select('*').eq('user_id', userId),
      supabaseAdmin.from('daily_tracking').select('*').eq('user_id', userId),
      supabaseAdmin.from('challenges').select('*').eq('creator_id', userId),
      supabaseAdmin.from('challenge_participants').select('*').eq('user_id', userId),
      supabaseAdmin.from('notifications').select('*').eq('user_id', userId),
      supabaseAdmin.from('comments').select('*').eq('user_id', userId),
      supabaseAdmin.from('reactions').select('*').eq('user_id', userId),
      supabaseAdmin.from('achievements').select('*').eq('user_id', userId),
      supabaseAdmin.from('user_consent').select('*').eq('user_id', userId),
    ]);

    return {
      export_date: new Date().toISOString(),
      user_id: userId,
      profile,
      activity_data: {
        check_ins: checkIns || [],
        daily_tracking: dailyTracking || [],
      },
      challenges: {
        created: challenges || [],
        participated: participations || [],
      },
      social: {
        notifications: notifications || [],
        comments: comments || [],
        reactions: reactions || [],
      },
      achievements: achievements || [],
      privacy: {
        consents: consents || [],
      },
    };
  }
}
