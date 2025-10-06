'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, Plus, Hash, Sparkles, Trophy, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

interface EmptyCirclesStateProps {
  onCreateClick: () => void;
  onJoinClick: () => void;
  isLoading?: boolean;
}

export default function EmptyCirclesState({ onCreateClick, onJoinClick, isLoading }: EmptyCirclesStateProps) {
  if (isLoading) {
    return (
      <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl">
        <CardContent className="p-12 text-center">
          <div className="animate-pulse">
            <div className="mb-6 inline-flex">
              <div className="w-24 h-24 rounded-full bg-slate-800 flex items-center justify-center">
                <Users className="w-12 h-12 text-slate-600 animate-pulse" />
              </div>
            </div>
            <div className="h-6 bg-slate-800 rounded w-48 mx-auto mb-3"></div>
            <div className="h-4 bg-slate-800 rounded w-64 mx-auto"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl overflow-hidden">
      {/* Top gradient bar */}
      <div className="h-1 bg-gradient-to-r from-orange-500 via-purple-500 to-cyan-500" />
      
      <CardContent className="p-12">
        {/* Animated icon */}
        <motion.div 
          className="mb-8 inline-flex relative"
          animate={{ 
            scale: [1, 1.05, 1],
            rotate: [0, 5, -5, 0] 
          }}
          transition={{ 
            duration: 4,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/20 to-purple-500/20 rounded-full blur-2xl" />
          <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-orange-900/40 to-purple-900/40 flex items-center justify-center border border-orange-500/30">
            <Trophy className="w-12 h-12 text-orange-400" />
          </div>
          <motion.div
            className="absolute -top-2 -right-2"
            animate={{ scale: [0.8, 1.2, 0.8] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Sparkles className="w-6 h-6 text-yellow-400" />
          </motion.div>
        </motion.div>

        {/* Main content */}
        <div className="text-center max-w-lg mx-auto">
          <h3 className="text-2xl font-semibold bg-gradient-to-r from-orange-300 to-purple-300 bg-clip-text text-transparent mb-3">
            Welcome to FitCircles!
          </h3>
          
          <p className="text-gray-400 mb-2">
            Join fitness challenges with friends and track your progress together.
          </p>
          
          <p className="text-sm text-gray-500 mb-8">
            Create your own circle or join one with an invite code.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2 justify-center mb-8">
            {['🏆 Compete', '📈 Track Progress', '💪 Stay Motivated', '👥 Social'].map((feature) => (
              <span
                key={feature}
                className="px-3 py-1 bg-slate-800/50 rounded-full text-xs text-gray-300 border border-slate-700"
              >
                {feature}
              </span>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                onClick={onCreateClick}
                size="lg"
                className="bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700 shadow-lg hover:shadow-orange-500/50 text-white border-0 group"
              >
                <Plus className="w-5 h-5 mr-2" />
                Create Your First Circle
                <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </motion.div>

            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Button
                onClick={onJoinClick}
                size="lg"
                variant="outline"
                className="border-slate-700 bg-slate-800/50 hover:bg-slate-800 text-white group"
              >
                <Hash className="w-5 h-5 mr-2 text-orange-400" />
                Join with Code
              </Button>
            </motion.div>
          </div>
        </div>

        {/* Bottom hint */}
        <motion.div
          className="mt-10 p-4 bg-gradient-to-br from-indigo-900/20 to-purple-900/20 rounded-lg border border-indigo-500/20"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <p className="text-xs text-gray-400 text-center">
            <span className="text-indigo-400 font-medium">Tip:</span> Invite friends to join your circle for more fun and accountability!
          </p>
        </motion.div>
      </CardContent>
    </Card>
  );
}
