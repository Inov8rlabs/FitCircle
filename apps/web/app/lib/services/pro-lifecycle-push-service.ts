/**
 * Pro lifecycle pushes (docs/PRO_LIFECYCLE_PROMPTS.md §4).
 *
 *  pro_expiring_reminder  hourly (/api/cron/pro-lifecycle): 10:00 local on the
 *                         day before free Pro ends, or right away if later
 *                         (lib/pro-lifecycle/timing.ts).
 *  pro_expired            sent by the downgrade cron (/api/cron/referrals)
 *                         right after it ends the promo (notifyExpired); the
 *                         hourly cron retries what quiet hours deferred, for
 *                         up to 36 h after the end.
 *
 * Both go through NotificationOrchestrator as transactional types: cap-exempt
 * and never blocked by a category toggle, but the push master switch, quiet
 * hours and the dedupe guard apply. Exactly one push per user, state and Pro
 * end time: the dedupeKey (type:user:endsAt) is checked against
 * notification_log with no time limit before every send, so a renewed
 * referral week (new end) gets its own reminder.
 *
 * Kill switches: PRO_ENDING_PROMPTS_ENABLED=false, the admin master switch,
 * per-state push toggles. Dry run (?dryRun=true or PRO_ENDING_PUSH_DRY_RUN=true):
 * everything is computed and reported, nothing is sent or written.
 */
import {
  PRO_LIFECYCLE_PUSH_TYPES,
  decideExpiredPush,
  decideExpiringPush,
  lifecyclePushDedupeKey,
  localTimeLabel,
  pushDryRunForced,
  renderPushCopy,
  type LifecycleFacts,
  type LifecycleResult,
  type ProLifecycleConfig,
} from '@/lib/pro-lifecycle';
import { isValidTimezone } from '@/lib/streaks/streak-calculator';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { NotificationOrchestrator, isWithinQuietWindow } from './notification-orchestrator';
import { NotificationPreferencesService } from './notification-preferences-service';
import { DEFAULT_TIMEZONE, ProLifecycleService, firstNameOf, lifecycleLive, loadUsage, readPublishedConfig, usageWindow } from './pro-lifecycle-service';
import { TrialConfig } from './trial-config';

export interface PlannedPush {
  userId: string;
  state: 'pro_expiring' | 'pro_expired';
  type: string;
  endsAt: string;
  timezone: string;
  /** When it is due (UTC) and the same in the user's local time. */
  dueAt: string | null;
  dueLocal: string | null;
  outcome: 'sent' | 'would_send' | 'already_sent' | 'not_yet' | 'quiet_hours' | 'too_late' | 'push_disabled' | 'copy_error' | string;
  title?: string;
  body?: string;
}

export interface PushRunSummary {
  enabled: boolean;
  dryRun: boolean;
  candidates: number;
  sent: number;
  planned: PlannedPush[];
  skipped: Record<string, number>;
}

/** Orchestrator outcomes that end the attempt (a retry wouldn't help). */
const FINAL_REASONS = new Set(['no_delivery', 'category_disabled', 'duplicate', 'unknown_type']);

function localMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
}

export class ProLifecyclePushService {
  /**
   * This push is done: delivered, or ended for good (no device, category off,
   * duplicate) — any age. Fails closed → treated as done (never double-send).
   */
  static async alreadySent(userId: string, type: string, dedupeKey: string): Promise<boolean> {
    const { data, error } = await createAdminSupabase()
      .from('notification_log')
      .select('suppressed, suppression_reason, data')
      .eq('user_id', userId)
      .eq('notification_type', type)
      .order('sent_at', { ascending: false })
      .limit(50);
    if (error) {
      console.error('[ProLifecyclePush] sent-check failed; skipping this run:', error.message);
      return true;
    }
    return ((data ?? []) as Array<{ suppressed: boolean; suppression_reason: string | null; data: Record<string, unknown> | null }>).some(
      (r) => r.data?.dedupeKey === dedupeKey && (!r.suppressed || FINAL_REASONS.has(r.suppression_reason ?? ''))
    );
  }

  /**
   * Schedule time zone + quiet-hours state. "10:00 local" uses the profile's
   * time zone (the apps keep it current); quiet hours are evaluated exactly
   * like NotificationOrchestrator.checkQuietHours (the preference's own
   * quiet_hours_timezone, which defaults to America/New_York for everyone).
   */
  static async quietHours(userId: string, profileTz: string | null | undefined, now: Date): Promise<{ timezone: string; inQuietHours: boolean }> {
    const prefs = await NotificationPreferencesService.getPreferences(userId).catch(() => null);
    const timezone = [profileTz, prefs?.quiet_hours_timezone].find((z) => isValidTimezone(z)) ?? DEFAULT_TIMEZONE;
    const quietTz = isValidTimezone(prefs?.quiet_hours_timezone) ? prefs.quiet_hours_timezone : timezone;
    const inQuietHours = !!prefs?.quiet_hours_start && !!prefs?.quiet_hours_end && isWithinQuietWindow(localMinutes(now, quietTz), prefs.quiet_hours_start, prefs.quiet_hours_end);
    return { timezone, inQuietHours };
  }

  /** Hourly pass: expiring reminders + deferred expired pushes. */
  static async run(opts: { now?: Date; dryRun?: boolean; userId?: string } = {}): Promise<PushRunSummary> {
    const now = opts.now ?? new Date();
    const dryRun = opts.dryRun === true || pushDryRunForced();
    const pub = await readPublishedConfig();
    const summary: PushRunSummary = { enabled: lifecycleLive(pub), dryRun, candidates: 0, sent: 0, planned: [], skipped: {} };
    if (!summary.enabled) return summary;
    const evaluated = await ProLifecycleService.evaluateAll(now, pub.config, { userId: opts.userId });
    const targets = evaluated.filter((e) => e.result.state === 'pro_expiring' || e.result.state === 'pro_expired');
    summary.candidates = targets.length;
    for (const e of evaluated) if (!e.result.state && e.result.reason) summary.skipped[e.result.reason] = (summary.skipped[e.result.reason] ?? 0) + 1;
    for (const t of targets) {
      try {
        const planned = await this.handle(t.facts, t.result, pub.config, now, dryRun);
        summary.planned.push(planned);
        if (planned.outcome === 'sent') summary.sent++;
      } catch (err: any) {
        console.error('[ProLifecyclePush] failed for', t.facts.profile.id, err?.message ?? err);
        summary.skipped.error = (summary.skipped.error ?? 0) + 1;
      }
    }
    if (summary.planned.length) console.log('[ProLifecyclePush] run', JSON.stringify({ dryRun, sent: summary.sent, outcomes: summary.planned.map((p) => `${p.state}:${p.outcome}`) }));
    return summary;
  }

  /**
   * Called by the downgrade cron right after it ended a user's promotional
   * Pro. Re-evaluates the user (the downgrade may have been held by a newer
   * grant or a store purchase) and sends the "Pro ended" push when due.
   * Never throws.
   */
  static async notifyExpired(userId: string, opts: { now?: Date; dryRun?: boolean } = {}): Promise<PlannedPush | null> {
    try {
      const now = opts.now ?? new Date();
      const pub = await readPublishedConfig();
      if (!lifecycleLive(pub)) return null;
      const [entry] = await ProLifecycleService.evaluateAll(now, pub.config, { userId });
      if (!entry || entry.result.state !== 'pro_expired') return null;
      return await this.handle(entry.facts, entry.result, pub.config, now, opts.dryRun === true || pushDryRunForced());
    } catch (err: any) {
      console.error('[ProLifecyclePush] notifyExpired failed for', userId, err?.message ?? err);
      return null;
    }
  }

  static async handle(facts: LifecycleFacts, result: LifecycleResult, config: ProLifecycleConfig, now: Date, dryRun: boolean): Promise<PlannedPush> {
    const state = result.state as 'pro_expiring' | 'pro_expired';
    const userId = facts.profile.id;
    const type = PRO_LIFECYCLE_PUSH_TYPES[state];
    const endsAt = result.endsAt!;
    const sc = config.states[state];
    const { timezone, inQuietHours } = await this.quietHours(userId, facts.profile.timezone, now);
    const base: PlannedPush = { userId, state, type, endsAt, timezone, dueAt: null, dueLocal: null, outcome: 'not_yet' };

    const decision =
      state === 'pro_expiring'
        ? decideExpiringPush({ now, endsAt: new Date(endsAt), timezone, inQuietHours })
        : decideExpiredPush({ now, endedAt: new Date(endsAt), inQuietHours });
    const dueAt = decision.sendAt ?? null;
    base.dueAt = dueAt ? dueAt.toISOString() : null;
    base.dueLocal = dueAt ? localTimeLabel(dueAt, timezone) : null;

    if (!sc.enabled || !sc.push.enabled) return { ...base, outcome: 'push_disabled' };
    const dedupeKey = lifecyclePushDedupeKey(type, userId, endsAt);
    if (await this.alreadySent(userId, type, dedupeKey)) return { ...base, outcome: 'already_sent' };
    if (!decision.send) return { ...base, outcome: decision.skip };

    let usage = null;
    const win = usageWindow(result, now);
    if (win) usage = await loadUsage(userId, win.since, win.until).catch(() => null);
    // Cron (no request → no platform): the shorter of the iOS / Android trial lengths, so the
    // push never promises more days than the user's store gives.
    const trialDays = result.trialAvailable ? await TrialConfig.mobileDays(userId) : undefined;
    const copy = renderPushCopy(sc.push, {
      state,
      now,
      timezone,
      endsAt: new Date(endsAt),
      source: result.source,
      periodDays: result.periodDays,
      trialAvailable: result.trialAvailable,
      usage,
      firstName: firstNameOf(facts.profile as any),
      trialDays,
    });
    if ('error' in copy) {
      console.error('[ProLifecyclePush] copy error:', state, copy.error);
      return { ...base, outcome: 'copy_error' };
    }
    if (dryRun) return { ...base, outcome: 'would_send', title: copy.title, body: copy.body };

    const res = await NotificationOrchestrator.send(userId, type, {
      dedupeKey,
      title: copy.title,
      body: copy.body,
      proEndsAt: endsAt,
      proSource: result.source ?? undefined,
      trialAvailable: result.trialAvailable,
    });
    if (res.sent) return { ...base, outcome: 'sent', title: copy.title, body: copy.body };
    // quiet_hours (orchestrator's own check) → the next hourly run retries; FINAL_REASONS end it.
    return { ...base, outcome: FINAL_REASONS.has(res.reason ?? '') ? `final_${res.reason}` : (res.reason ?? 'not_sent') };
  }
}
