'use client';

/**
 * Fitness assessment sub-flow — web port of iOS `OnboardingAssessmentView`
 * and Android `OnboardingAssessmentScreen`. Three internal phases:
 *
 *  1. Questions (5 single/multi-select)
 *  2. Circle recommendations
 *  3. Completion celebration → main app
 */

import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Check, ChevronRight, Loader2, PartyPopper, Sparkles, Users, Bolt, Trophy, Flame,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import Celebration from '@/components/Celebration';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  type AssessmentResponses,
  type CircleRecommendation,
  type FitnessLevel,
  onboardingClient,
} from '@/lib/api/onboarding-client';
import { useAuthStore } from '@/stores/auth-store';

// ─── Questions (must match backend zod schema) ──────────────────────────────

interface Question {
  key: keyof AssessmentResponses;
  text: string;
  type: 'single' | 'multi';
  options: { value: string; label: string; emoji: string }[];
}

const QUESTIONS: Question[] = [
  {
    key: 'exercise_frequency',
    text: 'How often do you exercise?',
    type: 'single',
    options: [
      { value: 'never',     label: 'Rarely or never',   emoji: '🛋️' },
      { value: '1-2x_week', label: '1–2 times a week',  emoji: '🚶' },
      { value: '3-4x_week', label: '3–4 times a week',  emoji: '🏃' },
      { value: 'daily',     label: 'Almost every day',  emoji: '💪' },
    ],
  },
  {
    key: 'primary_goal',
    text: 'What is your main goal?',
    type: 'single',
    options: [
      { value: 'lose_weight',     label: 'Lose weight',         emoji: '⚖️' },
      { value: 'gain_muscle',     label: 'Gain muscle',         emoji: '💪' },
      { value: 'improve_cardio',  label: 'Improve cardio',      emoji: '❤️‍🔥' },
      { value: 'maintain_health', label: 'Stay healthy',        emoji: '🌱' },
      { value: 'stress_relief',   label: 'Reduce stress',       emoji: '🧘' },
    ],
  },
  {
    key: 'preferred_workouts',
    text: 'Which workouts do you enjoy?',
    type: 'multi',
    options: [
      { value: 'cardio',         label: 'Cardio',          emoji: '🏃' },
      { value: 'strength',       label: 'Strength',        emoji: '🏋️' },
      { value: 'yoga',           label: 'Yoga & stretching', emoji: '🧘' },
      { value: 'sports',         label: 'Sports',          emoji: '⚽' },
      { value: 'dancing',        label: 'Dancing',         emoji: '💃' },
      { value: 'outdoor',        label: 'Outdoor',         emoji: '🥾' },
      { value: 'home_workouts',  label: 'Home workouts',   emoji: '🏠' },
    ],
  },
  {
    key: 'daily_time',
    text: 'How much time can you dedicate daily?',
    type: 'single',
    options: [
      { value: '15min',  label: '15 minutes',  emoji: '⚡' },
      { value: '30min',  label: '30 minutes',  emoji: '⏱️' },
      { value: '45min',  label: '45 minutes',  emoji: '⏰' },
      { value: '60min',  label: '60 minutes',  emoji: '🕐' },
      { value: '90min+', label: '90+ minutes', emoji: '🔥' },
    ],
  },
  {
    key: 'fitness_self_assessment',
    text: 'How would you rate your fitness level?',
    type: 'single',
    options: [
      { value: 'complete_beginner', label: 'Beginner',     emoji: '🌱' },
      { value: 'some_experience',   label: 'Intermediate', emoji: '🌿' },
      { value: 'regular_exerciser', label: 'Advanced',     emoji: '🌳' },
      { value: 'very_fit',          label: 'Expert',       emoji: '⭐' },
    ],
  },
];

// ─── Phases ─────────────────────────────────────────────────────────────────

type Phase = 'questions' | 'submitting' | 'recommendations' | 'completion';

// ─── Page ───────────────────────────────────────────────────────────────────

export default function OnboardingAssessmentPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const [phase, setPhase] = useState<Phase>('questions');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [responses, setResponses] = useState<Partial<Record<keyof AssessmentResponses, string | string[]>>>({});
  const [fitnessLevel, setFitnessLevel] = useState<FitnessLevel | null>(null);
  const [recommendations, setRecommendations] = useState<CircleRecommendation[]>([]);
  const [joiningIds, setJoiningIds] = useState<Set<string>>(new Set());
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  const question = QUESTIONS[currentIndex];
  const isMulti = question?.type === 'multi';
  const currentValue = responses[question?.key];
  const hasAnswered = isMulti
    ? Array.isArray(currentValue) && currentValue.length > 0
    : !!currentValue;
  const isLastQuestion = currentIndex === QUESTIONS.length - 1;
  const progress = ((currentIndex + 1) / QUESTIONS.length) * 100;

  const accent = useMemo(() => ACCENT_BY_INDEX[currentIndex] ?? 'from-purple-500 to-indigo-500', [currentIndex]);

  const selectSingle = (value: string) => {
    setResponses(r => ({ ...r, [question.key]: value }));
    // Auto-advance for single-choice after a short beat
    if (!isLastQuestion) {
      setTimeout(() => setCurrentIndex(i => i + 1), 350);
    }
  };

  const toggleMulti = (value: string) => {
    setResponses(r => {
      const current = Array.isArray(r[question.key]) ? (r[question.key] as string[]) : [];
      const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
      return { ...r, [question.key]: next };
    });
  };

  const advance = () => {
    if (!hasAnswered) return;
    if (isLastQuestion) {
      void submitAll();
    } else {
      setCurrentIndex(i => i + 1);
    }
  };

  const submitAll = useCallback(async () => {
    setPhase('submitting');
    try {
      const body = responses as AssessmentResponses;
      const result = await onboardingClient.submitAssessment(body);
      setFitnessLevel(result.data.fitnessLevel);
      // Now load recommendations
      setPhase('recommendations');
      setIsLoadingRecs(true);
      try {
        const recs = await onboardingClient.getRecommendations();
        setRecommendations(recs.data.recommendations);
      } catch (e) {
        console.warn('Recommendations load failed', e);
      } finally {
        setIsLoadingRecs(false);
      }
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not submit assessment');
      setPhase('questions');
    }
  }, [responses]);

  const joinCircle = async (circleId: string) => {
    setJoiningIds(s => new Set(s).add(circleId));
    try {
      await onboardingClient.joinRecommendedCircle(circleId);
      setJoinedIds(s => new Set(s).add(circleId));
      toast.success('Joined circle!');
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not join');
    } finally {
      setJoiningIds(s => {
        const n = new Set(s);
        n.delete(circleId);
        return n;
      });
    }
  };

  const goToCompletion = () => setPhase('completion');

  const finish = async () => {
    setIsCompleting(true);
    try {
      await onboardingClient.complete();
      router.push('/dashboard');
    } catch (e: any) {
      // Complete anyway — don't block
      router.push('/dashboard');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Sign in to start your assessment.</p>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-gradient-to-br ${BG_GRADIENT_BY_INDEX[currentIndex] ?? 'from-background to-background'} transition-colors duration-500`}>
      <div className="mx-auto max-w-2xl px-4 py-6 min-h-screen flex flex-col">
        <AnimatePresence mode="wait">
          {phase === 'questions' && (
            <QuestionsPhase
              key="questions"
              question={question}
              currentIndex={currentIndex}
              total={QUESTIONS.length}
              progress={progress}
              accent={accent}
              currentValue={currentValue}
              isMulti={isMulti}
              hasAnswered={hasAnswered}
              isLastQuestion={isLastQuestion}
              onSelectSingle={selectSingle}
              onToggleMulti={toggleMulti}
              onAdvance={advance}
              onBack={() => setCurrentIndex(i => Math.max(0, i - 1))}
            />
          )}

          {phase === 'submitting' && (
            <motion.div
              key="submitting"
              className="flex-1 flex items-center justify-center"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            >
              <div className="text-center space-y-4">
                <Loader2 className="h-10 w-10 mx-auto animate-spin text-purple-500" />
                <p className="text-muted-foreground">Building your personalized plan...</p>
              </div>
            </motion.div>
          )}

          {phase === 'recommendations' && (
            <RecommendationsPhase
              key="recommendations"
              isLoading={isLoadingRecs}
              recommendations={recommendations}
              joinedIds={joinedIds}
              joiningIds={joiningIds}
              onJoin={joinCircle}
              onContinue={goToCompletion}
              onSkip={goToCompletion}
            />
          )}

          {phase === 'completion' && (
            <CompletionPhase
              key="completion"
              fitnessLevel={fitnessLevel ?? 'beginner'}
              isCompleting={isCompleting}
              onFinish={finish}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Phase: Questions ───────────────────────────────────────────────────────

function QuestionsPhase({
  question, currentIndex, total, progress, accent, currentValue, isMulti,
  hasAnswered, isLastQuestion, onSelectSingle, onToggleMulti, onAdvance, onBack,
}: {
  question: Question;
  currentIndex: number;
  total: number;
  progress: number;
  accent: string;
  currentValue: string | string[] | undefined;
  isMulti: boolean;
  hasAnswered: boolean;
  isLastQuestion: boolean;
  onSelectSingle: (v: string) => void;
  onToggleMulti: (v: string) => void;
  onAdvance: () => void;
  onBack: () => void;
}) {
  const selectedValues = Array.isArray(currentValue) ? currentValue : currentValue ? [currentValue] : [];
  const selectedCount = isMulti ? selectedValues.length : 0;

  return (
    <motion.div
      className="flex-1 flex flex-col"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
    >
      {/* Progress */}
      <div className="space-y-2 mb-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Step {currentIndex + 1} of {total}</span>
          {currentIndex > 0 && (
            <button onClick={onBack} className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft className="h-3 w-3" /> Back
            </button>
          )}
        </div>
        <Progress value={progress} className={`h-1.5 bg-zinc-800 [&>div]:bg-gradient-to-r [&>div]:${accent}`} />
      </div>

      <h1 className="text-3xl font-bold text-center mb-2">{question.text}</h1>
      {isMulti && <p className="text-center text-sm text-muted-foreground mb-6">Select all that apply</p>}
      {!isMulti && <div className="mb-6" />}

      <div className="space-y-2 mb-8 flex-1">
        {question.options.map((option) => {
          const isSelected = selectedValues.includes(option.value);
          return (
            <motion.button
              key={option.value}
              type="button"
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => isMulti ? onToggleMulti(option.value) : onSelectSingle(option.value)}
              className={`w-full flex items-center gap-4 rounded-2xl border p-4 text-left transition-all
                ${isSelected
                  ? 'border-purple-500 bg-purple-500/10'
                  : 'border-border bg-card hover:border-zinc-700'}`}
            >
              <div className="text-3xl">{option.emoji}</div>
              <p className="flex-1 font-semibold">{option.label}</p>
              {isSelected && (
                <div className="h-6 w-6 rounded-full bg-purple-500 flex items-center justify-center">
                  <Check className="h-4 w-4 text-white" />
                </div>
              )}
            </motion.button>
          );
        })}
      </div>

      {(isMulti || isLastQuestion) && (
        <Button
          onClick={onAdvance}
          disabled={!hasAnswered}
          className="w-full bg-gradient-to-r from-purple-500 to-indigo-500 hover:opacity-90"
          size="lg"
        >
          {isLastQuestion
            ? `Submit${selectedCount ? ` (${selectedCount} selected)` : ''}`
            : selectedCount > 0 ? `Continue (${selectedCount} selected)` : 'Continue'}
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      )}
    </motion.div>
  );
}

// ─── Phase: Recommendations ─────────────────────────────────────────────────

function RecommendationsPhase({
  isLoading, recommendations, joinedIds, joiningIds, onJoin, onContinue, onSkip,
}: {
  isLoading: boolean;
  recommendations: CircleRecommendation[];
  joinedIds: Set<string>;
  joiningIds: Set<string>;
  onJoin: (id: string) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <motion.div
      className="flex-1 flex flex-col"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
    >
      <div className="text-center mb-6">
        <Users className="h-12 w-12 mx-auto text-purple-500 mb-3" />
        <h1 className="text-3xl font-bold">Circles for You</h1>
        <p className="text-muted-foreground mt-2">
          Based on your assessment, we think you'll love these.
        </p>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-purple-500" />
            <p className="text-sm text-muted-foreground">Finding your perfect circles...</p>
          </div>
        </div>
      ) : recommendations.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No recommendations yet — you can browse circles later.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3 mb-8 flex-1">
          {recommendations.map((rec) => {
            const joined = joinedIds.has(rec.id);
            const joining = joiningIds.has(rec.id);
            return (
              <Card key={rec.id} className={joined ? 'border-emerald-500/40' : ''}>
                <CardContent className="p-4 space-y-3">
                  <div>
                    <p className="font-semibold">{rec.name}</p>
                    {rec.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{rec.description}</p>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground inline-flex items-center gap-1">
                      <Users className="h-3 w-3" /> {rec.memberCount} members
                    </span>
                    <span className="inline-flex items-center gap-1 text-yellow-400">
                      <Sparkles className="h-3 w-3" /> {rec.matchReason}
                    </span>
                  </div>
                  {joined ? (
                    <div className="flex items-center justify-center gap-1 text-emerald-400 text-sm font-semibold bg-emerald-500/10 py-2 rounded-md">
                      <Check className="h-4 w-4" /> Joined
                    </div>
                  ) : (
                    <Button
                      onClick={() => onJoin(rec.id)}
                      disabled={joining}
                      className="w-full bg-purple-500 hover:bg-purple-600"
                      size="sm"
                    >
                      {joining ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Join Circle'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        <Button
          onClick={onContinue}
          className="w-full bg-gradient-to-r from-purple-500 to-indigo-500"
          size="lg"
        >
          {joinedIds.size === 0 ? 'Complete Setup' : `Continue (${joinedIds.size} joined)`}
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
        <button
          type="button"
          onClick={onSkip}
          className="w-full text-sm text-muted-foreground hover:text-foreground py-2"
        >
          Skip & browse all circles later
        </button>
      </div>
    </motion.div>
  );
}

// ─── Phase: Completion ──────────────────────────────────────────────────────

function CompletionPhase({
  fitnessLevel, isCompleting, onFinish,
}: { fitnessLevel: FitnessLevel; isCompleting: boolean; onFinish: () => void }) {
  return (
    <motion.div
      className="flex-1 flex flex-col"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <Celebration onComplete={() => {/* persists during phase */}} userName="Champion" />

      <div className="flex-1 flex flex-col items-center justify-center text-center space-y-6 py-8">
        <PartyPopper className="h-16 w-16 text-purple-500" />
        <h1 className="text-4xl font-bold">You're All Set!</h1>
        <p className="text-muted-foreground max-w-xs">Your personalized fitness journey starts now.</p>

        <FitnessLevelBadge level={fitnessLevel} />

        <div className="w-full space-y-3 max-w-sm pt-6">
          <FeatureRow icon={<Flame className="h-5 w-5" />} title="Momentum" description="Build streaks and keep your fitness momentum going" color="text-orange-500" bg="bg-orange-500/10" />
          <FeatureRow icon={<Trophy className="h-5 w-5" />} title="Challenges" description="Compete with friends and earn rewards" color="text-yellow-500" bg="bg-yellow-500/10" />
          <FeatureRow icon={<Bolt className="h-5 w-5" />} title="Circle Boost" description="Team up and boost your circle's energy" color="text-cyan-500" bg="bg-cyan-500/10" />
        </div>
      </div>

      <Button
        onClick={onFinish}
        disabled={isCompleting}
        className="w-full bg-gradient-to-r from-purple-500 to-indigo-500"
        size="lg"
      >
        {isCompleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Get Started'}
      </Button>
    </motion.div>
  );
}

function FitnessLevelBadge({ level }: { level: FitnessLevel }) {
  const meta = {
    beginner:     { emoji: '🌱', color: 'text-emerald-400', bg: 'bg-emerald-500/20' },
    intermediate: { emoji: '🌿', color: 'text-cyan-400',    bg: 'bg-cyan-500/20' },
    advanced:     { emoji: '🌳', color: 'text-orange-400',  bg: 'bg-orange-500/20' },
    expert:       { emoji: '⭐', color: 'text-purple-400',  bg: 'bg-purple-500/20' },
  }[level];

  return (
    <div className="space-y-2 text-center">
      <div className={`h-32 w-32 rounded-full ${meta.bg} flex items-center justify-center mx-auto`}>
        <div>
          <div className="text-5xl">{meta.emoji}</div>
          <p className={`text-sm font-semibold capitalize ${meta.color}`}>{level}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Your Fitness Level</p>
    </div>
  );
}

function FeatureRow({
  icon, title, description, color, bg,
}: {
  icon: React.ReactNode; title: string; description: string; color: string; bg: string;
}) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-lg ${bg} ${color} flex items-center justify-center`}>{icon}</div>
        <div className="flex-1 text-left">
          <p className="font-semibold text-sm">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ACCENT_BY_INDEX: Record<number, string> = {
  0: 'from-purple-500 to-indigo-500',
  1: 'from-orange-500 to-red-500',
  2: 'from-cyan-500 to-blue-500',
  3: 'from-emerald-500 to-green-500',
  4: 'from-pink-500 to-rose-500',
};

const BG_GRADIENT_BY_INDEX: Record<number, string> = {
  0: 'from-background via-background to-purple-950/20',
  1: 'from-background via-background to-orange-950/20',
  2: 'from-background via-background to-cyan-950/20',
  3: 'from-background via-background to-emerald-950/20',
  4: 'from-background via-background to-pink-950/20',
};
