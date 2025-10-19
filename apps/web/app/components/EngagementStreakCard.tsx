'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Flame, Trophy, Pause } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';

interface EngagementStreak {
  current_streak: number;
  longest_streak: number;
  streak_freezes_available: number;
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

      // Call web API endpoint (uses cookie-based auth)
      const response = await fetch('/api/streaks/engagement', {
        credentials: 'include', // Include cookies for authentication
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch streak: ${response.status}`);
      }

      const data = await response.json();

      if (data) {
        setStreak(data);
      }
    } catch (error) {
      console.error('Error fetching engagement streak:', error);
      // Set default values on error
      setStreak({
        current_streak: 0,
        longest_streak: 0,
        streak_freezes_available: 1,
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

  // Calculate circular progress (streak days / longest streak for progress percentage)
  const progressPercentage = streak.longest_streak > 0
    ? Math.min((streak.current_streak / streak.longest_streak) * 100, 100)
    : streak.current_streak > 0 ? 75 : 0; // Default to 75% if current streak exists but no longest

  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPercentage / 100) * circumference;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.1 }}
    >
      <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl hover:border-orange-500/50 transition-all duration-300 cursor-pointer group shadow-lg">
        <CardContent className="p-4 sm:p-6 lg:p-8">
          {/* Centered circular design */}
          <div className="flex flex-col items-center gap-6">
            {/* Circular progress ring with flame icon */}
            <div className="relative">
              {/* SVG Circle Progress */}
              <svg className="w-32 h-32 sm:w-36 sm:h-36 transform -rotate-90" viewBox="0 0 100 100">
                {/* Background circle */}
                <circle
                  cx="50"
                  cy="50"
                  r={radius}
                  stroke="currentColor"
                  strokeWidth="6"
                  fill="none"
                  className="text-slate-800"
                />
                {/* Progress circle */}
                <motion.circle
                  cx="50"
                  cy="50"
                  r={radius}
                  stroke="url(#flameGradient)"
                  strokeWidth="6"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  initial={{ strokeDashoffset: circumference }}
                  animate={{ strokeDashoffset }}
                  transition={{ duration: 1, ease: "easeOut" }}
                />
                <defs>
                  <linearGradient id="flameGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#fb923c" />
                    <stop offset="50%" stopColor="#f97316" />
                    <stop offset="100%" stopColor="#ea580c" />
                  </linearGradient>
                </defs>
              </svg>

              {/* Flame icon in center */}
              <motion.div
                animate={{
                  scale: pulseAnimation ? [1, 1.15, 1] : 1,
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  repeatType: 'reverse',
                }}
                className="absolute inset-0 flex items-center justify-center"
              >
                <Flame className="h-12 w-12 sm:h-14 sm:w-14 text-orange-500" strokeWidth={1.5} />
              </motion.div>
            </div>

            {/* Streak text */}
            <div className="text-center">
              <p className="text-sm sm:text-base text-gray-400 font-medium mb-1">Streak</p>
              <p className="text-3xl sm:text-4xl font-bold text-white">
                {streak.current_streak} day{streak.current_streak !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Freeze indicators */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex items-center gap-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <motion.div
                    key={index}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.1 * index }}
                  >
                    <div
                      className={`w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full transition-all duration-300 ${
                        index < streak.streak_freezes_available
                          ? 'bg-cyan-400 shadow-lg shadow-cyan-400/50 group-hover:scale-110'
                          : 'bg-slate-700/50'
                      }`}
                    />
                  </motion.div>
                ))}
              </div>
              <p className="text-xs sm:text-sm text-gray-500">
                {streak.streak_freezes_available} Freeze{streak.streak_freezes_available !== 1 ? 's' : ''} Available
              </p>
            </div>

            {/* Additional badges */}
            {(streak.current_streak < streak.longest_streak || streak.paused) && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {/* Longest streak record */}
                {streak.current_streak < streak.longest_streak && (
                  <div className="flex items-center gap-1.5 bg-slate-800/50 px-3 py-1.5 rounded-full">
                    <Trophy className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-yellow-400 flex-shrink-0" />
                    <p className="text-xs sm:text-sm text-gray-300 whitespace-nowrap">
                      Best: <span className="font-semibold text-yellow-400">{streak.longest_streak}</span> days
                    </p>
                  </div>
                )}

                {/* Paused indicator */}
                {streak.paused && (
                  <div className="flex items-center gap-1.5 bg-yellow-500/10 px-3 py-1.5 rounded-full">
                    <Pause className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-yellow-400 flex-shrink-0" />
                    <p className="text-xs sm:text-sm text-yellow-400 font-medium whitespace-nowrap">
                      Paused
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
