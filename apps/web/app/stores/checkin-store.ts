import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface CheckIn {
  id: string;
  userId: string;
  date: string;
  weight?: number;
  photos?: {
    front?: string;
    side?: string;
    back?: string;
  };
  measurements?: {
    chest?: number;
    waist?: number;
    hips?: number;
    arms?: number;
    thighs?: number;
  };
  mood?: 'amazing' | 'good' | 'okay' | 'tired' | 'stressed';
  energy?: number; // 1-10
  sleep?: number; // hours
  water?: number; // glasses
  notes?: string;
  workouts?: {
    type: string;
    duration: number;
    calories?: number;
  }[];
  nutrition?: {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  };
  challengeId?: string;
  xpEarned: number;
  streakDay: number;
  synced: boolean;
  createdAt: string;
}

export interface CheckInStreak {
  current: number;
  longest: number;
  lastCheckIn: string;
  missedDays: number;
  totalCheckIns: number;
}

export interface WeightProgress {
  startWeight: number;
  currentWeight: number;
  targetWeight: number;
  totalLost: number;
  weeklyAverage: number;
  monthlyAverage: number;
  trend: 'down' | 'up' | 'stable';
}

interface CheckInState {
  checkIns: CheckIn[];
  currentCheckIn: Partial<CheckIn> | null;
  streak: CheckInStreak;
  weightProgress: WeightProgress | null;
  offlineQueue: CheckIn[];
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchCheckIns: (userId: string) => Promise<void>;
  createCheckIn: (checkIn: Omit<CheckIn, 'id' | 'createdAt' | 'synced'>) => Promise<void>;
  updateCheckIn: (id: string, updates: Partial<CheckIn>) => Promise<void>;
  deleteCheckIn: (id: string) => Promise<void>;

  startCheckIn: () => void;
  updateCurrentCheckIn: (updates: Partial<CheckIn>) => void;
  submitCurrentCheckIn: () => Promise<void>;
  cancelCurrentCheckIn: () => void;

  calculateStreak: (userId: string) => void;
  calculateWeightProgress: (userId: string) => void;

  syncOfflineCheckIns: () => Promise<void>;
  addToOfflineQueue: (checkIn: CheckIn) => void;
  removeFromOfflineQueue: (id: string) => void;

  getTodayCheckIn: (userId: string) => CheckIn | undefined;
  getCheckInsByDateRange: (startDate: Date, endDate: Date) => CheckIn[];
}

// Mock data
const mockCheckIns: CheckIn[] = [
  {
    id: '1',
    userId: '1',
    date: new Date().toISOString(),
    weight: 178.5,
    photos: {
      front: 'https://via.placeholder.com/400x600',
    },
    mood: 'good',
    energy: 7,
    sleep: 7.5,
    water: 8,
    notes: 'Feeling strong today! Had a great workout.',
    workouts: [
      {
        type: 'Weight Training',
        duration: 45,
        calories: 300,
      },
    ],
    nutrition: {
      calories: 2100,
      protein: 150,
      carbs: 220,
      fat: 65,
    },
    xpEarned: 50,
    streakDay: 15,
    synced: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: '2',
    userId: '1',
    date: new Date(Date.now() - 86400000).toISOString(), // Yesterday
    weight: 179.2,
    mood: 'okay',
    energy: 6,
    sleep: 6.5,
    water: 7,
    xpEarned: 50,
    streakDay: 14,
    synced: true,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
  },
];

export const useCheckInStore = create<CheckInState>()(
  persist(
    (set, get) => ({
      checkIns: [],
      currentCheckIn: null,
      streak: {
        current: 0,
        longest: 0,
        lastCheckIn: '',
        missedDays: 0,
        totalCheckIns: 0,
      },
      weightProgress: null,
      offlineQueue: [],
      isLoading: false,
      error: null,

      fetchCheckIns: async (userId: string) => {
        set({ isLoading: true, error: null });
        try {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 1000));
          const userCheckIns = mockCheckIns.filter(c => c.userId === userId);
          set({ checkIns: userCheckIns, isLoading: false });

          // Calculate streak and progress after fetching
          get().calculateStreak(userId);
          get().calculateWeightProgress(userId);
        } catch (error) {
          set({ error: 'Failed to fetch check-ins', isLoading: false });
        }
      },

      createCheckIn: async (checkIn) => {
        set({ isLoading: true, error: null });
        try {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 500));

          const newCheckIn: CheckIn = {
            ...checkIn,
            id: Date.now().toString(),
            createdAt: new Date().toISOString(),
            synced: true,
          };

          set({
            checkIns: [newCheckIn, ...get().checkIns],
            isLoading: false,
          });

          // Recalculate streak and progress
          get().calculateStreak(checkIn.userId);
          get().calculateWeightProgress(checkIn.userId);
        } catch (error) {
          // Add to offline queue if failed
          const offlineCheckIn: CheckIn = {
            ...checkIn,
            id: `offline-${Date.now()}`,
            createdAt: new Date().toISOString(),
            synced: false,
          };
          get().addToOfflineQueue(offlineCheckIn);

          set({ error: 'Check-in saved offline', isLoading: false });
        }
      },

      updateCheckIn: async (id: string, updates: Partial<CheckIn>) => {
        set({ isLoading: true, error: null });
        try {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 500));

          const checkIns = get().checkIns.map(c =>
            c.id === id ? { ...c, ...updates } : c
          );

          set({ checkIns, isLoading: false });

          // Recalculate if weight was updated
          if (updates.weight) {
            const checkIn = checkIns.find(c => c.id === id);
            if (checkIn) {
              get().calculateWeightProgress(checkIn.userId);
            }
          }
        } catch (error) {
          set({ error: 'Failed to update check-in', isLoading: false });
        }
      },

      deleteCheckIn: async (id: string) => {
        set({ isLoading: true, error: null });
        try {
          // Simulate API call
          await new Promise(resolve => setTimeout(resolve, 500));

          const checkIn = get().checkIns.find(c => c.id === id);
          const checkIns = get().checkIns.filter(c => c.id !== id);

          set({ checkIns, isLoading: false });

          // Recalculate streak and progress
          if (checkIn) {
            get().calculateStreak(checkIn.userId);
            get().calculateWeightProgress(checkIn.userId);
          }
        } catch (error) {
          set({ error: 'Failed to delete check-in', isLoading: false });
        }
      },

      startCheckIn: () => {
        set({
          currentCheckIn: {
            date: new Date().toISOString(),
            mood: 'good',
            energy: 7,
            water: 0,
          },
        });
      },

      updateCurrentCheckIn: (updates: Partial<CheckIn>) => {
        const current = get().currentCheckIn;
        if (current) {
          set({ currentCheckIn: { ...current, ...updates } });
        }
      },

      submitCurrentCheckIn: async () => {
        const current = get().currentCheckIn;
        if (!current) return;

        const userId = '1'; // Get from auth store in real app
        const checkIn: Omit<CheckIn, 'id' | 'createdAt' | 'synced'> = {
          userId,
          date: current.date || new Date().toISOString(),
          weight: current.weight,
          photos: current.photos,
          measurements: current.measurements,
          mood: current.mood,
          energy: current.energy,
          sleep: current.sleep,
          water: current.water,
          notes: current.notes,
          workouts: current.workouts,
          nutrition: current.nutrition,
          challengeId: current.challengeId,
          xpEarned: 50, // Calculate based on completeness
          streakDay: get().streak.current + 1,
        };

        await get().createCheckIn(checkIn);
        set({ currentCheckIn: null });
      },

      cancelCurrentCheckIn: () => {
        set({ currentCheckIn: null });
      },

      calculateStreak: (userId: string) => {
        const userCheckIns = get().checkIns
          .filter(c => c.userId === userId)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        if (userCheckIns.length === 0) {
          set({
            streak: {
              current: 0,
              longest: 0,
              lastCheckIn: '',
              missedDays: 0,
              totalCheckIns: 0,
            },
          });
          return;
        }

        let currentStreak = 0;
        let longestStreak = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Check if there's a check-in today or yesterday
        const lastCheckIn = new Date(userCheckIns[0].date);
        lastCheckIn.setHours(0, 0, 0, 0);

        const daysDiff = Math.floor((today.getTime() - lastCheckIn.getTime()) / (1000 * 60 * 60 * 24));

        if (daysDiff <= 1) {
          currentStreak = 1;

          // Count consecutive days
          for (let i = 1; i < userCheckIns.length; i++) {
            const currentDate = new Date(userCheckIns[i - 1].date);
            const prevDate = new Date(userCheckIns[i].date);
            currentDate.setHours(0, 0, 0, 0);
            prevDate.setHours(0, 0, 0, 0);

            const diff = Math.floor((currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

            if (diff === 1) {
              currentStreak++;
            } else {
              break;
            }
          }
        }

        // Calculate longest streak
        let tempStreak = 1;
        for (let i = 1; i < userCheckIns.length; i++) {
          const currentDate = new Date(userCheckIns[i - 1].date);
          const prevDate = new Date(userCheckIns[i].date);
          currentDate.setHours(0, 0, 0, 0);
          prevDate.setHours(0, 0, 0, 0);

          const diff = Math.floor((currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

          if (diff === 1) {
            tempStreak++;
            longestStreak = Math.max(longestStreak, tempStreak);
          } else {
            tempStreak = 1;
          }
        }

        set({
          streak: {
            current: currentStreak,
            longest: Math.max(currentStreak, longestStreak),
            lastCheckIn: userCheckIns[0].date,
            missedDays: daysDiff > 1 ? daysDiff - 1 : 0,
            totalCheckIns: userCheckIns.length,
          },
        });
      },

      calculateWeightProgress: (userId: string) => {
        const userCheckIns = get().checkIns
          .filter(c => c.userId === userId && c.weight)
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        if (userCheckIns.length === 0) {
          set({ weightProgress: null });
          return;
        }

        const startWeight = userCheckIns[0].weight!;
        const currentWeight = userCheckIns[userCheckIns.length - 1].weight!;
        const totalLost = startWeight - currentWeight;

        // Calculate weekly average
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const weeklyCheckIns = userCheckIns.filter(c => new Date(c.date) >= oneWeekAgo);
        const weeklyAverage = weeklyCheckIns.length > 0
          ? weeklyCheckIns.reduce((sum, c) => sum + c.weight!, 0) / weeklyCheckIns.length
          : currentWeight;

        // Calculate monthly average
        const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const monthlyCheckIns = userCheckIns.filter(c => new Date(c.date) >= oneMonthAgo);
        const monthlyAverage = monthlyCheckIns.length > 0
          ? monthlyCheckIns.reduce((sum, c) => sum + c.weight!, 0) / monthlyCheckIns.length
          : currentWeight;

        // Determine trend
        let trend: 'down' | 'up' | 'stable' = 'stable';
        if (userCheckIns.length >= 3) {
          const recent = userCheckIns.slice(-3);
          const recentAvg = recent.reduce((sum, c) => sum + c.weight!, 0) / recent.length;
          const older = userCheckIns.slice(-6, -3);
          if (older.length > 0) {
            const olderAvg = older.reduce((sum, c) => sum + c.weight!, 0) / older.length;
            if (recentAvg < olderAvg - 0.5) trend = 'down';
            else if (recentAvg > olderAvg + 0.5) trend = 'up';
          }
        }

        set({
          weightProgress: {
            startWeight,
            currentWeight,
            targetWeight: 160, // Get from user profile in real app
            totalLost,
            weeklyAverage,
            monthlyAverage,
            trend,
          },
        });
      },

      syncOfflineCheckIns: async () => {
        const queue = get().offlineQueue;
        if (queue.length === 0) return;

        set({ isLoading: true });

        for (const checkIn of queue) {
          try {
            // Simulate API call
            await new Promise(resolve => setTimeout(resolve, 500));

            // Mark as synced and add to main list
            const syncedCheckIn = { ...checkIn, synced: true, id: Date.now().toString() };
            set({
              checkIns: [syncedCheckIn, ...get().checkIns],
            });

            // Remove from offline queue
            get().removeFromOfflineQueue(checkIn.id);
          } catch (error) {
            console.error('Failed to sync check-in:', checkIn.id);
          }
        }

        set({ isLoading: false });
      },

      addToOfflineQueue: (checkIn: CheckIn) => {
        set({
          offlineQueue: [...get().offlineQueue, checkIn],
        });
      },

      removeFromOfflineQueue: (id: string) => {
        set({
          offlineQueue: get().offlineQueue.filter(c => c.id !== id),
        });
      },

      getTodayCheckIn: (userId: string) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return get().checkIns.find(c => {
          if (c.userId !== userId) return false;
          const checkInDate = new Date(c.date);
          checkInDate.setHours(0, 0, 0, 0);
          return checkInDate.getTime() === today.getTime();
        });
      },

      getCheckInsByDateRange: (startDate: Date, endDate: Date) => {
        return get().checkIns.filter(c => {
          const date = new Date(c.date);
          return date >= startDate && date <= endDate;
        });
      },
    }),
    {
      name: 'checkin-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        checkIns: state.checkIns,
        offlineQueue: state.offlineQueue,
        streak: state.streak,
        weightProgress: state.weightProgress,
      }),
    }
  )
);