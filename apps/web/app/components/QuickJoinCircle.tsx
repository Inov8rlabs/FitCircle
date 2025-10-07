'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Sparkles,
  UserPlus,
  ArrowRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trophy,
  Users,
  Zap,
  Hash,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

interface QuickJoinCircleProps {
  isOpen: boolean;
  onClose: () => void;
  initialCode?: string;
}

export default function QuickJoinCircle({ isOpen, onClose, initialCode = '' }: QuickJoinCircleProps) {
  const router = useRouter();
  const { user } = useAuthStore();
  const [inviteCode, setInviteCode] = useState(initialCode);
  const [isJoining, setIsJoining] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [circlePreview, setCirclePreview] = useState<any>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'enter' | 'preview' | 'success'>('enter');

  const formatCode = (value: string) => {
    // Auto-format the code as user types
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    // If it starts with FIT and doesn't have a dash, add it
    if (cleaned.startsWith('FIT') && cleaned.length > 3 && !value.includes('-')) {
      return `FIT-${cleaned.slice(3)}`;
    }
    
    return cleaned;
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCode(e.target.value);
    setInviteCode(formatted);
    setError('');
    
    // Auto-validate when code looks complete
    if (formatted.length >= 9) {
      validateCode(formatted);
    }
  };

  const validateCode = async (code?: string) => {
    const codeToValidate = code || inviteCode;
    
    if (codeToValidate.length < 9) {
      setError('Please enter a valid invite code');
      return;
    }

    setIsValidating(true);
    setError('');

    try {
      // Check if the challenge exists
      const { data: challenge, error: challengeError } = await supabase
        .from('challenges')
        .select(`
          id,
          name,
          description,
          type,
          status,
          start_date,
          end_date,
          participant_count,
          max_participants,
          creator_id,
          profiles:creator_id (
            display_name,
            avatar_url
          )
        `)
        .eq('invite_code', codeToValidate)
        .single();

      if (challengeError || !challenge) {
        setError('Invalid invite code. Please check and try again.');
        setIsValidating(false);
        return;
      }

      // Check if user is already a member
      if (user) {
        const { data: membership } = (await supabase
          .from('challenge_participants')
          .select('id')
          .eq('challenge_id', (challenge as any).id)
          .eq('user_id', user.id)
          .single()) as { data: any; error: any };

        if (membership) {
          setError('You\'re already a member of this FitCircle!');
          setIsValidating(false);
          return;
        }
      }

      // Set preview data
      setCirclePreview(challenge);
      setStep('preview');
    } catch (err) {
      console.error('Error validating code:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleJoin = async () => {
    if (!user) {
      // Save the code and redirect to login
      localStorage.setItem('pendingJoinCode', inviteCode);
      router.push(`/login?returnUrl=/join/${inviteCode}`);
      return;
    }

    if (!circlePreview) return;

    setIsJoining(true);
    try {
      // Direct approach to join the circle
      const joinResult = (await (supabase
        .from('challenge_participants') as any)
        .insert({
          challenge_id: circlePreview.id,
          user_id: user.id,
          status: 'active',
          joined_at: new Date().toISOString(),
        }));

      const joinError = joinResult.error;

      if (joinError) {
        // Check for specific error types
        if (joinError.code === '23505' || joinError.message?.includes('duplicate')) {
          throw new Error('You are already a member of this FitCircle');
        }
        throw new Error(joinError.message || 'Failed to join FitCircle');
      }

      // Success animation
      setStep('success');
      toast.success('Welcome to the FitCircle!');
      
      // Redirect after animation
      setTimeout(() => {
        router.push(`/fitcircles/${circlePreview.id}`);
        onClose();
      }, 2000);
    } catch (error: any) {
      console.error('Error joining circle:', error);
      const errorMessage = error.message || 'Failed to join FitCircle';
      
      // Provide helpful error messages
      if (errorMessage.includes('already a member')) {
        toast.info('You are already a member of this FitCircle');
      } else if (errorMessage.includes('full')) {
        toast.error('This FitCircle is full');
      } else {
        toast.error(errorMessage);
      }
      
      setError(errorMessage);
    } finally {
      setIsJoining(false);
    }
  };

  const resetForm = () => {
    setStep('enter');
    setInviteCode('');
    setCirclePreview(null);
    setError('');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto bg-slate-900/95 border-slate-800 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-gradient-to-r from-orange-400 to-purple-400 bg-clip-text text-transparent">
            Join a FitCircle
          </DialogTitle>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === 'enter' && (
            <motion.div
              key="enter"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {/* Fun header */}
              <div className="text-center space-y-2">
                <div className="inline-flex items-center justify-center p-3 bg-gradient-to-br from-orange-500/20 to-purple-500/20 rounded-full mb-2">
                  <Hash className="h-8 w-8 text-orange-400" />
                </div>
                <p className="text-gray-300">
                  Enter your invite code to join your friends
                </p>
              </div>

              {/* Code input with live formatting */}
              <div className="space-y-2">
                <div className="relative">
                  <Input
                    value={inviteCode}
                    onChange={handleCodeChange}
                    placeholder="FIT-XXXXXX"
                    className={`
                      text-center text-2xl font-mono tracking-wider h-16
                      bg-slate-800/50 border-2 text-white placeholder:text-gray-500
                      focus:border-orange-500 transition-all
                      ${error ? 'border-red-500' : 'border-slate-700'}
                    `}
                    maxLength={10}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && inviteCode.length >= 9) {
                        validateCode();
                      }
                    }}
                  />
                  {isValidating && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <Loader2 className="h-5 w-5 animate-spin text-orange-400" />
                    </div>
                  )}
                </div>
                
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-2 text-red-400 text-sm"
                  >
                    <AlertCircle className="h-4 w-4" />
                    <span>{error}</span>
                  </motion.div>
                )}

                <p className="text-xs text-gray-400 text-center">
                  Ask your friend for their FitCircle invite code
                </p>
              </div>

              {/* Quick tips */}
              <div className="bg-gradient-to-br from-indigo-900/20 to-purple-900/20 rounded-lg p-4 border border-indigo-500/30">
                <div className="flex items-start gap-3">
                  <Sparkles className="h-5 w-5 text-indigo-400 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-indigo-300">Pro Tip</p>
                    <p className="text-xs text-gray-400">
                      Codes usually look like <span className="font-mono text-indigo-300">FIT-ABC123</span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 justify-end">
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="border-slate-700 hover:bg-slate-800"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => validateCode()}
                  disabled={inviteCode.length < 9 || isValidating}
                  className="bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700"
                >
                  {isValidating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Checking...
                    </>
                  ) : (
                    <>
                      Continue
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {step === 'preview' && circlePreview && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {/* Circle preview card */}
              <Card className="bg-slate-800/30 border-slate-700 p-4">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-gradient-to-br from-orange-500/20 to-purple-500/20 rounded-xl">
                    <Trophy className="h-8 w-8 text-orange-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-white mb-1">
                      {circlePreview.name}
                    </h3>
                    {circlePreview.description && (
                      <p className="text-sm text-gray-400 mb-2">
                        {circlePreview.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1 text-gray-300">
                        <Users className="h-3 w-3" />
                        <span>{circlePreview.participant_count || 0} members</span>
                      </div>
                      <div className="flex items-center gap-1 text-gray-300">
                        <Zap className="h-3 w-3" />
                        <span>{circlePreview.status === 'active' ? 'Active' : 'Starting Soon'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Join confirmation */}
              <div className="text-center space-y-2">
                <CheckCircle2 className="h-12 w-12 text-green-400 mx-auto" />
                <p className="text-white font-medium">Ready to join?</p>
                <p className="text-sm text-gray-400">
                  {user 
                    ? "Click 'Join Now' to become a member"
                    : "You'll need to sign in first"}
                </p>
              </div>

              <div className="flex gap-3 justify-between">
                <Button
                  variant="outline"
                  onClick={resetForm}
                  className="border-slate-700 hover:bg-slate-800"
                >
                  Back
                </Button>
                <Button
                  onClick={handleJoin}
                  disabled={isJoining}
                  className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
                >
                  {isJoining ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Joining...
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4 mr-2" />
                      {user ? 'Join Now' : 'Sign In to Join'}
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {step === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-8 space-y-4"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", duration: 0.5 }}
              >
                <div className="inline-flex items-center justify-center p-4 bg-gradient-to-br from-green-500/20 to-green-600/20 rounded-full mb-4">
                  <CheckCircle2 className="h-16 w-16 text-green-400" />
                </div>
              </motion.div>
              
              <div>
                <h3 className="text-2xl font-bold text-white mb-2">Welcome!</h3>
                <p className="text-gray-400">You've successfully joined the FitCircle</p>
              </div>
              
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <p className="text-sm text-gray-500">Redirecting to your circle...</p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}