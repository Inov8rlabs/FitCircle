/**
 * Zod validation schemas for FitCircle
 */

import { z } from 'zod';

// Common schemas
export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

// Auth schemas
export const signUpSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  displayName: z.string().min(1, 'Display name is required').max(50),
  acceptTerms: z.boolean().refine(val => val === true, 'You must accept the terms'),
});

export const signInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine(data => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

// Profile schemas
export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(500).optional(),
  dateOfBirth: z.string().datetime().optional(),
  heightCm: z.number().min(50).max(300).optional(),
  weightKg: z.number().min(20).max(500).optional(),
  timezone: z.string().optional(),
  countryCode: z.string().length(2).optional(),
  phoneNumber: z.string().optional(),
  fitnessLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
  goals: z.array(z.string()).optional(),
  preferences: z.object({
    notifications: z.object({
      push: z.boolean(),
      email: z.boolean(),
      sms: z.boolean(),
      challengeInvite: z.boolean(),
      teamInvite: z.boolean(),
      checkInReminder: z.boolean(),
      achievement: z.boolean(),
      comment: z.boolean(),
      reaction: z.boolean(),
      leaderboardUpdate: z.boolean(),
      weeklyInsights: z.boolean(),
    }).partial().optional(),
    privacy: z.object({
      profileVisibility: z.enum(['public', 'friends', 'private']),
      showWeight: z.boolean(),
      showProgress: z.boolean(),
      allowTeamInvites: z.boolean(),
      allowChallengeInvites: z.boolean(),
    }).partial().optional(),
    display: z.object({
      theme: z.enum(['light', 'dark', 'system']),
      language: z.string(),
      units: z.enum(['metric', 'imperial']),
    }).partial().optional(),
  }).optional(),
});

// Challenge schemas
export const createChallengeSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(100),
  description: z.string().max(1000).optional(),
  type: z.enum(['weight_loss', 'step_count', 'workout_minutes', 'custom']),
  visibility: z.enum(['public', 'private', 'invite_only']).default('public'),
  rules: z.object({
    checkInFrequency: z.enum(['daily', 'weekly', 'flexible']).default('daily'),
    requiredMetrics: z.array(z.string()).min(1),
    minWeightLoss: z.number().optional(),
    maxWeightLoss: z.number().optional(),
    rules: z.array(z.string()),
    penalties: z.object({
      missedCheckIn: z.number().optional(),
      lateCheckIn: z.number().optional(),
      invalidData: z.number().optional(),
    }).optional(),
  }),
  scoringSystem: z.object({
    checkIn: z.number().default(10),
    streakBonus: z.number().default(2),
    photoBonus: z.number().default(5),
    milestones: z.record(z.string(), z.number()).optional(),
    teamBonusMultiplier: z.number().optional(),
    customPoints: z.record(z.string(), z.number()).optional(),
  }),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  registrationDeadline: z.string().datetime(),
  entryFee: z.number().min(0).default(0),
  prizePool: z.number().min(0).default(0),
  prizeDistribution: z.array(z.object({
    position: z.number().min(1),
    amount: z.number().min(0),
    type: z.enum(['cash', 'points', 'merchandise', 'other']),
    description: z.string().optional(),
  })).optional(),
  minParticipants: z.number().min(1).default(2),
  maxParticipants: z.number().min(1).optional(),
  minTeamSize: z.number().min(1).default(1),
  maxTeamSize: z.number().min(1).optional(),
  allowLateJoin: z.boolean().default(false),
  lateJoinPenalty: z.number().min(0).default(0),
  tags: z.array(z.string()).optional(),
  locationName: z.string().optional(),
  sponsorInfo: z.object({
    name: z.string(),
    logoUrl: z.string().url().optional(),
    website: z.string().url().optional(),
    description: z.string().optional(),
  }).optional(),
}).refine(data => new Date(data.endDate) > new Date(data.startDate), {
  message: 'End date must be after start date',
  path: ['endDate'],
}).refine(data => new Date(data.registrationDeadline) <= new Date(data.startDate), {
  message: 'Registration deadline must be before or on start date',
  path: ['registrationDeadline'],
});

export const updateChallengeSchema = createChallengeSchema.partial();

export const joinChallengeSchema = z.object({
  challengeId: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  startingWeight: z.number().optional(),
  goalWeight: z.number().optional(),
  customGoals: z.record(z.string(), z.any()).optional(),
});

// Team schemas
export const createTeamSchema = z.object({
  challengeId: z.string().uuid(),
  name: z.string().min(2, 'Team name must be at least 2 characters').max(50),
  motto: z.string().max(100).optional(),
  isPublic: z.boolean().default(true),
  maxMembers: z.number().min(2).max(50).default(10),
  settings: z.object({
    autoAcceptMembers: z.boolean().default(false),
    requireApproval: z.boolean().default(true),
    minActivityLevel: z.number().min(0).max(100).optional(),
    notifications: z.object({
      newMember: z.boolean().default(true),
      memberCheckIn: z.boolean().default(true),
      rankChange: z.boolean().default(true),
    }).optional(),
  }).optional(),
});

export const updateTeamSchema = createTeamSchema.omit({ challengeId: true }).partial();

export const joinTeamSchema = z.object({
  teamId: z.string().uuid().optional(),
  inviteCode: z.string().optional(),
}).refine(data => data.teamId || data.inviteCode, {
  message: 'Either teamId or inviteCode is required',
});

// Check-in schemas
export const createCheckInSchema = z.object({
  challengeId: z.string().uuid(),
  checkInDate: z.string().datetime().optional(),
  weightKg: z.number().min(20).max(500).optional(),
  bodyFatPercentage: z.number().min(0).max(100).optional(),
  muscleMassKg: z.number().min(0).max(200).optional(),
  waterPercentage: z.number().min(0).max(100).optional(),
  steps: z.number().min(0).optional(),
  activeMinutes: z.number().min(0).max(1440).optional(),
  caloriesBurned: z.number().min(0).optional(),
  distanceKm: z.number().min(0).optional(),
  floorsClimbed: z.number().min(0).optional(),
  sleepHours: z.number().min(0).max(24).optional(),
  waterIntakeMl: z.number().min(0).optional(),
  moodScore: z.number().min(1).max(10).optional(),
  energyLevel: z.number().min(1).max(10).optional(),
  notes: z.string().max(1000).optional(),
  measurements: z.object({
    chest: z.number().optional(),
    waist: z.number().optional(),
    hips: z.number().optional(),
    thighs: z.number().optional(),
    arms: z.number().optional(),
    neck: z.number().optional(),
  }).optional(),
  workouts: z.array(z.object({
    type: z.string(),
    duration: z.number().min(0),
    intensity: z.enum(['low', 'moderate', 'high']),
    caloriesBurned: z.number().min(0).optional(),
    notes: z.string().optional(),
  })).optional(),
  nutrition: z.object({
    calories: z.number().min(0).optional(),
    protein: z.number().min(0).optional(),
    carbs: z.number().min(0).optional(),
    fat: z.number().min(0).optional(),
    fiber: z.number().min(0).optional(),
    sugar: z.number().min(0).optional(),
    sodium: z.number().min(0).optional(),
    water: z.number().min(0).optional(),
  }).optional(),
  customMetrics: z.record(z.string(), z.any()).optional(),
});

export const updateCheckInSchema = createCheckInSchema.omit({ challengeId: true }).partial();

// Comment schemas
export const createCommentSchema = z.object({
  entityType: z.enum(['check_in', 'challenge', 'team', 'achievement']),
  entityId: z.string().uuid(),
  content: z.string().min(1, 'Comment cannot be empty').max(1000),
  parentId: z.string().uuid().optional(),
  mentions: z.array(z.string().uuid()).optional(),
});

export const updateCommentSchema = z.object({
  content: z.string().min(1, 'Comment cannot be empty').max(1000),
});

// Reaction schemas
export const createReactionSchema = z.object({
  entityType: z.enum(['check_in', 'comment', 'achievement']),
  entityId: z.string().uuid(),
  type: z.enum(['like', 'love', 'celebrate', 'fire', 'muscle', 'trophy']),
});

// Payment schemas
export const createPaymentIntentSchema = z.object({
  amount: z.number().min(0.5, 'Minimum amount is $0.50'),
  currency: z.string().default('usd'),
  type: z.enum(['entry_fee', 'subscription', 'donation']),
  challengeId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const confirmPaymentSchema = z.object({
  paymentIntentId: z.string(),
  paymentMethodId: z.string().optional(),
});

// Notification schemas
export const sendNotificationSchema = z.object({
  userId: z.string().uuid().optional(),
  userIds: z.array(z.string().uuid()).optional(),
  type: z.enum([
    'challenge_invite',
    'team_invite',
    'check_in_reminder',
    'achievement',
    'comment',
    'reaction',
    'leaderboard_update',
    'system',
  ]),
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
  data: z.record(z.string(), z.any()).optional(),
  channels: z.array(z.enum(['push', 'email', 'sms', 'in_app'])).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  scheduledFor: z.string().datetime().optional(),
}).refine(data => data.userId || data.userIds, {
  message: 'Either userId or userIds is required',
});

// AI Coach schemas
export const aiCoachMessageSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').max(1000),
  context: z.object({
    challengeId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    conversationId: z.string().uuid().optional(),
  }).optional(),
  stream: z.boolean().default(false),
});

// Search and filter schemas
export const searchChallengesSchema = z.object({
  search: z.string().optional(),
  type: z.enum(['weight_loss', 'step_count', 'workout_minutes', 'custom']).optional(),
  status: z.enum(['draft', 'upcoming', 'active', 'completed', 'cancelled']).optional(),
  visibility: z.enum(['public', 'private', 'invite_only']).optional(),
  tags: z.array(z.string()).optional(),
  minEntryFee: z.number().optional(),
  maxEntryFee: z.number().optional(),
  startDateFrom: z.string().datetime().optional(),
  startDateTo: z.string().datetime().optional(),
  ...paginationSchema.shape,
});

export const searchUsersSchema = z.object({
  search: z.string().optional(),
  fitnessLevel: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).optional(),
  subscriptionTier: z.enum(['free', 'premium', 'enterprise']).optional(),
  isActive: z.boolean().optional(),
  ...paginationSchema.shape,
});

// Health data sync schemas
export const syncHealthDataSchema = z.object({
  provider: z.enum(['apple_health', 'google_fit', 'fitbit', 'garmin']),
  data: z.object({
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    metrics: z.array(z.string()),
    accessToken: z.string().optional(),
  }),
});

// Export all schemas
export const schemas = {
  // Auth
  signUp: signUpSchema,
  signIn: signInSchema,
  resetPassword: resetPasswordSchema,
  updatePassword: updatePasswordSchema,

  // Profile
  updateProfile: updateProfileSchema,

  // Challenge
  createChallenge: createChallengeSchema,
  updateChallenge: updateChallengeSchema,
  joinChallenge: joinChallengeSchema,

  // Team
  createTeam: createTeamSchema,
  updateTeam: updateTeamSchema,
  joinTeam: joinTeamSchema,

  // Check-in
  createCheckIn: createCheckInSchema,
  updateCheckIn: updateCheckInSchema,

  // Social
  createComment: createCommentSchema,
  updateComment: updateCommentSchema,
  createReaction: createReactionSchema,

  // Payment
  createPaymentIntent: createPaymentIntentSchema,
  confirmPayment: confirmPaymentSchema,

  // Notification
  sendNotification: sendNotificationSchema,

  // AI
  aiCoachMessage: aiCoachMessageSchema,

  // Search
  searchChallenges: searchChallengesSchema,
  searchUsers: searchUsersSchema,

  // Health
  syncHealthData: syncHealthDataSchema,

  // Common
  pagination: paginationSchema,
  dateRange: dateRangeSchema,
};