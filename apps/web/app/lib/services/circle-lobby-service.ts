/**
 * CircleLobbyService — "starts when your crew is in" (REFERRALS_SPEC §10.2).
 *
 * A lobby circle is an ordinary `upcoming` circle whose start_date is the
 * auto-start deadline (now + 72h) and whose metadata.lobby remembers the
 * crew size and challenge length. Because circle status is date-based, every
 * existing path (lists, invites, cron status flips) keeps working untouched;
 * this service only moves the dates EARLIER when the crew fills (or the
 * creator starts it), and announces the kickoff (chat + push).
 */
import { addDays, localToday } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';

import type * as OrchestratorModule from './notification-orchestrator';

export const LOBBY_AUTO_START_HOURS = 72;

export interface LobbyMeta {
  minMembers: number;
  durationDays: number;
  openedAt: string;
  autoStartAt: string;
  startedAt: string | null;
  startReason?: 'full' | 'timer' | 'manual';
}

export interface LobbyView {
  minMembers: number;
  memberCount: number;
  needed: number;
  autoStartAt: string;
  startedAt: string | null;
}

interface CircleRow {
  id: string;
  name: string;
  creator_id: string;
  start_date: string;
  end_date: string;
  timezone: string | null;
  metadata: Record<string, any> | null;
}

const DAY_MS = 86_400_000;

/** One shared module promise: a burst of pushes resolves the import once. */
let orchestrator: Promise<typeof OrchestratorModule> | null = null;

/** Fire-and-forget push. */
function push(userId: string, type: string, data: Record<string, unknown>): void {
  (orchestrator ??= import('./notification-orchestrator'))
    .then(({ NotificationOrchestrator }) => NotificationOrchestrator.send(userId, type as any, data))
    .catch((err) => console.error('[CircleLobbyService] push failed:', type, err?.message));
}

export class CircleLobbyService {
  /**
   * Dates + metadata for a new lobby circle. `startDate`/`endDate` are the
   * requested calendar days (their difference is the challenge length).
   */
  static plan(startDate: string, endDate: string, minMembers: number, now: Date = new Date()) {
    const durationDays = Math.max(1, Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY_MS));
    const autoStart = new Date(now.getTime() + LOBBY_AUTO_START_HOURS * 3600_000);
    const start = autoStart.toISOString().slice(0, 10);
    const lobby: LobbyMeta = {
      minMembers,
      durationDays,
      openedAt: now.toISOString(),
      autoStartAt: autoStart.toISOString(),
      startedAt: null,
    };
    return { start_date: start, end_date: addDays(start, durationDays), lobby };
  }

  /** Client-facing lobby block (null for normal circles and after kickoff+1 day). */
  static view(circle: { metadata?: Record<string, any> | null }, memberCount: number): LobbyView | null {
    const lobby = circle.metadata?.lobby as LobbyMeta | undefined;
    if (!lobby) return null;
    return {
      minMembers: lobby.minMembers,
      memberCount,
      needed: lobby.startedAt ? 0 : Math.max(0, lobby.minMembers - memberCount),
      autoStartAt: lobby.autoStartAt,
      startedAt: lobby.startedAt ?? null,
    };
  }

  /** A member joined: kick off if the crew is now big enough. Never throws. */
  static async onMemberJoined(circleId: string): Promise<void> {
    try {
      const circle = await this.load(circleId);
      const lobby = circle?.metadata?.lobby as LobbyMeta | undefined;
      if (!circle || !lobby || lobby.startedAt) return;
      if ((await this.memberCount(circleId)) >= lobby.minMembers) await this.kickoff(circle, 'full');
    } catch (err: any) {
      console.error('[CircleLobbyService] onMemberJoined failed:', circleId, err?.message);
    }
  }

  /** Creator taps "Start now". */
  static async startNow(circleId: string, userId: string): Promise<'started' | 'not_lobby' | 'forbidden' | 'already_started'> {
    const circle = await this.load(circleId);
    const lobby = circle?.metadata?.lobby as LobbyMeta | undefined;
    if (!circle || !lobby) return 'not_lobby';
    if (circle.creator_id !== userId) return 'forbidden';
    if (lobby.startedAt) return 'already_started';
    return (await this.kickoff(circle, 'manual')) ? 'started' : 'already_started';
  }

  /** Cron: lobbies whose 72h timer ran out start anyway. */
  static async autoStartDue(limit = 200): Promise<number> {
    const supabase = createAdminSupabase();
    const { data } = await supabase
      .from('fitcircles')
      .select('id, name, creator_id, start_date, end_date, timezone, metadata')
      .not('metadata->lobby', 'is', null)
      .limit(limit);
    let started = 0;
    for (const c of (data ?? []) as CircleRow[]) {
      const lobby = c.metadata?.lobby as LobbyMeta | undefined;
      if (!lobby || lobby.startedAt || Date.parse(lobby.autoStartAt) > Date.now()) continue;
      if (await this.kickoff(c, 'timer')) started++;
    }
    return started;
  }

  /**
   * Start the circle today (circle-local), keep the challenge length, mark the
   * lobby started, announce it. Compare-and-set on start_date so concurrent
   * joins kick off exactly once.
   */
  private static async kickoff(circle: CircleRow, reason: 'full' | 'timer' | 'manual'): Promise<boolean> {
    const supabase = createAdminSupabase();
    const lobby = circle.metadata!.lobby as LobbyMeta;
    const today = localToday(circle.timezone);
    // The timer path already reached its start date: keep the dates, just mark it started.
    const start = reason === 'timer' && circle.start_date.slice(0, 10) <= today ? circle.start_date.slice(0, 10) : today;
    const startedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from('fitcircles')
      .update({
        start_date: start,
        end_date: addDays(start, lobby.durationDays),
        status: 'active',
        metadata: { ...(circle.metadata ?? {}), lobby: { ...lobby, startedAt, startReason: reason } },
        updated_at: startedAt,
      })
      .eq('id', circle.id)
      .eq('start_date', circle.start_date)
      .select('id');
    if (error) throw error;
    if ((data ?? []).length !== 1) return false;

    const members = await this.memberIds(circle.id);
    const { ChatActivityHooks } = await import('./chat-activity-hooks');
    void ChatActivityHooks.onCircleKickoff(circle.id, circle.name, members.length, reason);
    for (const id of members) {
      if (reason === 'manual' && id === circle.creator_id) continue; // they just tapped it
      push(id, 'circle_kickoff', { circleName: circle.name, circleId: circle.id, kickoffReason: reason });
    }
    return true;
  }

  private static async load(circleId: string): Promise<CircleRow | null> {
    const { data } = await createAdminSupabase()
      .from('fitcircles')
      .select('id, name, creator_id, start_date, end_date, timezone, metadata')
      .eq('id', circleId)
      .maybeSingle();
    return (data as CircleRow | null) ?? null;
  }

  private static async memberIds(circleId: string): Promise<string[]> {
    const { data } = await createAdminSupabase()
      .from('fitcircle_members')
      .select('user_id')
      .eq('fitcircle_id', circleId)
      .eq('status', 'active');
    return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
  }

  private static async memberCount(circleId: string): Promise<number> {
    return (await this.memberIds(circleId)).length;
  }
}
