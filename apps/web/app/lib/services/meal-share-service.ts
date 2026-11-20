// Meal sharing from the 1.1.5 meal-logged success sheet (docs/ENGAGEMENT_115_SPEC.md §4).
//
//  - getShareTargets: the user's active circles with a server-computed default toggle
//    (defaultOnFor). A default never posts anything: sharing always needs the tap.
//  - shareToCircles: POST /food-log/{id}/share {circles, remember}: the entry is shared with
//    exactly the chosen circles (per-meal list `share_circle_ids`), live cards elsewhere are
//    retracted BEFORE the response, and the choices are remembered per circle.
//
// Fail-soft until migration 138 is applied: missing meal_share_circle_prefs → no memory;
// missing share_circle_ids → the list rides only on the in-memory entry for the cards.

import { logIgnoredQueryError } from '@/lib/api/route-errors';
import { RemoteConfigService } from '@/lib/remote-config/service';

import { createAdminSupabase } from '../supabase-admin';

import { CircleMealPostService, type EntryLike } from './circle-meal-post-service';
import {
  defaultOnFor,
  isShareableType,
  mealsMadePrivateAt,
  sharingDefaultState,
  type ShareTargetReason,
} from './food-entry-privacy';
import { isDraftEntry } from '@/lib/meal-drafts/config';

export const MAX_SHARE_TARGETS = 30;
const MAX_AVATARS = 3;

export interface ShareTarget {
  circle_id: string;
  name: string;
  member_count: number;
  avatar_urls: string[];
  default_on: boolean;
  reason: ShareTargetReason;
}

export interface ShareTargets {
  sharing_default: 'on' | 'off' | 'unset';
  circles: ShareTarget[];
}

export interface ShareRequest {
  circles: Array<{ circle_id: string; share: boolean }>;
  remember: boolean;
}

export interface ShareResult {
  entry_id: string;
  is_private: boolean;
  visibility: 'private' | 'circle';
  shared_circle_ids: string[];
  posted: number;
  retracted: number;
}

export class MealShareError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'UNSHAREABLE',
    message: string
  ) {
    super(message);
    this.name = 'MealShareError';
  }
}

/** 42P01 / PGRST205 (missing table) or PGRST204 / 42703 (missing column): migration not applied. */
function isMissingRelation(error: { code?: string } | null | undefined): boolean {
  return !!error && ['42P01', 'PGRST205', 'PGRST204', '42703'].includes(error.code ?? '');
}

export class MealShareService {
  /** Active memberships of a user whose circle is active / upcoming. */
  static async activeCircles(userId: string): Promise<Array<{ id: string; name: string; visibility: string | null; is_official: boolean }>> {
    const db = createAdminSupabase();
    const { data: memberships, error } = await db.from('fitcircle_members').select('fitcircle_id').eq('user_id', userId).eq('status', 'active');
    if (error) throw error;
    const ids = Array.from(new Set((memberships ?? []).map((m) => m.fitcircle_id as string).filter(Boolean)));
    if (ids.length === 0) return [];
    const { data: circles, error: circlesError } = await db
      .from('fitcircles')
      .select('id, name, visibility, is_official, status')
      .in('id', ids)
      .in('status', ['active', 'upcoming']);
    if (circlesError) throw circlesError;
    return ((circles ?? []) as Array<Record<string, unknown>>).map((c) => ({
      id: c.id as string,
      name: (c.name as string | null) ?? 'Circle',
      visibility: (c.visibility as string | null) ?? null,
      is_official: c.is_official === true,
    }));
  }

  /** GET /api/mobile/food-log/share-targets. */
  static async getShareTargets(userId: string): Promise<ShareTargets> {
    const db = createAdminSupabase();
    const [{ data: profile, error: profileError }, circles] = await Promise.all([
      db.from('profiles').select('preferences').eq('id', userId).maybeSingle(),
      this.activeCircles(userId),
    ]);
    logIgnoredQueryError('MealShareService.profile', profileError);
    const preferences = (profile as { preferences?: unknown } | null)?.preferences ?? null;
    const sharing_default = sharingDefaultState(preferences);
    if (circles.length === 0) return { sharing_default, circles: [] };

    const ids = circles.map((c) => c.id);
    const [members, remembered, tiers, activity, threshold] = await Promise.all([
      this.membersByCircle(ids),
      this.rememberedPrefs(userId, ids),
      this.explicitTiers(userId, ids),
      this.lastChatActivity(userId, ids),
      RemoteConfigService.value('meal_share_large_circle_threshold', { userId }).catch(() => 20),
    ]);
    const avatars = await this.avatarsFor(userId, members);
    const madePrivate = mealsMadePrivateAt(preferences) !== null;

    const rows = circles.map((c): ShareTarget & { _activity: string } => {
      const memberIds = members.get(c.id) ?? [];
      const memberCount = Math.max(1, memberIds.length);
      const d = defaultOnFor({
        remembered: remembered.has(c.id) ? (remembered.get(c.id) as boolean) : null,
        explicitTier: tiers.get(c.id) ?? null,
        sharingDefaultOff: sharing_default === 'off',
        madePrivate,
        isOfficial: c.is_official,
        circleVisibility: c.visibility,
        memberCount,
        largeCircleThreshold: threshold,
      });
      return {
        circle_id: c.id,
        name: c.name,
        member_count: memberCount,
        avatar_urls: memberIds
          .filter((id) => id !== userId)
          .map((id) => avatars.get(id))
          .filter((u): u is string => typeof u === 'string' && u.length > 0)
          .slice(0, MAX_AVATARS),
        default_on: d.default_on,
        reason: d.reason,
        _activity: activity.get(c.id) ?? '',
      };
    });
    rows.sort((a, b) => (a._activity === b._activity ? a.name.localeCompare(b.name) : a._activity < b._activity ? 1 : -1));
    return {
      sharing_default,
      circles: rows.slice(0, MAX_SHARE_TARGETS).map(({ _activity, ...r }) => {
        void _activity;
        return r;
      }),
    };
  }

  /**
   * POST /api/mobile/food-log/{id}/share {circles, remember}. Idempotent. Owner only (anything
   * else is NOT_FOUND); water / supplements are UNSHAREABLE. Throws on a failed retraction so
   * the client retries (never "Private" while a card is still up).
   */
  static async shareToCircles(userId: string, entryId: string, req: ShareRequest): Promise<ShareResult> {
    const db = createAdminSupabase();
    const { data: row, error } = await db.from('food_log_entries').select('*').eq('id', entryId).is('deleted_at', null).maybeSingle();
    if (error && error.code !== '22P02') throw error;
    if (!row || (row as EntryLike).user_id !== userId) throw new MealShareError('NOT_FOUND', 'Entry not found');
    const entry = row as EntryLike;
    if (!isShareableType(entry.entry_type)) throw new MealShareError('UNSHAREABLE', 'Water and supplements are never shared');
    // A Draft meal is never shared: confirm it first (POST /api/mobile/food-log/{id}/confirm).
    if (isDraftEntry(entry as { entry_status?: unknown })) throw new MealShareError('UNSHAREABLE', 'Confirm this draft meal before sharing it');

    const active = new Set((await this.activeCircles(userId)).map((c) => c.id));
    const wanted = Array.from(new Set(req.circles.filter((c) => c.share).map((c) => c.circle_id)));
    const target = wanted.filter((id) => active.has(id));
    const now = new Date().toISOString();

    let result: ShareResult;
    if (target.length > 0) {
      await this.writeEntry(entryId, userId, { is_private: false, visibility: 'circle', updated_at: now }, target);
      const shared: EntryLike = { ...entry, is_private: false, visibility: 'circle', share_circle_ids: target };
      const sync = await CircleMealPostService.syncMealCircles(shared);
      result = { entry_id: entryId, is_private: false, visibility: 'circle', shared_circle_ids: target, posted: sync.posted, retracted: sync.retracted };
    } else {
      // Same as PATCH share_with_circles:false: private, list cleared, every card retracted.
      await this.writeEntry(entryId, userId, { is_private: true, visibility: 'private', updated_at: now }, null);
      const retracted = await CircleMealPostService.retractMeal(entryId);
      result = { entry_id: entryId, is_private: true, visibility: 'private', shared_circle_ids: [], posted: 0, retracted };
    }
    if (req.remember) await this.remember(userId, req.circles);
    return result;
  }

  // ------------------------------------------------------------------------ private

  private static async writeEntry(entryId: string, userId: string, cols: Record<string, unknown>, list: string[] | null): Promise<void> {
    const db = createAdminSupabase();
    let { error } = await db.from('food_log_entries').update({ ...cols, share_circle_ids: list }).eq('id', entryId).eq('user_id', userId);
    if (error && isMissingRelation(error)) {
      ({ error } = await db.from('food_log_entries').update(cols).eq('id', entryId).eq('user_id', userId));
    }
    if (error) throw error;
  }

  /**
   * Remember from a create / PATCH body (the offline-outbox share path): every SEEN circle,
   * share = it is in share_circle_ids ([] = none). No seen list → nothing remembered. Never throws.
   */
  static async rememberFromEntryBody(userId: string, body: { share_circle_ids?: string[]; share_seen_circle_ids?: string[]; share_with_circles?: boolean }): Promise<void> {
    if (!Array.isArray(body.share_seen_circle_ids) || body.share_seen_circle_ids.length === 0) return;
    if (body.share_with_circles !== true && body.share_with_circles !== false) return;
    const chosen = new Set(body.share_with_circles === true && Array.isArray(body.share_circle_ids) ? body.share_circle_ids : []);
    try {
      await this.remember(userId, body.share_seen_circle_ids.map((circle_id) => ({ circle_id, share: chosen.has(circle_id) })));
    } catch (e) {
      console.error('[MealShareService.rememberFromEntryBody] failed:', e instanceof Error ? e.message : String(e));
    }
  }

  private static async remember(userId: string, circles: ShareRequest['circles']): Promise<void> {
    if (circles.length === 0) return;
    const now = new Date().toISOString();
    const byCircle = new Map(circles.map((c) => [c.circle_id, c.share]));
    const rows = Array.from(byCircle.entries()).map(([fitcircle_id, share]) => ({ user_id: userId, fitcircle_id, share, updated_at: now }));
    const { error } = await createAdminSupabase().from('meal_share_circle_prefs').upsert(rows, { onConflict: 'user_id,fitcircle_id' });
    if (error && !isMissingRelation(error)) {
      // Memory is a convenience: a failed write never fails the share itself.
      console.error('[MealShareService.remember] failed:', error.message);
    }
  }

  private static async membersByCircle(ids: string[]): Promise<Map<string, string[]>> {
    const { data, error } = await createAdminSupabase()
      .from('fitcircle_members')
      .select('fitcircle_id, user_id')
      .in('fitcircle_id', ids)
      .eq('status', 'active');
    if (error) throw error;
    const out = new Map<string, string[]>();
    for (const r of (data ?? []) as Array<{ fitcircle_id: string; user_id: string }>) {
      const list = out.get(r.fitcircle_id) ?? [];
      list.push(r.user_id);
      out.set(r.fitcircle_id, list);
    }
    return out;
  }

  private static async avatarsFor(userId: string, members: Map<string, string[]>): Promise<Map<string, string>> {
    const others = new Set<string>();
    for (const ids of members.values()) for (const id of ids.filter((x) => x !== userId).slice(0, 12)) others.add(id);
    if (others.size === 0) return new Map();
    const { data, error } = await createAdminSupabase().from('profiles').select('id, avatar_url').in('id', Array.from(others));
    logIgnoredQueryError('MealShareService.avatars', error);
    return new Map(((data ?? []) as Array<{ id: string; avatar_url: string | null }>).filter((p) => p.avatar_url).map((p) => [p.id, p.avatar_url as string]));
  }

  private static async rememberedPrefs(userId: string, ids: string[]): Promise<Map<string, boolean>> {
    const { data, error } = await createAdminSupabase()
      .from('meal_share_circle_prefs')
      .select('fitcircle_id, share')
      .eq('user_id', userId)
      .in('fitcircle_id', ids);
    if (error) {
      if (!isMissingRelation(error)) logIgnoredQueryError('MealShareService.rememberedPrefs', error);
      return new Map();
    }
    return new Map(((data ?? []) as Array<{ fitcircle_id: string; share: boolean }>).map((r) => [r.fitcircle_id, r.share === true]));
  }

  /** Explicit circle_food_privacy rows only (no row = 'full', which never turns a toggle off). */
  private static async explicitTiers(userId: string, ids: string[]): Promise<Map<string, string>> {
    const { data, error } = await createAdminSupabase()
      .from('circle_food_privacy')
      .select('fitcircle_id, tier')
      .eq('user_id', userId)
      .in('fitcircle_id', ids);
    if (error) {
      // Unsure → treat every circle as explicitly non-full (toggles off): never default-on blindly.
      logIgnoredQueryError('MealShareService.explicitTiers', error);
      return new Map(ids.map((id) => [id, 'unknown']));
    }
    return new Map(((data ?? []) as Array<{ fitcircle_id: string; tier: string }>).map((r) => [r.fitcircle_id, r.tier]));
  }

  /** Newest message the user sent per circle (ISO), for ordering. */
  private static async lastChatActivity(userId: string, ids: string[]): Promise<Map<string, string>> {
    const { data, error } = await createAdminSupabase()
      .from('circle_messages')
      .select('fitcircle_id, created_at')
      .eq('sender_id', userId)
      .in('fitcircle_id', ids)
      .order('created_at', { ascending: false })
      .limit(500);
    logIgnoredQueryError('MealShareService.lastChatActivity', error);
    const out = new Map<string, string>();
    for (const r of (data ?? []) as Array<{ fitcircle_id: string; created_at: string }>) {
      if (!out.has(r.fitcircle_id)) out.set(r.fitcircle_id, r.created_at);
    }
    return out;
  }
}
