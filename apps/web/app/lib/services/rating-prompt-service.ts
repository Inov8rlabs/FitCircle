/**
 * RatingPromptService — server-driven store rating prompt (docs/RATING_PROMPT.md).
 *
 *   GET  /api/mobile/rating-prompt            → decide(): eligible + active triggers for this user
 *   POST /api/mobile/rating-prompt/requested  → recordRequested(): the app asked the OS
 *
 * Config: feature_flags row `rating_prompt` (lib/rating-prompt/config.ts),
 * cached per instance. Facts: profiles (signup, email / is_admin for the
 * internal-account exclusion, timezone, metadata.rating_prompt ledger) and up
 * to `minMealDays - 1` indexed point reads on food_log_entries. No new table:
 * the per-user ledger is profiles.metadata.rating_prompt
 *   { last_prompt_at, prompt_count, last_trigger, last_platform, last_app_version }.
 */
import { swrCache } from '@/lib/home-feed/cache';
import {
  CONFIG_FLAG_NAME,
  DEFAULT_CONFIG,
  configVersion,
  envEnabled,
  parseConfig,
  type RatingPromptConfig,
} from '@/lib/rating-prompt/config';
import {
  decideRatingPrompt,
  type RatingPromptDecision,
  type RatingPromptFacts,
  type RatingPromptRequest,
} from '@/lib/rating-prompt/eligibility';
import { isValidTimezone } from '@/lib/streaks/streak-calculator';
import { createAdminSupabase } from '@/lib/supabase-admin';

export interface PublishedConfig {
  enabled: boolean;
  config: RatingPromptConfig;
  source: 'database' | 'defaults';
  updatedAt: string | null;
  invalidStored: boolean;
  version: string;
}

export async function readPublishedConfig(): Promise<PublishedConfig> {
  const fallback = (invalidStored = false): PublishedConfig => ({
    enabled: true,
    config: DEFAULT_CONFIG,
    source: 'defaults',
    updatedAt: null,
    invalidStored,
    version: configVersion(true, DEFAULT_CONFIG),
  });
  try {
    const { data, error } = await createAdminSupabase()
      .from('feature_flags')
      .select('name, is_enabled, metadata, updated_at')
      .eq('name', CONFIG_FLAG_NAME)
      .maybeSingle();
    if (error) throw error;
    if (!data) return fallback();
    const row = data as { is_enabled: boolean | null; metadata: unknown; updated_at: string | null };
    const enabled = row.is_enabled !== false;
    const parsed = parseConfig(row.metadata);
    if (!parsed) {
      console.warn('[rating-prompt] stored config is invalid; serving defaults');
      return { ...fallback(true), enabled, updatedAt: row.updated_at ?? null, version: configVersion(enabled, DEFAULT_CONFIG) };
    }
    return { enabled, config: parsed, source: 'database', updatedAt: row.updated_at ?? null, invalidStored: false, version: configVersion(enabled, parsed) };
  } catch (err: any) {
    console.warn('[rating-prompt] config read failed; serving defaults:', err?.message ?? err);
    return fallback();
  }
}

/** Per-instance cache (fresh 30 s, stale ≤ 10 min). */
export const ratingConfigCache = swrCache<PublishedConfig>(readPublishedConfig, { ttlMs: 30_000, maxStaleMs: 600_000, label: 'rating prompt config' });

export interface RatingLedger {
  last_prompt_at?: string | null;
  prompt_count?: number;
  last_trigger?: string | null;
  last_platform?: string | null;
  last_app_version?: string | null;
}

export function ledgerOf(metadata: unknown): RatingLedger {
  const m = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {};
  const l = m.rating_prompt;
  return l && typeof l === 'object' && !Array.isArray(l) ? (l as RatingLedger) : {};
}

/** YYYY-MM-DD of `now` in `timezone` (falls back to UTC). */
export function localDay(now: Date, timezone: string | null | undefined): string {
  const tz = timezone && isValidTimezone(timezone) ? timezone : 'UTC';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

type ProfileRow = {
  id: string;
  email: string | null;
  is_admin?: boolean | null;
  created_at: string | null;
  timezone: string | null;
  metadata: unknown;
};

const PROFILE_COLUMNS = 'id, email, is_admin, created_at, timezone, metadata';

export class RatingPromptService {
  /**
   * Distinct food-log days before `today`, counting at most `cap`: walks the
   * newest distinct days with indexed point reads (no scan of the whole log).
   */
  static async mealDaysBefore(userId: string, today: string, cap: number): Promise<number> {
    const supabase = createAdminSupabase();
    let count = 0;
    let before = today;
    while (count < cap) {
      const { data, error } = await supabase
        .from('food_log_entries')
        .select('entry_date')
        .eq('user_id', userId)
        .eq('entry_type', 'food')
        .is('deleted_at', null)
        .lt('entry_date', before)
        .order('entry_date', { ascending: false })
        .limit(1);
      if (error) throw error;
      const next = (data ?? [])[0]?.entry_date as string | undefined;
      if (!next) break;
      count += 1;
      before = next;
    }
    return count;
  }

  static async loadFacts(userId: string, config: RatingPromptConfig, now: Date): Promise<RatingPromptFacts | null> {
    const { data, error } = await createAdminSupabase().from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const p = data as ProfileRow;
    const ledger = ledgerOf(p.metadata);
    const mealTriggerOn = config.triggers.meal_saved?.enabled === true;
    const mealDays = mealTriggerOn ? await this.mealDaysBefore(userId, localDay(now, p.timezone), Math.max(0, config.minMealDays - 1)) : 0;
    return {
      userId,
      email: p.email ?? null,
      isAdmin: p.is_admin === true,
      signupAt: p.created_at ?? null,
      mealDaysBeforeToday: mealDays,
      lastPromptAt: ledger.last_prompt_at ?? null,
      promptCount: typeof ledger.prompt_count === 'number' ? ledger.prompt_count : 0,
    };
  }

  /** This user's decision. Any failure → not eligible (callers never prompt on doubt). */
  static async decide(userId: string, request: RatingPromptRequest, now = new Date()): Promise<RatingPromptDecision> {
    const pub = await ratingConfigCache.get();
    const quick = (facts: RatingPromptFacts) =>
      decideRatingPrompt({ config: pub.config, enabled: pub.enabled, envEnabled: envEnabled(), configVersion: pub.version, facts, request, now });
    const stub: RatingPromptFacts = { userId, email: null, isAdmin: false, signupAt: null, mealDaysBeforeToday: 0, lastPromptAt: null, promptCount: 0 };
    // Switches / platform / version / audience first: no DB reads when they already say no.
    const pre = quick(stub);
    if (pre.reason && ['kill_switch', 'disabled', 'unsupported_platform', 'platform_disabled', 'app_version', 'country', 'rollout'].includes(pre.reason)) {
      return pre;
    }
    const facts = await this.loadFacts(userId, pub.config, now);
    if (!facts) return quick(stub);
    return quick(facts);
  }

  /**
   * The app asked the OS for the prompt. Records the ledger (the cooldown
   * and max-prompts count run from it). A repeat within 60 s (client retry)
   * is not counted twice.
   */
  static async recordRequested(
    userId: string,
    input: { trigger: string; platform: string | null; appVersion: string | null },
    now = new Date()
  ): Promise<{ recorded: boolean; promptCount: number; lastPromptAt: string }> {
    const supabase = createAdminSupabase();
    const { data, error } = await supabase.from('profiles').select('metadata').eq('id', userId).maybeSingle();
    if (error) throw error;
    const base = data?.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata) ? (data.metadata as Record<string, unknown>) : {};
    const ledger = ledgerOf(base);
    const count = typeof ledger.prompt_count === 'number' ? ledger.prompt_count : 0;
    const last = ledger.last_prompt_at ? Date.parse(ledger.last_prompt_at) : NaN;
    if (Number.isFinite(last) && now.getTime() - last < 60_000) {
      return { recorded: false, promptCount: count, lastPromptAt: ledger.last_prompt_at as string };
    }
    const at = now.toISOString();
    const next: RatingLedger = {
      last_prompt_at: at,
      prompt_count: count + 1,
      last_trigger: input.trigger,
      last_platform: input.platform,
      last_app_version: input.appVersion,
    };
    const { error: updateError } = await supabase.from('profiles').update({ metadata: { ...base, rating_prompt: next } }).eq('id', userId);
    if (updateError) throw updateError;
    return { recorded: true, promptCount: count + 1, lastPromptAt: at };
  }
}
