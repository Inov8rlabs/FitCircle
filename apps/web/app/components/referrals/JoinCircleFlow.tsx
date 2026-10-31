'use client';

import { motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  Dumbbell,
  Footprints,
  Loader2,
  Shield,
  Star,
  Trophy,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import GoalSettingForm from '@/components/GoalSettingForm';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AnalyticsEvents, analytics, toErrorKind } from '@/lib/analytics';
import { emitAppEvent } from '@/lib/engage/client/runtime';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

type ChallengeType = 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom';

interface CircleDetails {
  id: string;
  name: string;
  description: string;
  type: ChallengeType;
  status: 'upcoming' | 'active' | 'completed';
  start_date: string;
  end_date: string;
  participant_count: number;
  max_participants?: number;
  creator: { display_name: string; avatar_url?: string };
}

interface GoalFormData {
  current_value: number;
  target_value: number;
  unit: string;
  progress_preview?: string;
}

const DAY_MS = 1000 * 60 * 60 * 24;

function challengeIcon(type: string) {
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
}

function challengeColor(type: string) {
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
}

const durationDays = (start: string, end: string) =>
  Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / DAY_MS);

/**
 * Signed-in circle join: circle details → goal → join. Joins through
 * `POST /api/mobile/circles/join` (cookie auth), which also attributes the
 * referral (`ref`) server-side. Replaces the old direct `fitcircle_members`
 * insert, which wrote a non-existent `challenge_id` column.
 */
export function JoinCircleFlow({
  inviteCode,
  refCode,
  onBack,
}: {
  inviteCode: string;
  refCode: string | null;
  onBack?: () => void;
}) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [circle, setCircle] = useState<CircleDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [showGoalSetting, setShowGoalSetting] = useState(false);
  const [isAlreadyMember, setIsAlreadyMember] = useState(false);
  const [canJoin, setCanJoin] = useState(true);
  const [joinError, setJoinError] = useState('');

  const validate = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/fitcircles/validate?code=${encodeURIComponent(inviteCode.toUpperCase())}`);
      if (!response.ok) {
        setJoinError('Invalid or expired invite code');
        setCanJoin(false);
        return;
      }
      const info = await response.json();
      const details: CircleDetails = {
        id: info.id,
        name: info.name,
        description: info.description || '',
        type: info.type,
        status: info.status,
        start_date: info.start_date,
        end_date: info.end_date,
        participant_count: info.participant_count || 0,
        max_participants: info.max_participants,
        creator: {
          display_name: info.creator?.display_name || 'Circle Creator',
          avatar_url: info.creator?.avatar_url,
        },
      };
      setCircle(details);

      if (user) {
        const { data: memberData } = await supabase
          .from('fitcircle_members')
          .select('id, status')
          .eq('fitcircle_id', details.id)
          .eq('user_id', user.id)
          .maybeSingle();
        const member = memberData as { status?: string } | null;
        if (member && member.status !== 'dropped') {
          setIsAlreadyMember(true);
          setCanJoin(false);
          return;
        }
      }

      if (details.status === 'completed') {
        setJoinError('This circle has already ended');
        setCanJoin(false);
      } else if (details.status === 'active') {
        const daysSinceStart = Math.floor((Date.now() - new Date(details.start_date).getTime()) / DAY_MS);
        if (daysSinceStart > 3) {
          setJoinError('This circle is no longer accepting new members');
          setCanJoin(false);
        }
      } else if (details.max_participants && details.participant_count >= details.max_participants) {
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
  }, [inviteCode, user]);

  useEffect(() => {
    void validate();
  }, [validate]);

  const handleGoalSet = async (goalData: GoalFormData) => {
    if (!user || !circle) return;
    setIsJoining(true);
    try {
      const response = await fetch('/api/mobile/circles/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          inviteCode: inviteCode.toUpperCase(),
          ...(refCode ? { ref: refCode } : {}),
          goal: {
            goal_type: circle.type,
            goal_start_value: goalData.current_value,
            goal_target_value: goalData.target_value,
            goal_unit: goalData.unit,
            ...(goalData.progress_preview ? { goal_description: goalData.progress_preview } : {}),
          },
        }),
      });

      if (response.status === 409) {
        toast.success("You're already in this circle 💜");
        router.push(`/fitcircles/${circle.id}`);
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const err = new Error(body?.message || body?.error?.message || 'Failed to join circle') as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      analytics.track(AnalyticsEvents.fitCircleJoined({ source: 'invite_link' }));
      emitAppEvent('circle_joined');
      toast.success('Successfully joined the FitCircle!');
      router.push(`/fitcircles/${circle.id}`);
    } catch (error: any) {
      console.error('Error joining circle:', error);
      analytics.track(
        AnalyticsEvents.fitCircleJoinFailed({ source: 'invite_link', error_kind: toErrorKind(error, error?.status) })
      );
      toast.error(error?.message || 'Failed to join circle');
    } finally {
      setIsJoining(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-purple-400 mx-auto mb-4" />
          <p className="text-gray-400">Getting your seat ready…</p>
        </div>
      </div>
    );
  }

  if (!circle || !canJoin) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <Card className="max-w-md w-full bg-slate-900/50 border-slate-800 backdrop-blur-xl">
          <CardContent className="p-8 text-center">
            <div className="mb-6">
              <div className={`p-4 rounded-full inline-flex mb-4 ${isAlreadyMember ? 'bg-purple-500/10' : 'bg-red-500/10'}`}>
                {isAlreadyMember ? (
                  <CheckCircle2 className="h-12 w-12 text-purple-400" />
                ) : (
                  <AlertCircle className="h-12 w-12 text-red-400" />
                )}
              </div>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">
              {isAlreadyMember ? "You're already in!" : 'Unable to join'}
            </h2>
            <p className="text-gray-400 mb-6">
              {isAlreadyMember ? "You're already part of this FitCircle." : joinError || 'This invite link is not valid.'}
            </p>
            <Button
              onClick={() => router.push(isAlreadyMember && circle ? `/fitcircles/${circle.id}` : '/fitcircles')}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
            >
              {isAlreadyMember ? 'Go to circle' : 'Browse FitCircles'}
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (showGoalSetting) {
    return (
      <GoalSettingForm
        circleName={circle.name}
        challengeType={circle.type}
        duration={durationDays(circle.start_date, circle.end_date)}
        onSubmit={handleGoalSet}
        onBack={() => setShowGoalSetting(false)}
        isSubmitting={isJoining}
      />
    );
  }

  const Icon = challengeIcon(circle.type);
  const daysLeft =
    circle.status === 'active'
      ? Math.max(0, Math.ceil((new Date(circle.end_date).getTime() - Date.now()) / DAY_MS))
      : Math.max(0, Math.ceil((new Date(circle.start_date).getTime() - Date.now()) / DAY_MS));

  return (
    <div className="relative max-w-3xl mx-auto px-4 py-10">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      )}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <Card className="bg-slate-900/50 border-slate-800 backdrop-blur-xl overflow-hidden">
          <div className={`h-2 bg-gradient-to-r ${challengeColor(circle.type)}`} />
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <CardTitle className="text-2xl sm:text-3xl font-bold text-white mb-2 break-words">{circle.name}</CardTitle>
                {circle.description && (
                  <CardDescription className="text-base text-gray-400">{circle.description}</CardDescription>
                )}
              </div>
              <Badge variant={circle.status === 'active' ? 'default' : 'secondary'} className="text-xs shrink-0">
                {circle.status === 'active' ? 'Active' : 'Starting Soon'}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-6 p-3 bg-slate-800/30 rounded-lg">
              <Avatar
                src={circle.creator.avatar_url}
                fallback={circle.creator.display_name}
                size="md"
                className="h-10 w-10"
              />
              <div>
                <p className="text-sm text-gray-400">Created by</p>
                <p className="text-white font-medium">{circle.creator.display_name}</p>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat icon={<Icon className="h-6 w-6 text-orange-400 mx-auto mb-2" />} label="Challenge">
                {circle.type
                  .split('_')
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(' ')}
              </Stat>
              <Stat icon={<Users className="h-6 w-6 text-purple-400 mx-auto mb-2" />} label="Members">
                {circle.participant_count}
                {circle.max_participants ? (
                  <span className="text-sm text-gray-400">/{circle.max_participants}</span>
                ) : null}
              </Stat>
              <Stat icon={<Calendar className="h-6 w-6 text-indigo-400 mx-auto mb-2" />} label="Days total">
                {durationDays(circle.start_date, circle.end_date)}
              </Stat>
              <Stat
                icon={<Clock className="h-6 w-6 text-green-400 mx-auto mb-2" />}
                label={circle.status === 'active' ? 'Days left' : 'Days until start'}
              >
                {daysLeft}
              </Stat>
            </div>

            <div className="bg-gradient-to-br from-green-900/20 to-green-800/10 rounded-lg p-5 border border-green-500/30">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <Shield className="h-6 w-6 text-green-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-green-400 mb-2">Your privacy is protected</h3>
                  <ul className="space-y-1 text-sm text-gray-300">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>Only your progress percentage is shared with the group</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                      <span>Your actual weight, measurements, or metrics stay private</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <Button
              size="lg"
              onClick={() => {
                analytics.track(AnalyticsEvents.fitCircleJoinStarted({ source: 'invite_link' }));
                setShowGoalSetting(true);
              }}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-lg py-6"
            >
              Set your goal & join
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

function Stat({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-800/30 rounded-lg p-4 text-center">
      {icon}
      <p className="text-xl font-bold text-white">{children}</p>
      <p className="text-xs text-gray-400 mt-1">{label}</p>
    </div>
  );
}
