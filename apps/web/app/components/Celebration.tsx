'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Trophy, Star, PartyPopper } from 'lucide-react';
import confetti from 'canvas-confetti';
import { Button } from '@/components/ui/button';

interface CelebrationProps {
  onComplete: () => void;
  userName?: string;
}

export default function Celebration({ onComplete, userName = 'Champion' }: CelebrationProps) {
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    // Trigger confetti animation
    const duration = 3000;
    const animationEnd = Date.now() + duration;
    const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

    function randomInRange(min: number, max: number) {
      return Math.random() * (max - min) + min;
    }

    const interval = setInterval(function() {
      const timeLeft = animationEnd - Date.now();

      if (timeLeft <= 0) {
        clearInterval(interval);
        setShowContent(true);
        return;
      }

      const particleCount = 50 * (timeLeft / duration);

      // Shoot confetti from left
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
        colors: ['#06b6d4', '#8b5cf6', '#f97316', '#10b981', '#FFD700'],
      });

      // Shoot confetti from right
      confetti({
        ...defaults,
        particleCount,
        origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
        colors: ['#06b6d4', '#8b5cf6', '#f97316', '#10b981', '#FFD700'],
      });
    }, 250);

    // Show content after initial burst
    setTimeout(() => setShowContent(true), 500);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const achievements = [
    { icon: Trophy, label: 'Profile Complete', color: 'text-yellow-400' },
    { icon: Star, label: 'Journey Started', color: 'text-cyan-400' },
    { icon: Sparkles, label: 'Ready to Crush Goals', color: 'text-purple-400' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-cyan-900/90 via-purple-900/90 to-orange-900/90 backdrop-blur-sm">
      <AnimatePresence>
        {showContent && (
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              type: 'spring',
              stiffness: 260,
              damping: 20,
              duration: 0.6,
            }}
            className="text-center px-6 py-12 max-w-md mx-auto"
          >
            {/* Main Trophy */}
            <motion.div
              initial={{ y: -20 }}
              animate={{ y: 0 }}
              transition={{
                type: 'spring',
                repeat: Infinity,
                repeatType: 'reverse',
                duration: 2,
              }}
              className="mb-8"
            >
              <div className="relative inline-block">
                <Trophy className="w-32 h-32 text-yellow-400 drop-shadow-2xl" />
                <motion.div
                  animate={{
                    scale: [1, 1.2, 1],
                    opacity: [0.5, 1, 0.5],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                  className="absolute inset-0 bg-yellow-400/20 rounded-full blur-xl"
                />
              </div>
            </motion.div>

            {/* Congratulations Text */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="mb-8"
            >
              <h1 className="text-5xl font-bold text-white mb-3 bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-purple-400 to-orange-400">
                Congratulations!
              </h1>
              <p className="text-2xl text-white/90 font-semibold">
                Welcome to FitCircle, {userName}!
              </p>
            </motion.div>

            {/* Achievement Badges */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="mb-8 space-y-3"
            >
              {achievements.map((achievement, index) => (
                <motion.div
                  key={achievement.label}
                  initial={{ x: -50, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: 0.8 + index * 0.1 }}
                  className="flex items-center justify-center gap-3 bg-white/10 backdrop-blur-sm rounded-full px-6 py-3"
                >
                  <achievement.icon className={`w-6 h-6 ${achievement.color}`} />
                  <span className="text-white font-medium">{achievement.label}</span>
                </motion.div>
              ))}
            </motion.div>

            {/* Motivational Message */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.1 }}
              className="mb-8"
            >
              <p className="text-white/80 text-lg italic">
                "Every expert was once a beginner. Your fitness journey starts now!"
              </p>
            </motion.div>

            {/* Continue Button */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 1.3, type: 'spring', stiffness: 200 }}
            >
              <Button
                onClick={onComplete}
                size="lg"
                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-8 rounded-full transform transition hover:scale-105 shadow-2xl shadow-purple-500/50"
              >
                <PartyPopper className="w-5 h-5 mr-2" />
                Start Your Journey
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}