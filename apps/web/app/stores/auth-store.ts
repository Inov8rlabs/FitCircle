import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { supabase } from '@/lib/supabase';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  username: string;
  bio?: string;
  height?: number;
  currentWeight?: number;
  targetWeight?: number;
  dateOfBirth?: string;
  gender?: 'male' | 'female' | 'other';
  fitnessLevel?: 'beginner' | 'intermediate' | 'advanced';
  goals?: string[];
  isPremium: boolean;
  xp: number;
  level: number;
  streak: number;
  achievements: Achievement[];
  joinedAt: string;
  lastCheckIn?: string;
  preferences: UserPreferences;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlockedAt: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  xpReward: number;
}

export interface UserPreferences {
  notifications: {
    dailyReminder: boolean;
    challengeUpdates: boolean;
    socialActivity: boolean;
    achievements: boolean;
  };
  privacy: {
    profileVisibility: 'public' | 'friends' | 'private';
    showWeight: boolean;
    showProgress: boolean;
  };
  units: {
    weight: 'kg' | 'lbs';
    height: 'cm' | 'inches';
  };
  theme: 'light' | 'dark' | 'system';
  language: string;
}

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_CONFIRMED'
  | 'UNKNOWN';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  errorCode: AuthErrorCode | null;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  updatePreferences: (preferences: Partial<UserPreferences>) => void;
  refreshToken: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  resendConfirmation: (email: string) => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

interface RegisterData {
  email: string;
  password: string;
  name: string;
  username: string;
}

const defaultPreferences: UserPreferences = {
  notifications: {
    dailyReminder: true,
    challengeUpdates: true,
    socialActivity: true,
    achievements: true,
  },
  privacy: {
    profileVisibility: 'public',
    showWeight: true,
    showProgress: true,
  },
  units: {
    weight: 'lbs',
    height: 'inches',
  },
  theme: 'system',
  language: 'en',
};

// Build a User from the authenticated Supabase auth user, hydrating the
// gamification/profile fields from the real `profiles` table row.
async function buildUserFromAuth(authUser: {
  id: string;
  email?: string | null;
  created_at?: string;
  user_metadata?: Record<string, any> | null;
}): Promise<User> {
  const email = authUser.email || '';
  const fallbackUsername = email ? email.split('@')[0] : 'user';

  let profile: any = null;
  try {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authUser.id)
      .single();
    profile = data;
  } catch (error) {
    console.error('Failed to fetch profile:', error);
  }

  const preferences: UserPreferences =
    profile?.preferences && typeof profile.preferences === 'object'
      ? { ...defaultPreferences, ...profile.preferences }
      : defaultPreferences;

  return {
    id: authUser.id,
    email,
    name:
      profile?.display_name ||
      authUser.user_metadata?.name ||
      'User',
    username:
      profile?.username ||
      authUser.user_metadata?.username ||
      fallbackUsername,
    avatar:
      profile?.avatar_url ||
      `https://api.dicebear.com/7.x/avataaars/svg?seed=${authUser.id}`,
    bio: profile?.bio || '',
    height: profile?.height_cm ?? undefined,
    currentWeight: profile?.weight_kg ?? undefined,
    dateOfBirth: profile?.date_of_birth ?? undefined,
    fitnessLevel: profile?.fitness_level ?? undefined,
    goals: Array.isArray(profile?.goals) ? profile.goals : undefined,
    isPremium:
      profile?.subscription_tier === 'premium' ||
      profile?.subscription_tier === 'enterprise',
    xp: profile?.total_xp ?? 0,
    level: profile?.current_level ?? 1,
    streak: profile?.current_streak ?? 0,
    achievements: [],
    joinedAt: profile?.created_at || authUser.created_at || new Date().toISOString(),
    preferences,
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      errorCode: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null, errorCode: null });
        try {
          // Sign in with Supabase Auth
          const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (authError) throw authError;

          if (authData.user) {
            // Fetch the real profile row and populate user fields from it
            const user = await buildUserFromAuth(authData.user);

            set({
              user,
              token: authData.session?.access_token || null,
              isAuthenticated: true,
              isLoading: false,
            });
          }
        } catch (error: any) {
          const lower = String(error?.message || '').toLowerCase();
          const isEmailNotConfirmed =
            lower.includes('email not confirmed') || lower.includes('not confirmed');
          const isInvalidCredentials =
            lower.includes('invalid login credentials') ||
            lower.includes('invalid credentials') ||
            lower.includes('invalid email or password');

          let errorCode: AuthErrorCode = 'UNKNOWN';
          let friendly = error?.message || 'Something went wrong. Please try again.';
          if (isEmailNotConfirmed) {
            errorCode = 'EMAIL_NOT_CONFIRMED';
            friendly = "We need to verify your email before you can sign in. Check your inbox for a confirmation link from FitCircle.";
          } else if (isInvalidCredentials) {
            errorCode = 'INVALID_CREDENTIALS';
            friendly = "The email or password you entered is incorrect. Try again, or reset your password if you've forgotten it.";
          }

          set({
            error: friendly,
            errorCode,
            isLoading: false,
          });
          throw error;
        }
      },

      register: async (data: RegisterData) => {
        set({ isLoading: true, error: null });
        try {
          // Create user with Supabase Auth
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
            (typeof window !== 'undefined' ? window.location.origin : '');
          const { data: authData, error: authError } = await supabase.auth.signUp({
            email: data.email,
            password: data.password,
            options: {
              emailRedirectTo: `${baseUrl}/onboarding`,
              data: {
                name: data.name,
                username: data.username,
              }
            }
          });

          if (authError) throw authError;

          // If no session (email confirmation required), sign in immediately for dev/testing
          if (authData.user && !authData.session) {
            console.log('No session from signup - attempting auto sign in');
            const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
              email: data.email,
              password: data.password,
            });

            if (signInError) {
              console.log('Auto sign in failed:', signInError.message);
              // Email confirmation required - show message
              throw new Error('Please check your email to confirm your account');
            }

            // Use the sign in session
            if (signInData.session) {
              authData.session = signInData.session;
            }
          }

          if (authData.user && authData.session) {
            // Create user profile
            const newUser: User = {
              id: authData.user.id,
              email: data.email,
              name: data.name,
              username: data.username,
              avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.username}`,
              bio: '',
              isPremium: false,
              xp: 0,
              level: 1,
              streak: 0,
              achievements: [],
              joinedAt: new Date().toISOString(),
              preferences: {
                notifications: {
                  dailyReminder: true,
                  challengeUpdates: true,
                  socialActivity: true,
                  achievements: true,
                },
                privacy: {
                  profileVisibility: 'public',
                  showWeight: true,
                  showProgress: true,
                },
                units: {
                  weight: 'lbs',
                  height: 'inches',
                },
                theme: 'system',
                language: 'en',
              },
            };

            set({
              user: newUser,
              token: authData.session.access_token,
              isAuthenticated: true,
              isLoading: false,
            });
          } else {
            throw new Error('Registration succeeded but could not create session');
          }
        } catch (error: any) {
          set({
            error: error.message || 'Registration failed',
            isLoading: false,
          });
          throw error;
        }
      },

      logout: () => {
        void (async () => {
        try {
          await supabase.auth.signOut();
          set({
            user: null,
            token: null,
            isAuthenticated: false,
            error: null,
          });
        } catch (error) {
          console.error('Logout error:', error);
        }
        })();
      },

      updateUser: (updates: Partial<User>) => {
        const { user } = get();
        if (user) {
          set({ user: { ...user, ...updates } });
        }
      },

      updatePreferences: (preferences: Partial<UserPreferences>) => {
        const { user } = get();
        if (user) {
          set({
            user: {
              ...user,
              preferences: {
                ...user.preferences,
                ...preferences,
              },
            },
          });
        }
      },

      refreshToken: async () => {
        const { token } = get();
        if (!token) return;

        try {
          const { data, error } = await supabase.auth.refreshSession();
          if (error) throw error;

          const newToken = data.session?.access_token;
          if (!newToken) {
            throw new Error('No session returned from refresh');
          }

          set({ token: newToken });
        } catch (error) {
          set({ error: 'Failed to refresh token' });
          get().logout();
        }
      },

      resetPassword: async (email: string) => {
        set({ isLoading: true, error: null });
        try {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
            (typeof window !== 'undefined' ? window.location.origin : '');
          const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${baseUrl}/auth/reset-password`,
          });

          if (error) throw error;

          set({ isLoading: false });
        } catch (error: any) {
          set({
            error: error?.message || 'Failed to send reset email',
            isLoading: false,
          });
          throw error;
        }
      },

      resendConfirmation: async (email: string) => {
        // Always resolves successfully — Supabase already protects against
        // email enumeration on resend.
        await supabase.auth.resend({
          type: 'signup',
          email,
          options: {
            emailRedirectTo:
              typeof window !== 'undefined'
                ? `${window.location.origin}/auth/callback`
                : undefined,
          },
        });
      },

      clearError: () => set({ error: null, errorCode: null }),

      checkAuth: async () => {
        set({ isLoading: true });
        try {
          // Get the current session from Supabase
          const { data: { session } } = await supabase.auth.getSession();

          if (session?.user) {
            // User is logged in. Populate the in-memory token from the session
            // (it is never persisted to localStorage) and hydrate the user from
            // the real profile row.
            const user = await buildUserFromAuth(session.user);

            set({
              user,
              token: session.access_token,
              isAuthenticated: true,
              isLoading: false,
            });
          } else {
            set({
              isAuthenticated: false,
              token: null,
              user: null,
              isLoading: false,
            });
          }
        } catch (error) {
          set({
            isAuthenticated: false,
            token: null,
            user: null,
            isLoading: false,
          });
        }
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);