'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  Calendar,
  Target,
  Users,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';
import { ChallengeTemplate, ChallengeCategory } from '@/lib/types/circle-challenge';
import { CHALLENGE_TEMPLATES, getTemplateById } from '@/lib/data/challenge-templates';
import ChallengeTemplateGrid from './ChallengeTemplateGrid';

interface ChallengeCreationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (challenge: any) => void;
  circleId: string;
  circleMembers?: Array<{ user_id: string; display_name: string; avatar_url?: string }>;
}

interface FormData {
  template_id: string | null;
  name: string;
  description: string;
  category: ChallengeCategory;
  goal_amount: string;
  unit: string;
  logging_prompt: string;
  is_open: boolean;
  starts_at: string;
  ends_at: string;
  invite_user_ids: string[];
}

const TOTAL_STEPS = 4;

export default function ChallengeCreationWizard({
  isOpen,
  onClose,
  onSuccess,
  circleId,
  circleMembers = [],
}: ChallengeCreationWizardProps) {
  const { user } = useAuthStore();
  const [currentStep, setCurrentStep] = useState(1);
  const [isCreating, setIsCreating] = useState(false);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultStart = tomorrow.toISOString().split('T')[0];
  const defaultEnd = new Date(tomorrow.getTime() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const [formData, setFormData] = useState<FormData>({
    template_id: null,
    name: '',
    description: '',
    category: 'strength',
    goal_amount: '',
    unit: 'reps',
    logging_prompt: '',
    is_open: true,
    starts_at: defaultStart,
    ends_at: defaultEnd,
    invite_user_ids: [],
  });

  const handleTemplateSelect = (template: ChallengeTemplate) => {
    const endDate = new Date(tomorrow.getTime() + template.recommended_duration_days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    setFormData({
      ...formData,
      template_id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      goal_amount: template.goal_amount.toString(),
      unit: template.unit,
      logging_prompt: template.logging_prompt,
      starts_at: defaultStart,
      ends_at: endDate,
    });
    setCurrentStep(2);
  };

  const handleStartFromScratch = () => {
    const customTemplate = CHALLENGE_TEMPLATES.find(t => t.id === 'custom')!;
    setFormData({
      ...formData,
      template_id: null,
      name: '',
      description: '',
      category: 'custom',
      goal_amount: '',
      unit: '',
      logging_prompt: '',
    });
    setCurrentStep(2);
  };

  const toggleMemberInvite = (userId: string) => {
    setFormData(prev => ({
      ...prev,
      invite_user_ids: prev.invite_user_ids.includes(userId)
        ? prev.invite_user_ids.filter(id => id !== userId)
        : [...prev.invite_user_ids, userId],
    }));
  };

  const selectAllMembers = () => {
    const allIds = circleMembers
      .filter(m => m.user_id !== user?.id)
      .map(m => m.user_id);
    setFormData(prev => ({ ...prev, invite_user_ids: allIds }));
  };

  const deselectAllMembers = () => {
    setFormData(prev => ({ ...prev, invite_user_ids: [] }));
  };

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const response = await fetch(`/api/fitcircles/${circleId}/challenges`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: formData.template_id,
          name: formData.name,
          description: formData.description || undefined,
          category: formData.category,
          goal_amount: parseFloat(formData.goal_amount),
          unit: formData.unit,
          logging_prompt: formData.logging_prompt || undefined,
          is_open: formData.is_open,
          starts_at: new Date(formData.starts_at).toISOString(),
          ends_at: new Date(formData.ends_at).toISOString(),
          invite_user_ids: formData.invite_user_ids,
        }),
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error?.message || 'Failed to create challenge');

      toast.success('Challenge created! Let the competition begin.');
      onSuccess(result.data);
      onClose();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsCreating(false);
    }
  };

  const durationDays = Math.ceil(
    (new Date(formData.ends_at).getTime() - new Date(formData.starts_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  const canProceed = () => {
    switch (currentStep) {
      case 1: return true; // template selection handled by click
      case 2: return formData.name.length >= 3 && parseFloat(formData.goal_amount) > 0 && formData.unit.length > 0;
      case 3: return true; // invites are optional
      case 4: return true;
      default: return false;
    }
  };

  const resetWizard = () => {
    setCurrentStep(1);
    setFormData({
      template_id: null,
      name: '',
      description: '',
      category: 'strength',
      goal_amount: '',
      unit: 'reps',
      logging_prompt: '',
      is_open: true,
      starts_at: defaultStart,
      ends_at: defaultEnd,
      invite_user_ids: [],
    });
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          resetWizard();
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-[540px] bg-slate-900 border-slate-700 max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-indigo-400" />
            Create a Challenge
          </DialogTitle>
        </DialogHeader>

        {/* Progress Indicator */}
        <div className="flex items-center gap-1 mb-4">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-all ${
                i + 1 <= currentStep ? 'bg-indigo-500' : 'bg-slate-700'
              }`}
            />
          ))}
        </div>

        <AnimatePresence mode="wait">
          {/* Step 1: Choose Template */}
          {currentStep === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <h3 className="text-sm font-medium text-slate-400 mb-3">Choose a template to get started</h3>
              <ChallengeTemplateGrid
                onSelectTemplate={handleTemplateSelect}
                onStartFromScratch={handleStartFromScratch}
              />
            </motion.div>
          )}

          {/* Step 2: Configure */}
          {currentStep === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <h3 className="text-sm font-medium text-slate-400 mb-3">Configure your challenge</h3>

              <div>
                <Label className="text-slate-300">Challenge Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., 100 Squats Daily"
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                  maxLength={50}
                />
              </div>

              <div>
                <Label className="text-slate-300">Description (optional)</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="What's this challenge about?"
                  className="bg-slate-800 border-slate-700 text-white mt-1 h-16 resize-none"
                  maxLength={200}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-slate-300">Goal</Label>
                  <Input
                    type="number"
                    value={formData.goal_amount}
                    onChange={(e) => setFormData({ ...formData, goal_amount: e.target.value })}
                    placeholder="1000"
                    className="bg-slate-800 border-slate-700 text-white mt-1"
                    min={1}
                  />
                </div>
                <div>
                  <Label className="text-slate-300">Unit</Label>
                  <Input
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    placeholder="reps"
                    className="bg-slate-800 border-slate-700 text-white mt-1"
                    maxLength={20}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-slate-300">Start Date</Label>
                  <Input
                    type="date"
                    value={formData.starts_at}
                    onChange={(e) => setFormData({ ...formData, starts_at: e.target.value })}
                    className="bg-slate-800 border-slate-700 text-white mt-1"
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>
                <div>
                  <Label className="text-slate-300">End Date</Label>
                  <Input
                    type="date"
                    value={formData.ends_at}
                    onChange={(e) => setFormData({ ...formData, ends_at: e.target.value })}
                    className="bg-slate-800 border-slate-700 text-white mt-1"
                    min={formData.starts_at}
                  />
                </div>
              </div>

              {durationDays > 0 && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-indigo-400" />
                  <span className="text-slate-400">{durationDays}-day challenge</span>
                </div>
              )}

              <div>
                <Label className="text-slate-300">Logging Prompt (optional)</Label>
                <Input
                  value={formData.logging_prompt}
                  onChange={(e) => setFormData({ ...formData, logging_prompt: e.target.value })}
                  placeholder="How many reps did you do?"
                  className="bg-slate-800 border-slate-700 text-white mt-1"
                  maxLength={60}
                />
                <p className="text-xs text-slate-500 mt-1">Shown when participants log activity</p>
              </div>
            </motion.div>
          )}

          {/* Step 3: Invite Members */}
          {currentStep === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-slate-400">Invite circle members</h3>
                <div className="flex gap-2">
                  <button
                    onClick={selectAllMembers}
                    className="text-xs text-indigo-400 hover:text-indigo-300"
                  >
                    Select all
                  </button>
                  <button
                    onClick={deselectAllMembers}
                    className="text-xs text-slate-500 hover:text-slate-400"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800 border border-slate-700">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-slate-400" />
                  <span className="text-sm text-slate-300">Open to all circle members</span>
                </div>
                <button
                  onClick={() => setFormData({ ...formData, is_open: !formData.is_open })}
                  className={`w-10 h-5 rounded-full transition-all relative ${
                    formData.is_open ? 'bg-indigo-500' : 'bg-slate-600'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all ${
                      formData.is_open ? 'left-5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>

              {circleMembers.length > 0 ? (
                <div className="space-y-2 max-h-[250px] overflow-y-auto">
                  {circleMembers
                    .filter(m => m.user_id !== user?.id)
                    .map(member => (
                      <button
                        key={member.user_id}
                        onClick={() => toggleMemberInvite(member.user_id)}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all ${
                          formData.invite_user_ids.includes(member.user_id)
                            ? 'bg-indigo-500/20 border border-indigo-500/50'
                            : 'bg-slate-800 border border-slate-700 hover:border-slate-600'
                        }`}
                      >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-sm font-medium">
                          {member.avatar_url ? (
                            <img src={member.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            member.display_name?.[0]?.toUpperCase() || '?'
                          )}
                        </div>
                        <span className="text-sm text-white flex-1 text-left">{member.display_name}</span>
                        {formData.invite_user_ids.includes(member.user_id) && (
                          <CheckCircle2 className="w-5 h-5 text-indigo-400" />
                        )}
                      </button>
                    ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 text-center py-6">
                  No other members in this circle yet. Share the circle invite link to add friends!
                </p>
              )}

              <p className="text-xs text-slate-500">
                {formData.invite_user_ids.length} member{formData.invite_user_ids.length !== 1 ? 's' : ''} will be invited
              </p>
            </motion.div>
          )}

          {/* Step 4: Review & Launch */}
          {currentStep === 4 && (
            <motion.div
              key="step4"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <h3 className="text-sm font-medium text-slate-400 mb-3">Review your challenge</h3>

              <div className="rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 p-5 space-y-4">
                <div className="flex items-start gap-3">
                  {formData.template_id && (
                    <span className="text-3xl">
                      {getTemplateById(formData.template_id)?.icon || '⭐'}
                    </span>
                  )}
                  <div>
                    <h4 className="text-lg font-bold text-white">{formData.name}</h4>
                    {formData.description && (
                      <p className="text-sm text-slate-400 mt-1">{formData.description}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-slate-800/50 p-3">
                    <div className="text-xs text-slate-500 mb-1">Goal</div>
                    <div className="text-white font-semibold">
                      {parseFloat(formData.goal_amount).toLocaleString()} {formData.unit}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-800/50 p-3">
                    <div className="text-xs text-slate-500 mb-1">Duration</div>
                    <div className="text-white font-semibold">{durationDays} days</div>
                  </div>
                  <div className="rounded-lg bg-slate-800/50 p-3">
                    <div className="text-xs text-slate-500 mb-1">Starts</div>
                    <div className="text-white font-semibold">
                      {new Date(formData.starts_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-800/50 p-3">
                    <div className="text-xs text-slate-500 mb-1">Invited</div>
                    <div className="text-white font-semibold">
                      {formData.invite_user_ids.length + 1} members
                    </div>
                  </div>
                </div>

                {formData.is_open && (
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                    Open to all circle members
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Sparkles className="w-3 h-3" />
                <span>
                  {new Date(formData.starts_at) <= new Date()
                    ? 'Live immediately on launch'
                    : `Scheduled — launches ${new Date(formData.starts_at).toLocaleDateString()}`}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation */}
        {currentStep > 1 && (
          <div className="flex justify-between pt-4 border-t border-slate-700">
            <Button
              variant="ghost"
              onClick={() => setCurrentStep(currentStep - 1)}
              className="text-slate-400 hover:text-white"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </Button>

            {currentStep < TOTAL_STEPS ? (
              <Button
                onClick={() => setCurrentStep(currentStep + 1)}
                disabled={!canProceed()}
                className="bg-indigo-500 hover:bg-indigo-600 text-white"
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={handleCreate}
                disabled={isCreating}
                className="bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white px-6"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-2" />
                    Launch Challenge
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
