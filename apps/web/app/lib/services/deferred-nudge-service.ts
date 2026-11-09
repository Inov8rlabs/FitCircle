/**
 * Releases nudges held by quiet hours (retention fix 2). Policy is pure
 * (lib/notifications/quiet-hours-deferral.ts); NotificationOrchestrator.send
 * writes the held rows. Runs every 15 minutes inside the meal-reminders cron,
 * before the Day-1 and meal passes, so a released nudge is in notification_log
 * (cap, dedupe, suppression chains) before they run.
 *
 * Per user with due rows: at most ONE release (highest priority, see
 * DEFERRABLE_PRIORITY), the rest closed as superseded; nothing more when a held
 * nudge was already released in the last 12 h. The release is claimed with a
 * conditional update (`… where suppression_reason = 'deferred_quiet_hours'`),
 * so overlapping runs can't both send it. Before sending, it re-checks the nudge
 * still makes sense (onboarding not finished / meal not logged since / app not
 * opened this morning); then send() applies prefs, the cap, quiet hours and the
 * dedupe key again.
 */
import { MORNING_STARTS_HOUR } from '../journey/day1-morning';
import {
  DEFERRED_LOOKBACK_HOURS,
  DEFERRED_REASON,
  DEFERRABLE_PRIORITY,
  ONE_RELEASE_PER_HOURS,
  planRelease,
  type DeferredOutcome,
  type DeferredRow,
} from '../notifications/quiet-hours-deferral';
import { DEFAULT_NOTIFICATION_TZ, isPlaceholderTimezone, localClockIn } from '../notifications/user-timezone';
import { createAdminSupabase } from '../supabase-admin';

import { AppOpenService } from './app-open-service';
import { NotificationOrchestrator, startOfLocalDay, type NotificationType } from './notification-orchestrator';

export interface DeferredReleaseSummary {
  heldUsers: number;
  released: number;
  sent: number;
  closed: Record<string, number>;
  notSent: Record<string, number>;
}

const HOLD_KEYS = new Set(['deferUntil', 'deferExpiresAt', 'timezone']);
const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

export class DeferredNudgeService {
  static async releaseDue(opts: { now?: Date; userId?: string } = {}): Promise<DeferredReleaseSummary> {
    const now = opts.now ?? new Date();
    const summary: DeferredReleaseSummary = { heldUsers: 0, released: 0, sent: 0, closed: {}, notSent: {} };
    const db = createAdminSupabase();
    let q = db
      .from('notification_log')
      .select('id, user_id, notification_type, sent_at, data, suppression_reason')
      .in('notification_type', [...DEFERRABLE_PRIORITY])
      .eq('suppressed', true)
      .eq('suppression_reason', DEFERRED_REASON)
      .gte('sent_at', new Date(now.getTime() - DEFERRED_LOOKBACK_HOURS * 3_600_000).toISOString());
    if (opts.userId) q = q.eq('user_id', opts.userId);
    const { data, error } = await q;
    if (error) throw new Error(`deferred nudges read failed: ${error.message}`);
    const held = (data ?? []) as DeferredRow[];
    if (!held.length) return summary;

    const byUser = new Map<string, DeferredRow[]>();
    for (const r of held) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
    summary.heldUsers = byUser.size;

    // Released in the last 12 h → no second one this morning.
    const { data: releasedRows } = await db
      .from('notification_log')
      .select('user_id, data')
      .in('user_id', [...byUser.keys()])
      .eq('suppression_reason', 'deferred_released')
      .gte('sent_at', new Date(now.getTime() - (DEFERRED_LOOKBACK_HOURS + ONE_RELEASE_PER_HOURS) * 3_600_000).toISOString());
    const releasedRecently = new Set(
      ((releasedRows ?? []) as Array<{ user_id: string; data: Record<string, any> | null }>)
        .filter((r) => now.getTime() - Date.parse(String(r.data?.releasedAt ?? '')) < ONE_RELEASE_PER_HOURS * 3_600_000)
        .map((r) => r.user_id)
    );

    for (const [userId, rows] of byUser) {
      try {
        const plan = planRelease(rows, now, releasedRecently.has(userId));
        for (const { row, outcome } of plan.close) {
          if (await this.close(row, outcome, now)) bump(summary.closed, outcome);
        }
        if (!plan.release) continue;
        const row = plan.release;
        if (!(await this.close(row, 'deferred_released', now))) continue; // another run took it
        summary.released++;
        const stale = await this.staleReason(row, now);
        if (stale) {
          await this.setOutcome(row, 'deferred_stale', { staleReason: stale });
          bump(summary.closed, `deferred_stale:${stale}`);
          continue;
        }
        const payload: Record<string, any> = {};
        for (const [k, v] of Object.entries(row.data ?? {})) if (!HOLD_KEYS.has(k)) payload[k] = v;
        const res = await NotificationOrchestrator.send(userId, row.notification_type, { ...payload, deferredRelease: true, deferredFrom: row.id });
        if (res.sent) summary.sent++;
        else bump(summary.notSent, res.reason ?? 'not_sent');
      } catch (err: any) {
        console.error('[DeferredNudge] release failed for', userId, err?.message ?? err);
        bump(summary.notSent, 'error');
      }
    }
    if (summary.released || Object.keys(summary.closed).length) console.log('[DeferredNudge] run', JSON.stringify(summary));
    return summary;
  }

  /** Conditional close: only while the row is still held. True when this call closed it. */
  private static async close(row: DeferredRow, outcome: DeferredOutcome, now: Date): Promise<boolean> {
    const { data, error } = await createAdminSupabase()
      .from('notification_log')
      .update({ suppression_reason: outcome, data: { ...(row.data ?? {}), ...(outcome === 'deferred_released' ? { releasedAt: now.toISOString() } : { closedAt: now.toISOString() }) } })
      .eq('id', row.id)
      .eq('suppression_reason', DEFERRED_REASON)
      .select('id');
    if (error) {
      console.warn('[DeferredNudge] close failed:', row.id, error.message);
      return false;
    }
    return (data ?? []).length > 0;
  }

  private static async setOutcome(row: DeferredRow, outcome: DeferredOutcome, extra: Record<string, unknown>): Promise<void> {
    await createAdminSupabase()
      .from('notification_log')
      .update({ suppression_reason: outcome, data: { ...(row.data ?? {}), ...extra } })
      .eq('id', row.id);
  }

  /** Why a held nudge no longer makes sense, or null. Fails open (null) on read errors. */
  static async staleReason(row: DeferredRow, now: Date): Promise<string | null> {
    const db = createAdminSupabase();
    const type: NotificationType = row.notification_type;
    try {
      if (type === 'onboarding_finish_reminder') {
        const { data } = await db.from('profiles').select('onboarding_completed').eq('id', row.user_id).maybeSingle();
        return (data as { onboarding_completed?: boolean } | null)?.onboarding_completed === true ? 'onboarding_completed' : null;
      }
      if (type === 'day1_morning') {
        const tzRaw = String(row.data?.timezone ?? '');
        const tz = isPlaceholderTimezone(tzRaw) ? DEFAULT_NOTIFICATION_TZ : tzRaw;
        const morning = new Date(startOfLocalDay(tz, now).getTime() + MORNING_STARTS_HOUR * 3_600_000);
        return (await AppOpenService.openedSince(row.user_id, morning, localClockIn(now, tz).date)) ? 'opened_this_morning' : null;
      }
      if (type.startsWith('meal_reminder_')) {
        const { data } = await db
          .from('food_log_entries')
          .select('id')
          .eq('user_id', row.user_id)
          .eq('entry_type', 'food')
          .is('deleted_at', null)
          .gte('created_at', row.sent_at)
          .limit(1);
        return (data ?? []).length > 0 ? 'meal_logged_since' : null;
      }
    } catch {
      return null;
    }
    return null;
  }
}
