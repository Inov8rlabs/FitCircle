/**
 * JourneyService — activation journey state for the apps
 * (docs/ACTIVATION_JOURNEY_SPEC.md §5, §6, Appendix A).
 *
 *  GET   /api/mobile/me/journey          → getJourney
 *  PATCH /api/mobile/me/journey          → updateMealReminderPrefs
 *  POST  /api/mobile/me/journey/events   → recordEvent (fitzy_opened, fitzy_intro_seen, paywall_shown)
 *
 * State lives in nullable profiles columns (migration 110) and
 * profiles.preferences.notifications.meal_reminders. Before 110 is applied
 * the reads degrade to null and the writes log + no-op.
 */
import { mealReminderPrefsFrom, withMealReminderPrefs, type MealReminderPrefs } from '@/lib/journey/meal-slots';
import { paywallEligibility, type PaywallEligibility } from '@/lib/journey/paywall';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { EntitlementService, normalizeTier } from './entitlement-service';
import { PromoService } from './promo-service';

export const JOURNEY_EVENTS = ['fitzy_opened', 'fitzy_intro_seen', 'paywall_shown'] as const;
export type JourneyEvent = (typeof JOURNEY_EVENTS)[number];

export interface JourneyView extends PaywallEligibility {
  mealsLoggedEver: number;
  firstMealAt: string | null;
  fitzyOpenedAt: string | null;
  fitzyIntroSeenAt: string | null;
  /** = autoEligible (flat alias the apps asked for). */
  paywallAutoEligible: boolean;
  paywallAutoLastAt: string | null;
  paywallAhaShownAt: string | null;
  isPro: boolean;
  subscriptionsEnabled: boolean;
  signupAt: string | null;
  mealReminderPrefs: MealReminderPrefs;
}

type Profile = Record<string, any> & { id: string };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : null);

export class JourneyService {
  static async getJourney(profile: Profile, now = new Date()): Promise<JourneyView> {
    const supabase = createAdminSupabase();
    const [countRes, firstRes, subscriptionsEnabled] = await Promise.all([
      supabase.from('food_log_entries').select('id', { count: 'exact', head: true }).eq('user_id', profile.id).eq('entry_type', 'food').is('deleted_at', null),
      supabase
        .from('food_log_entries')
        .select('created_at')
        .eq('user_id', profile.id)
        .eq('entry_type', 'food')
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(1),
      EntitlementService.areSubscriptionsEnabled(profile.id),
    ]);
    if (countRes.error) throw countRes.error;
    if (firstRes.error) throw firstRes.error;
    const mealsLoggedEver = countRes.count ?? 0;
    const firstMealAt = str((firstRes.data ?? [])[0]?.created_at);
    const isPro = normalizeTier(profile.subscription_tier) === 'premium';
    const signupAt = str(profile.created_at);
    const paywall = paywallEligibility({
      isPro,
      subscriptionsEnabled,
      mealsLoggedEver,
      signupAt,
      autoLastAt: str(profile.paywall_auto_last_at),
      ahaShownAt: str(profile.paywall_aha_shown_at),
      now,
    });
    return {
      mealsLoggedEver,
      firstMealAt,
      fitzyOpenedAt: str(profile.fitzy_opened_at),
      fitzyIntroSeenAt: str(profile.fitzy_intro_seen_at),
      ...paywall,
      paywallAutoEligible: paywall.autoEligible,
      paywallAutoLastAt: str(profile.paywall_auto_last_at),
      paywallAhaShownAt: str(profile.paywall_aha_shown_at),
      isPro,
      subscriptionsEnabled,
      signupAt,
      mealReminderPrefs: mealReminderPrefsFrom(profile.preferences),
    };
  }

  /** Merge per-slot toggles into profiles.preferences.notifications.meal_reminders. Returns the full prefs. */
  static async updateMealReminderPrefs(userId: string, patch: Partial<MealReminderPrefs>): Promise<MealReminderPrefs> {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from('profiles').select('preferences').eq('id', userId).single();
    if (error) throw error;
    const preferences = withMealReminderPrefs(data?.preferences, patch);
    const { error: updateError } = await supabase.from('profiles').update({ preferences, updated_at: new Date().toISOString() }).eq('id', userId);
    if (updateError) throw updateError;
    return mealReminderPrefsFrom(preferences);
  }

  /**
   * First Fitzy open from any entry point (chat sheet, first message, the
   * 1.1.0 explicit event). Idempotent: only the first call writes; the auth
   * profile short-circuits later calls with zero queries. Never throws.
   */
  static async markFitzyOpened(userId: string, profile?: Record<string, any> | null, now = new Date()): Promise<boolean> {
    try {
      if (profile && typeof profile.fitzy_opened_at === 'string') return false;
      // The auth profile is `select *`: no such key = migration 110 not applied yet (or a degraded auth profile).
      if (profile && !('fitzy_opened_at' in profile)) return false;
      const { data, error } = await createAdminSupabase()
        .from('profiles')
        .update({ fitzy_opened_at: now.toISOString() })
        .eq('id', userId)
        .is('fitzy_opened_at', null)
        .select('id');
      if (error) throw error;
      const first = (data ?? []).length > 0;
      if (first) await PromoService.recordConversion(userId, 'fitzy_opened', now);
      return first;
    } catch (err: any) {
      console.warn('[journey] markFitzyOpened failed (migration 110 applied?):', userId, err?.message ?? err);
      return false;
    }
  }

  /** POST /me/journey/events. Returns the stored timestamp(s). */
  static async recordEvent(
    userId: string,
    event: JourneyEvent,
    opts: { placement?: string; automatic?: boolean; profile?: Record<string, any> | null } = {},
    now = new Date()
  ): Promise<Record<string, string | null>> {
    const at = now.toISOString();
    if (event === 'fitzy_opened') {
      await this.markFitzyOpened(userId, opts.profile, now);
      return { fitzyOpenedAt: str(opts.profile?.fitzy_opened_at) ?? at };
    }
    const supabase = createAdminSupabase();
    if (event === 'fitzy_intro_seen') {
      const { error } = await supabase.from('profiles').update({ fitzy_intro_seen_at: at }).eq('id', userId).is('fitzy_intro_seen_at', null);
      if (error) throw error;
      return { fitzyIntroSeenAt: at };
    }
    // paywall_shown: only automatic presentations feed the 72 h spacing.
    const update: Record<string, string> = {};
    if (opts.automatic !== false) update.paywall_auto_last_at = at;
    if (opts.placement === 'first_meal_aha') update.paywall_aha_shown_at = at;
    if (Object.keys(update).length === 0) return {};
    const { error } = await supabase.from('profiles').update(update).eq('id', userId);
    if (error) throw error;
    return { ...(update.paywall_auto_last_at ? { paywallAutoLastAt: at } : {}), ...(update.paywall_aha_shown_at ? { paywallAhaShownAt: at } : {}) };
  }
}
