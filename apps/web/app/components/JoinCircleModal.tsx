'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Users,
  Loader2,
  CheckCircle2,
  ArrowRight,
  Info,
  Trophy,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';

interface JoinCircleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (circle: any) => void;
}

export default function JoinCircleModal({ isOpen, onClose, onSuccess }: JoinCircleModalProps) {
  const { user } = useAuthStore();
  const [inviteCode, setInviteCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [circlePreview, setCirclePreview] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);

  const formatInviteCode = (value: string) => {
    // Auto-format as user types: FIT-XXXXXX or FITXXXXXX (9-10 chars)
    let formatted = value.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Add FIT prefix if not present
    if (!formatted.startsWith('FIT')) {
      if (formatted.length > 0) {
        formatted = 'FIT' + formatted;
      }
    }

    // Add hyphen after FIT if there's more content
    if (formatted.length > 3 && !formatted.includes('-')) {
      formatted = formatted.slice(0, 3) + '-' + formatted.slice(3);
    }

    // Limit to FIT-XXXXXX format (10 chars total)
    formatted = formatted.slice(0, 10);

    return formatted;
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatInviteCode(e.target.value);
    setInviteCode(formatted);

    // Auto-search when code is complete (9 or 10 chars)
    if (formatted.length >= 9) {
      // Remove hyphen for search to support both formats
      const codeToSearch = formatted.replace('-', '');
      searchCircle(codeToSearch);
    } else {
      setCirclePreview(null);
    }
  };

  const searchCircle = async (code: string) => {
    if (code.length < 9) return;

    setIsSearching(true);
    try {
      const { data, error } = (await supabase
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
        .eq('invite_code', code)
        .single()) as { data: any; error: any };

      if (error) {
        if (error.code === 'PGRST116') {
          toast.error('Invalid invite code');
          setCirclePreview(null);
        } else {
          throw error;
        }
        return;
      }

      // Check if already a member
      const { data: existingMember } = await supabase
        .from('challenge_participants')
        .select('id')
        .eq('challenge_id', data.id)
        .eq('user_id', user?.id!)
        .single();

      if (existingMember) {
        toast.error("You're already a member of this FitCircle");
        setCirclePreview(null);
        return;
      }

      setCirclePreview(data);
    } catch (error) {
      console.error('Error searching circle:', error);
      toast.error('Failed to find FitCircle');
      setCirclePreview(null);
    } finally {
      setIsSearching(false);
    }
  };

  const handleJoin = async () => {
    if (!user) {
      toast.error('Please log in to join a FitCircle');
      return;
    }

    if (!circlePreview) {
      toast.error('Please enter a valid invite code');
      return;
    }

    setIsJoining(true);
    try {
      const { error } = await supabase
        .from('challenge_participants')
        .insert({
          challenge_id: circlePreview.id,
          user_id: user.id,
          status: 'active',
        } as any);

      if (error) throw error;

      toast.success(`Successfully joined ${circlePreview.name}!`);

      if (onSuccess) {
        onSuccess(circlePreview);
      }

      onClose();
      setInviteCode('');
      setCirclePreview(null);
    } catch (error: any) {
      console.error('Error joining circle:', error);
      toast.error(error.message || 'Failed to join FitCircle');
    } finally {
      setIsJoining(false);
    }
  };

  const getChallengeTypeLabel = (type: string) => {
    const types: Record<string, string> = {
      weight_loss: 'Weight Loss',
      step_count: 'Daily Steps',
      workout_frequency: 'Workout Frequency',
      custom: 'Custom Goal',
    };
    return types[type] || type;
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto bg-slate-900/95 border-slate-800 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-gradient-to-r from-orange-400 to-purple-400 bg-clip-text text-transparent">
            Join a FitCircle
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Info Banner */}
          <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-lg p-4 border border-indigo-500/20">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-indigo-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-white font-medium">Enter Your Invite Code</p>
                <p className="text-xs text-gray-400 mt-1">
                  Ask your friend for their FitCircle code (format: FIT-XXXXXX)
                </p>
              </div>
            </div>
          </div>

          {/* Invite Code Input */}
          <div className="space-y-2">
            <Label htmlFor="inviteCode" className="text-white">
              Invite Code
            </Label>
            <div className="relative">
              <Input
                id="inviteCode"
                placeholder="FIT-XXXXXX"
                value={inviteCode}
                onChange={handleCodeChange}
                className="bg-slate-800/50 border-slate-700 text-white text-center text-2xl font-mono tracking-widest uppercase h-14"
                maxLength={10}
                autoComplete="off"
              />
              {isSearching && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <Loader2 className="h-5 w-5 text-orange-400 animate-spin" />
                </div>
              )}
            </div>
            <p className="text-xs text-gray-400 text-center">
              Enter the code exactly as shown
            </p>
          </div>

          {/* Circle Preview */}
          {circlePreview && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-br from-orange-500/20 via-purple-500/20 to-cyan-500/20 rounded-xl p-5 border border-orange-500/30 backdrop-blur-xl"
            >
              <div className="flex items-start gap-4">
                <div className="bg-gradient-to-br from-orange-500 to-purple-600 rounded-full p-3">
                  <Trophy className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-white mb-1 truncate">
                    {circlePreview.name}
                  </h3>
                  {circlePreview.description && (
                    <p className="text-sm text-gray-300 mb-3 line-clamp-2">
                      {circlePreview.description}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="bg-slate-800/50 rounded-lg p-2">
                      <p className="text-xs text-gray-400">Type</p>
                      <p className="text-sm text-white font-medium">
                        {getChallengeTypeLabel(circlePreview.type)}
                      </p>
                    </div>
                    <div className="bg-slate-800/50 rounded-lg p-2">
                      <p className="text-xs text-gray-400">Members</p>
                      <p className="text-sm text-white font-medium">
                        {circlePreview.participant_count || 0}
                        {circlePreview.max_participants && ` / ${circlePreview.max_participants}`}
                      </p>
                    </div>
                  </div>

                  <div className="bg-slate-800/50 rounded-lg p-2">
                    <p className="text-xs text-gray-400">Duration</p>
                    <p className="text-sm text-white">
                      {formatDate(circlePreview.start_date)} → {formatDate(circlePreview.end_date)}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Join Button */}
          {circlePreview ? (
            <Button
              onClick={handleJoin}
              disabled={isJoining}
              className="w-full bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 shadow-lg hover:shadow-green-500/50 h-12"
            >
              {isJoining ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Joining...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 mr-2" />
                  Join {circlePreview.name}
                  <ArrowRight className="h-5 w-5 ml-2" />
                </>
              )}
            </Button>
          ) : (
            <div className="text-center py-8">
              <Users className="h-12 w-12 text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-400">
                Enter an invite code to see FitCircle details
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
