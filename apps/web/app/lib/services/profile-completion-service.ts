/**
 * ProfileCompletionService — the I/O side of the profile completion card
 * (docs/PROFILE_COMPLETION_CARD_SPEC.md). Rules are pure in
 * lib/profile-completion/model.ts.
 *
 *  GET  /api/mobile/profile/completion → status
 *  POST /api/mobile/profile/completion → answer
 *  home feed `profile_completion@1`    → feedHint (context loader)
 *
 * Every answer is written where the app already keeps it, through the same
 * code the existing endpoints use (no new table, no migration).
 */
import { birthDateUpdate, parseBirthDate } from '../onboarding/birth-date';
import {
  ABOUT_YOU_KEY,
  completionView,
  planRefreshPatch,
  resolveAnswers,
  type CompletionInputs,
  type CompletionProfile,
  type CompletionView,
  type ProfileAnswer,
  type ProfileAnswers,
} from '../profile-completion/model';
import { isValidTimezone } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';
import { savedTargets, targetsView, type TargetKey } from '../targets/user-targets';
import { getTodayInTimezone } from '../utils/timezone';

import { DailyGoalService } from './daily-goals';
import { MobileAPIService } from './mobile-api-service';
import { UserTargetsService } from './user-targets-service';
import { VitalsService } from './vitals-service';

/** Feed card id/type. Dismiss = snooze for this long (spec: 7 days). */
export const PROFILE_COMPLETION_CARD = 'profile_completion';
export const PROFILE_COMPLETION_SNOOZE_MS = 7 * 86_400_000;

const PROFILE_COLUMNS = 'id, height_cm, weight_kg, gender, date_of_birth, goals, preferences, onboarding_completed, timezone';

/** What the home feed needs to decide on the card (FeedContext.profileCompletion). */
export interface ProfileCompletionHint {
  onboardingCompleted: boolean;
  /** Dismissed within the last 7 days. */
  snoozed: boolean;
  view: CompletionView;
}

export interface AnswerResult extends CompletionView {
  /** The question just saved. */
  key: ProfileAnswer['key'];
  /** Daily targets refreshed because they were the untouched onboarding plan (clients refetch GET /api/mobile/targets). */
  targets_updated: TargetKey[];
}

type Json = Record<string, any>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});

export class ProfileCompletionService {
  /** onboarding_progress.data (null when no row). */
  static async onboardingData(userId: string): Promise<unknown> {
    const { data, error } = await createAdminSupabase().from('onboarding_progress').select('data').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data?.data ?? null;
  }

  /** Latest daily_tracking weight > 0 (any date). */
  static async latestWeightKg(userId: string): Promise<number | null> {
    const { data, error } = await createAdminSupabase()
      .from('daily_tracking')
      .select('weight_kg, tracking_date')
      .eq('user_id', userId)
      .gt('weight_kg', 0)
      .order('tracking_date', { ascending: false })
      .limit(1);
    if (error) throw error;
    const kg = Number((data ?? [])[0]?.weight_kg);
    return Number.isFinite(kg) && kg > 0 ? kg : null;
  }

  /** Was the card dismissed in the last 7 days? (home_feed_events, written by POST /api/mobile/home-feed/events) */
  static async snoozed(userId: string, now: Date): Promise<boolean> {
    const { data, error } = await createAdminSupabase()
      .from('home_feed_events')
      .select('id')
      .eq('user_id', userId)
      .eq('card_type', PROFILE_COMPLETION_CARD)
      .eq('event', 'dismiss')
      .gte('created_at', new Date(now.getTime() - PROFILE_COMPLETION_SNOOZE_MS).toISOString())
      .limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  static async loadProfile(userId: string): Promise<CompletionProfile & { id: string; timezone?: string | null }> {
    const { data, error } = await createAdminSupabase().from('profiles').select(PROFILE_COLUMNS).eq('id', userId).single();
    if (error) throw error;
    return data as any;
  }

  static async inputs(userId: string, profile?: CompletionProfile): Promise<CompletionInputs> {
    const [p, onboardingData, latestWeightKg] = await Promise.all([
      profile ?? this.loadProfile(userId),
      this.onboardingData(userId),
      this.latestWeightKg(userId),
    ]);
    return { profile: p, onboardingData, latestWeightKg };
  }

  /** GET: the current status (same shape as the card props). */
  static async status(userId: string): Promise<CompletionView> {
    return completionView(await this.inputs(userId));
  }

  /**
   * Home feed loader. `profile` is the auth middleware's `profiles.*` row, so
   * this is one parallel round of three indexed reads — and none at all before
   * onboarding is complete. Throws on a read error (the feed then drops the card).
   */
  static async feedHint(profile: CompletionProfile & { id: string }, now: Date): Promise<ProfileCompletionHint> {
    const onboardingCompleted = profile.onboarding_completed === true;
    if (!onboardingCompleted) {
      return { onboardingCompleted, snoozed: false, view: completionView({ profile, onboardingData: null, latestWeightKg: null }) };
    }
    const [inputs, snoozed] = await Promise.all([this.inputs(profile.id, profile), this.snoozed(profile.id, now)]);
    return { onboardingCompleted, snoozed, view: completionView(inputs) };
  }

  /**
   * POST: save one answer where the app keeps it, refresh the untouched
   * onboarding plan targets, and return the new status.
   */
  static async answer(userId: string, answer: ProfileAnswer, opts: { timezone?: string | null; now?: Date } = {}): Promise<AnswerResult> {
    const now = opts.now ?? new Date();
    const before = await this.inputs(userId);
    const beforeAnswers = resolveAnswers(before); // resolved now: the writes below may reuse row objects
    await this.write(userId, answer, before, { timezone: opts.timezone ?? null, now });

    const after = await this.inputs(userId);
    const targets_updated = await this.refreshPlan(userId, beforeAnswers, after, now);
    return { ...completionView(after), key: answer.key, targets_updated };
  }

  private static async write(
    userId: string,
    answer: ProfileAnswer,
    current: CompletionInputs,
    opts: { timezone: string | null; now: Date }
  ): Promise<void> {
    const profile = current.profile as CompletionProfile & { timezone?: string | null };
    const at = opts.now.toISOString();
    switch (answer.key) {
      case 'goal':
      case 'activity': {
        // preferences.about_you (read-modify-write, like VitalsService.updateGoals).
        const prefs = obj(profile.preferences);
        const aboutYou = { ...obj(prefs[ABOUT_YOU_KEY]), [answer.key]: answer.value, updated_at: at };
        await this.updateProfile(userId, { preferences: { ...prefs, [ABOUT_YOU_KEY]: aboutYou }, updated_at: at });
        return;
      }
      case 'height':
        // INTEGER column (same rounding as PUT /api/mobile/profile).
        await this.updateProfile(userId, { height_cm: Math.round(answer.value), updated_at: at });
        return;
      case 'sex':
        await this.updateProfile(userId, { gender: answer.value, updated_at: at });
        return;
      case 'birth_year': {
        // lib/onboarding/birth-date.ts rules: a year never overwrites a full date.
        const update = birthDateUpdate(profile, parseBirthDate({ birthYear: answer.value })!);
        if (update) await this.updateProfile(userId, { ...update, updated_at: at });
        return;
      }
      case 'weight': {
        // Today's weigh-in, exactly as onboarding's first weigh-in (POST /api/mobile/tracking/daily):
        // upsert today's row in the user's timezone (+ weight streak), daily goal completion, and the
        // profile weight onboarding's body save writes.
        const tz = isValidTimezone(opts.timezone) ? opts.timezone : isValidTimezone(profile.timezone) ? profile.timezone : 'UTC';
        const today = getTodayInTimezone(tz);
        await MobileAPIService.upsertDailyTracking(userId, today, { weight_kg: answer.value });
        try {
          await DailyGoalService.updateGoalCompletion(userId, today, { weight_kg: answer.value });
        } catch (err: any) {
          console.error('[ProfileCompletionService] goal completion update failed:', err?.message);
        }
        await this.updateProfile(userId, { weight_kg: answer.value, updated_at: at });
        return;
      }
      case 'goal_weight': {
        // The vitals weight goal (PUT /api/mobile/vitals/goals); starting weight = today's weight
        // when the goal has none yet (what onboarding sends).
        const goals = Array.isArray(profile.goals) ? (profile.goals as unknown[]) : [];
        const existing = obj(goals.find((g) => obj(g).type === 'weight'));
        const start = resolveAnswers(current).weightKg;
        await VitalsService.updateGoals(userId, {
          target_weight_kg: answer.value,
          ...(existing.starting_weight_kg == null && start !== null ? { starting_weight_kg: start } : {}),
        });
        return;
      }
    }
  }

  private static async updateProfile(userId: string, update: Json): Promise<void> {
    const { error } = await createAdminSupabase().from('profiles').update(update).eq('id', userId);
    if (error) throw error;
  }

  /** model.planRefreshPatch → UserTargetsService.update. Fail-soft: the answer is already saved. */
  private static async refreshPlan(userId: string, before: ProfileAnswers, after: CompletionInputs, now: Date): Promise<TargetKey[]> {
    try {
      const view = targetsView(after.profile);
      const patch = planRefreshPatch(savedTargets(after.profile), view.origin, before, resolveAnswers(after), now);
      if (!patch) return [];
      await UserTargetsService.update(userId, patch, now);
      return (Object.keys(patch)).filter((k) => k !== 'origin') as TargetKey[];
    } catch (err: any) {
      console.warn('[ProfileCompletionService] plan refresh skipped:', err?.code ?? err?.message ?? 'error');
      return [];
    }
  }
}
