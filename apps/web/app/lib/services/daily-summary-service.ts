// Circle Chat — Daily Summary Service (Build Spec v1.2 §3 daily_summary).
//
// The daily_summary is the ONE system post that is time-driven (once/day per
// circle), not event-driven. Every other system post originates from an activity
// SIGNAL emitted by a source-service hook; this one is emitted by a cron.
//
// Responsibilities:
//   * Find all currently-running fitcircles (status='active').
//   * For each, in the CIRCLE'S OWN TIMEZONE (fitcircles.timezone): once the
//     local day is nearly over, count active members and how many checked in
//     that local day. The cron runs hourly; a circle posts at the first tick
//     at/after 21:00 local, and only once per local day.
//   * Post only when at least one member checked in.
//   * Build a daily_summary ActivitySignal and hand it to the SystemPostEngine,
//     which owns rate-limit / quiet-hours / bundling / copy / the actual write.
//   * Enforce ONCE-PER-LOCAL-DAY idempotency the engine does NOT provide, so
//     hourly ticks and cron retries never double-post.
//
// Why local time (2026-09-22): the old 20:00 UTC run fired at 16:00 Eastern,
// before dinner and the evening workout, and compared against the UTC date —
// which is why the circle alternated "1 of 2" / "0 of 2" all week.
//
// Failure-isolated PER CIRCLE: one circle's DB error must not abort the batch.

import { createAdminSupabase } from '../supabase-admin';
import type { ActivitySignal } from '../types/circle-chat-engine';
import { getDateInTimezone } from '../utils/timezone';

// utils/timezone.getStartOfDayUTC is a stub that returns UTC midnight of the
// date string; for a 21:00 Eastern run that window would reach back into the
// previous local evening and swallow that day's summary as "already posted".
import { startOfLocalDay } from './notification-orchestrator';
import { SystemPostEngine } from './system-post-engine';

/**
 * "Checked in today" definition
 * --------------------------------
 * A member is counted as checked in if they have >=1 row in
 * `engagement_activities` with `activity_date` == the circle's local date. That
 * table is the product-wide record of "the user did something trackable today"
 * (food logs, manual claims, workouts, etc. all funnel through
 * EngagementStreakService / recordActivity), so it is the broadest, most
 * defensible single source for daily participation. `activity_date` is written
 * as the USER's local date, which for a circle of people in one region matches
 * the circle's local date.
 */
export interface DailySummaryResult {
  circlesProcessed: number;
  postsAttempted: number;
}

interface ActiveCircleRow {
  id: string;
  name: string | null;
  creator_id: string | null;
  timezone: string | null;
}

/** First local hour at which a circle's day is summarized. */
export const SUMMARY_LOCAL_HOUR = 21;
const DEFAULT_TIMEZONE = 'America/New_York';

export class DailySummaryService {
  // ---- pure decisions (unit-tested) -------------------------------------------

  /** A summary is worth posting only when at least one member checked in. */
  static shouldPostSummary(checkedIn: number, total: number): boolean {
    return total >= 1 && checkedIn >= 1;
  }

  /** The hourly cron only summarizes a circle once its local evening has arrived. */
  static isSummaryHour(localHour: number): boolean {
    return localHour >= SUMMARY_LOCAL_HOUR;
  }

  /** Hour of day (0–23) in an IANA timezone; falls back to the default zone on a bad id. */
  static localHour(now: Date, timeZone: string): number {
    try {
      const text = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(now);
      const hour = Number.parseInt(text, 10);
      return Number.isFinite(hour) ? hour % 24 : this.localHour(now, DEFAULT_TIMEZONE);
    } catch {
      return timeZone === DEFAULT_TIMEZONE ? now.getUTCHours() : this.localHour(now, DEFAULT_TIMEZONE);
    }
  }

  static circleTimezone(raw: string | null | undefined): string {
    const tz = (raw ?? '').trim();
    if (!tz) return DEFAULT_TIMEZONE;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return tz;
    } catch {
      return DEFAULT_TIMEZONE;
    }
  }

  // ---- entrypoint ---------------------------------------------------------------

  /**
   * Generate (at most) one daily_summary per currently-running circle whose
   * local day is ending. Returns a batch summary. Never throws on a single
   * circle's failure.
   */
  static async generateForAllActiveCircles(now: Date = new Date()): Promise<DailySummaryResult> {
    const supabaseAdmin = createAdminSupabase();
    const engine = new SystemPostEngine();
    const nowISO = now.toISOString();

    let circlesProcessed = 0;
    let postsAttempted = 0;

    // 1. All currently-running circles, with the zone their day is measured in.
    const { data: circles, error: circlesError } = await supabaseAdmin
      .from('fitcircles')
      .select('id, name, creator_id, timezone')
      .eq('status', 'active');

    if (circlesError) {
      console.error(
        '[DailySummaryService.generateForAllActiveCircles] Failed to load active circles:',
        circlesError
      );
      throw circlesError;
    }

    const activeCircles = (circles ?? []) as ActiveCircleRow[];

    for (const circle of activeCircles) {
      // Failure-isolated per circle: a single circle's error never aborts the batch.
      try {
        const timeZone = this.circleTimezone(circle.timezone);

        // 2. Not evening yet in this circle's zone → nothing to do this tick.
        if (!this.isSummaryHour(this.localHour(now, timeZone))) {
          continue;
        }
        circlesProcessed++;

        const localDate = getDateInTimezone(now, timeZone); // YYYY-MM-DD in the circle's zone
        const localMidnightISO = startOfLocalDay(timeZone, now).toISOString();

        // 3. Idempotency: skip if a daily_summary already exists for this circle
        //    since ITS local midnight. The engine does NOT dedupe by day.
        const { count: existingCount, error: existingError } = await supabaseAdmin
          .from('circle_messages')
          .select('id', { count: 'exact', head: true })
          .eq('fitcircle_id', circle.id)
          .eq('kind', 'system_event')
          .eq('system_event_type', 'daily_summary')
          .gte('created_at', localMidnightISO);

        if (existingError) throw existingError;
        if ((existingCount ?? 0) > 0) {
          continue; // already summarized today
        }

        // 4. Active members of this circle.
        const { data: members, error: membersError } = await supabaseAdmin
          .from('fitcircle_members')
          .select('user_id')
          .eq('fitcircle_id', circle.id)
          .eq('status', 'active');

        if (membersError) throw membersError;

        const memberIds = [
          ...new Set((members ?? []).map((m) => m.user_id as string).filter(Boolean)),
        ];
        const total = memberIds.length;

        // Only post for circles with >=1 active member.
        if (total < 1) {
          continue;
        }

        // 5. How many checked in on the circle's local day.
        let checkedIn = 0;
        if (memberIds.length > 0) {
          const { data: activities, error: activityError } = await supabaseAdmin
            .from('engagement_activities')
            .select('user_id')
            .eq('activity_date', localDate)
            .in('user_id', memberIds);

          if (activityError) throw activityError;

          checkedIn = new Set(
            (activities ?? []).map((a) => a.user_id as string)
          ).size;
        }

        // 6. Nothing to celebrate: "0 of N checked in" is not a message anyone
        //    wants (product decision 2026-09-22). Post only when someone did.
        if (!DailySummaryService.shouldPostSummary(checkedIn, total)) {
          continue;
        }

        // 7. Build the signal. The circle is the actor for a circle-wide summary;
        //    actorName is the circle's display name (used by the renderer's
        //    fallbacks even though daily_summary copy is name-agnostic), and
        //    actorUserId stands in as the creator when available, else the
        //    circle id, so the engine's payload always has a stable actor id.
        const signal: ActivitySignal = {
          fitcircleId: circle.id,
          actorUserId: circle.creator_id ?? circle.id,
          actorName: circle.name ?? 'Your circle',
          eventType: 'daily_summary',
          refId: null,
          occurredAt: nowISO,
          payload: { checkedIn, total },
        };

        postsAttempted++;
        // The engine handles rate-limit / quiet-hours / dedupe-by-window and the
        // write. It is itself failure-isolated (never throws), but we await so
        // the batch is sequential and predictable.
        await engine.ingest(signal);
      } catch (err) {
        console.error(
          `[DailySummaryService.generateForAllActiveCircles] Failed for circle ${circle.id}:`,
          err
        );
        // Swallow and continue with the next circle.
      }
    }

    return { circlesProcessed, postsAttempted };
  }
}
