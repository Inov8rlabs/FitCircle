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
  Shield,
  Star,
  Trophy,
  Users,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import GoalSettingForm from '@/components/GoalSettingForm';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { GradientText } from '@/components/ui/gradient-text';
import { AvatarCircle, GlassCard, ToneDisc } from '@/components/ui/ios';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { AnalyticsEvents, analytics, toErrorKind } from '@/lib/analytics';
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
      <div className="mx-auto w-full max-w-2xl px-4 py-10" aria-busy="true" data-testid="join-loading">
        <span className="sr-only">Getting your seat ready…</span>
        <div className="flex flex-col items-center">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-3 h-9 w-60" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
          <Skeleton className="mt-5 h-12 w-56 rounded-full" />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[118px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="mt-4 h-28 rounded-xl" />
        <Skeleton className="mt-6 h-14 rounded-xl" />
      </div>
    );
  }

  if (!circle || !canJoin) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-md items-center px-4">
        <GlassCard className="w-full">
          <EmptyState
            icon={isAlreadyMember ? CheckCircle2 : AlertCircle}
            tone={isAlreadyMember ? 'purple' : 'orange'}
            title={isAlreadyMember ? "You're already in!" : 'Unable to join'}
            description={isAlreadyMember ? "You're already part of this FitCircle." : joinError || 'This invite link is not valid.'}
            action={
              <Button onClick={() => router.push(isAlreadyMember && circle ? `/fitcircles/${circle.id}` : '/fitcircles')}>
                {isAlreadyMember ? 'Go to circle' : 'Browse FitCircles'}
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            }
          />
        </GlassCard>
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
  const typeLabel = circle.type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return (
    <div className="relative mx-auto w-full max-w-2xl px-4 pb-16 pt-6 sm:pt-10">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-glass bg-surface-raised/60 text-white transition hover:bg-surface-raised"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      )}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        {/* iOS circle header: status, gradient name, description, creator */}
        <header className="flex flex-col items-center text-center">
          <span
            className={
              circle.status === 'active'
                ? 'rounded-full bg-brand-green/15 px-3 py-1 text-caption font-semibold text-brand-green'
                : 'rounded-full bg-brand-orange/15 px-3 py-1 text-caption font-semibold text-brand-orange'
            }
          >
            {circle.status === 'active' ? 'Active' : 'Starting Soon'}
          </span>
          <GradientText as="h1" className="mt-3 break-words text-[30px] font-bold leading-tight sm:text-large-title">
            {circle.name}
          </GradientText>
          {circle.description && <p className="mt-1 max-w-lg text-subhead text-fg-secondary">{circle.description}</p>}
          <div className="mt-5 inline-flex items-center gap-3 rounded-full border border-glass bg-surface-raised/50 py-1.5 pl-1.5 pr-4">
            <AvatarCircle name={circle.creator.display_name} src={circle.creator.avatar_url} size={36} />
            <span className="text-left leading-tight">
              <span className="block text-caption text-fg-secondary">Created by</span>
              <span className="block text-subhead font-semibold text-white">{circle.creator.display_name}</span>
            </span>
          </div>
        </header>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <StatTile icon={Icon} tone="orange" label="Challenge" value={<span className="text-headline">{typeLabel}</span>} />
          <StatTile
            icon={Users}
            tone="purple"
            label="Members"
            value={
              <>
                {circle.participant_count}
                {circle.max_participants ? <span className="text-subhead text-fg-secondary">/{circle.max_participants}</span> : null}
              </>
            }
          />
          <StatTile icon={Calendar} tone="indigo" label="Days total" value={durationDays(circle.start_date, circle.end_date)} />
          <StatTile icon={Clock} tone="green" label={circle.status === 'active' ? 'Days left' : 'Days until start'} value={daysLeft} />
        </div>

        <GlassCard className="mt-4 border-brand-green/25 bg-brand-green/[0.06]">
          <div className="flex items-start gap-3">
            <ToneDisc icon={Shield} tone="green" />
            <div className="min-w-0 flex-1">
              <h3 className="text-headline text-white">Your privacy is protected</h3>
              <ul className="mt-2 space-y-1.5 text-subhead text-fg-secondary">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" aria-hidden />
                  <span>Only your progress percentage is shared with the group</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" aria-hidden />
                  <span>Your actual weight, measurements, or metrics stay private</span>
                </li>
              </ul>
            </div>
          </div>
        </GlassCard>

        <Button
          size="xl"
          fullWidth
          className="mt-6"
          data-testid="join-set-goal"
          onClick={() => {
            analytics.track(AnalyticsEvents.fitCircleJoinStarted({ source: 'invite_link' }));
            setShowGoalSetting(true);
          }}
        >
          Set your goal & join
          <ArrowRight className="ml-2 h-5 w-5" />
        </Button>
      </motion.div>
    </div>
  );
}
