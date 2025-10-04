/**
 * Shared constants for FitCircle
 */

// API Configuration
export const API_VERSION = 'v1';
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://fitcircle.app/api';

// Pagination
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// Auth
export const JWT_EXPIRES_IN = '15m';
export const REFRESH_TOKEN_EXPIRES_IN = '7d';
export const PASSWORD_MIN_LENGTH = 8;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

// Rate Limiting
export const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
export const RATE_LIMIT_MAX_REQUESTS = 100;
export const RATE_LIMIT_MAX_UPLOADS = 10;

// File Upload
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const IMAGE_QUALITY = {
  thumbnail: { width: 150, height: 150, quality: 80 },
  medium: { width: 600, height: 600, quality: 85 },
  large: { width: 1200, height: 1200, quality: 90 },
};

// Challenge
export const CHALLENGE_MIN_DURATION_DAYS = 7;
export const CHALLENGE_MAX_DURATION_DAYS = 365;
export const CHALLENGE_MIN_PARTICIPANTS = 2;
export const CHALLENGE_MAX_PARTICIPANTS = 10000;
export const CHALLENGE_MIN_ENTRY_FEE = 0;
export const CHALLENGE_MAX_ENTRY_FEE = 1000;

// Team
export const TEAM_MIN_SIZE = 2;
export const TEAM_MAX_SIZE = 50;
export const TEAM_NAME_MIN_LENGTH = 2;
export const TEAM_NAME_MAX_LENGTH = 50;
export const TEAM_INVITE_CODE_LENGTH = 12;

// Check-in
export const CHECK_IN_GRACE_PERIOD_HOURS = 24;
export const CHECK_IN_EDIT_WINDOW_HOURS = 1;
export const CHECK_IN_MAX_PHOTOS = 5;

// Points System
export const POINTS = {
  checkIn: 10,
  dailyStreak: 2,
  weeklyStreak: 15,
  monthlyStreak: 50,
  photoUpload: 5,
  completeData: 5,
  achievement: 25,
  firstPlace: 100,
  secondPlace: 50,
  thirdPlace: 25,
  participation: 10,
};

// Achievements
export const ACHIEVEMENT_MILESTONES = {
  weightLoss: [1, 5, 10, 15, 20, 25, 30], // kg
  steps: [10000, 50000, 100000, 250000, 500000, 1000000],
  workouts: [10, 25, 50, 100, 200, 365],
  streak: [3, 7, 14, 30, 60, 90, 180, 365],
  checkIns: [10, 25, 50, 100, 250, 500, 1000],
};

// Notifications
export const NOTIFICATION_TYPES = {
  CHALLENGE_INVITE: 'challenge_invite',
  TEAM_INVITE: 'team_invite',
  CHECK_IN_REMINDER: 'check_in_reminder',
  ACHIEVEMENT: 'achievement',
  COMMENT: 'comment',
  REACTION: 'reaction',
  LEADERBOARD_UPDATE: 'leaderboard_update',
  SYSTEM: 'system',
} as const;

export const NOTIFICATION_PRIORITIES = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
} as const;

// Subscription Tiers
export const SUBSCRIPTION_TIERS = {
  FREE: {
    name: 'free',
    maxChallenges: 1,
    maxTeamSize: 5,
    features: [
      'Join 1 challenge at a time',
      'Basic progress tracking',
      'Community support',
      'Weekly insights',
    ],
  },
  PREMIUM: {
    name: 'premium',
    price: 9.99,
    maxChallenges: 5,
    maxTeamSize: 10,
    features: [
      'Join up to 5 challenges',
      'Advanced analytics',
      'AI coaching',
      'Priority support',
      'Custom goals',
      'Health app integrations',
      'Daily insights',
      'Ad-free experience',
    ],
  },
  ENTERPRISE: {
    name: 'enterprise',
    price: 49.99,
    maxChallenges: -1, // unlimited
    maxTeamSize: -1, // unlimited
    features: [
      'Unlimited challenges',
      'Unlimited team size',
      'White-label options',
      'API access',
      'Dedicated support',
      'Custom integrations',
      'Advanced reporting',
      'Team management tools',
    ],
  },
} as const;

// Error Codes
export const ERROR_CODES = {
  // Auth errors (1xxx)
  UNAUTHORIZED: 'ERR_1001',
  INVALID_CREDENTIALS: 'ERR_1002',
  TOKEN_EXPIRED: 'ERR_1003',
  TOKEN_INVALID: 'ERR_1004',
  ACCOUNT_DISABLED: 'ERR_1005',
  EMAIL_NOT_VERIFIED: 'ERR_1006',

  // Validation errors (2xxx)
  VALIDATION_FAILED: 'ERR_2001',
  INVALID_INPUT: 'ERR_2002',
  MISSING_REQUIRED_FIELD: 'ERR_2003',
  INVALID_FORMAT: 'ERR_2004',

  // Resource errors (3xxx)
  NOT_FOUND: 'ERR_3001',
  ALREADY_EXISTS: 'ERR_3002',
  RESOURCE_LOCKED: 'ERR_3003',
  RESOURCE_EXPIRED: 'ERR_3004',

  // Permission errors (4xxx)
  FORBIDDEN: 'ERR_4001',
  INSUFFICIENT_PERMISSIONS: 'ERR_4002',
  SUBSCRIPTION_REQUIRED: 'ERR_4003',
  FEATURE_NOT_AVAILABLE: 'ERR_4004',

  // Rate limit errors (5xxx)
  RATE_LIMIT_EXCEEDED: 'ERR_5001',
  QUOTA_EXCEEDED: 'ERR_5002',

  // Payment errors (6xxx)
  PAYMENT_FAILED: 'ERR_6001',
  PAYMENT_METHOD_REQUIRED: 'ERR_6002',
  INSUFFICIENT_FUNDS: 'ERR_6003',
  SUBSCRIPTION_INACTIVE: 'ERR_6004',

  // Server errors (9xxx)
  INTERNAL_ERROR: 'ERR_9001',
  DATABASE_ERROR: 'ERR_9002',
  EXTERNAL_SERVICE_ERROR: 'ERR_9003',
  MAINTENANCE_MODE: 'ERR_9004',
} as const;

// Cache Keys
export const CACHE_KEYS = {
  USER_PROFILE: (id: string) => `user:profile:${id}`,
  USER_CHALLENGES: (id: string) => `user:challenges:${id}`,
  CHALLENGE: (id: string) => `challenge:${id}`,
  CHALLENGE_LEADERBOARD: (id: string) => `challenge:leaderboard:${id}`,
  TEAM: (id: string) => `team:${id}`,
  TEAM_MEMBERS: (id: string) => `team:members:${id}`,
  CHECK_INS: (userId: string, challengeId: string) => `checkins:${userId}:${challengeId}`,
  ACHIEVEMENTS: (userId: string) => `achievements:${userId}`,
} as const;

// Cache TTL (in seconds)
export const CACHE_TTL = {
  SHORT: 60, // 1 minute
  MEDIUM: 300, // 5 minutes
  LONG: 3600, // 1 hour
  VERY_LONG: 86400, // 24 hours
} as const;

// Queue Names
export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  EMAILS: 'emails',
  IMAGE_PROCESSING: 'image-processing',
  LEADERBOARD_UPDATE: 'leaderboard-update',
  HEALTH_DATA_SYNC: 'health-data-sync',
  ANALYTICS: 'analytics',
  CLEANUP: 'cleanup',
} as const;

// Webhook Events
export const WEBHOOK_EVENTS = {
  // Challenge events
  CHALLENGE_CREATED: 'challenge.created',
  CHALLENGE_STARTED: 'challenge.started',
  CHALLENGE_ENDED: 'challenge.ended',
  CHALLENGE_CANCELLED: 'challenge.cancelled',

  // Team events
  TEAM_CREATED: 'team.created',
  TEAM_MEMBER_JOINED: 'team.member.joined',
  TEAM_MEMBER_LEFT: 'team.member.left',

  // Check-in events
  CHECK_IN_CREATED: 'checkin.created',
  CHECK_IN_VERIFIED: 'checkin.verified',

  // Achievement events
  ACHIEVEMENT_UNLOCKED: 'achievement.unlocked',

  // Payment events
  PAYMENT_SUCCEEDED: 'payment.succeeded',
  PAYMENT_FAILED: 'payment.failed',
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
} as const;

// Regex Patterns
export const REGEX = {
  USERNAME: /^[a-zA-Z0-9_]{3,30}$/,
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  PHONE: /^\+?[1-9]\d{1,14}$/,
  UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  INVITE_CODE: /^[A-Z0-9]{12}$/,
} as const;