/**
 * "Your trial ends tomorrow / on Friday" push (docs/ONBOARDING_V2_EXPERIMENT_SPEC.md §3.2,
 * §5.7). Hourly cron: /api/cron/trial-reminders. Any trial length (3-day, 7-day, …): it only
 * uses trial_ends_at, the store's expiry from the RevenueCat webhook.
 *
 * Candidates: trialing + will_renew + not yet reminded + trial_ends_at within
 * the next 50 h. Timing is pure (lib/trials/reminder.ts): 10:00 local, 24–48 h
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
 * Email fallback (docs/ENGAGEMENT_115_SPEC.md §14.1): when the push cannot be delivered
 * (no active token / every send failed = `no_delivery`, push master switch off =
 * `category_disabled`, or any other suppression except quiet hours / deferral / an
 * already-delivered duplicate) the same reminder goes out by email (Resend, transactional,
 * lib/email/trial-reminder-email.ts). Quiet hours still defer the push; the email is only
 * decided once the push attempt is final. Robot / QA test accounts get no email; internal and
 * review accounts do (the team tests transactional mail on them, as with push). The
 * marketing opt-out does not apply (billing notice); the bounce/complaint suppression list does.
 * `Trial Reminder Sent {channel, trial_days}` goes to Amplitude for real users only.
 *
 * Kill switches: TRIAL_REMINDERS_ENABLED=false (everything, default ON);
 * TRIAL_REMINDER_EMAIL_ENABLED=false (the email fallback only, default ON).
 */
import { trackServerEventInBackground } from '../analytics/amplitude-server';
import { AnalyticsEvents } from '../analytics/events.generated';
import { sendEmail } from '../email/email-service';
import { trialReminderEmail, type TrialStore } from '../email/trial-reminder-email';
import { testAccountReason, type AudienceTestReason } from '../notifications/audience';
import { endsPhrase } from '../pro-lifecycle/copy';
import { isValidTimezone } from '../streaks/streak-calculator';
import { createAdminSupabase } from '../supabase-admin';
import { planOf } from '../trials/classify';
import { decideTrialReminder, REMINDER_LAST_CALL_MS, REMINDER_LOOKAHEAD_MS, type TrialReminderSkip } from '../trials/reminder';

import { NotificationOrchestrator, isWithinQuietWindow } from './notification-orchestrator';
import { NotificationPreferencesService } from './notification-preferences-service';
import { UserAudienceService } from './user-audience-service';

const DEFAULT_TZ = 'America/New_York';
/** Orchestrator outcomes that end this trial's reminder (a retry wouldn't help). */
const FINAL_REASONS = new Set(['no_delivery', 'category_disabled', 'duplicate', 'unknown_type']);
/** Push outcomes that never trigger the email: wait for a later run, or a push already went out. */
const NO_EMAIL_REASONS = new Set(['quiet_hours', 'deferred', 'duplicate']);
/** Test-account kinds that still get the email (the team's own / review accounts; robots don't). */
const EMAILABLE_TEST_KINDS: ReadonlySet<AudienceTestReason> = new Set<AudienceTestReason>(['internal', 'review']);
/** sendEmail errorNames a retry won't fix (anything else, e.g. rate limit / network, is retried next run). */
const PERMANENT_EMAIL_ERRORS = new Set(['suppressed', 'validation_error', 'not_configured', 'compliance_blocked', 'invalid_to_address']);

const switchOn = (raw: string | undefined) => !['0', 'false', 'off', 'no'].includes((raw ?? '').trim().toLowerCase());

export function trialRemindersEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return switchOn(env.TRIAL_REMINDERS_ENABLED);
}

export function trialReminderEmailEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return switchOn(env.TRIAL_REMINDER_EMAIL_ENABLED);
}

/** Should a push outcome fall back to email? Pure. */
export function needsEmailFallback(res: { sent: boolean; reason?: string }): boolean {
  return !res.sent && !NO_EMAIL_REASONS.has(res.reason ?? '');
}

/** Whole days between trial start and end, or undefined. */
export function trialDays(startedAt: string | null | undefined, endsAt: string): number | undefined {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const end = Date.parse(endsAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return undefined;
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

export const trialReminderDedupeKey = (userId: string, trialEndsAt: string) => `trial_reminder:${userId}:${trialEndsAt.slice(0, 16)}`;

export interface TrialReminderRunSummary {
  enabled: boolean;
  candidates: number;
  /** Reminders delivered on any channel. */
  sent: number;
  /** Of `sent`, delivered by the email fallback. */
  emailed: number;
  skipped: Record<string, number>;
}

export interface Candidate {
  id: string;
  timezone: string | null;
  trial_ends_at: string;
  trial_started_at?: string | null;
  email?: string | null;
  is_admin?: boolean | null;
  metadata?: Record<string, unknown> | null;
  subscription_platform?: string | null;
  subscription_product_id?: string | null;
}

type EmailOutcome = { sent: true } | { sent: false; reason: string; permanent: boolean };

/** Minutes past local midnight in `timezone`. */
function localMinutes(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
}

export class TrialReminderService {
  static async run(opts: { now?: Date; userId?: string } = {}): Promise<TrialReminderRunSummary> {
    const now = opts.now ?? new Date();
    const summary: TrialReminderRunSummary = { enabled: trialRemindersEnabled(), candidates: 0, sent: 0, emailed: 0, skipped: {} };
    if (!summary.enabled) return summary;
    const bump = (k: string) => (summary.skipped[k] = (summary.skipped[k] ?? 0) + 1);

    const supabase = createAdminSupabase();
    let query = supabase
      .from('profiles')
      .select('id, timezone, trial_ends_at, trial_started_at, email, is_admin, metadata, subscription_platform, subscription_product_id')
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
        else if (outcome === 'sent_email') {
          summary.sent++;
          summary.emailed++;
        } else bump(outcome);
      } catch (err: any) {
        console.error('[TrialReminderService] failed for', c.id, err?.message ?? err);
        bump('error');
      }
    }
    if (summary.sent || Object.keys(summary.skipped).length) console.log('[TrialReminderService] run', JSON.stringify(summary));
    return summary;
  }

  /** One candidate → 'sent' (push), 'sent_email' (fallback) or the reason it wasn't (yet). */
  static async remindOne(c: Candidate, now: Date): Promise<'sent' | 'sent_email' | TrialReminderSkip | string> {
    const prefs = await NotificationPreferencesService.getPreferences(c.id).catch(() => null);
    const tz = [prefs?.quiet_hours_timezone, c.timezone].find((z) => isValidTimezone(z)) ?? DEFAULT_TZ;
    const inQuietHours =
      !!prefs?.quiet_hours_start && !!prefs?.quiet_hours_end && isWithinQuietWindow(localMinutes(now, tz), prefs.quiet_hours_start, prefs.quiet_hours_end);

    const decision = decideTrialReminder({ now, trialEndsAt: new Date(c.trial_ends_at), timezone: tz, inQuietHours });
    if (!decision.send) return decision.skip;

    const phrase = endsPhrase(new Date(c.trial_ends_at), now, tz); // 'tomorrow' | 'on Friday' in the user's zone
    const res = await NotificationOrchestrator.send(c.id, 'trial_ending_reminder', {
      dedupeKey: trialReminderDedupeKey(c.id, c.trial_ends_at),
      trialEndsAt: c.trial_ends_at,
      endsPhrase: phrase,
    });
    // The orchestrator loaded the audience (incl. mock attribution) for this user.
    const testReason = UserAudienceService.cachedTestReason(c.id) ?? testAccountReason({ email: c.email, isAdmin: c.is_admin, metadata: c.metadata });

    if (res.sent) {
      await this.stamp(c.id, now);
      this.track(c, 'push', testReason);
      return 'sent';
    }

    let email: EmailOutcome | null = null;
    if (needsEmailFallback(res)) {
      email = await this.sendEmailFallback(c, now, tz, phrase, testReason);
      if (email.sent) {
        await this.stamp(c.id, now);
        this.track(c, 'email', testReason);
        return 'sent_email';
      }
    }
    // Neither channel delivered. A final push outcome still ends this trial's reminder,
    // unless the email failed transiently (then the next hourly run tries again).
    if (FINAL_REASONS.has(res.reason ?? '') && (email === null || email.permanent)) await this.stamp(c.id, now);
    const reason = res.reason ?? 'not_sent';
    return email ? `${reason}+email_${email.reason}` : reason;
  }

  private static async sendEmailFallback(c: Candidate, now: Date, tz: string, phrase: string, testReason: AudienceTestReason | null): Promise<EmailOutcome> {
    if (!trialReminderEmailEnabled()) return { sent: false, reason: 'disabled', permanent: true };
    if (testReason && !EMAILABLE_TEST_KINDS.has(testReason)) return { sent: false, reason: 'test_account', permanent: true };
    const to = typeof c.email === 'string' ? c.email.trim() : '';
    if (!to || !to.includes('@')) return { sent: false, reason: 'no_address', permanent: true };

    const rendered = trialReminderEmail({
      trialEndsAt: new Date(c.trial_ends_at),
      timezone: tz,
      endsPhrase: phrase,
      store: toTrialStore(c.subscription_platform),
      plan: planOf(c.subscription_product_id),
      // The server has no reliable post-trial price (the trial event carries price 0 and store
      // prices vary by territory), so the email never quotes one.
      price: null,
    });
    const result = await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      category: 'trial_reminder',
      idempotencyKey: trialReminderDedupeKey(c.id, c.trial_ends_at),
      tags: { template: 'trial_reminder_1' },
    });
    if (result.success) return { sent: true };
    const name = result.errorName ?? 'error';
    console.warn('[TrialReminderService] email fallback not sent:', c.id, name);
    return { sent: false, reason: name, permanent: PERMANENT_EMAIL_ERRORS.has(name) };
  }

  private static async stamp(userId: string, now: Date): Promise<void> {
    const { error } = await createAdminSupabase()
      .from('profiles')
      .update({ trial_reminder_sent_at: now.toISOString() })
      .eq('id', userId)
      .is('trial_reminder_sent_at', null);
    if (error) console.error('[TrialReminderService] stamp failed:', userId, error.message);
  }

  /** `Trial Reminder Sent` (server event). Real users only, like Push Sent. Never throws. */
  private static track(c: Candidate, channel: 'push' | 'email', testReason: AudienceTestReason | null): void {
    if (testReason) return;
    try {
      const e = AnalyticsEvents.trialReminderSent({ channel, trial_days: trialDays(c.trial_started_at, c.trial_ends_at) });
      trackServerEventInBackground(
        { event_type: e.name, user_id: c.id, event_properties: { ...e.properties } as Record<string, string | number | boolean>, insert_id: `trial-reminder:${c.id}:${c.trial_ends_at.slice(0, 16)}` },
        'trial-reminder-sent'
      );
    } catch (err: any) {
      console.warn('[TrialReminderService] track failed:', err?.message ?? err);
    }
  }
}

function toTrialStore(platform: string | null | undefined): TrialStore {
  return platform === 'app_store' || platform === 'play_store' || platform === 'stripe' ? platform : null;
}
