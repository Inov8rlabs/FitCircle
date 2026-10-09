/**
 * Canonical user properties derived from app state. Only plan enums, booleans,
 * counts and goal tokens: never email, name, username or health values.
 */
import type { AnalyticsUserProperties, AuthMethod } from './events.generated';

interface UserLike {
  isPremium?: boolean;
  goals?: unknown;
  onboardingCompleted?: boolean;
  preferences?: object;
}

const GOAL_TOKEN = /^[a-z][a-z0-9_]{0,39}$/;

export function unitsSystemOf(user: UserLike | null | undefined): 'metric' | 'imperial' | undefined {
  const prefs = user?.preferences as { unitSystem?: unknown; units?: { weight?: unknown } } | undefined;
  if (!prefs) return undefined;
  if (prefs.unitSystem === 'metric' || prefs.unitSystem === 'imperial') return prefs.unitSystem;
  if (prefs.units?.weight === 'kg') return 'metric';
  if (prefs.units?.weight === 'lbs') return 'imperial';
  return undefined;
}

/** First goal, only when it is a short enum-like token (never free text). */
export function primaryGoalOf(goals: unknown): string | undefined {
  if (!Array.isArray(goals) || goals.length === 0) return undefined;
  const first: unknown = goals[0];
  const token =
    typeof first === 'string'
      ? first
      : typeof first === 'object' && first !== null && typeof (first as { type?: unknown }).type === 'string'
        ? (first as { type: string }).type
        : undefined;
  return token && GOAL_TOKEN.test(token) ? token : undefined;
}

export function userPropertiesFor(user: UserLike | null | undefined): AnalyticsUserProperties {
  if (!user) return {};
  const props: AnalyticsUserProperties = {};
  if (typeof user.isPremium === 'boolean') props.plan = user.isPremium ? 'pro' : 'free';
  const units = unitsSystemOf(user);
  if (units) props.units_system = units;
  const goal = primaryGoalOf(user.goals);
  if (goal) props.primary_goal = goal;
  if (typeof user.onboardingCompleted === 'boolean') props.onboarding_completed = user.onboardingCompleted;
  return props;
}

/** setOnce properties stamped when an account is created on the web. */
export function signupUserProperties(method: AuthMethod, createdAt: Date = new Date()): AnalyticsUserProperties {
  return {
    signup_method: method,
    signup_platform: 'web',
    account_created_date: createdAt.toISOString().slice(0, 10),
  };
}

/** Maps an entitlement product id (store or web) to the plan's pro_plan value. */
export function proPlanOf(isPro: boolean, productId: string | null | undefined): AnalyticsUserProperties['pro_plan'] {
  if (!isPro) return 'none';
  const id = (productId ?? '').toLowerCase();
  if (id.includes('lifetime')) return 'lifetime';
  if (id.includes('annual') || id.includes('year')) return 'annual';
  if (id.includes('month')) return 'monthly';
  return undefined;
}
