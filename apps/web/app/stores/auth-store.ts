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

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  updatePreferences: (preferences: Partial<UserPreferences>) => void;
  refreshToken: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  checkAuth: () => Promise<void>;
}

interface RegisterData {
  email: string;
  password: string;
  name: string;
  username: string;
}

// Mock user for development
const mockUser: User = {
  id: '1',
  email: 'user@fitcircle.com',
  name: 'Alex Johnson',
  username: 'alexfit',
  avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex',
  bio: 'Fitness enthusiast on a journey to better health!',
  height: 70,
  currentWeight: 180,
  targetWeight: 160,
  dateOfBirth: '1990-05-15',
  gender: 'male',
  fitnessLevel: 'intermediate',
  goals: ['weight-loss', 'muscle-gain', 'endurance'],
  isPremium: true,
  xp: 2450,
  level: 12,
  streak: 15,
  achievements: [
    {
      id: '1',
      name: 'First Step',
      description: 'Complete your first check-in',
      icon: '👣',
      unlockedAt: '2024-01-01',
      rarity: 'common',
      xpReward: 50,
    },
    {
      id: '2',
      name: 'Week Warrior',
      description: 'Maintain a 7-day streak',
      icon: '🔥',
      unlockedAt: '2024-01-07',
      rarity: 'rare',
      xpReward: 150,
    },
  ],
  joinedAt: '2024-01-01',
  lastCheckIn: new Date().toISOString(),
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

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          // Sign in with Supabase Auth
          const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (authError) throw authError;

          if (authData.user) {
            // For now, create a user object from auth data
            // In production, you'd fetch the full user profile from your database
            const user: User = {
              id: authData.user.id,
              email: authData.user.email!,
              name: authData.user.user_metadata?.name || 'User',
              username: authData.user.user_metadata?.username || email.split('@')[0],
              avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${authData.user.id}`,
              bio: '',
              isPremium: false,
              xp: 0,
              level: 1,
              streak: 0,
              achievements: [],
              joinedAt: authData.user.created_at,
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
              user,
              token: authData.session?.access_token || null,
              isAuthenticated: true,
              isLoading: false,
            });
          }
        } catch (error: any) {
          set({
            error: error.message || 'Invalid email or password',
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

      logout: async () => {
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
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 500));
          set({ token: 'refreshed-mock-jwt-token' });
        } catch (error) {
          set({ error: 'Failed to refresh token' });
          get().logout();
        }
      },

      resetPassword: async (email: string) => {
        set({ isLoading: true, error: null });
        try {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 1000));
          set({ isLoading: false });
        } catch (error) {
          set({
            error: 'Failed to send reset email',
            isLoading: false,
          });
        }
      },

      checkAuth: async () => {
        set({ isLoading: true });
        try {
          // Get the current session from Supabase
          const { data: { session } } = await supabase.auth.getSession();

          if (session?.user) {
            // User is logged in, create user object from session
            const user: User = {
              id: session.user.id,
              email: session.user.email!,
              name: session.user.user_metadata?.name || 'User',
              username: session.user.user_metadata?.username || session.user.email!.split('@')[0],
              avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${session.user.id}`,
              bio: '',
              isPremium: false,
              xp: 0,
              level: 1,
              streak: 0,
              achievements: [],
              joinedAt: session.user.created_at,
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
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);