/**
 * UserFacts: everything a message definition may read about a person. The
 * FitCircle adapter (adapters/fitcircle-facts.ts) fills these from FitCircle
 * tables; message definitions are pure functions of them.
 *
 * Rule (no fake data): a metric is `null` when we don't collect it for this
 * person, and a section built from it is hidden — never shown as zero.
 */

/** One week of a person's own activity (local Monday..Sunday). */
export interface WeekActivity {
  /** Distinct local days with any logged activity (meal, workout, water, weight, check-in). */
  activeDays: number;
  meals: { count: number; days: number };
  /** Photo-logged meals this week (AI scan). */
  photoMeals: number;
  workouts: { count: number; minutes: number };
  /** Streak check-ins (distinct claim days). */
  checkIns: number;
  /** Null when no step data at all that week (no Health sync / manual steps). */
  steps: { total: number; daysWithData: number; daysAtGoal: number | null } | null;
  /** Null when no water logged that week. */
  water: { days: number; daysAtGoal: number | null } | null;
  /** Null unless ≥ 1 weigh-in that week. Values in kg; first/last of the week. */
  weight: { first: number; last: number; entries: number } | null;
}

export interface CircleFacts {
  id: string;
  name: string;
  /** Active members including the person. */
  memberCount: number;
  /** Members (incl. the person) with ≥ 1 active day this week. */
  activeMembersThisWeek: number;
  /** The person's active days this week. */
  yourActiveDays: number;
  /** 1-based rank by active days this week among members (ties share the better rank). */
  yourRank: number;
  /** Lobby / not started yet. */
  upcoming: boolean;
  inviteCode: string | null;
  /** When the person joined the circle (ISO). */
  joinedAt: string | null;
}

export interface CampaignFacts {
  slug: string;
  title: string;
  tagline: string | null;
  startsAt: string;
  endsAt: string;
  joined: boolean;
}

/** The person's share link and the live referral reward (both from the host app). */
export interface ReferralFacts {
  code: string;
  link: string;
  /** Pro days each side earns (0 = no reward copy). */
  rewardDays: number;
  /** Check-in days a friend needs for the reward. */
  qualifyingDays: number;
}

export interface GoalFacts {
  dailyStepsTarget: number | null;
  dailyWaterMlTarget: number | null;
  targetWeightKg: number | null;
}

export interface UserProfileFacts {
  userId: string;
  email: string | null;
  firstName: string;
  timezone: string;
  /** 'kg' | 'lbs' (display only). */
  weightUnit: 'kg' | 'lbs';
  createdAt: string;
  isAdmin: boolean;
}

/** Facts for the weekly report of one ISO week. */
export interface WeeklyReportFacts {
  profile: UserProfileFacts;
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  thisWeek: WeekActivity;
  lastWeek: WeekActivity;
  /** Best activeDays in the 8 weeks before this one (null when < 2 earlier weeks of history). */
  bestPriorActiveDays: number | null;
  /** Active days in the 4 weeks before this one (dormancy). */
  activeDaysPrior4Weeks: number;
  streak: { current: number; longest: number };
  goals: GoalFacts;
  circles: CircleFacts[];
  referral: ReferralFacts | null;
  fitzyUsed: boolean;
  mealsEver: number;
  photoMealsEver: number;
  campaigns: CampaignFacts[];
  /** Growth slot shown in the previous weekly reports, newest first ('none' = skipped). */
  recentGrowthSlots: string[];
}

/** Facts for the onboarding / re-engagement steps. */
export interface LifecycleFacts {
  profile: UserProfileFacts;
  /** Local "today" in the person's zone. */
  today: string;
  localHour: number;
  accountAgeHours: number;
  mealsEver: number;
  firstMealAt: string | null;
  /** Most recent local day with any activity, or null. */
  lastActiveDate: string | null;
  streak: { current: number; lastEngagementDate: string | null };
  circles: CircleFacts[];
  referral: ReferralFacts | null;
  /**
   * Ledger rows of the last 30 days (any status: a holdout / skipped / failed
   * row still marks its period as done). Spacing and caps count status 'sent'.
   */
  recentSends: Array<{ messageKey: string; periodKey: string; channel: 'email' | 'push'; status: string; at: string }>;
}
