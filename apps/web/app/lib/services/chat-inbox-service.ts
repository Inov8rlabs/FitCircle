// Circle chat inbox — GET /api/mobile/chats, the push badge, and the home-feed
// chat card (docs/CHAT_NAV_NOTIFICATIONS_CHEERS.md §1).
//
// Unread = messages newer than the member's read cursor (circle_chat_state.
// last_read_at, written by POST /circles/:id/read), not their own, not deleted,
// not from a member they blocked / who blocked them. Muted circles still report
// their count but stay out of total_unread.
//
// Query budget is fixed, not per circle: memberships, circles, chat state,
// blocks, one light message window, one detail read for the last messages, one
// fallback for circles silent longer than the window, one profiles batch.

import { createAdminSupabase } from '../supabase-admin';

/** Unread look-back: older unread messages are not counted (the badge reads 99+ long before). */
export const UNREAD_LOOKBACK_DAYS = 30;
/** Row cap for the light message window per request. */
export const INBOX_WINDOW_ROW_CAP = 2000;
/** Row cap for the batched badge computation (many recipients, union of their circles). */
export const BADGE_WINDOW_ROW_CAP = 5000;
export const INBOX_PREVIEW_MAX = 80;

export interface InboxLastMessage {
  id: string;
  sender_id: string | null;
  sender_display_name: string | null;
  preview: string;
  kind: 'user_text' | 'user_photo' | 'system_event';
  is_cheer: boolean;
  created_at: string;
}

export interface InboxChat {
  circle_id: string;
  circle_name: string;
  circle_avatar_url: string | null;
  circle_type: string | null;
  unread_count: number;
  muted: boolean;
  last_message: InboxLastMessage | null;
  last_read_at: string | null;
  last_activity_at: string | null;
}

export interface ChatInbox {
  chats: InboxChat[];
  total_unread: number;
  muted_unread: number;
  default_circle_id: string | null;
}

/** A light circle_messages row (what the unread window reads). */
export interface WindowRow {
  id: string;
  fitcircle_id: string;
  sender_id: string | null;
  created_at: string;
  deleted_at: string | null;
}

interface DetailRow extends WindowRow {
  kind: 'user_text' | 'user_photo' | 'system_event';
  body: string | null;
  system_payload: Record<string, unknown> | null;
}

type Row = Record<string, any>;

/** Is this message visible to (and countable for) the viewer? Pure. */
export function isVisibleTo(row: WindowRow, hidden: ReadonlySet<string>): boolean {
  if (row.deleted_at) return false;
  return !(row.sender_id && hidden.has(row.sender_id));
}

/** Does this message count as unread for the viewer? Pure. */
export function isUnreadFor(
  row: WindowRow,
  viewerId: string,
  lastReadAt: string | null,
  hidden: ReadonlySet<string>
): boolean {
  if (!isVisibleTo(row, hidden)) return false;
  if (row.sender_id === viewerId) return false;
  return !lastReadAt || Date.parse(row.created_at) > Date.parse(lastReadAt);
}

/** One-line, ≤ 80-char preview of a message for the inbox / feed card. Pure. */
export function previewOf(row: Pick<DetailRow, 'kind' | 'body'>): string {
  if (row.kind === 'user_photo') return 'Photo';
  const text = (row.body ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= INBOX_PREVIEW_MAX) return text;
  return `${text.slice(0, INBOX_PREVIEW_MAX - 1).trimEnd()}…`;
}

function cheerOf(row: Pick<DetailRow, 'kind' | 'system_payload'>): boolean {
  if (row.kind !== 'user_text') return false;
  const cheer = (row.system_payload as { cheer?: unknown } | null)?.cheer;
  return !!cheer && typeof cheer === 'object';
}

function firstActorId(row: Pick<DetailRow, 'system_payload'>): string | null {
  const actors = (row.system_payload as { actors?: unknown } | null)?.actors;
  const first = Array.isArray(actors) ? actors[0] : undefined;
  const id = first && typeof first === 'object' ? (first as { id?: unknown }).id : undefined;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Which chat the top-nav button opens: the newest unread among non-muted
 * circles, then among muted ones, else the most recently active. Pure.
 */
export function pickDefaultCircle(
  chats: ReadonlyArray<Pick<InboxChat, 'circle_id' | 'muted' | 'unread_count'>>,
  newestUnreadAt: ReadonlyMap<string, string>
): string | null {
  if (chats.length === 0) return null;
  const newest = (muted: boolean) =>
    chats
      .filter((c) => c.muted === muted && c.unread_count > 0 && newestUnreadAt.has(c.circle_id))
      .sort((a, b) => Date.parse(newestUnreadAt.get(b.circle_id)!) - Date.parse(newestUnreadAt.get(a.circle_id)!))[0];
  return (newest(false) ?? newest(true) ?? chats[0]).circle_id;
}

function lookbackStart(now: number): string {
  return new Date(now - UNREAD_LOOKBACK_DAYS * 86_400_000).toISOString();
}

export class ChatInboxService {
  /** GET /api/mobile/chats. */
  static async listChats(userId: string, now: number = Date.now()): Promise<ChatInbox> {
    const db = createAdminSupabase();

    const { data: memberRows, error: memberError } = await db
      .from('fitcircle_members')
      .select('fitcircle_id, joined_at')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (memberError) throw memberError;
    const memberships = (memberRows ?? []) as Array<{ fitcircle_id: string; joined_at: string | null }>;
    const circleIds = [...new Set(memberships.map((m) => m.fitcircle_id).filter(Boolean))];
    if (circleIds.length === 0) {
      return { chats: [], total_unread: 0, muted_unread: 0, default_circle_id: null };
    }

    const since = lookbackStart(now);
    const [circlesRes, stateRes, hiddenIds, windowRes] = await Promise.all([
      db.from('fitcircles').select('id, name, type, cover_image_url').in('id', circleIds),
      db
        .from('circle_chat_state')
        .select('fitcircle_id, last_read_at, muted')
        .eq('user_id', userId)
        .in('fitcircle_id', circleIds),
      this.blockedIdsFor([userId]).then((m) => m.get(userId) ?? new Set<string>()),
      db
        .from('circle_messages')
        .select('id, fitcircle_id, sender_id, created_at, deleted_at')
        .in('fitcircle_id', circleIds)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(INBOX_WINDOW_ROW_CAP),
    ]);
    if (circlesRes.error) throw circlesRes.error;
    if (stateRes.error) throw stateRes.error;
    if (windowRes.error) throw windowRes.error;

    const circleById = new Map(((circlesRes.data ?? []) as Row[]).map((c) => [c.id as string, c]));
    const stateById = new Map(((stateRes.data ?? []) as Row[]).map((s) => [s.fitcircle_id as string, s]));
    const windowRows = ((windowRes.data ?? []) as WindowRow[]).sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    );

    // Per circle: unread count, newest unread, newest visible message.
    const unread = new Map<string, number>();
    const newestUnreadAt = new Map<string, string>();
    const lastVisible = new Map<string, WindowRow>();
    for (const row of windowRows) {
      const circleId = row.fitcircle_id;
      if (!isVisibleTo(row, hiddenIds)) continue;
      if (!lastVisible.has(circleId)) lastVisible.set(circleId, row);
      const lastReadAt = (stateById.get(circleId)?.last_read_at as string | null) ?? null;
      if (isUnreadFor(row, userId, lastReadAt, hiddenIds)) {
        unread.set(circleId, (unread.get(circleId) ?? 0) + 1);
        if (!newestUnreadAt.has(circleId)) newestUnreadAt.set(circleId, row.created_at);
      }
    }

    // Circles silent for the whole window: one bounded fallback read.
    const silent = circleIds.filter((id) => !lastVisible.has(id));
    if (silent.length > 0) {
      const { data: older, error } = await db
        .from('circle_messages')
        .select('id, fitcircle_id, sender_id, created_at, deleted_at')
        .in('fitcircle_id', silent)
        .lt('created_at', since)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(silent.length * 10);
      if (error) throw error;
      for (const row of ((older ?? []) as WindowRow[]).sort(
        (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
      )) {
        if (!lastVisible.has(row.fitcircle_id) && isVisibleTo(row, hiddenIds)) lastVisible.set(row.fitcircle_id, row);
      }
    }

    // Detail for the chosen last messages + the names they need.
    const lastIds = [...lastVisible.values()].map((r) => r.id);
    const details = new Map<string, DetailRow>();
    if (lastIds.length > 0) {
      const { data, error } = await db
        .from('circle_messages')
        .select('id, fitcircle_id, sender_id, kind, body, system_payload, created_at, deleted_at')
        .in('id', lastIds);
      if (error) throw error;
      for (const r of (data ?? []) as DetailRow[]) details.set(r.id, r);
    }
    const nameIds = new Set<string>();
    for (const d of details.values()) {
      const id = d.sender_id ?? firstActorId(d);
      if (id) nameIds.add(id);
    }
    const names = new Map<string, string>();
    if (nameIds.size > 0) {
      const { data, error } = await db.from('profiles').select('id, display_name').in('id', [...nameIds]);
      if (error) throw error;
      for (const p of (data ?? []) as Row[]) names.set(p.id, ((p.display_name as string | null) ?? '').trim());
    }

    const joinedAt = new Map(memberships.map((m) => [m.fitcircle_id, m.joined_at]));
    const chats: InboxChat[] = circleIds
      .filter((id) => circleById.has(id))
      .map((id) => {
        const circle = circleById.get(id)!;
        const state = stateById.get(id);
        const last = lastVisible.get(id);
        const detail = last ? details.get(last.id) : undefined;
        const nameId = detail ? detail.sender_id ?? firstActorId(detail) : null;
        const lastMessage: InboxLastMessage | null = detail
          ? {
              id: detail.id,
              sender_id: detail.sender_id,
              sender_display_name: nameId ? names.get(nameId) || null : null,
              preview: previewOf(detail),
              kind: detail.kind,
              is_cheer: cheerOf(detail),
              created_at: detail.created_at,
            }
          : null;
        const avatar = typeof circle.cover_image_url === 'string' && circle.cover_image_url.startsWith('https://')
          ? (circle.cover_image_url as string)
          : null;
        return {
          circle_id: id,
          circle_name: (circle.name as string | null) ?? '',
          circle_avatar_url: avatar,
          circle_type: (circle.type as string | null) ?? null,
          unread_count: unread.get(id) ?? 0,
          muted: !!state?.muted,
          last_message: lastMessage,
          last_read_at: (state?.last_read_at as string | null) ?? null,
          last_activity_at: lastMessage?.created_at ?? joinedAt.get(id) ?? null,
        };
      })
      .sort((a, b) => {
        const at = a.last_activity_at ? Date.parse(a.last_activity_at) : 0;
        const bt = b.last_activity_at ? Date.parse(b.last_activity_at) : 0;
        return bt - at || a.circle_name.localeCompare(b.circle_name);
      });

    let total = 0;
    let muted = 0;
    for (const c of chats) {
      if (c.muted) muted += c.unread_count;
      else total += c.unread_count;
    }

    return {
      chats,
      total_unread: total,
      muted_unread: muted,
      default_circle_id: pickDefaultCircle(chats, newestUnreadAt),
    };
  }

  /**
   * total_unread (non-muted) for many users at once — the push badge for a
   * fan-out. Four queries regardless of how many recipients. Never throws:
   * users whose count could not be computed are absent from the map.
   */
  static async unreadTotals(userIds: string[], now: number = Date.now()): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const users = [...new Set(userIds.filter(Boolean))];
    if (users.length === 0) return out;
    try {
      const db = createAdminSupabase();
      const [memberRes, stateRes, hidden] = await Promise.all([
        db.from('fitcircle_members').select('user_id, fitcircle_id').in('user_id', users).eq('status', 'active'),
        db.from('circle_chat_state').select('user_id, fitcircle_id, last_read_at, muted').in('user_id', users),
        this.blockedIdsFor(users),
      ]);
      if (memberRes.error) throw memberRes.error;
      if (stateRes.error) throw stateRes.error;

      const circlesByUser = new Map<string, Set<string>>();
      for (const m of (memberRes.data ?? []) as Row[]) {
        const set = circlesByUser.get(m.user_id) ?? new Set<string>();
        set.add(m.fitcircle_id);
        circlesByUser.set(m.user_id, set);
      }
      const stateKey = (u: string, c: string) => `${u}:${c}`;
      const states = new Map(((stateRes.data ?? []) as Row[]).map((s) => [stateKey(s.user_id, s.fitcircle_id), s]));

      const allCircles = [...new Set([...circlesByUser.values()].flatMap((s) => [...s]))];
      let rows: WindowRow[] = [];
      if (allCircles.length > 0) {
        const { data, error } = await db
          .from('circle_messages')
          .select('id, fitcircle_id, sender_id, created_at, deleted_at')
          .in('fitcircle_id', allCircles)
          .gte('created_at', lookbackStart(now))
          .order('created_at', { ascending: false })
          .limit(BADGE_WINDOW_ROW_CAP);
        if (error) throw error;
        rows = (data ?? []) as WindowRow[];
      }
      const byCircle = new Map<string, WindowRow[]>();
      for (const r of rows) byCircle.set(r.fitcircle_id, [...(byCircle.get(r.fitcircle_id) ?? []), r]);

      for (const user of users) {
        const hiddenForUser = hidden.get(user) ?? new Set<string>();
        let total = 0;
        for (const circleId of circlesByUser.get(user) ?? []) {
          const state = states.get(stateKey(user, circleId));
          if (state?.muted) continue;
          const lastReadAt = (state?.last_read_at as string | null) ?? null;
          for (const r of byCircle.get(circleId) ?? []) {
            if (isUnreadFor(r, user, lastReadAt, hiddenForUser)) total += 1;
          }
        }
        out.set(user, total);
      }
    } catch (err) {
      console.error('[ChatInboxService.unreadTotals] badge skipped:', err);
    }
    return out;
  }

  /** Bidirectional block sets for several users in one query (user → ids hidden from them). */
  static async blockedIdsFor(userIds: string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    const users = [...new Set(userIds.filter(Boolean))];
    if (users.length === 0) return out;
    const list = users.join(',');
    const { data, error } = await createAdminSupabase()
      .from('circle_member_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.in.(${list}),blocked_id.in.(${list})`);
    if (error) throw error;
    const add = (user: string, other: string) => {
      const set = out.get(user) ?? new Set<string>();
      set.add(other);
      out.set(user, set);
    };
    const wanted = new Set(users);
    for (const r of (data ?? []) as Array<{ blocker_id: string; blocked_id: string }>) {
      if (wanted.has(r.blocker_id)) add(r.blocker_id, r.blocked_id);
      if (wanted.has(r.blocked_id)) add(r.blocked_id, r.blocker_id);
    }
    return out;
  }
}
