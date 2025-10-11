/**
 * Hook for managing unit preferences in FitCircle
 */

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { supabase } from '@/lib/supabase';
import { UnitSystem, WeightUnit, getWeightUnit } from '@/lib/utils/units';
import { toast } from 'sonner';

interface UseUnitPreferenceReturn {
  unitSystem: UnitSystem;
  weightUnit: WeightUnit;
  setUnitSystem: (system: UnitSystem) => Promise<void>;
  toggleUnitSystem: () => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function useUnitPreference(): UseUnitPreferenceReturn {
  const { user, updateUser } = useAuthStore();
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>('metric');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load user preferences on mount and when user changes
  useEffect(() => {
    if (user) {
      loadUserPreferences();
    }
  }, [user?.id]);

  const loadUserPreferences = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('preferences')
        .eq('id', user.id)
        .single();

      if (error) {
        // Silently use default if preferences don't exist yet
        console.log('Using default unit system (metric)');
        setUnitSystemState('metric');
        return;
      }

      const profileData = data as any;
      const preferences = profileData?.preferences || {};
      const system = preferences.unitSystem || 'metric';
      setUnitSystemState(system);
    } catch (err) {
      // Fallback to metric on any error
      console.log('Using default unit system (metric)');
      setUnitSystemState('metric');
    }
  };

  const setUnitSystem = async (system: UnitSystem) => {
    if (!user) {
      setError('No user logged in');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Get current preferences
      const { data: currentData } = await supabase
        .from('profiles')
        .select('preferences')
        .eq('id', user.id)
        .single();

      const currentPreferences = (currentData as any)?.preferences || {};

      // Update preferences with new unit system
      const updatedPreferences = {
        ...currentPreferences,
        unitSystem: system,
        units: {
          weight: system === 'imperial' ? 'lbs' : 'kg',
          height: system === 'imperial' ? 'inches' : 'cm',
        },
      };

      // Save to database
      const { error: updateError } = await (supabase as any)
        .from('profiles')
        .update({
          preferences: updatedPreferences,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (updateError) {
        throw updateError;
      }

      // Update local state
      setUnitSystemState(system);

      // Update user store
      updateUser({
        ...user,
        preferences: updatedPreferences,
      });

      // No toast needed - visual feedback from toggle is sufficient
    } catch (err: any) {
      console.error('Error updating unit system:', err);
      setError(err.message || 'Failed to update unit preference');
      toast.error('Failed to update unit preference');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleUnitSystem = async () => {
    const newSystem = unitSystem === 'metric' ? 'imperial' : 'metric';
    await setUnitSystem(newSystem);
  };

  return {
    unitSystem,
    weightUnit: getWeightUnit(unitSystem),
    setUnitSystem,
    toggleUnitSystem,
    isLoading,
    error,
  };
}