'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Plus, Flame, Trophy, PartyPopper } from 'lucide-react';
import React, { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { type CircleChallengeWithDetails, type LogActivityResponse } from '@/lib/types/circle-challenge';

interface LogActivitySheetProps {
  isOpen: boolean;
  onClose: () => void;
  challenge: CircleChallengeWithDetails;
  circleId: string;
  onLogSuccess: (result: LogActivityResponse) => void;
}

export default function LogActivitySheet({
  isOpen,
  onClose,
  challenge,
  circleId,
  onLogSuccess,
}: LogActivitySheetProps) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [isLogging, setIsLogging] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationText, setCelebrationText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const todayTotal = challenge.my_participation?.today_total || 0;
  const cumulativeTotal = challenge.my_participation?.cumulative_total || 0;
  const loggingPrompt = challenge.logging_prompt || `How many ${challenge.unit} did you do?`;

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleLog = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) return;

    setIsLogging(true);
    try {
      const response = await fetch(
        `/api/fitcircles/${circleId}/challenges/${challenge.id}/logs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: value, note: note || undefined }),
        }
      );

      const result = await response.json();

      if (!result.success) {
        if (result.error?.code === 'DUPLICATE_DETECTED') {
          const confirmed = window.confirm('Looks like a duplicate — did you mean to log again?');
          if (!confirmed) {
            setIsLogging(false);
            return;
          }
          // User confirmed, resubmit would need different note, for now just show message
          toast.info('Try adding a note to distinguish this entry');
          setIsLogging(false);
          return;
        }
        throw new Error(result.error?.message || 'Failed to log');
      }

      const logResult: LogActivityResponse = result.data;

      // Show celebration for milestones
      if (logResult.milestone_reached) {
        setCelebrationText(`${logResult.milestone_reached} of your goal!`);
        setShowCelebration(true);
        setTimeout(() => setShowCelebration(false), 3000);
      }

      // Show rank change toast
      if (logResult.rank_changed) {
        if (logResult.new_rank < (logResult.old_rank || 999)) {
          toast.success(`You moved up to #${logResult.new_rank}!`);
        }
      }

      toast.success(`+${value} ${challenge.unit} logged!`);
      onLogSuccess(logResult);
      setAmount('');
      setNote('');
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsLogging(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[400px] bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              {challenge.template?.icon && <span className="text-xl">{challenge.template.icon}</span>}
              Log Activity
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Today's running total */}
            <div className="text-center py-3 rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20">
              <div className="text-3xl font-bold text-white">
                {todayTotal.toLocaleString()}
              </div>
              <div className="text-xs text-slate-400">{challenge.unit} today</div>
              <div className="text-xs text-slate-500 mt-1">
                {cumulativeTotal.toLocaleString()} total
              </div>
            </div>

            {/* Prompt */}
            <p className="text-sm text-slate-400 text-center">{loggingPrompt}</p>

            {/* Amount input */}
            <div className="relative">
              <Input
                ref={inputRef}
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="bg-slate-800 border-slate-700 text-white text-center text-2xl font-bold h-14 pr-16"
                min={0.1}
                max={10000}
                step={challenge.unit === 'miles' || challenge.unit === 'km' ? 0.1 : 1}
                onKeyDown={(e) => e.key === 'Enter' && handleLog()}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                {challenge.unit}
              </span>
            </div>

            {/* Optional note */}
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note (optional)"
              className="bg-slate-800 border-slate-700 text-white text-sm"
              maxLength={80}
            />

            {/* Log button */}
            <Button
              onClick={handleLog}
              disabled={isLogging || !amount || parseFloat(amount) <= 0}
              className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white h-12 text-base font-semibold"
            >
              {isLogging ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Logging...
                </>
              ) : (
                <>
                  <Plus className="w-5 h-5 mr-2" />
                  Log {amount ? parseFloat(amount).toLocaleString() : ''} {challenge.unit}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Milestone Celebration Overlay */}
      <AnimatePresence>
        {showCelebration && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowCelebration(false)}
          >
            <motion.div
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              className="text-center space-y-4"
            >
              <motion.div
                animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
                transition={{ duration: 0.5 }}
              >
                <PartyPopper className="w-16 h-16 text-yellow-400 mx-auto" />
              </motion.div>
              <h2 className="text-3xl font-bold text-white">Milestone!</h2>
              <p className="text-xl text-indigo-300">{celebrationText}</p>
              <p className="text-sm text-slate-400">Keep crushing it!</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
