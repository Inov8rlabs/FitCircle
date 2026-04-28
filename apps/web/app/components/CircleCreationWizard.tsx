'use client';

import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy,
  Target,
  Footprints,
  Dumbbell,
  Star,
  Calendar,
  Clock,
  Users,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Bolt,
  Lock,
  Globe,
  Mail,
  X,
  Activity,
  UserPlus,
  Copy,
  Search,
  Share2,
  Sparkles,
  Wrench,
  QrCode,
} from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'sonner';

import { CHALLENGE_TEMPLATES } from '@/lib/data/challenge-templates';
import { type ChallengeCategory } from '@/lib/types/circle-challenge';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
// import { Switch } from '@/components/ui/switch'; // Temporarily disabled
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';

interface CircleCreationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (circle: any) => void;
}

type ChallengeType = 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom';

/** What the user wants to do for the circle's challenge: pick a starter
 *  template, design their own, or skip and decide later. */
type ChallengeMode = 'template' | 'custom' | 'none';

interface FormData {
  name: string;
  description: string;
  type: ChallengeType;
  startDate: string;
  endDate: string;
  maxParticipants: string;
  isPrivate: boolean;
  autoAccept: boolean;
  inviteEmails: string[];
  leaderboardFrequency: 'realtime' | 'daily' | 'weekly';
  leaderboardDay: number;
  leaderboardTime: string;

  // Step 2 — Choose a Challenge
  challengeMode: ChallengeMode;
  selectedTemplateId: string | null;
  templateCategoryFilter: ChallengeCategory | null;
  customChallengeName: string;
  customChallengeDescription: string;
  customChallengeCategory: ChallengeCategory;
  customChallengeGoalAmount: string;
  customChallengeUnit: string;
  customChallengeLoggingPrompt: string;
}

const CHALLENGE_CATEGORY_FILTERS: { label: string; value: ChallengeCategory | null }[] = [
  { label: 'All', value: null },
  { label: 'Strength', value: 'strength' },
  { label: 'Cardio', value: 'cardio' },
  { label: 'Flexibility', value: 'flexibility' },
  { label: 'Wellness', value: 'wellness' },
  { label: 'Custom', value: 'custom' },
];

export default function CircleCreationWizard({ isOpen, onClose, onSuccess }: CircleCreationWizardProps) {
  const { user } = useAuthStore();
  const [currentStep, setCurrentStep] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [createdCircleId, setCreatedCircleId] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState('');
  const [participantSearch, setParticipantSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedParticipants, setSelectedParticipants] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    name: '',
    description: '',
    type: 'custom', // legacy field — derived from challenge below; not user-picked
    startDate: '',
    endDate: '',
    maxParticipants: '',
    isPrivate: true,
    autoAccept: true,
    inviteEmails: [],
    leaderboardFrequency: 'realtime',
    leaderboardDay: 1, // Monday
    leaderboardTime: '08:00',

    // Step 2 — Choose a Challenge defaults
    challengeMode: 'template',
    selectedTemplateId: null,
    templateCategoryFilter: null,
    customChallengeName: '',
    customChallengeDescription: '',
    customChallengeCategory: 'custom',
    customChallengeGoalAmount: '100',
    customChallengeUnit: 'reps',
    customChallengeLoggingPrompt: '',
  });

  const selectedTemplate = formData.selectedTemplateId
    ? CHALLENGE_TEMPLATES.find((t) => t.id === formData.selectedTemplateId) ?? null
    : null;

  const filteredTemplates = formData.templateCategoryFilter
    ? CHALLENGE_TEMPLATES.filter((t) => t.category === formData.templateCategoryFilter)
    : CHALLENGE_TEMPLATES;

  const customChallengeIsValid =
    formData.customChallengeName.trim().length >= 3 &&
    formData.customChallengeUnit.trim().length > 0 &&
    parseFloat(formData.customChallengeGoalAmount) > 0;

  const challengeTypes = [
    {
      value: 'weight_loss' as ChallengeType,
      label: 'Weight Loss',
      icon: Trophy,
      description: 'Track weight loss progress',
      color: 'from-purple-500 to-purple-600',
    },
    {
      value: 'step_count' as ChallengeType,
      label: 'Daily Steps',
      icon: Footprints,
      description: 'Reach daily step goals',
      color: 'from-indigo-500 to-indigo-600',
    },
    {
      value: 'workout_frequency' as ChallengeType,
      label: 'Workout Frequency',
      icon: Dumbbell,
      description: 'Complete workout sessions',
      color: 'from-orange-500 to-orange-600',
    },
    {
      value: 'custom' as ChallengeType,
      label: 'Custom Goal',
      icon: Star,
      description: 'Define your own metric',
      color: 'from-green-500 to-green-600',
    },
  ];

  const calculateDuration = () => {
    if (!formData.startDate || !formData.endDate) return 0;
    const start = new Date(formData.startDate);
    const end = new Date(formData.endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const validateStep = (step: number): boolean => {
    switch (step) {
      case 1:
        return formData.name.length >= 3 && formData.name.length <= 50;
      case 2: {
        // Choose a Challenge
        switch (formData.challengeMode) {
          case 'none':
            return true;
          case 'template':
            return formData.selectedTemplateId !== null;
          case 'custom':
            return customChallengeIsValid;
          default:
            return false;
        }
      }
      case 3: {
        // Timeline (was step 2)
        if (!formData.startDate || !formData.endDate) return false;
        const start = new Date(formData.startDate + 'T00:00:00');
        const end = new Date(formData.endDate + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return start >= today && end > start && calculateDuration() >= 7;
      }
      case 4:
        return true; // Settings/Review are optional
      case 5:
        return true; // Invites are optional
      default:
        return false;
    }
  };

  const addEmail = () => {
    const email = emailInput.trim().toLowerCase();
    if (!email) return;

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error('Please enter a valid email address');
      return;
    }

    if (formData.inviteEmails.includes(email)) {
      toast.error('This email is already added');
      return;
    }

    setFormData({ ...formData, inviteEmails: [...formData.inviteEmails, email] });
    setEmailInput('');
  };

  const removeEmail = (email: string) => {
    setFormData({
      ...formData,
      inviteEmails: formData.inviteEmails.filter(e => e !== email),
    });
  };

  const copyInviteCode = () => {
    void navigator.clipboard.writeText(inviteLink); // inviteLink stores the code
    toast.success('Invite code copied to clipboard!');
  };

  const copyInviteURL = () => {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '');
    const url = `${baseUrl}/join/${inviteLink}`;
    void navigator.clipboard.writeText(url);
    toast.success('Invite link copied to clipboard!');
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(currentStep + 1);
    } else {
      toast.error('Please fill in all required fields correctly');
    }
  };

  const handleBack = () => {
    setCurrentStep(currentStep - 1);
  };

  const generateInviteCode = (): string => {
    // Generate a short, memorable code
    // Format: FIT-XXXXXX (10 chars) or FITXXXXXX (9 chars for backward compatibility)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    // Try with hyphen first (10 chars), fallback to no hyphen (9 chars) if needed
    return `FIT-${code}`;
  };

  const handleCreateAndContinue = async () => {
    if (!user) {
      toast.error('Please log in to create a FitCircle');
      return;
    }

    // Timeline is now Step 3
    if (!validateStep(3)) {
      toast.error('Please complete all required fields');
      return;
    }

    setIsCreating(true);
    try {
      let inviteCode = generateInviteCode();
      const startDate = new Date(formData.startDate);
      const registrationDeadline = new Date(startDate);
      registrationDeadline.setDate(registrationDeadline.getDate() - 1);

      const challengeData = {
        creator_id: user.id,
        name: formData.name,
        description: formData.description || null,
        type: formData.type,
        status: 'upcoming' as const,
        visibility: formData.isPrivate ? ('invite_only' as const) : ('public' as const),
        start_date: formData.startDate,
        end_date: formData.endDate,
        registration_deadline: registrationDeadline.toISOString(),
        max_participants: formData.maxParticipants ? parseInt(formData.maxParticipants) : null,
        invite_code: inviteCode,
        entry_fee: 0,
        prize_pool: 0,
        leaderboard_update_frequency: formData.leaderboardFrequency,
        leaderboard_update_day: formData.leaderboardFrequency === 'weekly' ? formData.leaderboardDay : null,
        leaderboard_update_time: formData.leaderboardFrequency === 'weekly' ? formData.leaderboardTime : null,
        rules: {
          daily_checkin_required: false,
          min_checkins_per_week: 0,
          photo_proof_required: false,
          auto_accept_invites: formData.autoAccept,
        },
        scoring_system: {
          checkin_points: 10,
          goal_achievement_points: 100,
          streak_bonus_points: 5,
        },
      };

      console.log('Creating challenge with data:', {
        ...challengeData,
        invite_code: inviteCode,
        invite_code_length: inviteCode.length,
      });

      let { data, error } = (await supabase
        .from('fitcircles')
        .insert(challengeData as any)
        .select()
        .single()) as { data: any; error: any };

      // If error is due to invite_code length, try with 9-char code (backward compatibility)
      if (error && (error.message?.includes('value too long') || error.code === '22001')) {
        console.log('Retrying with 9-character invite code...');
        inviteCode = inviteCode.replace('-', ''); // Remove hyphen: FIT-ABC123 -> FITABC123
        challengeData.invite_code = inviteCode;

        const retry = (await supabase
          .from('fitcircles')
          .insert(challengeData as any)
          .select()
          .single()) as { data: any; error: any };

        data = retry.data;
        error = retry.error;
      }

      if (error) {
        console.error('Supabase error details:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          fullError: JSON.stringify(error),
        });
        throw error;
      }

      if (!data) {
        throw new Error('No data returned from challenge creation');
      }

      console.log('Challenge created successfully:', data);

      // Auto-join the creator to their circle
      const { error: joinError } = await supabase
        .from('fitcircle_members')
        .insert({
          challenge_id: data.id,
          user_id: user.id,
          status: 'active',
        } as any);

      if (joinError) {
        console.error('Error joining circle:', {
          message: joinError.message,
          details: joinError.details,
          hint: joinError.hint,
          code: joinError.code,
          fullError: JSON.stringify(joinError),
        });
        throw joinError;
      }

      // Store circle ID, invite code and link for the invite step
      setCreatedCircleId(data.id);
      setInviteLink(inviteCode); // Store just the code, we'll format the URL in the UI

      // Best-effort: attach the chosen challenge to the new circle. If this
      // fails the circle still exists — match iOS/Android behavior and don't
      // roll back. The user can re-attach later from the circle detail page.
      if (formData.challengeMode !== 'none') {
        try {
          const challengePayload =
            formData.challengeMode === 'template' && selectedTemplate
              ? {
                  template_id: selectedTemplate.id,
                  name: selectedTemplate.name,
                  description: selectedTemplate.description,
                  category: selectedTemplate.category,
                  goal_amount: selectedTemplate.goal_amount,
                  unit: selectedTemplate.unit,
                  logging_prompt: selectedTemplate.logging_prompt,
                }
              : formData.challengeMode === 'custom'
                ? {
                    name: formData.customChallengeName.trim(),
                    description: formData.customChallengeDescription.trim() || null,
                    category: formData.customChallengeCategory,
                    goal_amount: parseFloat(formData.customChallengeGoalAmount) || 0,
                    unit: formData.customChallengeUnit.trim(),
                    logging_prompt:
                      formData.customChallengeLoggingPrompt.trim() || null,
                  }
                : null;

          if (challengePayload) {
            const { error: challengeError } = await supabase
              .from('challenges')
              .insert({
                fitcircle_id: data.id,
                creator_id: user.id,
                ...challengePayload,
                is_open: true,
                status: 'scheduled',
                starts_at: new Date(formData.startDate + 'T00:00:00').toISOString(),
                ends_at: new Date(formData.endDate + 'T23:59:59').toISOString(),
              } as any);

            if (challengeError) {
              console.warn(
                '[CircleCreationWizard] Circle created but challenge attach failed:',
                challengeError
              );
            }
          }
        } catch (e) {
          console.warn('[CircleCreationWizard] Challenge attach exception:', e);
        }
      }

      toast.success('FitCircle created successfully!');

      // Move to step 5 (invite members)
      setCurrentStep(5);
    } catch (error: any) {
      console.error('Error creating FitCircle:', error);
      toast.error(error.message || 'Failed to create FitCircle');
    } finally {
      setIsCreating(false);
    }
  };

  const handleFinish = async () => {
    if (formData.inviteEmails.length > 0 && createdCircleId) {
      try {
        // TODO: Send email invitations via API
        // For now, just show success message
        toast.success(`Invitations will be sent to ${formData.inviteEmails.length} people`);
      } catch (error) {
        console.error('Error sending invites:', error);
      }
    }

    onSuccess({ id: createdCircleId });
    onClose();
  };

  const stepVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 300 : -300,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      x: direction < 0 ? 300 : -300,
      opacity: 0,
    }),
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-900/95 border-slate-800 backdrop-blur-xl">
        <DialogHeader className="sticky top-0 z-10 bg-slate-900/95 pb-4 backdrop-blur-xl">
          <DialogTitle className="text-xl font-bold bg-gradient-to-r from-orange-400 to-purple-400 bg-clip-text text-transparent">
            Create Your FitCircle
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto">
          {/* Progress Indicator */}
          <div className="mb-4 sm:mb-6 px-2 sm:px-4" data-testid="progress-indicator">
            <div className="flex items-start justify-center gap-1 sm:gap-2" data-testid="step-container">
              {[1, 2, 3, 4, 5].map((step, index) => (
                <React.Fragment key={step}>
                  {/* Step circle and label group */}
                  <div className="flex flex-col items-center min-w-[44px] sm:min-w-[56px]" data-testid={`step-group-${step}`}>
                    <div
                      className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-sm sm:text-base font-semibold transition-all ${
                        step <= currentStep
                          ? 'bg-gradient-to-r from-orange-500 to-purple-600 text-white'
                          : 'bg-slate-800 text-gray-500'
                      }`}
                    >
                      {step < currentStep ? (
                        <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5" />
                      ) : (
                        step
                      )}
                    </div>
                    <span className={`text-[10px] sm:text-xs font-medium text-center whitespace-nowrap mt-1.5 sm:mt-2 ${currentStep >= step ? 'text-orange-400' : 'text-gray-500'}`}>
                      {step === 1 && 'Info'}
                      {step === 2 && 'Challenge'}
                      {step === 3 && 'Timeline'}
                      {step === 4 && 'Settings'}
                      {step === 5 && 'Invite'}
                    </span>
                  </div>

                  {/* Connecting line */}
                  {index < 4 && (
                    <div className="flex items-center pt-4 sm:pt-5">
                      <div
                        data-testid={`connecting-line-${step}`}
                        className={`h-0.5 sm:h-1 w-4 sm:w-8 md:w-12 rounded transition-all ${
                          step < currentStep
                            ? 'bg-gradient-to-r from-orange-500 to-purple-600'
                            : 'bg-slate-800'
                        }`}
                      />
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

        {/* Step Content */}
        <AnimatePresence mode="wait" custom={currentStep}>
          <motion.div
            key={currentStep}
            custom={currentStep}
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="min-h-[320px] px-3 sm:px-4"
            data-testid="step-content"
          >
            {/* Step 1: Basic Info */}
            {currentStep === 1 && (
              <div className="space-y-4 sm:space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-white">
                    Circle Name <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id="name"
                    placeholder="e.g., Summer Shred Challenge"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500"
                    maxLength={50}
                  />
                  <p className="text-xs text-gray-400">
                    {formData.name.length}/50 characters
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description" className="text-white">
                    Description <span className="text-gray-500">(optional)</span>
                  </Label>
                  <Textarea
                    id="description"
                    placeholder="What's this challenge about? What are the goals?"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500 min-h-[80px]"
                    maxLength={200}
                  />
                  <p className="text-xs text-gray-400">
                    {formData.description.length}/200 characters
                  </p>
                </div>

                <p className="text-xs text-gray-400">
                  Give your group a name. You&apos;ll pick what you&apos;re doing together next.
                </p>
              </div>
            )}

            {/* Step 2: Choose a Challenge */}
            {currentStep === 2 && (
              <div className="space-y-4 sm:space-y-6">
                <div>
                  <h3 className="text-white text-base font-semibold">Choose a challenge</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Kick off with a ready-made challenge, build your own, or add one later.
                  </p>
                </div>

                {/* Mode picker */}
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {([
                    { mode: 'template' as const, title: 'Quick Start', subtitle: 'Starter challenges', icon: Bolt },
                    { mode: 'custom' as const, title: 'Custom', subtitle: 'Design your own', icon: Wrench },
                    { mode: 'none' as const, title: 'Add Later', subtitle: 'Skip for now', icon: Clock },
                  ] as const).map(({ mode, title, subtitle, icon: Icon }) => {
                    const isSelected = formData.challengeMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          setFormData({
                            ...formData,
                            challengeMode: mode,
                            // Clear template selection when leaving template mode
                            selectedTemplateId: mode === 'template' ? formData.selectedTemplateId : null,
                          });
                        }}
                        className={`p-3 sm:p-4 rounded-xl border transition-all text-center ${
                          isSelected
                            ? 'bg-gradient-to-br from-orange-500/20 to-purple-600/20 border-orange-500/60'
                            : 'bg-slate-800/40 border-slate-700 hover:bg-slate-800/70'
                        }`}
                      >
                        <Icon
                          className={`h-5 w-5 mx-auto mb-1.5 ${isSelected ? 'text-orange-300' : 'text-gray-400'}`}
                        />
                        <p className={`text-xs sm:text-sm font-semibold ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                          {title}
                        </p>
                        <p className={`text-[10px] sm:text-xs mt-0.5 ${isSelected ? 'text-gray-200' : 'text-gray-500'}`}>
                          {subtitle}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* Template browser */}
                {formData.challengeMode === 'template' && (
                  <div className="space-y-3">
                    {/* Category filter chips */}
                    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                      {CHALLENGE_CATEGORY_FILTERS.map((cat) => {
                        const isSelected = formData.templateCategoryFilter === cat.value;
                        return (
                          <button
                            key={cat.label}
                            type="button"
                            onClick={() => setFormData({ ...formData, templateCategoryFilter: cat.value })}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                              isSelected
                                ? 'bg-gradient-to-r from-orange-500 to-purple-600 text-white'
                                : 'bg-slate-800/60 text-gray-400 hover:bg-slate-800'
                            }`}
                          >
                            {cat.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Template list */}
                    {filteredTemplates.length === 0 ? (
                      <p className="text-sm text-gray-400 py-4 text-center">
                        No templates in this category yet.
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                        {filteredTemplates.map((template) => {
                          const isSelected = formData.selectedTemplateId === template.id;
                          return (
                            <button
                              key={template.id}
                              type="button"
                              onClick={() => {
                                // Selecting a template auto-prefills the timeline end date
                                // from its recommended duration so the user lands on Step 3
                                // with a sensible default they can edit.
                                const startDate = formData.startDate
                                  ? new Date(formData.startDate + 'T00:00:00')
                                  : new Date();
                                const endDate = new Date(startDate);
                                endDate.setDate(endDate.getDate() + template.recommended_duration_days);
                                const yyyy = endDate.getFullYear();
                                const mm = String(endDate.getMonth() + 1).padStart(2, '0');
                                const dd = String(endDate.getDate()).padStart(2, '0');

                                setFormData({
                                  ...formData,
                                  selectedTemplateId: template.id,
                                  challengeMode: 'template',
                                  endDate: formData.endDate || `${yyyy}-${mm}-${dd}`,
                                });
                              }}
                              className={`w-full text-left p-3 rounded-xl border transition-all ${
                                isSelected
                                  ? 'border-orange-500 bg-gradient-to-br from-orange-500/10 to-purple-600/10'
                                  : 'border-slate-700 bg-slate-800/30 hover:bg-slate-800/50'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <div className="text-3xl shrink-0">{template.icon}</div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-white font-semibold text-sm">{template.name}</p>
                                  <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                                    {template.description}
                                  </p>
                                  <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
                                    <Target className="h-3 w-3" />
                                    {template.goal_amount} {template.unit} ·{' '}
                                    {template.recommended_duration_days} days
                                  </p>
                                </div>
                                {isSelected && (
                                  <CheckCircle2 className="h-5 w-5 text-orange-400 shrink-0 mt-0.5" />
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Custom challenge form */}
                {formData.challengeMode === 'custom' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-white text-sm">Challenge Name</Label>
                      <Input
                        placeholder="e.g., 100 Squats Daily"
                        value={formData.customChallengeName}
                        onChange={(e) =>
                          setFormData({ ...formData, customChallengeName: e.target.value })
                        }
                        className="bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500"
                        maxLength={50}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-white text-sm">
                        Description <span className="text-gray-500 text-xs">(optional)</span>
                      </Label>
                      <Textarea
                        placeholder="What are people doing?"
                        value={formData.customChallengeDescription}
                        onChange={(e) =>
                          setFormData({ ...formData, customChallengeDescription: e.target.value })
                        }
                        className="bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500 min-h-[60px]"
                        maxLength={200}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-white text-sm">Category</Label>
                      <div className="flex gap-2 flex-wrap">
                        {(['strength', 'cardio', 'flexibility', 'wellness', 'custom'] as const).map(
                          (cat) => {
                            const isSelected = formData.customChallengeCategory === cat;
                            return (
                              <button
                                key={cat}
                                type="button"
                                onClick={() =>
                                  setFormData({ ...formData, customChallengeCategory: cat })
                                }
                                className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition-all ${
                                  isSelected
                                    ? 'bg-gradient-to-r from-orange-500 to-purple-600 text-white'
                                    : 'bg-slate-800/60 text-gray-400 hover:bg-slate-800'
                                }`}
                              >
                                {cat}
                              </button>
                            );
                          }
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label className="text-white text-sm">Goal Total</Label>
                        <Input
                          inputMode="decimal"
                          placeholder="100"
                          value={formData.customChallengeGoalAmount}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^0-9.]/g, '');
                            setFormData({ ...formData, customChallengeGoalAmount: v });
                          }}
                          className="bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-white text-sm">Unit</Label>
                        <Input
                          placeholder="reps"
                          value={formData.customChallengeUnit}
                          onChange={(e) =>
                            setFormData({ ...formData, customChallengeUnit: e.target.value })
                          }
                          className="bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500"
                          maxLength={20}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-white text-sm">
                        Logging Prompt <span className="text-gray-500 text-xs">(optional)</span>
                      </Label>
                      <Input
                        placeholder="How many reps today?"
                        value={formData.customChallengeLoggingPrompt}
                        onChange={(e) =>
                          setFormData({ ...formData, customChallengeLoggingPrompt: e.target.value })
                        }
                        className="bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500"
                        maxLength={60}
                      />
                    </div>

                    {/* Live preview */}
                    {customChallengeIsValid && (
                      <div className="rounded-lg p-3 bg-purple-500/10 border border-purple-500/30">
                        <p className="text-sm text-white">
                          Reach{' '}
                          <span className="font-semibold">
                            {parseFloat(formData.customChallengeGoalAmount) % 1 === 0
                              ? parseInt(formData.customChallengeGoalAmount)
                              : formData.customChallengeGoalAmount}{' '}
                            {formData.customChallengeUnit.trim()}
                          </span>{' '}
                          —{' '}
                          <span className="font-medium">
                            &ldquo;{formData.customChallengeName.trim()}&rdquo;
                          </span>
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Add Later card */}
                {formData.challengeMode === 'none' && (
                  <Card className="bg-slate-800/40 border-slate-700">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Clock className="h-5 w-5 text-indigo-400 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-white font-semibold text-sm">Add a challenge later</p>
                          <p className="text-xs text-gray-400 mt-1">
                            Create the circle now and invite friends. You can start a challenge
                            anytime from the circle&apos;s detail page.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Step 3: Timeline */}
            {currentStep === 3 && (
              <div className="space-y-4 sm:space-y-6">
                <div className="grid grid-cols-2 gap-3 sm:gap-4">
                  <div className="space-y-1">
                    <DatePicker
                      label="Start Date"
                      value={formData.startDate}
                      onChange={(value) => setFormData({ ...formData, startDate: value })}
                      min={new Date().toISOString().split('T')[0]}
                      placeholder="When does your challenge start?"
                      required
                    />
                    <p className="text-xs text-gray-400 pl-1">
                      Can start today or any future date
                    </p>
                  </div>

                  <div className="space-y-1">
                    <DatePicker
                      label="End Date"
                      value={formData.endDate}
                      onChange={(value) => setFormData({ ...formData, endDate: value })}
                      min={formData.startDate}
                      placeholder="When does it end?"
                      required
                    />
                    <p className="text-xs text-gray-400 pl-1">
                      Minimum 7 days duration
                    </p>
                  </div>
                </div>

                {formData.startDate && formData.endDate && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-gradient-to-br from-orange-900/20 to-purple-900/20 rounded-lg p-4 border border-orange-500/30"
                  >
                    <div className="flex items-center gap-3">
                      <Clock className="h-5 w-5 text-orange-400" />
                      <div>
                        <p className="text-white font-medium">
                          {calculateDuration()}-day challenge
                        </p>
                        <p className="text-xs text-gray-400">
                          From {new Date(formData.startDate).toLocaleDateString()} to{' '}
                          {new Date(formData.endDate).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    {calculateDuration() < 7 && (
                      <div className="flex items-center gap-2 mt-3 text-yellow-400">
                        <AlertCircle className="h-4 w-4" />
                        <p className="text-xs">Challenge must be at least 7 days long</p>
                      </div>
                    )}
                  </motion.div>
                )}
              </div>
            )}

            {/* Step 4: Settings */}
            {currentStep === 4 && (
              <div className="space-y-4 sm:space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-slate-800/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      {formData.isPrivate ? (
                        <Lock className="h-5 w-5 text-orange-400" />
                      ) : (
                        <Globe className="h-5 w-5 text-green-400" />
                      )}
                      <div>
                        <p className="text-white font-medium">
                          {formData.isPrivate ? 'Private Circle' : 'Public Circle'}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formData.isPrivate
                            ? 'Only people with invite link can join'
                            : 'Anyone can discover and join'}
                        </p>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={formData.isPrivate}
                      onChange={(e) => setFormData({ ...formData, isPrivate: e.target.checked })}
                      className="h-6 w-11 rounded-full cursor-pointer"
                      aria-label="Toggle privacy mode"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="maxParticipants" className="text-white">
                      Maximum Participants <span className="text-gray-500">(optional)</span>
                    </Label>
                    <div className="relative">
                      <Users className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        id="maxParticipants"
                        type="number"
                        placeholder="No limit"
                        value={formData.maxParticipants}
                        onChange={(e) => setFormData({ ...formData, maxParticipants: e.target.value })}
                        className="pl-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500"
                        min="2"
                        max="100"
                      />
                    </div>
                    <p className="text-xs text-gray-400">
                      Leave empty for unlimited participants (max 100)
                    </p>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-slate-800/30 rounded-lg">
                    <div className="flex-1">
                      <p className="text-white font-medium">Auto-accept invites</p>
                      <p className="text-xs text-gray-400">
                        New members join immediately without approval
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={formData.autoAccept}
                      onChange={(e) => setFormData({ ...formData, autoAccept: e.target.checked })}
                      className="h-6 w-11 rounded-full cursor-pointer"
                      aria-label="Toggle auto-accept invites"
                    />
                  </div>

                  {/* Leaderboard Update Frequency */}
                  <div className="space-y-3">
                    <Label className="text-white">Leaderboard Update Frequency</Label>
                    <p className="text-xs text-gray-400">
                      When should the leaderboard update with new tracking data?
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, leaderboardFrequency: 'realtime' })}
                        className={`p-3 rounded-lg border transition-all ${
                          formData.leaderboardFrequency === 'realtime'
                            ? 'bg-orange-500/20 border-orange-500 text-white'
                            : 'bg-slate-800/50 border-slate-700 text-gray-400 hover:bg-slate-800'
                        }`}
                      >
                        <Activity className="h-5 w-5 mx-auto mb-1" />
                        <p className="text-sm font-medium">Realtime</p>
                        <p className="text-xs opacity-75">Instant updates</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, leaderboardFrequency: 'daily' })}
                        className={`p-3 rounded-lg border transition-all ${
                          formData.leaderboardFrequency === 'daily'
                            ? 'bg-orange-500/20 border-orange-500 text-white'
                            : 'bg-slate-800/50 border-slate-700 text-gray-400 hover:bg-slate-800'
                        }`}
                      >
                        <Calendar className="h-5 w-5 mx-auto mb-1" />
                        <p className="text-sm font-medium">Daily</p>
                        <p className="text-xs opacity-75">Once per day</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, leaderboardFrequency: 'weekly' })}
                        className={`p-3 rounded-lg border transition-all ${
                          formData.leaderboardFrequency === 'weekly'
                            ? 'bg-orange-500/20 border-orange-500 text-white'
                            : 'bg-slate-800/50 border-slate-700 text-gray-400 hover:bg-slate-800'
                        }`}
                      >
                        <Clock className="h-5 w-5 mx-auto mb-1" />
                        <p className="text-sm font-medium">Weekly</p>
                        <p className="text-xs opacity-75">Once per week</p>
                      </button>
                    </div>

                    {/* Weekly schedule settings */}
                    {formData.leaderboardFrequency === 'weekly' && (
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <div className="space-y-2">
                          <Label className="text-white text-xs">Update Day</Label>
                          <select
                            value={formData.leaderboardDay}
                            onChange={(e) => setFormData({ ...formData, leaderboardDay: parseInt(e.target.value) })}
                            className="w-full p-2 bg-slate-800/50 border-slate-700 rounded-lg text-white text-sm"
                          >
                            <option value={0}>Sunday</option>
                            <option value={1}>Monday</option>
                            <option value={2}>Tuesday</option>
                            <option value={3}>Wednesday</option>
                            <option value={4}>Thursday</option>
                            <option value={5}>Friday</option>
                            <option value={6}>Saturday</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-white text-xs">Update Time (ET)</Label>
                          <input
                            type="time"
                            value={formData.leaderboardTime}
                            onChange={(e) => setFormData({ ...formData, leaderboardTime: e.target.value })}
                            className="w-full p-2 bg-slate-800/50 border-slate-700 rounded-lg text-white text-sm"
                          />
                        </div>
                      </div>
                    )}

                    <div className="bg-slate-800/50 rounded-lg p-3 mt-2">
                      <p className="text-xs text-gray-400">
                        {formData.leaderboardFrequency === 'realtime' &&
                          'Leaderboard updates instantly when you track your daily progress.'}
                        {formData.leaderboardFrequency === 'daily' &&
                          'Leaderboard updates once per day with your latest tracking data.'}
                        {formData.leaderboardFrequency === 'weekly' &&
                          `Leaderboard updates weekly on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][formData.leaderboardDay]} at ${formData.leaderboardTime} ET. Your last entry in the 12-hour window before update time will be used.`}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-gradient-to-br from-indigo-900/20 to-purple-900/20 rounded-lg p-4 border border-indigo-500/30">
                  <h4 className="text-white font-medium mb-3">Circle Summary</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Name:</span>
                      <span className="text-white">{formData.name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Challenge:</span>
                      <span className="text-white text-right">
                        {formData.challengeMode === 'template' && selectedTemplate
                          ? selectedTemplate.name
                          : formData.challengeMode === 'custom' &&
                              formData.customChallengeName.trim()
                            ? formData.customChallengeName.trim()
                            : 'Add later'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Duration:</span>
                      <span className="text-white">{calculateDuration()} days</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Privacy:</span>
                      <span className="text-white">
                        {formData.isPrivate ? 'Invite Only' : 'Public'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 5: Invite Members */}
            {currentStep === 5 && (
              <div className="space-y-4 sm:space-y-6">
                <div className="text-center mb-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", duration: 0.5 }}
                  >
                    <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto mb-3" />
                  </motion.div>
                  <h3 className="text-xl font-semibold text-white mb-2">FitCircle Created!</h3>
                  <p className="text-gray-400 text-sm">
                    Share your invite code with friends to get started
                  </p>
                </div>

                {/* Invite Code - Hero Section with Animation */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="relative bg-gradient-to-br from-orange-500/20 via-purple-500/20 to-cyan-500/20 rounded-2xl p-6 border border-orange-500/30 backdrop-blur-xl overflow-hidden"
                >
                  {/* Animated background particles */}
                  <div className="absolute inset-0 pointer-events-none">
                    <motion.div
                      className="absolute top-10 left-10 w-2 h-2 bg-orange-400 rounded-full opacity-50"
                      animate={{
                        y: [-20, 20, -20],
                        x: [-10, 10, -10],
                      }}
                      transition={{
                        duration: 4,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    />
                    <motion.div
                      className="absolute bottom-10 right-10 w-3 h-3 bg-purple-400 rounded-full opacity-50"
                      animate={{
                        y: [20, -20, 20],
                        x: [10, -10, 10],
                      }}
                      transition={{
                        duration: 5,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    />
                    <motion.div
                      className="absolute top-20 right-20 w-1.5 h-1.5 bg-cyan-400 rounded-full opacity-50"
                      animate={{
                        y: [-15, 15, -15],
                        x: [15, -15, 15],
                      }}
                      transition={{
                        duration: 3.5,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    />
                  </div>
                  
                  <div className="relative text-center space-y-4">
                    <div>
                      <div className="flex items-center justify-center gap-2 mb-3">
                        <Sparkles className="h-5 w-5 text-yellow-400 animate-pulse" />
                        <p className="text-sm text-gray-300 font-medium">Your Unique FitCircle Code</p>
                        <Sparkles className="h-5 w-5 text-yellow-400 animate-pulse" />
                      </div>
                      <div className="relative inline-block">
                        <div className="absolute inset-0 bg-gradient-to-r from-orange-400 to-purple-400 blur-xl opacity-50 animate-pulse" />
                        <motion.div
                          className="relative bg-slate-900/90 px-8 py-4 rounded-xl border-2 border-orange-500/50"
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          <p className="text-4xl font-bold bg-gradient-to-r from-orange-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent tracking-wider font-mono select-all">
                            {inviteLink}
                          </p>
                        </motion.div>
                      </div>
                    </div>

                    <div className="flex gap-3 justify-center flex-wrap">
                      <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Button
                          onClick={copyInviteCode}
                          className="bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700 shadow-lg hover:shadow-orange-500/50"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Copy Code
                        </Button>
                      </motion.div>
                      <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Button
                          onClick={copyInviteURL}
                          variant="outline"
                          className="border-slate-700 hover:bg-slate-800 hover:border-purple-500/50"
                        >
                          <Share2 className="h-4 w-4 mr-2" />
                          Share Link
                        </Button>
                      </motion.div>
                      <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                        <Button
                          onClick={() => {
                            // Generate QR code (future feature)
                            toast.info('QR Code feature coming soon!');
                          }}
                          variant="outline"
                          className="border-slate-700 hover:bg-slate-800 hover:border-cyan-500/50"
                        >
                          <QrCode className="h-4 w-4 mr-2" />
                          QR Code
                        </Button>
                      </motion.div>
                    </div>

                    <motion.div
                      className="bg-slate-800/50 rounded-lg p-3"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.5 }}
                    >
                      <p className="text-xs text-gray-400">
                        Friends can join instantly by entering <span className="text-orange-400 font-semibold">{inviteLink}</span> or clicking your share link
                      </p>
                    </motion.div>
                  </div>
                </motion.div>

                {/* Email Invites */}
                <div className="space-y-2">
                  <Label className="text-white">Invite by Email <span className="text-gray-500">(optional)</span></Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        placeholder="friend@example.com"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addEmail();
                          }
                        }}
                        className="pl-10 bg-slate-800/50 border-slate-700 text-white placeholder:text-gray-500"
                      />
                    </div>
                    <Button
                      onClick={addEmail}
                      className="bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700"
                    >
                      Add
                    </Button>
                  </div>
                  <p className="text-xs text-gray-400">
                    Press Enter or click Add to include an email
                  </p>
                </div>

                {/* Email List */}
                {formData.inviteEmails.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-white">Invited ({formData.inviteEmails.length})</Label>
                    <div className="bg-slate-800/30 rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                      {formData.inviteEmails.map((email) => (
                        <div
                          key={email}
                          className="flex items-center justify-between bg-slate-700/30 rounded px-3 py-2"
                        >
                          <span className="text-sm text-white">{email}</span>
                          <button
                            onClick={() => removeEmail(email)}
                            className="text-gray-400 hover:text-red-400 transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Info Box */}
                <div className="bg-gradient-to-br from-green-900/20 to-cyan-900/20 rounded-lg p-4 border border-green-500/30">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-400 mt-0.5" />
                    <div>
                      <p className="text-white font-medium text-sm">You&apos;re all set!</p>
                      <p className="text-xs text-gray-400 mt-1">
                        You can invite more members later from the FitCircle page. Don&apos;t worry if you skip this step.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation Buttons */}
        <div className="flex justify-between gap-2 mt-4 sm:mt-6 px-3 sm:px-0">
          <Button
            variant="outline"
            onClick={currentStep === 1 ? onClose : handleBack}
            size="sm"
            className="border-slate-700 hover:bg-slate-800 text-xs sm:text-sm"
            disabled={currentStep === 5} // Can't go back from invite step
            aria-label={currentStep === 1 ? 'Cancel' : 'Go back'}
          >
            <ChevronLeft className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
            {currentStep === 1 ? 'Cancel' : 'Back'}
          </Button>

          {currentStep < 4 ? (
            <Button
              onClick={handleNext}
              disabled={!validateStep(currentStep)}
              size="sm"
              className="bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700 text-xs sm:text-sm"
            >
              Next
              <ChevronRight className="h-3 w-3 sm:h-4 sm:w-4 ml-1 sm:ml-2" />
            </Button>
          ) : currentStep === 4 ? (
            <Button
              onClick={handleCreateAndContinue}
              disabled={isCreating || !validateStep(3)}
              size="sm"
              className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-xs sm:text-sm"
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2 animate-spin" />
                  <span className="hidden sm:inline">Creating...</span>
                  <span className="sm:hidden">Creating</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                  <span className="hidden sm:inline">Create & Continue</span>
                  <span className="sm:hidden">Create</span>
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={handleFinish}
              size="sm"
              className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-xs sm:text-sm"
            >
              <CheckCircle2 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              {formData.inviteEmails.length > 0 ? (
                <>
                  <span className="hidden sm:inline">Send Invites & Finish</span>
                  <span className="sm:hidden">Finish</span>
                </>
              ) : (
                'Finish'
              )}
            </Button>
          )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}