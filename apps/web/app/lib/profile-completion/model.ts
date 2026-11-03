/**
 * Profile completion (docs/PROFILE_COMPLETION_CARD_SPEC.md) — pure.
 *
 * Which of the v1 questions a user has answered, which apply to them, and the
 * home card's props. Every answer lives where the app already keeps it:
 *
 *   goal         profiles.preferences.about_you.goal  (written by this feature)
 *                fallback: onboarding_progress.data.v3.goal (iOS v3) / .data.goal (Android v3)
 *   height       profiles.height_cm (integer cm)
 *   weight       latest daily_tracking.weight_kg > 0, else profiles.weight_kg
 *   goal_weight  profiles.goals[type="weight"].target_weight_kg
 *   birth_year   profiles.date_of_birth (a year is stored as YYYY-07-01, see lib/onboarding/birth-date.ts)
 *   sex          profiles.gender (any PROFILE_GENDER_VALUES value; "prefer_not_to_say" counts as answered)
 *   activity     profiles.preferences.about_you.activity
 *                fallback: onboarding_progress.data.v3.activity (iOS) / .data.activity (Android)
 *
 * Onboarding v3 never wrote goal / activity to the profile (only to its resume
 * blob and the plan request), hence the fallback. `preferences.about_you` is a
 * new preferences key: preferences pass through to every client
 * (withPreferenceDefaults), so shipped builds ignore it.
 *
 * Applicability mirrors onboarding v3: `goal_weight` matters only for weight
 * goals (lose_weight, build_muscle) — the plan ignores it otherwise. While the
 * goal is unknown it stays applicable, so answering the goal can only REMOVE a
 * page from the carousel, never insert one mid-swipe.
 */
import { z } from 'zod';

import { refineBirthDate } from '../onboarding/birth-date';
import { PLAN_HEIGHT_RANGE_CM, PLAN_WEIGHT_RANGE_KG, ageFrom, computePlan, type PlanRequest, type PlanTargets } from '../onboarding/plan';
import type { TargetKey, TargetsPatch, TargetOrigin } from '../targets/user-targets';
import { healthyWeightRangeKg } from '../utils/bmi';
import { PROFILE_GENDER_VALUES, isProfileGender } from '../validation/profile-validation';

/** Wire ids, in carousel order. */
export const PROFILE_QUESTION_KEYS = ['goal', 'height', 'weight', 'goal_weight', 'birth_year', 'sex', 'activity'] as const;
export type ProfileQuestionKey = (typeof PROFILE_QUESTION_KEYS)[number];

/** Onboarding v3 goal step ids (iOS `V3Goal`, Android `V3Goal`). */
export const PROFILE_GOALS = ['lose_weight', 'eat_healthier', 'build_muscle', 'stay_active'] as const;
export type ProfileGoal = (typeof PROFILE_GOALS)[number];

/** Onboarding v3 activity step ids (= lib/onboarding/plan.ts PLAN_ACTIVITY_FACTORS keys). */
export const PROFILE_ACTIVITY_LEVELS = ['sedentary', 'light', 'active', 'very_active'] as const;
export type ProfileActivity = (typeof PROFILE_ACTIVITY_LEVELS)[number];

/** Card chips send female | male | prefer_not_to_say; non_binary (Profile edit) is accepted too. */
export const PROFILE_SEX_VALUES = PROFILE_GENDER_VALUES;

/** Goals for which onboarding's goal weight means something. */
export const GOAL_WEIGHT_GOALS: ReadonlySet<string> = new Set<ProfileGoal>(['lose_weight', 'build_muscle']);

/** profiles.preferences key this feature writes goal / activity under. */
export const ABOUT_YOU_KEY = 'about_you';

export type Units = 'metric' | 'imperial';

type Json = Record<string, any>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const oneOf = <T extends string>(allowed: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/** A positive finite number (numeric columns may arrive as strings), else null. */
export function positive(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/** The profile columns this module reads (the auth middleware's `profiles.*` has them all). */
export interface CompletionProfile {
  height_cm?: unknown;
  weight_kg?: unknown;
  gender?: unknown;
  date_of_birth?: unknown;
  goals?: unknown;
  preferences?: unknown;
  onboarding_completed?: unknown;
}

export interface CompletionInputs {
  profile: CompletionProfile;
  /** onboarding_progress.data (null when there is no row). */
  onboardingData: unknown;
  /** Latest daily_tracking.weight_kg > 0 (null when none). */
  latestWeightKg: number | null;
}

/** Every answer resolved from its store (null = not answered). */
export interface ProfileAnswers {
  goal: ProfileGoal | null;
  heightCm: number | null;
  weightKg: number | null;
  goalWeightKg: number | null;
  dateOfBirth: string | null;
  /** true when date_of_birth is a birth-year estimate (preferences.date_of_birth_estimate). */
  dateOfBirthIsYear: boolean;
  sex: string | null;
  activity: ProfileActivity | null;
}

/** Onboarding v3 answers from the resume blob: iOS nests them under `v3`, Android stores them flat. */
function onboardingAnswer(data: unknown, field: 'goal' | 'activity'): unknown {
  const d = obj(data);
  return obj(d.v3)[field] ?? d[field];
}

export function resolveAnswers(inputs: CompletionInputs): ProfileAnswers {
  const p = inputs.profile;
  const prefs = obj(p.preferences);
  const aboutYou = obj(prefs[ABOUT_YOU_KEY]);
  const goals = Array.isArray(p.goals) ? (p.goals as unknown[]) : [];
  const weightGoal = obj(goals.find((g) => obj(g).type === 'weight'));
  const dob = typeof p.date_of_birth === 'string' ? (/^(\d{4}-\d{2}-\d{2})/.exec(p.date_of_birth)?.[1] ?? null) : null;
  return {
    goal: oneOf(PROFILE_GOALS, aboutYou.goal) ?? oneOf(PROFILE_GOALS, onboardingAnswer(inputs.onboardingData, 'goal')),
    heightCm: positive(p.height_cm),
    weightKg: positive(inputs.latestWeightKg) ?? positive(p.weight_kg),
    goalWeightKg: positive(weightGoal.target_weight_kg ?? weightGoal.targetWeightKg),
    dateOfBirth: dob,
    dateOfBirthIsYear: dob !== null && obj(prefs.date_of_birth_estimate).date === dob,
    sex: isProfileGender(p.gender) ? p.gender : null,
    activity:
      oneOf(PROFILE_ACTIVITY_LEVELS, aboutYou.activity) ?? oneOf(PROFILE_ACTIVITY_LEVELS, onboardingAnswer(inputs.onboardingData, 'activity')),
  };
}

export function isApplicable(key: ProfileQuestionKey, a: ProfileAnswers): boolean {
  if (key === 'goal_weight') return a.goal === null || GOAL_WEIGHT_GOALS.has(a.goal);
  return true;
}

export function isAnswered(key: ProfileQuestionKey, a: ProfileAnswers): boolean {
  switch (key) {
    case 'goal':
      return a.goal !== null;
    case 'height':
      return a.heightCm !== null;
    case 'weight':
      return a.weightKg !== null;
    case 'goal_weight':
      return a.goalWeightKg !== null;
    case 'birth_year':
      return a.dateOfBirth !== null;
    case 'sex':
      return a.sex !== null;
    case 'activity':
      return a.activity !== null;
  }
}

export interface CompletionStatus {
  /** round(answered / total × 100), 0–100. */
  percent: number;
  answered: number;
  total: number;
  /** Applicable, unanswered keys in carousel order. */
  remaining: ProfileQuestionKey[];
}

export function completionStatus(a: ProfileAnswers): CompletionStatus {
  const applicable = PROFILE_QUESTION_KEYS.filter((k) => isApplicable(k, a));
  const remaining = applicable.filter((k) => !isAnswered(k, a));
  const total = applicable.length;
  const answered = total - remaining.length;
  return { percent: total === 0 ? 100 : Math.round((answered / total) * 100), answered, total, remaining };
}

/** Same rule as the vitals summary (VitalsService): imperial only when the user chose it. */
export function unitsFrom(preferences: unknown): Units {
  const prefs = obj(preferences);
  return obj(prefs.display).units === 'imperial' || prefs.unitSystem === 'imperial' ? 'imperial' : 'metric';
}

export interface CompletionHints {
  /** Healthy (BMI 18.5–24.9) goal-weight range for the user's height — the vitals BMI card's range. */
  goal_weight?: { healthy_min_kg: number; healthy_max_kg: number };
}

/** Hints for the questions still to answer (only what the server knows). */
export function completionHints(a: ProfileAnswers, remaining: readonly ProfileQuestionKey[]): CompletionHints {
  const hints: CompletionHints = {};
  if (remaining.includes('goal_weight') && a.heightCm !== null) {
    const range = healthyWeightRangeKg(a.heightCm);
    hints.goal_weight = { healthy_min_kg: range.min, healthy_max_kg: range.max };
  }
  return hints;
}

/** The card props / endpoint body (spec §Home feed contract). */
export interface CompletionView extends CompletionStatus {
  units: Units;
  hints: CompletionHints;
  /**
   * The user's known goal, resolved exactly as for applicability
   * (preferences.about_you.goal, then the onboarding blob); null when unknown.
   * Lets clients default the goal-weight page (lose vs gain) when the goal was
   * answered in onboarding rather than on the card.
   */
  goal: ProfileGoal | null;
}

export function completionView(inputs: CompletionInputs): CompletionView {
  const answers = resolveAnswers(inputs);
  const status = completionStatus(answers);
  return {
    ...status,
    units: unitsFrom(inputs.profile.preferences),
    hints: completionHints(answers, status.remaining),
    goal: answers.goal,
  };
}

// ---------------------------------------------------------------------------
// Plan refresh
// ---------------------------------------------------------------------------

/**
 * Age for the plan: a birth-year estimate uses "this year − birth year" (what
 * onboarding sends as `age`); a full date uses the exact age.
 */
export function planAge(a: ProfileAnswers, now: Date): number | null {
  if (!a.dateOfBirth) return null;
  if (a.dateOfBirthIsYear) {
    const age = now.getUTCFullYear() - Number(a.dateOfBirth.slice(0, 4));
    return age >= 13 && age <= 100 ? age : null;
  }
  return ageFrom(a.dateOfBirth, now);
}

/** The onboarding plan request these answers produce (iOS/Android V3Rules.planRequest). */
export function planRequestFrom(a: ProfileAnswers, now: Date): PlanRequest {
  return {
    goal: a.goal ?? 'stay_active',
    heightCm: a.heightCm,
    weightKg: a.weightKg,
    targetWeightKg: a.goal === 'lose_weight' ? a.goalWeightKg : null,
    sex: a.sex === 'male' || a.sex === 'female' || a.sex === 'prefer_not_to_say' ? a.sex : null,
    age: planAge(a, now),
    activityLevel: a.activity,
  };
}

const PLAN_FIELDS: ReadonlyArray<[TargetKey, keyof PlanTargets]> = [
  ['calories', 'calories'],
  ['proteinG', 'proteinG'],
  ['waterMl', 'waterMl'],
  ['steps', 'steps'],
];

/**
 * Refresh the saved targets after an answer — only where they are still the
 * untouched onboarding plan. A field is replaced when (1) the last nutrition
 * save came from the onboarding plan, (2) the saved value equals the plan the
 * answers produced BEFORE this answer (so the user never adjusted it, in
 * onboarding or since), and (3) the plan AFTER the answer differs. Anything
 * the user set themselves is never touched. Returns null when nothing changes.
 */
export function planRefreshPatch(
  saved: Record<TargetKey, number | null>,
  origin: TargetOrigin | null,
  before: ProfileAnswers,
  after: ProfileAnswers,
  now: Date
): TargetsPatch | null {
  if (origin !== 'onboarding_plan') return null;
  const was = computePlan(planRequestFrom(before, now));
  const will = computePlan(planRequestFrom(after, now));
  const patch: TargetsPatch = {};
  for (const [key, field] of PLAN_FIELDS) {
    const prev = was[field] as number;
    const next = will[field] as number;
    if (saved[key] !== null && saved[key] === prev && next !== prev) (patch as Record<string, number>)[key] = next;
  }
  if (Object.keys(patch).length === 0) return null;
  return { ...patch, origin: 'onboarding_plan' };
}

// ---------------------------------------------------------------------------
// POST /api/mobile/profile/completion body
// ---------------------------------------------------------------------------

/** Where the answer was given (analytics only; matches the `Profile Question Answered` source enum). */
export const PROFILE_ANSWER_SOURCES = ['home_card', 'profile'] as const;

const source = z.enum(PROFILE_ANSWER_SOURCES).optional();
const kg = z.number().finite().min(PLAN_WEIGHT_RANGE_KG.min).max(PLAN_WEIGHT_RANGE_KG.max);

/**
 * `{ key, value, source? }` — one answer, validated per key (unknown extra
 * fields ignored). Metric only: clients convert lb / ft+in before sending.
 */
export const profileAnswerSchema = z
  .discriminatedUnion('key', [
    z.object({ key: z.literal('goal'), value: z.enum(PROFILE_GOALS), source }).strip(),
    z.object({ key: z.literal('height'), value: z.number().finite().min(PLAN_HEIGHT_RANGE_CM.min).max(PLAN_HEIGHT_RANGE_CM.max), source }).strip(),
    z.object({ key: z.literal('weight'), value: kg, source }).strip(),
    z.object({ key: z.literal('goal_weight'), value: kg, source }).strip(),
    z.object({ key: z.literal('birth_year'), value: z.number().int(), source }).strip(),
    z.object({ key: z.literal('sex'), value: z.enum(PROFILE_SEX_VALUES), source }).strip(),
    z.object({ key: z.literal('activity'), value: z.enum(PROFILE_ACTIVITY_LEVELS), source }).strip(),
  ])
  .superRefine((v, ctx) => {
    // Same rule as the onboarding birth year (age 13–100 this calendar year).
    if (v.key === 'birth_year') {
      refineBirthDate({ birthYear: v.value }, { addIssue: (issue: z.IssueData) => ctx.addIssue({ ...issue, path: ['value'] }) } as z.RefinementCtx);
    }
  });
export type ProfileAnswer = z.infer<typeof profileAnswerSchema>;
