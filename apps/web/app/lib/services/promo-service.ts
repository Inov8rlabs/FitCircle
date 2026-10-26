/**
 * PromoService — the I/O side of promo@1 (docs/PROMO_CARD_SPEC.md §5–§7,
 * docs/ACTIVATION_JOURNEY_SPEC.md §3): the feed's per-request promo reads,
 * promo_user_state writes from the home-feed events batch, and conversion
 * hooks (first meal logged, subscription started, Fitzy opened).
 *
 * Every write is best-effort and runs after the response; nothing here may
 * fail a feed, a food log, a webhook or a Fitzy request.
 */
import { swrCache } from '@/lib/home-feed/cache';
import { localClock } from '@/lib/journey/meal-slots';
import {
  CONVERSION_WINDOW_DAYS,
  SYSTEM_PROMO_KEYS,
  promoKeyFromCardId,
  promosConfig,
  type JourneyFacts,
  type PromoUserState,
} from '@/lib/promos';
import { addDays } from '@/lib/streaks/streak-calculator';
import { createAdminSupabase } from '@/lib/supabase-admin';

export type ConversionKind = 'meal_logged' | 'subscription_started' | 'fitzy_opened';

/** Which promos a completed action converts (PROMO_CARD_SPEC §4 completion events). */
export const CONVERSIONS: Record<ConversionKind, readonly string[]> = {
  meal_logged: ['first_meal', 'log_meal_now'],
  subscription_started: ['pro_value'],
  fitzy_opened: ['meet_fitzy'],
};

const SEEN_DAYS_KEPT = 14;

export interface PromoEventInput {
  card_id: string;
  event: 'impression' | 'tap' | 'dismiss' | 'cta';
  promo_id?: string;
  creative_id?: string;
  button?: 'primary' | 'secondary';
  /** Already-normalised occurred_at (or null → now). */
  occurredAt: string | null;
}

interface StateRow {
  user_id: string;
  promo_key: string;
  creative_id: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  impressions_total: number;
  impressions_day: number;
  day: string | null;
  seen_days: string[] | null;
  dismissed_at: string | null;
  tapped_at: string | null;
  tapped_button: string | null;
  converted_at: string | null;
  updated_at?: string;
}

export function stateFromRow(r: StateRow): PromoUserState {
  return {
    promoKey: r.promo_key,
    creativeId: r.creative_id ?? null,
    impressionsTotal: Number(r.impressions_total) || 0,
    impressionsDay: Number(r.impressions_day) || 0,
    day: r.day ?? null,
    seenDays: Array.isArray(r.seen_days) ? r.seen_days : [],
    dismissedAt: r.dismissed_at ?? null,
    tappedAt: r.tapped_at ?? null,
    convertedAt: r.converted_at ?? null,
  };
}

/**
 * Pure: fold one promo's events (in order) into its state row. `localDate`
 * is the viewer's local day (impressions_day / seen_days).
 */
export function applyPromoEvents(prev: StateRow | null, userId: string, promoKey: string, events: readonly PromoEventInput[], localDate: string, nowIso: string): StateRow {
  const row: StateRow = prev
    ? { ...prev, seen_days: [...(prev.seen_days ?? [])] }
    : {
        user_id: userId,
        promo_key: promoKey,
        creative_id: null,
        first_seen_at: null,
        last_seen_at: null,
        impressions_total: 0,
        impressions_day: 0,
        day: null,
        seen_days: [],
        dismissed_at: null,
        tapped_at: null,
        tapped_button: null,
        converted_at: null,
      };
  for (const e of events) {
    const at = e.occurredAt ?? nowIso;
    if (e.creative_id) row.creative_id = e.creative_id;
    switch (e.event) {
      case 'impression':
        row.impressions_total = (row.impressions_total || 0) + 1;
        if (row.day === localDate) row.impressions_day = (row.impressions_day || 0) + 1;
        else {
          row.day = localDate;
          row.impressions_day = 1;
        }
        row.seen_days = [localDate, ...(row.seen_days ?? []).filter((d) => d !== localDate)].sort().reverse().slice(0, SEEN_DAYS_KEPT);
        row.first_seen_at = row.first_seen_at ?? at;
        row.last_seen_at = at;
        break;
      case 'dismiss':
        row.dismissed_at = at;
        break;
      case 'tap':
      case 'cta':
        row.tapped_at = at;
        row.tapped_button = e.button ?? 'primary';
        break;
    }
  }
  row.updated_at = nowIso;
  return row;
}

/** Pure: should this conversion mark the row converted? (tap within the window, not converted yet). */
export function convertsNow(row: Pick<StateRow, 'tapped_at' | 'converted_at'>, now: Date): boolean {
  if (row.converted_at || !row.tapped_at) return false;
  const tapped = Date.parse(row.tapped_at);
  return !Number.isNaN(tapped) && now.getTime() - tapped <= CONVERSION_WINDOW_DAYS * 86_400_000 && tapped <= now.getTime() + 60_000;
}

/** Pro feature keys whose gate is live (required_tier = premium). User-independent → per-instance SWR cache. */
export const liveProFeaturesCache = swrCache<Set<string>>(
  async () => {
    const { data, error } = await createAdminSupabase().from('feature_gates').select('feature_key, required_tier');
    if (error) throw error;
    return new Set(((data ?? []) as Array<{ feature_key: string; required_tier: string | null }>).filter((g) => g.required_tier === 'premium').map((g) => g.feature_key));
  },
  { ttlMs: 60_000, maxStaleMs: 3_600_000, label: 'feature gates' }
);

/** Injected I/O for the feed (unit-testable). Each is ONE indexed read. */
export interface PromoLoaders {
  journeyFacts(userId: string, localDate: string): Promise<JourneyFacts>;
  promoState(userId: string): Promise<Map<string, PromoUserState>>;
  liveProFeatures(): Promise<Set<string>>;
}

export const defaultPromoLoaders: PromoLoaders = {
  async journeyFacts(userId, localDate) {
    const supabase = createAdminSupabase();
    const [last, recent] = await Promise.all([
      supabase
        .from('food_log_entries')
        .select('title, meal_type, logged_at')
        .eq('user_id', userId)
        .eq('entry_type', 'food')
        .is('deleted_at', null)
        .order('logged_at', { ascending: false })
        .limit(1),
      supabase
        .from('food_log_entries')
        .select('entry_type, entry_date, meal_type, logged_at')
        .eq('user_id', userId)
        .eq('entry_type', 'food')
        .is('deleted_at', null)
        .gte('entry_date', addDays(localDate, -1))
        .lte('entry_date', addDays(localDate, 1)),
    ]);
    if (last.error) throw last.error;
    if (recent.error) throw recent.error;
    return { lastMeal: ((last.data ?? [])[0] as JourneyFacts['lastMeal']) ?? null, recentEntries: (recent.data ?? []) as JourneyFacts['recentEntries'] };
  },
  async promoState(userId) {
    const { data, error } = await createAdminSupabase().from('promo_user_state').select('*').eq('user_id', userId);
    if (error) throw error;
    return new Map(((data ?? []) as StateRow[]).map((r) => [r.promo_key, stateFromRow(r)]));
  },
  liveProFeatures: () => liveProFeaturesCache.get(),
};

export class PromoService {
  /**
   * Fold promo events from a home-feed events batch into promo_user_state.
   * Called after the response. Only known promo keys are written.
   */
  static async recordFeedEvents(userId: string, events: readonly PromoEventInput[], timezone: string, now = new Date()): Promise<number> {
    const byKey = new Map<string, PromoEventInput[]>();
    for (const e of events) {
      const key = e.promo_id ?? promoKeyFromCardId(e.card_id);
      if (!key || !SYSTEM_PROMO_KEYS.includes(key)) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), e]);
    }
    if (byKey.size === 0) return 0;
    let localDate: string;
    try {
      localDate = localClock(now, timezone).date;
    } catch {
      localDate = now.toISOString().slice(0, 10);
    }
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from('promo_user_state').select('*').eq('user_id', userId).in('promo_key', [...byKey.keys()]);
    if (error) throw error;
    const existing = new Map(((data ?? []) as StateRow[]).map((r) => [r.promo_key, r]));
    const nowIso = now.toISOString();
    const rows = [...byKey.entries()].map(([key, evs]) => applyPromoEvents(existing.get(key) ?? null, userId, key, evs, localDate, nowIso));
    const { error: upsertError } = await supabase.from('promo_user_state').upsert(rows, { onConflict: 'user_id,promo_key' });
    if (upsertError) throw upsertError;
    return rows.length;
  }

  /**
   * Conversion hook: the completion event for `kind` happened. Marks the
   * matching promos converted when the user tapped them within 7 days
   * (PROMO_CARD_SPEC §12 `Promo Converted`). No-op while promos are off.
   * Never throws.
   */
  static async recordConversion(userId: string, kind: ConversionKind, now = new Date()): Promise<string[]> {
    if (!promosConfig().enabled) return [];
    try {
      const keys = CONVERSIONS[kind];
      const supabase = createAdminSupabase();
      const { data, error } = await supabase
        .from('promo_user_state')
        .select('promo_key, creative_id, tapped_at, converted_at')
        .eq('user_id', userId)
        .in('promo_key', [...keys]);
      if (error) throw error;
      const hits = ((data ?? []) as StateRow[]).filter((r) => convertsNow(r, now));
      for (const r of hits) {
        const { error: updateError } = await supabase
          .from('promo_user_state')
          .update({ converted_at: now.toISOString(), updated_at: now.toISOString() })
          .eq('user_id', userId)
          .eq('promo_key', r.promo_key);
        if (updateError) throw updateError;
        // Promo Converted {promo, creative, action} — server-recorded (no server analytics sender yet).
        console.log(`[promos] Promo Converted ${JSON.stringify({ promo: r.promo_key, creative: r.creative_id, action: kind })}`);
      }
      return hits.map((r) => r.promo_key);
    } catch (err: any) {
      console.warn(`[promos] conversion ${kind} failed for ${userId}:`, err?.message ?? err);
      return [];
    }
  }
}
