/**
 * "Showed up" days and friends for campaigns (docs/CAMPAIGNS_SPEC.md §3).
 *
 * A calendar door opens when the viewer shows up that local day — exactly the
 * circle-streak definition (CircleStreakService.loggedOn, minus circle saves,
 * which are per-circle): a non-freeze `streak_claims` row, or a calorie-bearing,
 * non-deleted `food_log_entries` row on that date.
 */
import { createAdminSupabase } from '../supabase-admin';

export interface FriendProfile {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

const CHUNK = 200;
const chunks = <T>(xs: T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export class CampaignActivityService {
  /** userId → set of local dates in [from, to] they showed up. */
  static async showedUpDates(userIds: string[], from: string, to: string): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0 || from > to) return out;
    const add = (u: string, d: string) => {
      if (!out.has(u)) out.set(u, new Set());
      out.get(u)!.add(d);
    };
    const supabase = createAdminSupabase();
    for (const part of chunks(ids)) {
      const [{ data: claims, error: claimsError }, { data: entries, error: entriesError }] = await Promise.all([
        supabase
          .from('streak_claims')
          .select('user_id, claim_date, claim_method')
          .in('user_id', part)
          .gte('claim_date', from)
          .lte('claim_date', to),
        supabase
          .from('food_log_entries')
          .select('user_id, entry_date')
          .in('user_id', part)
          .gte('entry_date', from)
          .lte('entry_date', to)
          .not('calories', 'is', null)
          .is('deleted_at', null),
      ]);
      if (claimsError) throw claimsError;
      if (entriesError) throw entriesError;
      for (const c of (claims ?? []) as Array<{ user_id: string; claim_date: string; claim_method: string | null }>) {
        if (c.claim_method !== 'freeze') add(c.user_id, String(c.claim_date).slice(0, 10));
      }
      for (const e of (entries ?? []) as Array<{ user_id: string; entry_date: string }>) {
        add(e.user_id, String(e.entry_date).slice(0, 10));
      }
    }
    return out;
  }

  /** Users (of `userIds`) who showed up on `date`. */
  static async showedUpOn(userIds: string[], date: string): Promise<Set<string>> {
    const map = await this.showedUpDates(userIds, date, date);
    return new Set([...map.entries()].filter(([, days]) => days.has(date)).map(([u]) => u));
  }

  /**
   * Distinct active members of the caller's active circles (excluding the
   * caller), with display names. "Active circle" = upcoming/active fitcircle
   * the caller is an active member of.
   */
  static async friendsOf(userId: string): Promise<FriendProfile[]> {
    const supabase = createAdminSupabase();
    const { data: mine, error: mineError } = await supabase
      .from('fitcircle_members')
      .select('fitcircle_id')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (mineError) throw mineError;
    const circleIds = [...new Set(((mine ?? []) as Array<{ fitcircle_id: string }>).map((r) => r.fitcircle_id))];
    if (circleIds.length === 0) return [];

    const { data: circles, error: circlesError } = await supabase
      .from('fitcircles')
      .select('id')
      .in('id', circleIds)
      .in('status', ['upcoming', 'active']);
    if (circlesError) throw circlesError;
    const activeCircleIds = ((circles ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (activeCircleIds.length === 0) return [];

    const { data: members, error: membersError } = await supabase
      .from('fitcircle_members')
      .select('user_id')
      .in('fitcircle_id', activeCircleIds)
      .eq('status', 'active');
    if (membersError) throw membersError;
    const friendIds = [...new Set(((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id))].filter(
      (id) => id && id !== userId
    );
    if (friendIds.length === 0) return [];

    const profiles: Array<{ id: string; display_name: string | null; username: string | null; avatar_url: string | null }> = [];
    for (const part of chunks(friendIds)) {
      const { data, error } = await supabase.from('profiles').select('id, display_name, username, avatar_url').in('id', part);
      if (error) throw error;
      profiles.push(...((data ?? []) as typeof profiles));
    }
    const byId = new Map(profiles.map((p) => [p.id, p]));
    return friendIds.map((id) => {
      const p = byId.get(id);
      return {
        userId: id,
        name: (p?.display_name || p?.username || 'Friend').trim() || 'Friend',
        avatarUrl: p?.avatar_url ?? null,
      };
    });
  }
}
