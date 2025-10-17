'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Flame, Trophy, Pause } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

interface EngagementStreak {
  current_streak: number;
  longest_streak: number;
  freezes_available: number;
  paused: boolean;
  pause_end_date: string | null;
  last_engagement_date: string | null;
}

export function EngagementStreakCard() {
  const { user } = useAuthStore();
  const [streak, setStreak] = useState<EngagementStreak | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pulseAnimation, setPulseAnimation] = useState(false);

  useEffect(() => {
    if (user) {
      fetchStreak();
    }
  }, [user]);

  useEffect(() => {
    // Start pulse animation after component mounts
    setPulseAnimation(true);
  }, []);

  const fetchStreak = async () => {
    if (!user) return;

    try {
      setIsLoading(true);

      // Get the auth session
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        console.error('No access token available');
        return;
      }

      // Fetch from mobile API endpoint
      const response = await fetch('/api/mobile/streaks/engagement', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch streak');
      }

      const result = await response.json();

      if (result.success && result.data) {
        setStreak(result.data);
      }
    } catch (error) {
      console.error('Error fetching engagement streak:', error);
      // Set default values on error
      setStreak({
        current_streak: 0,
        longest_streak: 0,
        freezes_available: 1,
        paused: false,
        pause_end_date: null,
        last_engagement_date: null,
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading || !streak) {
    return (
      <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl h-full">
        <CardContent className="p-4 sm:p-6 flex items-center justify-center h-full min-h-[200px]">
          <div className="text-gray-400 text-sm">Loading streak...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.1 }}
    >
      <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl hover:border-orange-500/50 transition-all duration-300 cursor-pointer group shadow-lg">
        <CardContent className="p-4 sm:p-6 lg:p-8">
          {/* Desktop & Mobile Layouts */}
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6">
            {/* Left: Fire emoji with pulse animation */}
            <motion.div
              animate={{
                scale: pulseAnimation ? [1, 1.1, 1] : 1,
              }}
              transition={{
                duration: 1,
                repeat: Infinity,
                repeatType: 'reverse',
              }}
              className="flex-shrink-0"
            >
              <span className="text-6xl sm:text-7xl lg:text-8xl">🔥</span>
            </motion.div>

            {/* Right: Streak info */}
            <div className="flex-1 flex flex-col items-center sm:items-start text-center sm:text-left w-full">
              {/* Streak count and label */}
              <div className="mb-3 sm:mb-4">
                <div className="text-5xl sm:text-6xl lg:text-7xl font-bold bg-gradient-to-r from-orange-400 via-red-500 to-orange-600 bg-clip-text text-transparent mb-1">
                  {streak.current_streak}
                </div>
                <p className="text-sm sm:text-base lg:text-lg text-gray-400 font-medium">
                  Day Engagement Streak
                </p>
              </div>

              {/* Freeze indicators */}
              <div className="flex flex-col items-center sm:items-start gap-2 mb-3 sm:mb-4">
                <div className="flex items-center gap-2 sm:gap-2.5">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <motion.div
                      key={index}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.1 * index }}
                    >
                      <div
                        className={`w-3 h-3 sm:w-3.5 sm:h-3.5 lg:w-4 lg:h-4 rounded-full transition-all duration-300 ${
                          index < streak.freezes_available
                            ? 'bg-cyan-400 shadow-lg shadow-cyan-400/50 group-hover:scale-110'
                            : 'bg-slate-700/50'
                        }`}
                      />
                    </motion.div>
                  ))}
                </div>
                <p className="text-xs sm:text-sm text-gray-500">
                  {streak.freezes_available} Freeze{streak.freezes_available !== 1 ? 's' : ''} Available
                </p>
              </div>

              {/* Additional info: Longest streak and paused status */}
              <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3 sm:gap-4 w-full">
                {/* Longest streak record (if current is not longest) */}
                {streak.current_streak < streak.longest_streak && (
                  <div className="flex items-center gap-1.5 bg-slate-800/50 px-3 py-1.5 rounded-full">
                    <Trophy className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-yellow-400 flex-shrink-0" />
                    <p className="text-xs sm:text-sm text-gray-300 whitespace-nowrap">
                      PR: <span className="font-semibold text-yellow-400">{streak.longest_streak}</span> days
                    </p>
                  </div>
                )}

                {/* Paused indicator */}
                {streak.paused && (
                  <div className="flex items-center gap-1.5 bg-yellow-500/10 px-3 py-1.5 rounded-full">
                    <Pause className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-yellow-400 flex-shrink-0" />
                    <p className="text-xs sm:text-sm text-yellow-400 font-medium whitespace-nowrap">
                      Streak Paused
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
