// Circle Chat — Daily Summary Service (Build Spec v1.2 §3 daily_summary).
//
// The daily_summary is the ONE system post that is time-driven (once/day per
// circle), not event-driven. Every other system post originates from an activity
// SIGNAL emitted by a source-service hook; this one is emitted by a cron.
//
// Responsibilities:
//   * Find all currently-running fitcircles (status='active').
//   * For each: count active members and how many "checked in" today.
//   * Build a daily_summary ActivitySignal and hand it to the SystemPostEngine,
//     which owns rate-limit / quiet-hours / bundling / copy / the actual write.
//   * Enforce ONCE-PER-DAY idempotency the engine does NOT provide (the engine
//     dedupes by bundle window / caps, never by calendar day) — we check
//     circle_messages for an existing daily_summary since local (UTC) midnight
//     and skip if present, so cron retries never double-post.
//
// Failure-isolated PER CIRCLE: one circle's DB error must not abort the batch.

import { createAdminSupabase } from '../supabase-admin';
import { SystemPostEngine } from './system-post-engine';
import type { ActivitySignal } from '../types/circle-chat-engine';

/**
 * "Checked in today" definition
 * --------------------------------
 * A member is counted as checked in if they have >=1 row in
 * `engagement_activities` with `activity_date` == today (UTC). That table is the
 * product-wide record of "the user did something trackable today" (food logs,
 * manual claims, workouts, etc. all funnel through EngagementStreakService /
 * recordActivity), so it is the broadest, most defensible single source for
 * daily participation — broader than food_log_entries alone, and already the
 * table the streak system treats as the canonical daily-activity signal.
 *
 * We intentionally use `activity_date` (a DATE column) rather than a timestamp
 * so the comparison is a simple calendar-day match and needs no per-user
 * timezone math here; the cron's schedule decides "when the day ends".
 */
export interface DailySummaryResult {
  circlesProcessed: number;
  postsAttempted: number;
}

interface ActiveCircleRow {
  id: string;
  name: string | null;
  creator_id: string | null;
}

export class DailySummaryService {
  /**
   * Generate (at most) one daily_summary per currently-running circle.
   * Returns a batch summary. Never throws on a single circle's failure.
   */
  static async generateForAllActiveCircles(): Promise<DailySummaryResult> {
    const supabaseAdmin = createAdminSupabase();
    const engine = new SystemPostEngine();
    const nowISO = new Date().toISOString();
    const todayDate = nowISO.split('T')[0]; // YYYY-MM-DD (UTC)
    const localMidnightISO = `${todayDate}T00:00:00.000Z`;

    let circlesProcessed = 0;
    let postsAttempted = 0;

    // 1. All currently-running circles.
    const { data: circles, error: circlesError } = await supabaseAdmin
      .from('fitcircles')
      .select('id, name, creator_id')
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
        circlesProcessed++;

        // 2. Idempotency: skip if a daily_summary already exists for this circle
        //    since local (UTC) midnight. The engine does NOT dedupe by day.
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

        // 3. Active members of this circle.
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

        // 4. How many checked in today (any engagement activity today).
        let checkedIn = 0;
        if (memberIds.length > 0) {
          const { data: activities, error: activityError } = await supabaseAdmin
            .from('engagement_activities')
            .select('user_id')
            .eq('activity_date', todayDate)
            .in('user_id', memberIds);

          if (activityError) throw activityError;

          checkedIn = new Set(
            (activities ?? []).map((a) => a.user_id as string)
          ).size;
        }

        // 5. Build the signal. The circle is the actor for a circle-wide summary;
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
