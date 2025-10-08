import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

interface ProfileUpdateData {
  display_name: string;
  date_of_birth: string;
  height_cm: number;
  weight_kg: number;
  goals: string[];
  fitness_level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  preferences: {
    units: {
      weight: 'kg' | 'lbs';
      height: 'cm' | 'inches';
    };
    privacy: {
      profileVisibility: 'public' | 'friends' | 'private';
    };
  };
  onboarding_completed: boolean;
}

export function useProfile() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, updateUser } = useAuthStore();

  const updateProfile = async (data: Partial<ProfileUpdateData>) => {
    if (!user) {
      setError('No user logged in');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check auth session first
      const { data: { session } } = await supabase.auth.getSession();
      console.log('Current session:', session?.user?.id);
      console.log('User from store:', user.id);
      console.log('Profile data:', data);

      if (!session?.user) {
        throw new Error('No active session - please log in again');
      }

      if (session.user.id !== user.id) {
        throw new Error(`Session mismatch: session=${session.user.id}, store=${user.id}`);
      }

      // First check if profile exists
      const { data: profilesData, error: checkError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id);

      if (checkError) {
        console.error('Error checking profile:', checkError);
        throw new Error(`Database check failed: ${checkError.message} (${checkError.code})`);
      }

      const existingProfile = profilesData && profilesData.length > 0 ? profilesData[0] : null;

      let result;
      if (existingProfile) {
        console.log('Updating existing profile');
        // Update existing profile
        result = await (supabase as any)
          .from('profiles')
          .update({
            ...data,
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id)
          .select()
          .single();
      } else {
        console.log('Creating new profile');
        // Create new profile
        result = await (supabase as any)
          .from('profiles')
          .insert({
            id: user.id,
            email: user.email,
            username: user.username,
            ...data,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();
      }

      console.log('Profile operation result:', result);

      if (result.error) {
        console.error('Profile operation error:', result.error);
        throw new Error(`Profile save failed: ${result.error.message} (${result.error.code})`);
      }

      // Update local user state with new data
      updateUser({
        ...user,
        name: data.display_name || user.name,
        height: data.height_cm,
        currentWeight: data.weight_kg,
        targetWeight: user.targetWeight,
        dateOfBirth: data.date_of_birth,
        goals: data.goals,
        fitnessLevel: data.fitness_level as 'beginner' | 'intermediate' | 'advanced' | undefined,
        preferences: {
          ...user.preferences,
          ...(data.preferences || {}),
        } as any,
      });

      setIsLoading(false);
      return true;
    } catch (err: any) {
      console.error('Profile update error:', err);
      setError(err.message || 'Failed to update profile');
      setIsLoading(false);
      return false;
    }
  };

  const fetchProfile = async () => {
    if (!user) return null;

    setIsLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      setIsLoading(false);
      return data;
    } catch (err: any) {
      console.error('Profile fetch error:', err);
      setError(err.message || 'Failed to fetch profile');
      setIsLoading(false);
      return null;
    }
  };

  return {
    updateProfile,
    fetchProfile,
    isLoading,
    error,
  };
}