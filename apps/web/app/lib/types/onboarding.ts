import { z } from 'zod';

// ============================================================================
// ENUMS
// ============================================================================

export const PersonaType = z.enum(['casey', 'sarah', 'mike', 'fiona']);
export type PersonaType = z.infer<typeof PersonaType>;

export const FitnessLevel = z.enum(['beginner', 'intermediate', 'advanced', 'athlete']);
export type FitnessLevel = z.infer<typeof FitnessLevel>;

export const TimeCommitment = z.enum(['15-30', '30-60', '60+', 'flexible']);
export type TimeCommitment = z.infer<typeof TimeCommitment>;

export const GoalType = z.enum(['weight', 'steps', 'workout_frequency', 'habit', 'custom']);
export type GoalType = z.infer<typeof GoalType>;

export const GoalStatus = z.enum(['active', 'completed', 'abandoned', 'paused']);
export type GoalStatus = z.infer<typeof GoalStatus>;

// ============================================================================
// QUESTIONNAIRE
// ============================================================================

export const QuestionnaireAnswersSchema = z.object({
  primaryGoal: z.enum(['lose_weight', 'get_stronger', 'stay_accountable', 'stay_active']),
  motivationStyle: z.enum(['competition', 'community', 'progress_tracking', 'rewards']),
  fitnessLevel: FitnessLevel,
  timeCommitment: TimeCommitment,
});

export type QuestionnaireAnswers = z.infer<typeof QuestionnaireAnswersSchema>;

export const PersonaScoresSchema = z.object({
  casey: z.number().min(0).max(10),
  sarah: z.number().min(0).max(10),
  mike: z.number().min(0).max(10),
  fiona: z.number().min(0).max(10),
});

export type PersonaScores = z.infer<typeof PersonaScoresSchema>;

export const PersonaResultSchema = z.object({
  primary: PersonaType,
  secondary: PersonaType.optional(),
  scores: PersonaScoresSchema,
  description: z.string(),
  recommendations: z.array(z.string()),
});

export type PersonaResult = z.infer<typeof PersonaResultSchema>;

// ============================================================================
// PROFILE
// ============================================================================

export const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores')
    .optional(),
  avatarUrl: z.string().url().optional(),
  bio: z.string().max(500).optional(),
  persona: PersonaType.optional(),
  fitnessLevel: FitnessLevel.optional(),
  timeCommitment: TimeCommitment.optional(),
});

export type UpdateProfileData = z.infer<typeof UpdateProfileSchema>;

// ============================================================================
// GOALS
// ============================================================================

export const CreateGoalSchema = z.object({
  goalType: GoalType,
  goalName: z.string().min(1).max(100),
  goalDescription: z.string().max(500).optional(),
  currentValue: z.number().optional(),
  targetValue: z.number(),
  startValue: z.number().optional(),
  targetDate: z.string().optional(), // ISO date string
  metadata: z.record(z.any()).optional(),
});

export type CreateGoalData = z.infer<typeof CreateGoalSchema>;

export const CreateGoalsSchema = z.object({
  weightGoal: z
    .object({
      currentWeight: z.number().positive(),
      targetWeight: z.number().positive(),
      targetDate: z.string().optional(),
      unit: z.enum(['kg', 'lbs']).default('lbs'),
    })
    .optional(),
  stepsGoal: z
    .object({
      dailySteps: z.number().int().positive(),
    })
    .optional(),
  workoutFrequency: z
    .object({
      daysPerWeek: z.number().int().min(1).max(7),
      minutesPerDay: z.number().int().positive(),
    })
    .optional(),
  customGoals: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        targetValue: z.number(),
        unit: z.string().optional(),
      })
    )
    .optional(),
});

export type CreateGoalsData = z.infer<typeof CreateGoalsSchema>;

export interface UserGoal {
  id: string;
  userId: string;
  goalType: GoalType;
  goalName: string;
  goalDescription: string | null;
  currentValue: number | null;
  targetValue: number;
  startValue: number | null;
  targetDate: string | null;
  createdDate: string;
  status: GoalStatus;
  progressPercentage: number;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

// ============================================================================
// FIRST CHECK-IN
// ============================================================================

export const FirstCheckInSchema = z.object({
  weight: z.number().positive().optional(),
  height: z.number().positive().optional(),
  measurements: z
    .object({
      chest: z.number().positive().optional(),
      waist: z.number().positive().optional(),
      hips: z.number().positive().optional(),
      arms: z.number().positive().optional(),
      thighs: z.number().positive().optional(),
    })
    .optional(),
  mood: z.number().int().min(1).max(5).optional(),
  energy: z.number().int().min(1).max(5).optional(),
  notes: z.string().max(1000).optional(),
  unit: z.enum(['kg', 'lbs']).default('lbs'),
});

export type FirstCheckInData = z.infer<typeof FirstCheckInSchema>;

// ============================================================================
// ONBOARDING PROGRESS
// ============================================================================

export const SaveProgressSchema = z.object({
  currentStep: z.number().int().min(0).max(20),
  completedSteps: z.array(z.number().int()).optional(),
  questionnaireAnswers: QuestionnaireAnswersSchema.partial().optional(),
  personaScores: PersonaScoresSchema.optional(),
  detectedPersona: PersonaType.optional(),
  goalsData: z.record(z.any()).optional(),
  firstCheckinData: z.record(z.any()).optional(),
});

export type SaveProgressData = z.infer<typeof SaveProgressSchema>;

export interface OnboardingProgress {
  id: string;
  userId: string;
  currentStep: number;
  completedSteps: number[];
  isComplete: boolean;
  questionnaireAnswers: Partial<QuestionnaireAnswers>;
  personaScores: PersonaScores | null;
  detectedPersona: PersonaType | null;
  detectedPersonaSecondary: PersonaType | null;
  goalsData: Record<string, any>;
  firstCheckinData: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

// ============================================================================
// ONBOARDING COMPLETION
// ============================================================================

export interface OnboardingCompletionResult {
  success: boolean;
  user: {
    id: string;
    displayName: string;
    persona: PersonaType;
    totalXp: number;
    currentLevel: number;
  };
  achievement: {
    id: string;
    name: string;
    description: string;
    xpAwarded: number;
  };
  goals: UserGoal[];
}

// ============================================================================
// CHALLENGE DISCOVERY
// ============================================================================

export interface BeginnerChallenge {
  id: string;
  name: string;
  description: string;
  type: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  duration: number; // days
  participantCount: number;
  entryFee: number;
  prizePool: number;
  startDate: string;
  coverImageUrl: string | null;
  tags: string[];
  isRecommended: boolean;
  recommendationReason: string | null;
}
