'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import {
  Users,
  Calendar,
  Clock,
  Trophy,
  Lock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
  Shield,
  Target,
  Footprints,
  Dumbbell,
  Star,
  ArrowRight,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';
import GoalSettingForm from '@/components/GoalSettingForm';

interface CircleDetails {
  id: string;
  name: string;
  description: string;
  type: 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom';
  status: 'upcoming' | 'active' | 'completed';
  start_date: string;
  end_date: string;
  participant_count: number;
  max_participants?: number;
  creator: {
    display_name: string;
    avatar_url?: string;
  };
}

export default function JoinCirclePage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const [inviteCode] = useState(params.code as string);
  const [circleDetails, setCircleDetails] = useState<CircleDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [showGoalSetting, setShowGoalSetting] = useState(false);
  const [isAlreadyMember, setIsAlreadyMember] = useState(false);
  const [canJoin, setCanJoin] = useState(true);
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    if (inviteCode) {
      validateInviteCode();
    }
  }, [inviteCode, user]);

  const validateInviteCode = async () => {
    setIsLoading(true);
    try {
      // If user is not logged in, skip validation and show welcome screen
      if (!user) {
        setIsLoading(false);
        return;
      }

      console.log('Validating invite code:', inviteCode);

      // Fetch circle details using invite code (only for authenticated users)
      const { data: circleData, error: circleError } = await supabase
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
          invite_code,
          profiles:creator_id (
            display_name,
            avatar_url
          )
        `)
        .eq('invite_code', inviteCode.toUpperCase())
        .single();

      console.log('Circle query result:', { data: circleData, error: circleError });

      if (circleError || !circleData) {
        setJoinError('Invalid or expired invite code');
        setCanJoin(false);
        setIsLoading(false);
        return;
      }

      const circleInfo = circleData as any;
      const circle: CircleDetails = {
        id: circleInfo.id,
        name: circleInfo.name,
        description: circleInfo.description || '',
        type: circleInfo.type,
        status: circleInfo.status,
        start_date: circleInfo.start_date,
        end_date: circleInfo.end_date,
        participant_count: circleInfo.participant_count || 0,
        max_participants: circleInfo.max_participants,
        creator: {
          display_name: circleInfo.profiles?.display_name || 'Circle Creator',
          avatar_url: circleInfo.profiles?.avatar_url,
        },
      };

      setCircleDetails(circle);

      // Check if user is already a member (if logged in)
      if (user) {
        const { data: memberData } = await supabase
          .from('challenge_participants')
          .select('id')
          .eq('challenge_id', circle.id)
          .eq('user_id', user.id)
          .single();

        if (memberData) {
          setIsAlreadyMember(true);
          setCanJoin(false);
        }
      }

      // Check if circle can accept new members
      if (circle.status === 'completed') {
        setJoinError('This circle has already ended');
        setCanJoin(false);
      } else if (circle.status === 'active') {
        const startDate = new Date(circle.start_date);
        const now = new Date();
        const daysSinceStart = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSinceStart > 3) {
          setJoinError('This circle is no longer accepting new members');
          setCanJoin(false);
        }
      } else if (circle.max_participants && circle.participant_count >= circle.max_participants) {
        setJoinError('This circle is full');
        setCanJoin(false);
      }

    } catch (error) {
      console.error('Error validating invite code:', error);
      setJoinError('Something went wrong. Please try again.');
      setCanJoin(false);
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoinClick = () => {
    if (!user) {
      // Redirect to login/signup with return URL
      router.push(`/login?returnUrl=/join/${inviteCode}`);
    } else {
      setShowGoalSetting(true);
    }
  };

  const handleGoalSet = async (goalData: any) => {
    if (!user || !circleDetails) return;

    setIsJoining(true);
    try {
      // Join the circle with goal data
      const { error: joinError } = await supabase
        .from('fitcircle_members')
        .insert({
          circle_id: circleDetails.id,
          user_id: user.id,
          goal_type: goalData.type,
          goal_config: goalData,
          starting_value: goalData.current_value,
          target_value: goalData.target_value,
          current_value: goalData.current_value,
          progress_percentage: 0,
        } as any);

      if (joinError) throw joinError;

      // Also add to challenge_participants for compatibility
      const { error: participantError } = await supabase
        .from('challenge_participants')
        .insert({
          challenge_id: circleDetails.id,
          user_id: user.id,
          status: 'active',
          starting_value: goalData.current_value,
          goal_value: goalData.target_value,
          current_value: goalData.current_value,
        } as any);

      if (participantError) throw participantError;

      toast.success('Successfully joined the FitCircle!');
      router.push(`/fitcircles/${circleDetails.id}`);
    } catch (error: any) {
      console.error('Error joining circle:', error);
      toast.error(error.message || 'Failed to join circle');
    } finally {
      setIsJoining(false);
    }
  };

  const calculateDaysRemaining = (endDate: string) => {
    const end = new Date(endDate);
    const now = new Date();
    const diff = end.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const calculateDuration = (startDate: string, endDate: string) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diff = end.getTime() - start.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const getChallengeIcon = (type: string) => {
    switch (type) {
      case 'weight_loss':
        return Trophy;
      case 'step_count':
        return Footprints;
      case 'workout_frequency':
        return Dumbbell;
      default:
        return Star;
    }
  };

  const getChallengeColor = (type: string) => {
    switch (type) {
      case 'weight_loss':
        return 'from-purple-500 to-purple-600';
      case 'step_count':
        return 'from-indigo-500 to-indigo-600';
      case 'workout_frequency':
        return 'from-orange-500 to-orange-600';
      default:
        return 'from-green-500 to-green-600';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-orange-400 mx-auto mb-4" />
          <p className="text-gray-400">Validating invite code...</p>
        </div>
      </div>
    );
  }

  // Show welcome screen for unauthenticated users
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        {/* Background decoration */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-20 w-[500px] h-[500px] bg-orange-500/5 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-2xl mx-auto px-4 py-16 flex items-center min-h-screen">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="w-full"
          >
            <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl overflow-hidden">
              <div className="h-2 bg-gradient-to-r from-orange-500 to-purple-600" />

              <CardContent className="p-8 sm:p-12 text-center">
                {/* Icon */}
                <div className="mb-6">
                  <div className="p-4 bg-gradient-to-br from-orange-500/20 to-purple-600/20 rounded-full inline-flex mb-4">
                    <Users className="h-16 w-16 text-orange-400" />
                  </div>
                </div>

                {/* Heading */}
                <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">
                  You've Been Invited!
                </h1>

                <p className="text-lg text-gray-300 mb-8">
                  A friend has invited you to join their FitCircle challenge.
                  Sign up or log in to see the details and join the fun!
                </p>

                {/* Benefits */}
                <div className="bg-slate-800/30 rounded-lg p-6 mb-8 text-left">
                  <h3 className="text-lg font-semibold text-white mb-4 text-center">
                    What is FitCircle?
                  </h3>
                  <ul className="space-y-3 text-gray-300">
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>Compete with friends in weight loss and fitness challenges</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>Track your progress while keeping your data private</span>
                    </li>
                    <li className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>Stay motivated with friendly competition and accountability</span>
                    </li>
                  </ul>
                </div>

                {/* CTA Buttons */}
                <div className="space-y-4">
                  <Button
                    size="lg"
                    onClick={() => router.push(`/register?returnUrl=/join/${inviteCode}`)}
                    className="w-full bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700 text-lg py-6"
                  >
                    Sign Up to Join
                    <ArrowRight className="h-5 w-5 ml-2" />
                  </Button>

                  <div className="text-center text-sm text-gray-400">
                    Already have an account?{' '}
                    <Button
                      variant="link"
                      className="text-orange-400 hover:text-orange-300 p-0"
                      onClick={() => router.push(`/login?returnUrl=/join/${inviteCode}`)}
                    >
                      Log in
                    </Button>
                  </div>
                </div>

                {/* Invite code display */}
                <div className="mt-8 pt-6 border-t border-slate-700">
                  <p className="text-xs text-gray-500">
                    Invite code: <span className="font-mono text-gray-400">{inviteCode.toUpperCase()}</span>
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    );
  }

  if (!circleDetails || !canJoin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
        <Card className="max-w-md w-full bg-slate-900/50 border-slate-800 backdrop-blur-xl">
          <CardContent className="p-8 text-center">
            <div className="mb-6">
              <div className="p-4 bg-red-500/10 rounded-full inline-flex mb-4">
                <AlertCircle className="h-12 w-12 text-red-400" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              {isAlreadyMember ? "You're Already a Member!" : "Unable to Join"}
            </h2>
            <p className="text-gray-400 mb-6">
              {isAlreadyMember
                ? "You're already part of this FitCircle."
                : joinError || "This invite link is not valid."}
            </p>
            <Button
              onClick={() => router.push(isAlreadyMember ? `/fitcircles/${circleDetails?.id}` : '/fitcircles')}
              className="bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700"
            >
              {isAlreadyMember ? 'Go to Circle' : 'Browse FitCircles'}
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (showGoalSetting && user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <GoalSettingForm
          circleName={circleDetails.name}
          challengeType={circleDetails.type}
          duration={calculateDuration(circleDetails.start_date, circleDetails.end_date)}
          onSubmit={handleGoalSet}
          onBack={() => setShowGoalSetting(false)}
          isSubmitting={isJoining}
        />
      </div>
    );
  }

  const ChallengeIcon = getChallengeIcon(circleDetails.type);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-96 h-96 bg-orange-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-[500px] h-[500px] bg-purple-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-4xl mx-auto px-4 py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Circle Preview Card */}
          <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl overflow-hidden">
            <div className={`h-2 bg-gradient-to-r ${getChallengeColor(circleDetails.type)}`} />

            <CardHeader className="pb-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-3xl font-bold text-white mb-2">
                    {circleDetails.name}
                  </CardTitle>
                  {circleDetails.description && (
                    <CardDescription className="text-base text-gray-400">
                      {circleDetails.description}
                    </CardDescription>
                  )}
                </div>
                <Badge
                  variant={circleDetails.status === 'active' ? 'default' : 'secondary'}
                  className="text-xs"
                >
                  {circleDetails.status === 'active' ? 'Active' : 'Starting Soon'}
                </Badge>
              </div>

              {/* Creator Info */}
              <div className="flex items-center gap-3 mt-6 p-3 bg-slate-800/30 rounded-lg">
                <Avatar 
                  src={circleDetails.creator.avatar_url}
                  fallback={circleDetails.creator.display_name}
                  size="md"
                  className="h-10 w-10"
                />
                <div>
                  <p className="text-sm text-gray-400">Created by</p>
                  <p className="text-white font-medium">{circleDetails.creator.display_name}</p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* Challenge Details */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-slate-800/30 rounded-lg p-4 text-center">
                  <ChallengeIcon className="h-6 w-6 text-orange-400 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-white">
                    {circleDetails.type.replace('_', ' ').split(' ').map(w =>
                      w.charAt(0).toUpperCase() + w.slice(1)
                    ).join(' ')}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Challenge Type</p>
                </div>

                <div className="bg-slate-800/30 rounded-lg p-4 text-center">
                  <Users className="h-6 w-6 text-purple-400 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-white">
                    {circleDetails.participant_count}
                    {circleDetails.max_participants && (
                      <span className="text-sm text-gray-400">/{circleDetails.max_participants}</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Members</p>
                </div>

                <div className="bg-slate-800/30 rounded-lg p-4 text-center">
                  <Calendar className="h-6 w-6 text-indigo-400 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-white">
                    {calculateDuration(circleDetails.start_date, circleDetails.end_date)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Days Total</p>
                </div>

                <div className="bg-slate-800/30 rounded-lg p-4 text-center">
                  <Clock className="h-6 w-6 text-green-400 mx-auto mb-2" />
                  <p className="text-2xl font-bold text-white">
                    {circleDetails.status === 'active'
                      ? calculateDaysRemaining(circleDetails.end_date)
                      : Math.max(0, Math.ceil((new Date(circleDetails.start_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)))
                    }
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {circleDetails.status === 'active' ? 'Days Left' : 'Days Until Start'}
                  </p>
                </div>
              </div>

              {/* Privacy Promise */}
              <div className="bg-gradient-to-br from-green-900/20 to-green-800/10 rounded-lg p-6 border border-green-500/30">
                <div className="flex items-start gap-4">
                  <div className="p-2 bg-green-500/20 rounded-lg">
                    <Shield className="h-6 w-6 text-green-400" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-green-400 mb-2">
                      Your Privacy is Protected
                    </h3>
                    <ul className="space-y-1 text-sm text-gray-300">
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                        <span>Only your progress percentage is shared with the group</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                        <span>Your actual weight, measurements, or metrics stay completely private</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                        <span>Compete based on effort and consistency, not numbers</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Join Button */}
              <div className="pt-4">
                <Button
                  size="lg"
                  onClick={handleJoinClick}
                  className="w-full bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700 text-lg py-6"
                >
                  {user ? 'Set Your Goal & Join' : 'Sign Up to Join'}
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
                {!user && (
                  <p className="text-center text-sm text-gray-400 mt-3">
                    Already have an account?{' '}
                    <Button
                      variant="link"
                      className="text-orange-400 hover:text-orange-300 p-0"
                      onClick={() => router.push(`/login?returnUrl=/join/${inviteCode}`)}
                    >
                      Log in
                    </Button>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Additional Info */}
          <div className="mt-8 text-center">
            <p className="text-sm text-gray-500">
              Invite code: <span className="font-mono text-gray-400">{inviteCode.toUpperCase()}</span>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}