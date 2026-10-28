/**
 * "Your trial ends tomorrow" push (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §3.2,
 * §5.7). Hourly cron: /api/cron/trial-reminders.
 *
 * Candidates: trialing + will_renew + not yet reminded + trial_ends_at within
 * the next 40 h. Timing is pure (lib/trials/reminder.ts): 10:00 local the day
 * before the trial ends, or right away when that moment has passed. Quiet
 * hours defer to the next run. The push goes through NotificationOrchestrator
 * as `trial_ending_reminder` — cap-exempt and never blocked by a category
 * toggle (transactional), still subject to the push master switch, quiet
 * hours and the dedupe guard.
 *
 * profiles.trial_reminder_sent_at is stamped once the attempt is final
 * (delivered, or nothing that a retry would fix) so each trial gets one
 * reminder; a new trial clears it (SubscriptionService.trialPatchFor).
 *
 * Kill switch: TRIAL_REMINDERS_ENABLED=false (default ON).
 */
import { isValidTimezone } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';
import { decideTrialReminder, REMINDER_LAST_CALL_MS, REMINDER_LOOKAHEAD_MS, type TrialReminderSkip } from '../trials/reminder';

import { NotificationOrchestrator, isWithinQuietWindow } from './notification-orchestrator';
import { NotificationPreferencesService } from './notification-preferences-service';

const DEFAULT_TZ = 'America/New_York';
/** Orchestrator outcomes that end this trial's reminder (a retry wouldn't help). */
const FINAL_REASONS = new Set(['no_delivery', 'category_disabled', 'duplicate', 'unknown_type']);

export function trialRemindersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.TRIAL_REMINDERS_ENABLED ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

export const trialReminderDedupeKey = (userId: string, trialEndsAt: string) => `trial_reminder:${userId}:${trialEndsAt.slice(0, 16)}`;

export interface TrialReminderRunSummary {
  enabled: boolean;
  candidates: number;
  sent: number;
  skipped: Record<string, number>;
}

interface Candidate {
  id: string;
  timezone: string | null;
  trial_ends_at: string;
}

/** Minutes past local midnight in `timezone`. */
function localMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
}

export class TrialReminderService {
  static async run(opts: { now?: Date; userId?: string } = {}): Promise<TrialReminderRunSummary> {
    const now = opts.now ?? new Date();
    const summary: TrialReminderRunSummary = { enabled: trialRemindersEnabled(), candidates: 0, sent: 0, skipped: {} };
    if (!summary.enabled) return summary;
    const bump = (k: string) => (summary.skipped[k] = (summary.skipped[k] ?? 0) + 1);

    const supabase = createAdminSupabase();
    let query = supabase
      .from('profiles')
      .select('id, timezone, trial_ends_at')
      .eq('subscription_status', 'trialing')
      .eq('subscription_will_renew', true)
      .is('trial_reminder_sent_at', null)
      .gt('trial_ends_at', new Date(now.getTime() + REMINDER_LAST_CALL_MS).toISOString())
      .lte('trial_ends_at', new Date(now.getTime() + REMINDER_LOOKAHEAD_MS).toISOString());
    if (opts.userId) query = query.eq('id', opts.userId);
    const { data, error } = await query.limit(1000);
    if (error) throw new Error(`trial reminder candidates read failed: ${error.message}`);
    const candidates = (data ?? []) as Candidate[];
    summary.candidates = candidates.length;

    for (const c of candidates) {
      try {
        const outcome = await this.remindOne(c, now);
        if (outcome === 'sent') summary.sent++;
        else bump(outcome);
      } catch (err: any) {
        console.error('[TrialReminderService] failed for', c.id, err?.message ?? err);
        bump('error');
      }
    }
    if (summary.sent || Object.keys(summary.skipped).length) console.log('[TrialReminderService] run', JSON.stringify(summary));
    return summary;
  }

  /** One candidate → 'sent' or the reason it wasn't (yet). */
  static async remindOne(c: Candidate, now: Date): Promise<'sent' | TrialReminderSkip | string> {
    const prefs = await NotificationPreferencesService.getPreferences(c.id).catch(() => null);
    const tz = [prefs?.quiet_hours_timezone, c.timezone].find((z) => isValidTimezone(z)) ?? DEFAULT_TZ;
    const inQuietHours =
      !!prefs?.quiet_hours_start && !!prefs?.quiet_hours_end && isWithinQuietWindow(localMinutes(now, tz), prefs.quiet_hours_start, prefs.quiet_hours_end);

    const decision = decideTrialReminder({ now, trialEndsAt: new Date(c.trial_ends_at), timezone: tz, inQuietHours });
    if (!decision.send) return decision.skip;

    const res = await NotificationOrchestrator.send(c.id, 'trial_ending_reminder', {
      dedupeKey: trialReminderDedupeKey(c.id, c.trial_ends_at),
      trialEndsAt: c.trial_ends_at,
    });
    if (res.sent || FINAL_REASONS.has(res.reason ?? '')) {
      const { error } = await createAdminSupabase()
        .from('profiles')
        .update({ trial_reminder_sent_at: now.toISOString() })
        .eq('id', c.id)
        .is('trial_reminder_sent_at', null);
      if (error) console.error('[TrialReminderService] stamp failed:', c.id, error.message);
    }
    return res.sent ? 'sent' : (res.reason ?? 'not_sent');
  }
}
