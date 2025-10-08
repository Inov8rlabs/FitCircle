'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  User,
  Target,
  Activity,
  Calendar,
  ChevronRight,
  ChevronLeft,
  Check,
  Scale,
  Ruler,
  CalendarDays,
  Loader2
} from 'lucide-react';
import Celebration from '@/components/Celebration';
import { useProfile } from '@/hooks/useProfile';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from 'sonner';

const steps = [
  {
    id: 'personal',
    title: 'Personal Information',
    description: 'Tell us a bit about yourself',
    icon: User,
  },
  {
    id: 'goals',
    title: 'Your Goals',
    description: 'What would you like to achieve?',
    icon: Target,
  },
  {
    id: 'activity',
    title: 'Activity Level',
    description: 'How active are you currently?',
    icon: Activity,
  },
  {
    id: 'preferences',
    title: 'Preferences',
    description: 'Customize your experience',
    icon: Calendar,
  }
];

const activityLevels = [
  { value: 'sedentary', label: 'Sedentary', description: 'Little to no exercise' },
  { value: 'light', label: 'Lightly Active', description: '1-3 days per week' },
  { value: 'moderate', label: 'Moderately Active', description: '3-5 days per week' },
  { value: 'very_active', label: 'Very Active', description: '6-7 days per week' },
];

const goals = [
  { value: 'weight_loss', label: 'Lose Weight', icon: Scale },
  { value: 'muscle_gain', label: 'Build Muscle', icon: Activity },
  { value: 'endurance', label: 'Improve Endurance', icon: Target },
  { value: 'health', label: 'General Health', icon: User },
];

function OnboardingForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnUrl = searchParams.get('returnUrl');
  const { user } = useAuthStore();
  const { updateProfile, isLoading } = useProfile();
  const [currentStep, setCurrentStep] = useState(0);
  const [showCelebration, setShowCelebration] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    // Personal
    displayName: '',
    dateOfBirth: '',
    height: '',
    weight: '',
    // Goals
    goals: [] as string[],
    targetWeight: '',
    targetDate: '',
    // Activity
    activityLevel: '',
    // Preferences
    units: 'metric',
    notifications: true,
    privacy: 'friends',
  });

  const progress = ((currentStep + 1) / steps.length) * 100;

  const handleNext = async () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // Complete onboarding - save to database
      setIsSaving(true);

      try {
        // Map activity level to fitness level
        const fitnessLevelMap: { [key: string]: 'beginner' | 'intermediate' | 'advanced' | 'expert' } = {
          'sedentary': 'beginner',
          'light': 'beginner',
          'moderate': 'intermediate',
          'very_active': 'advanced'
        };

        // Convert height and weight to numbers
        const heightValue = parseFloat(formData.height) || 0;
        const weightValue = parseFloat(formData.weight) || 0;

        const heightCm = formData.units === 'metric'
          ? heightValue
          : Math.round(heightValue * 2.54); // Convert inches to cm

        const weightKg = formData.units === 'metric'
          ? weightValue
          : Math.round(weightValue * 0.453592 * 100) / 100; // Convert lbs to kg

        const profileData = {
          display_name: formData.displayName,
          date_of_birth: formData.dateOfBirth,
          height_cm: heightCm,
          weight_kg: weightKg,
          goals: formData.goals,
          fitness_level: fitnessLevelMap[formData.activityLevel] || 'beginner',
          preferences: {
            units: {
              weight: formData.units === 'metric' ? 'kg' as const : 'lbs' as const,
              height: formData.units === 'metric' ? 'cm' as const : 'inches' as const,
            },
            privacy: {
              profileVisibility: formData.privacy as 'public' | 'friends' | 'private',
            },
          },
          onboarding_completed: true,
        };

        const success = await updateProfile(profileData);

        if (success) {
          setShowCelebration(true);
        } else {
          toast.error('Failed to save profile. Please try again.');
          setIsSaving(false);
        }
      } catch (error) {
        console.error('Error saving profile:', error);
        toast.error('An error occurred. Please try again.');
        setIsSaving(false);
      }
    }
  };

  const handleCelebrationComplete = () => {
    // Redirect to returnUrl if provided (e.g., from invite link), otherwise go to dashboard
    if (returnUrl) {
      router.push(returnUrl);
    } else {
      router.push('/dashboard');
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const updateFormData = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const toggleGoal = (goal: string) => {
    setFormData(prev => ({
      ...prev,
      goals: prev.goals.includes(goal)
        ? prev.goals.filter(g => g !== goal)
        : [...prev.goals, goal]
    }));
  };

  return (
    <>
      {showCelebration && (
        <Celebration
          onComplete={handleCelebrationComplete}
          userName={formData.displayName || user?.name || 'Champion'}
        />
      )}
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
        {/* Progress Bar */}
        <div className="mb-8">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between mt-2">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className={`flex items-center ${
                  index <= currentStep ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${
                    index < currentStep
                      ? 'bg-primary border-primary text-primary-foreground'
                      : index === currentStep
                      ? 'border-primary'
                      : 'border-muted-foreground'
                  }`}
                >
                  {index < currentStep ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <span className="text-xs">{index + 1}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  {(() => {
                    const Icon = steps[currentStep].icon;
                    return <Icon className="w-8 h-8 text-primary" />;
                  })()}
                  <div>
                    <CardTitle>{steps[currentStep].title}</CardTitle>
                    <CardDescription>{steps[currentStep].description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Step 1: Personal Information */}
                {currentStep === 0 && (
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Display Name</label>
                      <Input
                        placeholder="How should we call you?"
                        value={formData.displayName}
                        onChange={(e) => updateFormData('displayName', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-2 block">Date of Birth</label>
                      <Input
                        type="date"
                        value={formData.dateOfBirth}
                        onChange={(e) => updateFormData('dateOfBirth', e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">
                          Height (cm)
                        </label>
                        <div className="relative">
                          <Ruler className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            type="number"
                            placeholder="170"
                            className="pl-10"
                            value={formData.height}
                            onChange={(e) => updateFormData('height', e.target.value)}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-2 block">
                          Weight (kg)
                        </label>
                        <div className="relative">
                          <Scale className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                          <Input
                            type="number"
                            placeholder="70"
                            className="pl-10"
                            value={formData.weight}
                            onChange={(e) => updateFormData('weight', e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 2: Goals */}
                {currentStep === 1 && (
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-3 block">Select Your Goals</label>
                      <div className="grid grid-cols-2 gap-3">
                        {goals.map((goal) => {
                          const Icon = goal.icon;
                          const isSelected = formData.goals.includes(goal.value);
                          return (
                            <button
                              key={goal.value}
                              onClick={() => toggleGoal(goal.value)}
                              className={`p-4 rounded-lg border-2 transition-all ${
                                isSelected
                                  ? 'border-primary bg-primary/10'
                                  : 'border-border hover:border-primary/50'
                              }`}
                            >
                              <Icon className={`w-6 h-6 mb-2 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                              <p className={`text-sm font-medium ${isSelected ? 'text-primary' : ''}`}>
                                {goal.label}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">
                          Target Weight (kg)
                        </label>
                        <Input
                          type="number"
                          placeholder="65"
                          value={formData.targetWeight}
                          onChange={(e) => updateFormData('targetWeight', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-2 block">
                          Target Date
                        </label>
                        <Input
                          type="date"
                          value={formData.targetDate}
                          onChange={(e) => updateFormData('targetDate', e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 3: Activity Level */}
                {currentStep === 2 && (
                  <div className="space-y-4">
                    <label className="text-sm font-medium block">How active are you?</label>
                    <div className="space-y-3">
                      {activityLevels.map((level) => (
                        <button
                          key={level.value}
                          onClick={() => updateFormData('activityLevel', level.value)}
                          className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
                            formData.activityLevel === level.value
                              ? 'border-primary bg-primary/10'
                              : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <p className={`font-medium ${
                            formData.activityLevel === level.value ? 'text-primary' : ''
                          }`}>
                            {level.label}
                          </p>
                          <p className="text-sm text-muted-foreground">{level.description}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step 4: Preferences */}
                {currentStep === 3 && (
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-3 block">Measurement Units</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => updateFormData('units', 'metric')}
                          className={`p-3 rounded-lg border-2 ${
                            formData.units === 'metric'
                              ? 'border-primary bg-primary/10'
                              : 'border-border'
                          }`}
                        >
                          <p className={formData.units === 'metric' ? 'text-primary font-medium' : ''}>
                            Metric (kg, cm)
                          </p>
                        </button>
                        <button
                          onClick={() => updateFormData('units', 'imperial')}
                          className={`p-3 rounded-lg border-2 ${
                            formData.units === 'imperial'
                              ? 'border-primary bg-primary/10'
                              : 'border-border'
                          }`}
                        >
                          <p className={formData.units === 'imperial' ? 'text-primary font-medium' : ''}>
                            Imperial (lbs, ft)
                          </p>
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-3 block">Privacy Settings</label>
                      <div className="space-y-2">
                        {[
                          { value: 'public', label: 'Public', description: 'Everyone can see your progress' },
                          { value: 'friends', label: 'Friends Only', description: 'Only friends can see your progress' },
                          { value: 'private', label: 'Private', description: 'Only you can see your progress' },
                        ].map((option) => (
                          <button
                            key={option.value}
                            onClick={() => updateFormData('privacy', option.value)}
                            className={`w-full p-3 rounded-lg border-2 text-left ${
                              formData.privacy === option.value
                                ? 'border-primary bg-primary/10'
                                : 'border-border'
                            }`}
                          >
                            <p className={`text-sm font-medium ${
                              formData.privacy === option.value ? 'text-primary' : ''
                            }`}>
                              {option.label}
                            </p>
                            <p className="text-xs text-muted-foreground">{option.description}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </AnimatePresence>

        {/* Navigation Buttons */}
        <div className="flex justify-between mt-6">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 0}
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <Button onClick={handleNext} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                {currentStep === steps.length - 1 ? 'Complete' : 'Next'}
                <ChevronRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
    </>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <OnboardingForm />
    </Suspense>
  );
}