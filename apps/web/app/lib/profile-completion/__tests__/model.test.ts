import { describe, expect, it } from 'vitest';

import { computePlan } from '../../onboarding/plan';
import {
  PROFILE_QUESTION_KEYS,
  completionStatus,
  completionView,
  planRefreshPatch,
  planRequestFrom,
  profileAnswerSchema,
  resolveAnswers,
  unitsFrom,
  type CompletionInputs,
} from '../model';

const NOW = new Date('2026-11-03T12:00:00Z');

/** A v3 user who skipped About you: goal + activity only in the onboarding blob. */
const skipped = (blob: unknown, profile: Record<string, unknown> = {}): CompletionInputs => ({
  profile: { onboarding_completed: true, preferences: {}, goals: [], ...profile },
  onboardingData: blob,
  latestWeightKg: null,
});

const IOS_BLOB = { useMetric: false, v3: { goal: 'lose_weight', activity: 'light', body: { useMetric: false } } };
const ANDROID_BLOB = { step: 'v3_summary', goal: 'build_muscle', activity: 'very_active', body: { useMetric: true } };

describe('resolveAnswers — where each answer lives', () => {
  it('reads goal / activity from the iOS (data.v3) and Android (flat data) onboarding blobs', () => {
    expect(resolveAnswers(skipped(IOS_BLOB))).toMatchObject({ goal: 'lose_weight', activity: 'light' });
    expect(resolveAnswers(skipped(ANDROID_BLOB))).toMatchObject({ goal: 'build_muscle', activity: 'very_active' });
  });

  it('preferences.about_you wins over the onboarding blob; unknown ids are ignored', () => {
    const a = resolveAnswers(skipped(IOS_BLOB, { preferences: { about_you: { goal: 'stay_active', activity: 'turbo' } } }));
    expect(a.goal).toBe('stay_active');
    expect(a.activity).toBe('light');
    expect(resolveAnswers(skipped({ v3: { goal: 'build_habits' } })).goal).toBeNull(); // v2 id, not a v3 option
  });

  it('profile columns: height, gender (prefer_not_to_say counts), date of birth, weight goal', () => {
    const a = resolveAnswers(
      skipped(null, {
        height_cm: 178,
        gender: 'prefer_not_to_say',
        date_of_birth: '1990-07-01',
        preferences: { date_of_birth_estimate: { from: 'birth_year', date: '1990-07-01' } },
        goals: [{ type: 'steps', daily_steps_target: 8000 }, { type: 'weight', target_weight_kg: '72.5', starting_weight_kg: 80 }],
      })
    );
    expect(a).toMatchObject({ heightCm: 178, sex: 'prefer_not_to_say', dateOfBirth: '1990-07-01', dateOfBirthIsYear: true, goalWeightKg: 72.5 });
  });

  it('weight: latest weigh-in, else profiles.weight_kg; zero / junk is unanswered', () => {
    expect(resolveAnswers({ ...skipped(null, { weight_kg: 81 }), latestWeightKg: 79.4 }).weightKg).toBe(79.4);
    expect(resolveAnswers(skipped(null, { weight_kg: '81' })).weightKg).toBe(81);
    expect(resolveAnswers(skipped(null, { weight_kg: 0, height_cm: 0, gender: 'robot' }))).toMatchObject({ weightKg: null, heightCm: null, sex: null });
  });
});

describe('completionStatus — applicability + percent', () => {
  it('nothing answered: all 7, in carousel order', () => {
    expect(completionStatus(resolveAnswers(skipped(null)))).toEqual({ percent: 0, answered: 0, total: 7, remaining: [...PROFILE_QUESTION_KEYS] });
  });

  it('skipped About you with a weight goal: 2 of 7 (goal + activity)', () => {
    expect(completionStatus(resolveAnswers(skipped(IOS_BLOB)))).toEqual({
      percent: 29,
      answered: 2,
      total: 7,
      remaining: ['height', 'weight', 'goal_weight', 'birth_year', 'sex'],
    });
  });

  it('goal_weight only applies to weight goals (lose_weight, build_muscle) or an unknown goal', () => {
    for (const goal of ['eat_healthier', 'stay_active']) {
      const s = completionStatus(resolveAnswers(skipped({ v3: { goal } })));
      expect(s.total).toBe(6);
      expect(s.remaining).not.toContain('goal_weight');
    }
    expect(completionStatus(resolveAnswers(skipped({ v3: { goal: 'build_muscle' } }))).remaining).toContain('goal_weight');
    // A goal weight saved earlier doesn't count once the goal is "stay active".
    const s = completionStatus(resolveAnswers(skipped({ v3: { goal: 'stay_active' } }, { goals: [{ type: 'weight', target_weight_kg: 70 }] })));
    expect(s).toMatchObject({ answered: 1, total: 6 });
  });

  it('everything answered → 100 %, nothing remaining', () => {
    const full = skipped(IOS_BLOB, {
      height_cm: 170,
      weight_kg: 80,
      gender: 'female',
      date_of_birth: '1988-03-14',
      goals: [{ type: 'weight', target_weight_kg: 70 }],
    });
    expect(completionStatus(resolveAnswers(full))).toEqual({ percent: 100, answered: 7, total: 7, remaining: [] });
  });
});

describe('completionView — card props', () => {
  it('units follow the vitals rule; the goal-weight hint is the vitals healthy range for the height', () => {
    const v = completionView(skipped(IOS_BLOB, { height_cm: 170, preferences: { display: { units: 'imperial' } } }));
    expect(v).toEqual({
      percent: 43,
      answered: 3,
      total: 7,
      remaining: ['weight', 'goal_weight', 'birth_year', 'sex'],
      units: 'imperial',
      hints: { goal_weight: { healthy_min_kg: 53.5, healthy_max_kg: 72 } },
      goal: 'lose_weight',
    });
  });

  it('goal: the resolved goal (about_you, then iOS / Android onboarding blob), null when unknown', () => {
    expect(completionView(skipped(IOS_BLOB)).goal).toBe('lose_weight');
    expect(completionView(skipped(ANDROID_BLOB)).goal).toBe('build_muscle');
    expect(completionView(skipped(IOS_BLOB, { preferences: { about_you: { goal: 'eat_healthier' } } })).goal).toBe('eat_healthier');
    expect(completionView(skipped(null)).goal).toBeNull();
    expect(completionView(skipped({ v3: { goal: 'build_habits' } })).goal).toBeNull();
  });

  it('no hint without a height or when goal_weight is not remaining', () => {
    expect(completionView(skipped(IOS_BLOB)).hints).toEqual({});
    expect(completionView(skipped({ v3: { goal: 'stay_active' } }, { height_cm: 170 })).hints).toEqual({});
  });

  it('unitsFrom', () => {
    expect(unitsFrom({ unitSystem: 'imperial' })).toBe('imperial');
    expect(unitsFrom({ display: { units: 'imperial' } })).toBe('imperial');
    expect(unitsFrom({ display: { units: 'metric' } })).toBe('metric');
    expect(unitsFrom(null)).toBe('metric');
  });
});

describe('profileAnswerSchema', () => {
  const ok = (body: unknown) => profileAnswerSchema.safeParse(body).success;

  it('accepts each key with its own value type', () => {
    expect(ok({ key: 'goal', value: 'lose_weight', source: 'home_card' })).toBe(true);
    expect(ok({ key: 'height', value: 175.26 })).toBe(true);
    expect(ok({ key: 'weight', value: 81.6 })).toBe(true);
    expect(ok({ key: 'goal_weight', value: 72 })).toBe(true);
    expect(ok({ key: 'birth_year', value: 1990 })).toBe(true);
    expect(ok({ key: 'sex', value: 'prefer_not_to_say' })).toBe(true);
    expect(ok({ key: 'activity', value: 'very_active', source: 'profile', extra: 1 })).toBe(true);
  });

  it('rejects unknown keys, wrong types and out-of-range values', () => {
    expect(ok({ key: 'mood', value: 3 })).toBe(false);
    expect(ok({ key: 'goal', value: 'build_habits' })).toBe(false);
    expect(ok({ key: 'height', value: '175' })).toBe(false);
    expect(ok({ key: 'height', value: 99 })).toBe(false);
    expect(ok({ key: 'weight', value: 301 })).toBe(false);
    expect(ok({ key: 'goal_weight', value: 29 })).toBe(false);
    expect(ok({ key: 'birth_year', value: 1990.5 })).toBe(false);
    expect(ok({ key: 'sex', value: 'other' })).toBe(false);
    expect(ok({ key: 'activity', value: 'moderate' })).toBe(false);
    expect(ok({ key: 'goal', value: 'lose_weight', source: 'push' })).toBe(false);
  });

  it('birth year: age 18–100 this calendar year; under 18 is an AGE_REQUIREMENT issue on `value`', () => {
    const year = new Date().getUTCFullYear();
    expect(ok({ key: 'birth_year', value: year - 18 })).toBe(true);
    const tooYoung = profileAnswerSchema.safeParse({ key: 'birth_year', value: year - 17 });
    expect(tooYoung.success).toBe(false);
    expect(tooYoung.error?.issues[0].path).toEqual(['value']);
    expect((tooYoung.error?.issues[0] as any).params?.code).toBe('AGE_REQUIREMENT');
    expect(ok({ key: 'birth_year', value: year - 101 })).toBe(false);
  });
});

describe('planRefreshPatch — refresh only the untouched onboarding plan', () => {
  const before = resolveAnswers(skipped(IOS_BLOB));
  const plan0 = computePlan(planRequestFrom(before, NOW));
  const saved = { calories: plan0.calories, proteinG: plan0.proteinG, carbsG: null, fatG: null, waterMl: plan0.waterMl, steps: plan0.steps };

  it('mirrors the onboarding plan request (goal default stay_active, target only for lose_weight, year-estimate age)', () => {
    expect(planRequestFrom(resolveAnswers(skipped(null)), NOW).goal).toBe('stay_active');
    const a = resolveAnswers(
      skipped({ v3: { goal: 'build_muscle' } }, {
        goals: [{ type: 'weight', target_weight_kg: 90 }],
        date_of_birth: '1990-07-01',
        preferences: { date_of_birth_estimate: { from: 'birth_year', date: '1990-07-01' } },
      })
    );
    expect(planRequestFrom(a, NOW)).toMatchObject({ goal: 'build_muscle', targetWeightKg: null, age: 36 });
  });

  it('height + weight answered → reference body replaced by the real one', () => {
    const after = resolveAnswers({ ...skipped(IOS_BLOB, { height_cm: 165 }), latestWeightKg: 95 });
    const patch = planRefreshPatch(saved, 'onboarding_plan', before, after, NOW);
    const plan1 = computePlan(planRequestFrom(after, NOW));
    expect(patch).toEqual({ calories: plan1.calories, proteinG: plan1.proteinG, waterMl: plan1.waterMl, origin: 'onboarding_plan' });
  });

  it('a value the user adjusted is never touched; other origins / no saved targets → nothing', () => {
    const after = resolveAnswers({ ...skipped(IOS_BLOB, { height_cm: 165 }), latestWeightKg: 95 });
    const adjusted = { ...saved, calories: saved.calories + 50 };
    expect(planRefreshPatch(adjusted, 'onboarding_plan', before, after, NOW)).not.toHaveProperty('calories');
    expect(planRefreshPatch(saved, 'settings', before, after, NOW)).toBeNull();
    expect(planRefreshPatch({ ...saved, calories: null, proteinG: null, waterMl: null, steps: null }, 'onboarding_plan', before, after, NOW)).toBeNull();
  });

  it('an answer that does not change the plan → null', () => {
    const after = resolveAnswers(skipped(IOS_BLOB, { height_cm: 165 })); // height alone: still the reference body
    expect(planRefreshPatch(saved, 'onboarding_plan', before, after, NOW)).toBeNull();
  });
});
