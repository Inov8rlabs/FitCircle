/**
 * The one shape every mobile endpoint uses to send a user (a `profiles` row)
 * to the apps: auth login/register/apple/google/session, GET and PUT
 * /api/mobile/profile, PUT /api/mobile/profile/preferences and
 * POST /api/mobile/onboarding/complete.
 *
 * Why it exists: the iOS `User` model (Core/Models/User.swift) is decoded with
 * synthesized Swift Codable. A missing key, a null in a non-optional field, an
 * unknown value for one of its closed enums, or one malformed array element
 * fails the WHOLE response ("The data couldn't be read because it isn't in the
 * correct format") — even when the server already saved the change. Rows in
 * production do not always satisfy that contract: web onboarding stores
 * `goals` as plain strings (["weight_loss", "health"]), `preferences` defaults
 * to `{}`, older web code stored camelCase privacy keys. Each endpoint used to
 * reshape the row by hand and they drifted; PUT /profile returned the raw row.
 *
 * Every field iOS decodes is therefore normalized here: present, the right
 * type, and (for enums) a value the app knows. Android's `User` is decoded
 * leniently but its `goals: List<Goal>` breaks on string elements too.
 */
import { isProfileGender } from '@/lib/validation/profile-validation';

import { testAccountReason, type AudienceTestReason } from '../notifications/audience';
import { PRIVACY_DEFAULTS } from '../privacy/defaults';

import { isTestDeviceRequest } from './test-device-service';

type Json = Record<string, any>;

function asObject(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

/** `existing`, plus every key of `defaults` that is missing (or null) in it. */
function fillMissing(existing: Json, defaults: Json): Json {
  const out: Json = { ...existing };
  for (const [key, value] of Object.entries(defaults)) {
    if (out[key] === undefined || out[key] === null) out[key] = value;
  }
  return out;
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** A finite number (numeric columns may arrive as strings), else null. */
export function iosNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/** An integer for a Swift `Int` (which rejects 1.5), else `fallback`. */
function iosInt(value: unknown, fallback: number): number {
  const number = iosNumber(value);
  return number === null ? fallback : Math.trunc(number);
}

/** ISO-8601 with millisecond precision. Postgres timestamps carry microseconds. */
export function formatDateForIOS(dateValue: string | Date | null | undefined): string | null {
  if (!dateValue) return null;
  const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * `date_of_birth` as the calendar date "YYYY-MM-DD". iOS decodes a date-only
 * string as local midnight; an instant (UTC midnight) shows the day before
 * west of UTC.
 */
function calendarDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

const VISIBILITY = ['public', 'friends', 'private'] as const;
const THEMES = ['light', 'dark', 'system'] as const;
const UNITS = ['metric', 'imperial'] as const;
/** iOS `FitnessLevel`. */
const FITNESS_LEVELS = ['beginner', 'intermediate', 'advanced', 'expert'] as const;
/** iOS `GoalType`. Web onboarding's string goals ("weight_loss", ...) are not goals here. */
const GOAL_TYPES = ['weight', 'steps', 'workout_minutes'] as const;

const NOTIFICATION_DEFAULTS = {
  push: true,
  email: true,
  sms: false,
  challenge_invite: true,
  team_invite: true,
  check_in_reminder: true,
  achievement: true,
  comment: true,
  reaction: true,
  leaderboard_update: true,
  weekly_insights: true,
};

/**
 * Stored preferences plus everything the mobile clients decode. Additive: keys
 * the apps do not read (hydration, security, ...) pass through untouched. The
 * keys they do read are always present and valid; an invalid stored value is
 * replaced by its default.
 */
export function withPreferenceDefaults(stored: unknown): Json {
  const preferences = asObject(stored);
  const notifications = asObject(preferences.notifications);
  const privacy = asObject(preferences.privacy);
  const display = asObject(preferences.display);
  const unitSystem = oneOf(UNITS, preferences.unitSystem);

  const notificationOut: Json = { ...notifications };
  for (const [key, fallback] of Object.entries(NOTIFICATION_DEFAULTS)) {
    notificationOut[key] = bool(notifications[key], fallback);
  }

  // Older web code stored privacy in camelCase; the settings route keeps an
  // existing camelCase twin in step with its snake_case key.
  const privacyOut: Json = {
    ...privacy,
    profile_visibility:
      oneOf(VISIBILITY, privacy.profile_visibility) ?? oneOf(VISIBILITY, privacy.profileVisibility) ?? PRIVACY_DEFAULTS.profileVisibility,
    show_weight: bool(privacy.show_weight, bool(privacy.showWeight, PRIVACY_DEFAULTS.showWeight)),
    show_progress: bool(privacy.show_progress, bool(privacy.showProgress, PRIVACY_DEFAULTS.showProgress)),
    allow_team_invites: bool(privacy.allow_team_invites, bool(privacy.allowTeamInvites, true)),
    allow_challenge_invites: bool(privacy.allow_challenge_invites, bool(privacy.allowChallengeInvites, true)),
    // New meals are private unless the user turned this on (FOOD_ENTRY_PRIVACY_SPEC).
    share_meals_with_circles: typeof privacy.share_meals_with_circles === 'boolean' ? privacy.share_meals_with_circles : PRIVACY_DEFAULTS.shareMealsWithCircles,
  };

  const displayOut: Json = {
    ...display,
    theme: oneOf(THEMES, display.theme) ?? 'dark',
    language: typeof display.language === 'string' && display.language ? display.language : 'en',
    units: oneOf(UNITS, display.units) ?? unitSystem ?? 'metric',
  };

  return {
    ...preferences,
    notifications: notificationOut,
    privacy: privacyOut,
    display: displayOut,
    // Web-style unit keys, as GET /api/mobile/profile has always returned them.
    units: fillMissing(asObject(preferences.units), {
      height: unitSystem === 'imperial' ? 'inches' : 'cm',
      weight: unitSystem === 'imperial' ? 'lbs' : 'kg',
    }),
    unitSystem: unitSystem ?? 'metric',
  };
}

/**
 * `gender` as it may be sent to a client: one of the four known values or null.
 * iOS decodes it as a closed enum, so nothing else may ever go out.
 */
export function safeGender(value: unknown): string | null {
  return isProfileGender(value) ? value : null;
}

/** Goal objects iOS can decode; anything else (strings, unknown types) is dropped. */
export function toMobileGoals(goals: unknown): Json[] {
  if (!Array.isArray(goals)) return [];
  return goals
    .filter((goal) => oneOf(GOAL_TYPES, asObject(goal).type))
    .map((goal) => {
      const steps = iosNumber(goal.daily_steps_target ?? goal.dailyStepsTarget);
      return {
        type: goal.type,
        target_weight_kg: iosNumber(goal.target_weight_kg ?? goal.targetWeightKg),
        starting_weight_kg: iosNumber(goal.starting_weight_kg ?? goal.startingWeightKg),
        daily_steps_target: steps === null ? null : Math.trunc(steps),
      };
    });
}

/** Extra facts for the `test_account` flag that are not on the profile row. */
export interface MobileUserContext {
  /** The request's headers: `X-Test-Device: 1` marks a Test Lab / Play pre-launch device. */
  headers?: Pick<Headers, 'get'>;
  /** user_attribution.is_test (Apple's mock AdServices payload), when the caller has it. */
  mockAttribution?: boolean;
}

/** Response header set (value "1") on mobile user responses for a test account. */
export const TEST_ACCOUNT_HEADER = 'X-Test-Account';

/**
 * `test_account` / `test_account_kind` (docs/TEST_ACCOUNT_CONTRACT.md): the
 * server's verdict that this is not a real customer, so the apps mute their
 * own telemetry (Sentry, product analytics, ad attribution, push registration).
 * Same rules as the Ads Console / PMF / push audience
 * (lib/ads/test-users.ts + profiles.metadata.test_device): internal team and
 * admins, the App Review demo account, Test Lab / Play pre-launch robots
 * (domain, generated Play tester addresses, X-Test-Device), QA domains and
 * Apple's mock attribution. Internal and review accounts are muted too: they
 * are excluded from every analytics cohort anyway.
 */
export function testAccountFields(
  row: Json,
  email: string,
  context: MobileUserContext = {}
): { test_account: boolean; test_account_kind: AudienceTestReason | null } {
  const kind =
    testAccountReason({
      email,
      isAdmin: row.is_admin === true,
      mockAttribution: context.mockAttribution === true,
      metadata: asObject(row.metadata),
    }) ?? (context.headers && isTestDeviceRequest(context.headers) ? 'test_device' : null);
  return { test_account: kind !== null, test_account_kind: kind };
}

/**
 * `user` (a toMobileUser / toMobileProfile result) with the request's
 * `X-Test-Device` signal applied, for routes whose user was built without the
 * request (GET /api/mobile/profile).
 */
export function withRequestTestSignal<T extends Json>(user: T, headers: Pick<Headers, 'get'>): T {
  if (!user || user.test_account === true || !isTestDeviceRequest(headers)) return user;
  return { ...user, test_account: true, test_account_kind: 'test_device' };
}

/** Sets `X-Test-Account: 1` on `response` when `user` is a test account. Returns `response`. */
export function withTestAccountHeader<R extends { headers: Headers }>(response: R, user: Json | null | undefined): R {
  if (user?.test_account === true) response.headers.set(TEST_ACCOUNT_HEADER, '1');
  return response;
}

/**
 * Exactly the fields of the iOS `User`, each guaranteed decodable, plus the
 * additive `test_account` / `test_account_kind` (old clients ignore them).
 * `authUser` is the signed-in auth user where the route has it: its id/email
 * are authoritative, and cover a missing or incomplete row.
 */
export function toMobileUser(
  profile: Json | null | undefined,
  authUser: { id?: string; email?: string | null } = {},
  context: MobileUserContext = {}
): Json {
  const row = asObject(profile);
  const email = authUser.email || (typeof row.email === 'string' && row.email) || '';
  const fallbackName = email.split('@')[0] || 'user';
  const username = typeof row.username === 'string' && row.username ? row.username : fallbackName;
  const now = new Date().toISOString();

  return {
    id: authUser.id || row.id,
    username,
    display_name: typeof row.display_name === 'string' && row.display_name ? row.display_name : username,
    email,
    avatar_url: typeof row.avatar_url === 'string' && row.avatar_url ? row.avatar_url : null,
    bio: typeof row.bio === 'string' && row.bio ? row.bio : null,
    date_of_birth: calendarDate(row.date_of_birth),
    height_cm: iosNumber(row.height_cm),
    weight_kg: iosNumber(row.weight_kg),
    gender: safeGender(row.gender),
    timezone: typeof row.timezone === 'string' && row.timezone ? row.timezone : 'UTC',
    fitness_level: oneOf(FITNESS_LEVELS, row.fitness_level) ?? null,
    goals: toMobileGoals(row.goals),
    preferences: withPreferenceDefaults(row.preferences),
    total_points: iosInt(row.total_points, 0),
    current_streak: iosInt(row.current_streak, 0),
    longest_streak: iosInt(row.longest_streak, 0),
    challenges_completed: iosInt(row.challenges_completed, 0),
    challenges_won: iosInt(row.challenges_won, 0),
    is_active: bool(row.is_active, true),
    last_active_at: formatDateForIOS(row.last_active_at) || now,
    created_at: formatDateForIOS(row.created_at) || now,
    updated_at: formatDateForIOS(row.updated_at) || now,
    ...testAccountFields(row, email, context),
  };
}

/**
 * The full profile row (every other column is kept — Android and web read some
 * of them) with the iOS `User` fields normalized on top.
 */
export function toMobileProfile(
  profile: Json,
  authUser: { id?: string; email?: string | null } = {}
): Json {
  return { ...profile, ...toMobileUser(profile, authUser) };
}

/** The updated profile row returned by PUT /api/mobile/profile. */
export function toProfileUpdateResponse(row: Json | null | undefined): Json | null | undefined {
  if (!row || typeof row !== 'object') return row;
  return toMobileProfile(row);
}
