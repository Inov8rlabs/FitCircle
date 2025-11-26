'use client';

import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Flame, Check, Loader2 } from 'lucide-react';

interface AutoSyncSubmissionCardProps {
  steps: number;
  onSubmit: () => void;
  isSubmitting?: boolean;
}

/**
 * Card shown when HealthKit/auto-synced steps are detected but the user
 * hasn't confirmed them for streak credit. User must tap "Log Steps" to
 * confirm the auto-synced data counts towards their streak.
 */
export function AutoSyncSubmissionCard({ steps, onSubmit, isSubmitting = false }: AutoSyncSubmissionCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="bg-gradient-to-r from-orange-500/10 to-amber-500/10 border-orange-500/30 backdrop-blur-xl shadow-lg shadow-orange-500/10">
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Icon and text */}
            <div className="flex items-start sm:items-center gap-3 flex-1">
              <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                <Flame className="w-5 h-5 text-orange-400" />
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-base sm:text-lg font-semibold text-white">
                  Submit today's steps
                </h3>
                <p className="text-xs sm:text-sm text-gray-400 mt-0.5">
                  Auto-synced steps need a quick confirmation to keep your streak alive.
                </p>
              </div>
            </div>

            {/* Steps count and CTA */}
            <div className="flex items-center gap-4 sm:gap-6">
              <div className="text-left sm:text-right">
                <p className="text-2xl sm:text-3xl font-bold text-white">
                  {steps.toLocaleString()}
                </p>
                <p className="text-xs text-gray-500">
                  steps from Health
                </p>
              </div>

              <Button
                onClick={onSubmit}
                disabled={isSubmitting}
                className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-4 sm:px-6 py-2 h-auto whitespace-nowrap shadow-lg hover:shadow-xl transition-all duration-200"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Log Steps
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}


