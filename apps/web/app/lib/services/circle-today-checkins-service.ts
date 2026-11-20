// Circle Chat — today's check-in status (1.1.5).
//
// The nightly daily_summary system post ("1 of 10 checked in today") filled
// the chat thread with one card per day. 1.1.5 clients hide those posts and
// show a live "Today: N of M checked in" strip outside the thread instead,
// fed by this status on the first page of GET /circles/:id/messages.
//
// Same definition as DailySummaryService, so the strip and the stored summary
// never disagree: an active member is "checked in" when they have >= 1
// engagement_activities row whose activity_date is the CIRCLE's local date
// (fitcircles.timezone). Read-only; no migration, no stored procedures.
//
// Older apps are unaffected: they ignore the extra key and keep rendering the
// stored summary posts, which the cron still writes.

import { createAdminSupabase } from '../supabase-admin';
import { getDateInTimezone } from '../utils/timezone';

import { DailySummaryService } from './daily-summary-service';
import { startOfLocalDay } from './notification-orchestrator';

export interface TodayCheckinMember {
  id: string;
  name: string;
  avatarUrl: string | null;
  checkedIn: boolean;
}

export interface TodayCheckinsDTO {
  /** The circle-local day being counted (YYYY-MM-DD). */
  date: string;
  /** IANA zone the day is measured in (the circle's). */
  timezone: string;
  /** Next circle-local midnight (ISO): the status resets to 0 then. */
  resetsAt: string;
  checkedIn: number;
  total: number;
  viewerCheckedIn: boolean;
  /** Active members: checked in first, then by name. */
  members: TodayCheckinMember[];
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export class CircleTodayCheckinsService {
  /** Next local midnight after `now` in `timeZone` (DST-safe: 23h and 25h days). */
  static nextLocalMidnight(timeZone: string, now: Date): Date {
    const start = startOfLocalDay(timeZone, now);
    // 36h past today's midnight is always inside tomorrow, whatever its length.
    return startOfLocalDay(timeZone, new Date(start.getTime() + 36 * 3600 * 1000));
  }

  /** PURE: assemble the DTO. */
  static build(params: {
    date: string;
    timezone: string;
    resetsAt: Date;
    viewerId: string;
    memberIds: string[];
    checkedInIds: Set<string>;
    profiles: Map<string, ProfileRow>;
  }): TodayCheckinsDTO {
    const members: TodayCheckinMember[] = params.memberIds.map((id) => {
      const p = params.profiles.get(id);
      return {
        id,
        name: (p?.display_name ?? '').trim(),
        avatarUrl: p?.avatar_url ?? null,
        checkedIn: params.checkedInIds.has(id),
      };
    });
    members.sort((a, b) => {
      if (a.checkedIn !== b.checkedIn) return a.checkedIn ? -1 : 1;
      return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    });
    return {
      date: params.date,
      timezone: params.timezone,
      resetsAt: params.resetsAt.toISOString(),
      checkedIn: members.filter((m) => m.checkedIn).length,
      total: members.length,
      viewerCheckedIn: params.checkedInIds.has(params.viewerId),
      members,
    };
  }

  /**
   * Today's status for one circle. Fails open: any error returns null so the
   * messages page it rides on is never sunk by it.
   */
  static async forCircle(circleId: string, viewerId: string, now: Date = new Date()): Promise<TodayCheckinsDTO | null> {
    try {
      const supabaseAdmin = createAdminSupabase();

      const { data: circle, error: circleError } = await supabaseAdmin
        .from('fitcircles')
        .select('id, timezone')
        .eq('id', circleId)
        .maybeSingle();
      if (circleError) throw circleError;
      if (!circle) return null;

      const timezone = DailySummaryService.circleTimezone((circle as { timezone: string | null }).timezone);
      const date = getDateInTimezone(now, timezone);

      const { data: members, error: membersError } = await supabaseAdmin
        .from('fitcircle_members')
        .select('user_id')
        .eq('fitcircle_id', circleId)
        .eq('status', 'active');
      if (membersError) throw membersError;

      const memberIds = [...new Set((members ?? []).map((m: { user_id: string }) => m.user_id).filter(Boolean))];

      let checkedInIds = new Set<string>();
      const profiles = new Map<string, ProfileRow>();
      if (memberIds.length > 0) {
        const [activities, profileRows] = await Promise.all([
          supabaseAdmin
            .from('engagement_activities')
            .select('user_id')
            .eq('activity_date', date)
            .in('user_id', memberIds),
          supabaseAdmin.from('profiles').select('id, display_name, avatar_url').in('id', memberIds),
        ]);
        if (activities.error) throw activities.error;
        checkedInIds = new Set((activities.data ?? []).map((a: { user_id: string }) => a.user_id));
        // Names are nice-to-have; a profile error leaves them blank.
        for (const p of (profileRows.data ?? []) as ProfileRow[]) profiles.set(p.id, p);
      }

      return this.build({
        date,
        timezone,
        resetsAt: this.nextLocalMidnight(timezone, now),
        viewerId,
        memberIds,
        checkedInIds,
        profiles,
      });
    } catch (err) {
      console.error(`[CircleTodayCheckinsService.forCircle] ${circleId}:`, err);
      return null;
    }
  }
}
