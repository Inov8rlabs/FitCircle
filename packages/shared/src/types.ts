/**
 * Core TypeScript types for FitCircle
 */

// User and Profile Types
export interface Profile {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  bio?: string;
  dateOfBirth?: Date;
  heightCm?: number;
  weightKg?: number;
  timezone: string;
  countryCode?: string;
  phoneNumber?: string;
  phoneVerified: boolean;
  onboardingCompleted: boolean;
  fitnessLevel?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  goals: string[];
  preferences: UserPreferences;
  healthDataSync: HealthDataSync;
  stripeCustomerId?: string;
  subscriptionTier: 'free' | 'premium' | 'enterprise';
  subscriptionStatus?: SubscriptionStatus;
  subscriptionExpiresAt?: Date;
  totalPoints: number;
  currentStreak: number;
  longestStreak: number;
  challengesCompleted: number;
  challengesWon: number;
  metadata: Record<string, any>;
  isActive: boolean;
  lastActiveAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPreferences {
  notifications: {
    push: boolean;
    email: boolean;
    sms: boolean;
    challengeInvite: boolean;
    teamInvite: boolean;
    checkInReminder: boolean;
    achievement: boolean;
    comment: boolean;
    reaction: boolean;
    leaderboardUpdate: boolean;
    weeklyInsights: boolean;
  };
  privacy: {
    profileVisibility: 'public' | 'friends' | 'private';
    showWeight: boolean;
    showProgress: boolean;
    allowTeamInvites: boolean;
    allowChallengeInvites: boolean;
  };
  display: {
    theme: 'light' | 'dark' | 'system';
    language: string;
    units: 'metric' | 'imperial';
  };
}

export interface HealthDataSync {
  appleHealth?: {
    enabled: boolean;
    lastSync?: Date;
    permissions: string[];
  };
  googleFit?: {
    enabled: boolean;
    lastSync?: Date;
    permissions: string[];
  };
  fitbit?: {
    enabled: boolean;
    lastSync?: Date;
    accessToken?: string;
  };
  garmin?: {
    enabled: boolean;
    lastSync?: Date;
    credentials?: Record<string, any>;
  };
}

// Challenge Types
export type ChallengeStatus = 'draft' | 'upcoming' | 'active' | 'completed' | 'cancelled';
export type ChallengeType = 'weight_loss' | 'step_count' | 'workout_minutes' | 'custom';
export type ChallengeVisibility = 'public' | 'private' | 'invite_only';

export interface Challenge {
  id: string;
  creatorId: string;
  name: string;
  description?: string;
  type: ChallengeType;
  status: ChallengeStatus;
  visibility: ChallengeVisibility;
  rules: ChallengeRules;
  scoringSystem: ScoringSystem;
  startDate: Date;
  endDate: Date;
  registrationDeadline: Date;
  entryFee: number;
  prizePool: number;
  prizeDistribution: PrizeDistribution[];
  minParticipants: number;
  maxParticipants?: number;
  minTeamSize: number;
  maxTeamSize?: number;
  allowLateJoin: boolean;
  lateJoinPenalty: number;
  coverImageUrl?: string;
  badgeImageUrl?: string;
  tags: string[];
  location?: { lat: number; lng: number };
  locationName?: string;
  isFeatured: boolean;
  sponsorInfo?: SponsorInfo;
  customFields: Record<string, any>;
  participantCount: number;
  teamCount: number;
  totalCheckIns: number;
  avgProgress: number;
  completionRate: number;
  engagementScore: number;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChallengeRules {
  checkInFrequency: 'daily' | 'weekly' | 'flexible';
  requiredMetrics: string[];
  minWeightLoss?: number;
  maxWeightLoss?: number;
  rules: string[];
  penalties?: {
    missedCheckIn?: number;
    lateCheckIn?: number;
    invalidData?: number;
  };
}

export interface ScoringSystem {
  checkIn: number;
  streakBonus: number;
  photoBonus: number;
  milestones: Record<string, number>;
  teamBonusMultiplier?: number;
  customPoints?: Record<string, number>;
}

export interface PrizeDistribution {
  position: number;
  amount: number;
  type: 'cash' | 'points' | 'merchandise' | 'other';
  description?: string;
}

export interface SponsorInfo {
  name: string;
  logoUrl?: string;
  website?: string;
  description?: string;
}

// Team Types
export type TeamRole = 'captain' | 'member';

export interface Team {
  id: string;
  challengeId: string;
  name: string;
  motto?: string;
  avatarUrl?: string;
  isPublic: boolean;
  maxMembers: number;
  memberCount: number;
  totalPoints: number;
  rank?: number;
  inviteCode: string;
  settings: TeamSettings;
  stats: TeamStats;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamSettings {
  autoAcceptMembers: boolean;
  requireApproval: boolean;
  minActivityLevel?: number;
  notifications: {
    newMember: boolean;
    memberCheckIn: boolean;
    rankChange: boolean;
  };
}

export interface TeamStats {
  avgProgress: number;
  totalWeightLost: number;
  totalSteps: number;
  totalMinutes: number;
  avgStreak: number;
  memberActivity: Record<string, number>;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  joinedAt: Date;
  pointsContributed: number;
  checkInsCount: number;
  lastCheckInAt?: Date;
  isActive: boolean;
  removedAt?: Date;
  removedBy?: string;
  removalReason?: string;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

// Participant Types
export type ParticipantStatus = 'pending' | 'active' | 'completed' | 'dropped' | 'disqualified';

export interface ChallengeParticipant {
  id: string;
  challengeId: string;
  userId: string;
  teamId?: string;
  status: ParticipantStatus;
  joinedAt: Date;
  completedAt?: Date;
  droppedAt?: Date;
  disqualifiedAt?: Date;
  disqualificationReason?: string;
  startingWeightKg?: number;
  currentWeightKg?: number;
  goalWeightKg?: number;
  startingValue?: number;
  currentValue?: number;
  goalValue?: number;
  progressPercentage: number;
  totalPoints: number;
  rank?: number;
  checkInsCount: number;
  streakDays: number;
  missedCheckIns: number;
  lastCheckInAt?: Date;
  achievements: string[];
  stats: ParticipantStats;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParticipantStats {
  avgDailySteps?: number;
  avgDailyMinutes?: number;
  bestStreak: number;
  completionRate: number;
  weeklyProgress: number[];
}

// Check-in Types
export type CheckInSource = 'manual' | 'apple_health' | 'google_fit' | 'fitbit' | 'garmin' | 'api';
export type VerificationStatus = 'pending' | 'verified' | 'flagged' | 'rejected';

export interface CheckIn {
  id: string;
  userId: string;
  challengeId: string;
  participantId: string;
  teamId?: string;
  checkInDate: Date;
  weightKg?: number;
  bodyFatPercentage?: number;
  muscleMassKg?: number;
  waterPercentage?: number;
  steps?: number;
  activeMinutes?: number;
  caloriesBurned?: number;
  distanceKm?: number;
  floorsClimbed?: number;
  sleepHours?: number;
  waterIntakeMl?: number;
  moodScore?: number;
  energyLevel?: number;
  notes?: string;
  photoUrls: string[];
  measurements: BodyMeasurements;
  workouts: Workout[];
  nutrition: NutritionData;
  customMetrics: Record<string, any>;
  pointsEarned: number;
  verificationStatus: VerificationStatus;
  verifiedBy?: string;
  verifiedAt?: Date;
  verificationNotes?: string;
  isValid: boolean;
  source: CheckInSource;
  deviceData?: Record<string, any>;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface BodyMeasurements {
  chest?: number;
  waist?: number;
  hips?: number;
  thighs?: number;
  arms?: number;
  neck?: number;
}

export interface Workout {
  type: string;
  duration: number;
  intensity: 'low' | 'moderate' | 'high';
  caloriesBurned?: number;
  notes?: string;
}

export interface NutritionData {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  water?: number;
}

// Leaderboard Types
export type EntityType = 'individual' | 'team';
export type Trend = 'up' | 'down' | 'stable';

export interface LeaderboardEntry {
  id: string;
  challengeId: string;
  entityId: string;
  entityType: EntityType;
  rank: number;
  previousRank?: number;
  points: number;
  progressPercentage: number;
  weightLostKg?: number;
  weightLostPercentage?: number;
  totalSteps: number;
  totalMinutes: number;
  checkInsCount: number;
  streakDays: number;
  lastCheckInAt?: Date;
  trend: Trend;
  stats: Record<string, any>;
  calculatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Notification Types
export type NotificationType =
  | 'challenge_invite'
  | 'team_invite'
  | 'check_in_reminder'
  | 'achievement'
  | 'comment'
  | 'reaction'
  | 'leaderboard_update'
  | 'system';

export type NotificationChannel = 'push' | 'email' | 'sms' | 'in_app';
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  body: string;
  actionUrl?: string;
  actionData?: Record<string, any>;
  priority: NotificationPriority;
  senderId?: string;
  relatedChallengeId?: string;
  relatedTeamId?: string;
  relatedUserId?: string;
  isRead: boolean;
  readAt?: Date;
  isArchived: boolean;
  archivedAt?: Date;
  sentAt?: Date;
  deliveredAt?: Date;
  clickedAt?: Date;
  errorMessage?: string;
  retryCount: number;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

// Social Features Types
export type ReactionType = 'like' | 'love' | 'celebrate' | 'fire' | 'muscle' | 'trophy';

export interface Comment {
  id: string;
  userId: string;
  parentId?: string;
  entityType: 'check_in' | 'challenge' | 'team' | 'achievement';
  entityId: string;
  content: string;
  mentions: string[];
  isEdited: boolean;
  editedAt?: Date;
  isDeleted: boolean;
  deletedAt?: Date;
  deletedBy?: string;
  reactionsCount: number;
  repliesCount: number;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Reaction {
  id: string;
  userId: string;
  entityType: 'check_in' | 'comment' | 'achievement';
  entityId: string;
  type: ReactionType;
  createdAt: Date;
}

// Payment Types
export type PaymentStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'refunded';
export type PaymentType = 'entry_fee' | 'subscription' | 'donation' | 'prize' | 'refund';
export type SubscriptionStatus = 'trialing' | 'active' | 'cancelled' | 'past_due' | 'unpaid' | 'incomplete';

export interface Payment {
  id: string;
  userId: string;
  challengeId?: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  type: PaymentType;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  stripeRefundId?: string;
  paymentMethod?: string;
  paymentMethodDetails?: Record<string, any>;
  description?: string;
  receiptUrl?: string;
  failureReason?: string;
  refundedAmount: number;
  feeAmount: number;
  netAmount?: number;
  taxAmount: number;
  processedAt?: Date;
  failedAt?: Date;
  refundedAt?: Date;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

// Achievement Types
export type AchievementType = 'milestone' | 'streak' | 'ranking' | 'participation' | 'special';

export interface Achievement {
  id: string;
  userId: string;
  challengeId?: string;
  type: AchievementType;
  name: string;
  description?: string;
  iconUrl?: string;
  badgeUrl?: string;
  points: number;
  level: number;
  unlockedAt: Date;
  progress: number;
  criteria: Record<string, any>;
  metadata: Record<string, any>;
  shared: boolean;
  sharedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// API Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
  timestamp: Date;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface FilterParams {
  search?: string;
  status?: string;
  type?: string;
  startDate?: Date;
  endDate?: Date;
  tags?: string[];
  [key: string]: any;
}

// JWT Token Types
export interface JWTPayload {
  sub: string; // user id
  email: string;
  role?: string;
  permissions?: string[];
  iat: number;
  exp: number;
  jti?: string; // JWT ID for token blacklisting
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}