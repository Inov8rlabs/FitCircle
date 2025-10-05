/**
 * Service for managing user preferences in FitCircle
 */

import { createAdminSupabase } from '@/lib/supabase-admin';
import { UnitSystem } from '@/lib/utils/units';

export interface UserPreferences {
  unitSystem?: UnitSystem;
  units?: {
    weight: 'kg' | 'lbs';
    height: 'cm' | 'inches';
  };
  privacy?: {
    profileVisibility: 'public' | 'friends' | 'private';
  };
}

export class PreferenceService {
  /**
   * Get user preferences
   */
  static async getUserPreferences(userId: string): Promise<UserPreferences> {
    const supabaseAdmin = createAdminSupabase();

    try {
      const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('preferences')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error fetching preferences:', error);
        return this.getDefaultPreferences();
      }

      return data?.preferences || this.getDefaultPreferences();
    } catch (error) {
      console.error('Error in getUserPreferences:', error);
      return this.getDefaultPreferences();
    }
  }

  /**
   * Update user preferences
   */
  static async updateUserPreferences(
    userId: string,
    preferences: Partial<UserPreferences>
  ): Promise<boolean> {
    const supabaseAdmin = createAdminSupabase();

    try {
      // Fetch current preferences
      const { data: currentData } = await supabaseAdmin
        .from('profiles')
        .select('preferences')
        .eq('id', userId)
        .single();

      const currentPreferences = currentData?.preferences || {};

      // Merge with new preferences
      const updatedPreferences = {
        ...currentPreferences,
        ...preferences,
        // Update units based on unitSystem if provided
        ...(preferences.unitSystem && {
          units: {
            weight: preferences.unitSystem === 'imperial' ? 'lbs' : 'kg',
            height: preferences.unitSystem === 'imperial' ? 'inches' : 'cm',
          },
        }),
      };

      // Update in database
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({
          preferences: updatedPreferences,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (error) {
        console.error('Error updating preferences:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in updateUserPreferences:', error);
      return false;
    }
  }

  /**
   * Update unit system preference
   */
  static async updateUnitSystem(
    userId: string,
    unitSystem: UnitSystem
  ): Promise<boolean> {
    return this.updateUserPreferences(userId, { unitSystem });
  }

  /**
   * Get unit system for a user
   */
  static async getUnitSystem(userId: string): Promise<UnitSystem> {
    const preferences = await this.getUserPreferences(userId);
    return preferences.unitSystem || 'metric';
  }

  /**
   * Get default preferences
   */
  static getDefaultPreferences(): UserPreferences {
    return {
      unitSystem: 'metric',
      units: {
        weight: 'kg',
        height: 'cm',
      },
      privacy: {
        profileVisibility: 'public',
      },
    };
  }
}