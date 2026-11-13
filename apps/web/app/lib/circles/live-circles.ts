/**
 * Live private circles and their members, for the win-back day-7 step and the
 * leaderboard overtake push (docs/PUSH_NOTIFICATIONS.md §8.4 / §8.6).
 *
 * "Live private circle": fitcircles.status = 'active', end_date in the future,
 * visibility 'private' or 'invite_only' (friends you invited — public circles
 * are open to strangers and are left out on purpose).
 */
import { createAdminSupabase } from '../supabase-admin';

export const PRIVATE_VISIBILITIES = ['private', 'invite_only'] as const;

export interface LiveCircle {
  id: string;
  name: string;
  type: string;
  timezone: string | null;
  startDate: string;
  endDate: string;
  memberIds: string[];
}

type Row = Record<string, any>;

/** Live private circles (optionally only those with a member in `userIds`), with active members. */
export async function loadLiveCircles(opts: { userIds?: string[]; now?: Date } = {}): Promise<LiveCircle[]> {
  const db = createAdminSupabase();
  const now = (opts.now ?? new Date()).toISOString();
  let circleIds: string[] | null = null;
  if (opts.userIds) {
    if (opts.userIds.length === 0) return [];
    const ids = new Set<string>();
    for (let i = 0; i < opts.userIds.length; i += 150) {
      const { data, error } = await db
        .from('fitcircle_members')
        .select('fitcircle_id')
        .in('user_id', opts.userIds.slice(i, i + 150))
        .eq('status', 'active');
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as Row[]) ids.add(r.fitcircle_id);
    }
    circleIds = [...ids];
    if (circleIds.length === 0) return [];
  }
  let q = db
    .from('fitcircles')
    .select('id, name, type, timezone, start_date, end_date, status, visibility')
    .eq('status', 'active')
    .in('visibility', [...PRIVATE_VISIBILITIES])
    .gt('end_date', now);
  if (circleIds) q = q.in('id', circleIds);
  const { data: circles, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (circles ?? []) as Row[];
  if (rows.length === 0) return [];
  const members = new Map<string, string[]>();
  const ids = rows.map((c) => c.id as string);
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error: mErr } = await db
      .from('fitcircle_members')
      .select('fitcircle_id, user_id')
      .in('fitcircle_id', ids.slice(i, i + 150))
      .eq('status', 'active');
    if (mErr) throw new Error(mErr.message);
    for (const r of (data ?? []) as Row[]) {
      const list = members.get(r.fitcircle_id) ?? [];
      list.push(r.user_id);
      members.set(r.fitcircle_id, list);
    }
  }
  return rows.map((c) => ({
    id: c.id,
    name: c.name ?? 'your circle',
    type: c.type ?? 'custom',
    timezone: c.timezone ?? null,
    startDate: String(c.start_date ?? '').slice(0, 10),
    endDate: String(c.end_date ?? '').slice(0, 10),
    memberIds: [...new Set(members.get(c.id) ?? [])],
  }));
}
