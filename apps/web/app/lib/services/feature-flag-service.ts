/**
 * Feature Flag Service
 *
 * Controls feature access based on:
 * - Subscription tier
 * - Explicit user allowlist
 * - Percentage-based rollout
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { FeatureFlagResult } from '@/lib/types/food-log';

export class FeatureFlagService {
  /**
   * Check if feature is enabled for user
   */
  static async isFeatureEnabled(
    featureName: string,
    userId: string,
    supabase: SupabaseClient
  ): Promise<FeatureFlagResult> {
    try {
      // Get feature flag
      const { data: flag } = await supabase
        .from('feature_flags')
        .select('*')
        .eq('name', featureName)
        .single();

      if (!flag || !flag.is_enabled) {
        return { enabled: false, reason: 'disabled', access_level: 'none' };
      }

      // Get user profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('subscription_tier')
        .eq('id', userId)
        .single();

      if (!profile) {
        return { enabled: false, reason: 'disabled', access_level: 'none' };
      }

      // Check explicit allowlist
      if (flag.allowed_user_ids && flag.allowed_user_ids.includes(userId)) {
        return { enabled: true, reason: 'explicit', access_level: 'full' };
      }

      // Check tier allowlist
      if (flag.allowed_tiers && flag.allowed_tiers.includes(profile.subscription_tier)) {
        return { enabled: true, reason: 'tier', access_level: 'full' };
      }

      // Check rollout percentage
      if (flag.rollout_percentage > 0) {
        const userHash = this.hashUserId(userId);
        const userPercentile = userHash % 100;

        if (userPercentile < flag.rollout_percentage) {
          return { enabled: true, reason: 'rollout', access_level: 'full' };
        }
      }

      return { enabled: false, reason: 'disabled', access_level: 'none' };
    } catch (error) {
      console.error('Feature flag check error:', error);
      return { enabled: false, reason: 'disabled', access_level: 'none' };
    }
  }

  /**
   * Batch check multiple features for user
   */
  static async checkFeatures(
    featureNames: string[],
    userId: string,
    supabase: SupabaseClient
  ): Promise<Record<string, boolean>> {
    const results = await Promise.all(
      featureNames.map(async (name) => {
        const result = await this.isFeatureEnabled(name, userId, supabase);
        return [name, result.enabled] as [string, boolean];
      })
    );

    return Object.fromEntries(results);
  }

  /**
   * Admin: Enable feature for specific users
   */
  static async addUsersToAllowlist(
    featureName: string,
    userIds: string[],
    supabase: SupabaseClient
  ): Promise<{ success: boolean; error?: Error }> {
    try {
      const { data: flag } = await supabase
        .from('feature_flags')
        .select('allowed_user_ids')
        .eq('name', featureName)
        .single();

      if (!flag) {
        return { success: false, error: new Error('Feature flag not found') };
      }

      const currentIds = flag.allowed_user_ids || [];
      const updatedIds = [...new Set([...currentIds, ...userIds])];

      const { error } = await supabase
        .from('feature_flags')
        .update({ allowed_user_ids: updatedIds })
        .eq('name', featureName);

      if (error) {
        return { success: false, error: new Error(error.message) };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  /**
   * Admin: Update rollout percentage
   */
  static async updateRolloutPercentage(
    featureName: string,
    percentage: number,
    supabase: SupabaseClient
  ): Promise<{ success: boolean; error?: Error }> {
    try {
      if (percentage < 0 || percentage > 100) {
        return { success: false, error: new Error('Invalid percentage') };
      }

      const { error } = await supabase
        .from('feature_flags')
        .update({ rollout_percentage: percentage })
        .eq('name', featureName);

      if (error) {
        return { success: false, error: new Error(error.message) };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      };
    }
  }

  // Private helpers

  private static hashUserId(userId: string): number {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      const char = userId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}
