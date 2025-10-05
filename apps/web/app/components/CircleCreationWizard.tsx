'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
// import { Switch } from '@/components/ui/switch'; // Temporarily disabled
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
  Lock,
  Globe,
  Mail,
  X,
  UserPlus,
  Copy,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';

interface CircleCreationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (circle: any) => void;
}

type ChallengeType = 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom';

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
}

export default function CircleCreationWizard({ isOpen, onClose, onSuccess }: CircleCreationWizardProps) {
  const { user } = useAuthStore();
  const [currentStep, setCurrentStep] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [createdCircleId, setCreatedCircleId] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState('');
  const [formData, setFormData] = useState<FormData>({
    name: '',
    description: '',
    type: 'weight_loss',
    startDate: '',
    endDate: '',
    maxParticipants: '',
    isPrivate: true,
    autoAccept: true,
    inviteEmails: [],
  });

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
      case 2:
        if (!formData.startDate || !formData.endDate) return false;
        const start = new Date(formData.startDate + 'T00:00:00');
        const end = new Date(formData.endDate + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Start date must be today or later, end date must be after start, minimum 7 days
        return start >= today && end > start && calculateDuration() >= 7;
      case 3:
        return true; // Settings are optional
      case 4:
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
    navigator.clipboard.writeText(inviteLink); // inviteLink stores the code
    toast.success('Invite code copied to clipboard!');
  };

  const copyInviteURL = () => {
    const url = `${window.location.origin}/circles/join/${inviteLink}`;
    navigator.clipboard.writeText(url);
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

    if (!validateStep(2)) {
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

      let { data, error } = await supabase
        .from('challenges')
        .insert(challengeData as any)
        .select()
        .single();

      // If error is due to invite_code length, try with 9-char code (backward compatibility)
      if (error && (error.message?.includes('value too long') || error.code === '22001')) {
        console.log('Retrying with 9-character invite code...');
        inviteCode = inviteCode.replace('-', ''); // Remove hyphen: FIT-ABC123 -> FITABC123
        challengeData.invite_code = inviteCode;

        const retry = await supabase
          .from('challenges')
          .insert(challengeData as any)
          .select()
          .single();

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
        .from('challenge_participants')
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

      // Store circle ID, invite code and link for step 4
      setCreatedCircleId(data.id);
      setInviteLink(inviteCode); // Store just the code, we'll format the URL in the UI

      toast.success('FitCircle created successfully!');

      // Move to step 4 (invite members)
      setCurrentStep(4);
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
      <DialogContent className="max-w-2xl bg-slate-900/95 border-slate-800 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold bg-gradient-to-r from-orange-400 to-purple-400 bg-clip-text text-transparent">
            Create Your FitCircle
          </DialogTitle>
        </DialogHeader>

        {/* Progress Indicator */}
        <div className="flex items-center justify-between mb-6">
          {[1, 2, 3, 4].map((step) => (
            <div key={step} className="flex items-center flex-1">
              <div className="relative">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-all ${
                    step <= currentStep
                      ? 'bg-gradient-to-r from-orange-500 to-purple-600 text-white'
                      : 'bg-slate-800 text-gray-500'
                  }`}
                >
                  {step < currentStep ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    step
                  )}
                </div>
              </div>
              {step < 4 && (
                <div
                  className={`flex-1 h-1 mx-2 rounded transition-all ${
                    step < currentStep
                      ? 'bg-gradient-to-r from-orange-500 to-purple-600'
                      : 'bg-slate-800'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step Labels */}
        <div className="flex justify-between mb-6 px-2">
          <span className={`text-xs ${currentStep >= 1 ? 'text-orange-400' : 'text-gray-500'}`}>
            Basic Info
          </span>
          <span className={`text-xs ${currentStep >= 2 ? 'text-purple-400' : 'text-gray-500'}`}>
            Timeline
          </span>
          <span className={`text-xs ${currentStep >= 3 ? 'text-indigo-400' : 'text-gray-500'}`}>
            Settings
          </span>
          <span className={`text-xs ${currentStep >= 4 ? 'text-green-400' : 'text-gray-500'}`}>
            Invite
          </span>
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
            className="min-h-[320px]"
          >
            {/* Step 1: Basic Info */}
            {currentStep === 1 && (
              <div className="space-y-6">
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

                <div className="space-y-2">
                  <Label className="text-white">Challenge Type</Label>
                  <div className="grid grid-cols-2 gap-3">
                    {challengeTypes.map((type) => (
                      <motion.div
                        key={type.value}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <Card
                          className={`cursor-pointer transition-all ${
                            formData.type === type.value
                              ? 'border-orange-500 bg-gradient-to-br ' + type.color + ' bg-opacity-20'
                              : 'border-slate-700 bg-slate-800/30 hover:bg-slate-800/50'
                          }`}
                          onClick={() => setFormData({ ...formData, type: type.value })}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <div
                                className={`p-2 rounded-lg ${
                                  formData.type === type.value
                                    ? 'bg-white/20'
                                    : 'bg-slate-700/50'
                                }`}
                              >
                                <type.icon className={`h-5 w-5 ${
                                  formData.type === type.value ? 'text-white' : 'text-gray-400'
                                }`} />
                              </div>
                              <div className="flex-1">
                                <p className={`font-medium ${
                                  formData.type === type.value ? 'text-white' : 'text-gray-300'
                                }`}>
                                  {type.label}
                                </p>
                                <p className={`text-xs mt-1 ${
                                  formData.type === type.value ? 'text-gray-200' : 'text-gray-500'
                                }`}>
                                  {type.description}
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Timeline */}
            {currentStep === 2 && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="startDate" className="text-white">
                      Start Date <span className="text-red-400">*</span>
                    </Label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        id="startDate"
                        type="date"
                        value={formData.startDate}
                        onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                        className="pl-10 bg-slate-800/50 border-slate-700 text-white"
                        min={new Date().toISOString().split('T')[0]}
                      />
                    </div>
                    <p className="text-xs text-gray-400">
                      Can start today or any future date
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="endDate" className="text-white">
                      End Date <span className="text-red-400">*</span>
                    </Label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        id="endDate"
                        type="date"
                        value={formData.endDate}
                        onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                        className="pl-10 bg-slate-800/50 border-slate-700 text-white"
                        min={formData.startDate}
                      />
                    </div>
                    <p className="text-xs text-gray-400">
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

            {/* Step 3: Settings */}
            {currentStep === 3 && (
              <div className="space-y-6">
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
                    />
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
                      <span className="text-gray-400">Type:</span>
                      <span className="text-white">
                        {challengeTypes.find(t => t.value === formData.type)?.label}
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

            {/* Step 4: Invite Members */}
            {currentStep === 4 && (
              <div className="space-y-6">
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

                {/* Invite Code - Hero Section */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="bg-gradient-to-br from-orange-500/20 via-purple-500/20 to-cyan-500/20 rounded-2xl p-6 border border-orange-500/30 backdrop-blur-xl"
                >
                  <div className="text-center space-y-4">
                    <div>
                      <p className="text-sm text-gray-300 mb-2">Your FitCircle Code</p>
                      <div className="relative inline-block">
                        <div className="absolute inset-0 bg-gradient-to-r from-orange-400 to-purple-400 blur-xl opacity-50" />
                        <div className="relative bg-slate-900/90 px-8 py-4 rounded-xl border-2 border-orange-500/50">
                          <p className="text-4xl font-bold bg-gradient-to-r from-orange-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent tracking-wider font-mono">
                            {inviteLink}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-3 justify-center">
                      <Button
                        onClick={copyInviteCode}
                        className="bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700 shadow-lg hover:shadow-orange-500/50"
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy Code
                      </Button>
                      <Button
                        onClick={copyInviteURL}
                        variant="outline"
                        className="border-slate-700 hover:bg-slate-800"
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Copy Link
                      </Button>
                    </div>

                    <div className="bg-slate-800/50 rounded-lg p-3">
                      <p className="text-xs text-gray-400">
                        Friends can join by entering <span className="text-orange-400 font-semibold">{inviteLink}</span> in the "Join FitCircle" section
                      </p>
                    </div>
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
                      <p className="text-white font-medium text-sm">You're all set!</p>
                      <p className="text-xs text-gray-400 mt-1">
                        You can invite more members later from the FitCircle page. Don't worry if you skip this step.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation Buttons */}
        <div className="flex justify-between mt-6">
          <Button
            variant="outline"
            onClick={currentStep === 1 ? onClose : handleBack}
            className="border-slate-700 hover:bg-slate-800"
            disabled={currentStep === 4} // Can't go back from invite step
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            {currentStep === 1 ? 'Cancel' : 'Back'}
          </Button>

          {currentStep < 3 ? (
            <Button
              onClick={handleNext}
              disabled={!validateStep(currentStep)}
              className="bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : currentStep === 3 ? (
            <Button
              onClick={handleCreateAndContinue}
              disabled={isCreating || !validateStep(2)}
              className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Create & Continue
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={handleFinish}
              className="bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800"
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              {formData.inviteEmails.length > 0 ? 'Send Invites & Finish' : 'Finish'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}