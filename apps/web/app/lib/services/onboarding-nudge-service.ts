/**
 * "Finish setting up" re-engagement (cron: /api/cron/onboarding-nudges, every
 * 15 min). Timing and eligibility are pure (lib/onboarding-nudges/policy.ts).
 *
 * Per candidate (onboarding_completed false, created 1 h – maxAgeHours ago,
 * not a test/internal account):
 *   1. plan the due slot(s);
 *   2. claim each slot in profiles.metadata.onboarding_nudges (conditional
 *      update `… where metadata->onboarding_nudges-><slot> is null`, so two
 *      overlapping runs can't both claim it);
 *   3. send — push through NotificationOrchestrator (journey toggle, push
 *      master switch, quiet hours, daily cap, dedupe key), email through Resend
 *      (idempotency key, List-Unsubscribe, marketing opt-out honoured);
 *   4. record the outcome, or release the claim when a later run should retry
 *      (quiet hours, cap, transient Resend errors).
 *
 * Backstops against a double send: delivered notification_log rows of this
 * type count as sent, the orchestrator's 24 h dedupe key, Resend's 24 h
 * idempotency key.
 *
 * Test/internal accounts are skipped with the same rules the ads console uses
 * (lib/ads/test-users.ts: admins, own domains, reviewer, Test Lab, Play
 * pre-launch testers, mock attribution) plus the `X-Test-Device` flag and
 * emulator-only devices.
 *
 * Kill switch: ONBOARDING_NUDGES_ENABLED=false (default ON).
 * Dry run: `dryRun` option or ONBOARDING_NUDGES_DRY_RUN=true — reads only.
 */
import { classifyTestUser } from '../ads/test-users';
import { sendEmail } from '../email/email-service';
import { onboardingNudgeEmail } from '../email/onboarding-nudge-email';
import {
  DEFAULT_MAX_AGE_HOURS,
  NUDGE_METADATA_KEY,
  NUDGE_PUSH_TYPE,
  type NudgeAction,
  type NudgeCandidate,
  type NudgeSlot,
  type SlotRecord,
  emailDisposition,
  flaggedTestDevice,
  HOUR_MS,
  ineligibleReason,
  nudgeDedupeKey,
  nudgeIdempotencyKey,
  onlyEmulatorDevices,
  planNudges,
  pushDisposition,
  TOUCH_1_AFTER_MS,
} from '../onboarding-nudges/policy';
import { createAdminSupabase } from '../supabase-admin';

import { NotificationOrchestrator } from './notification-orchestrator';

/** The Day-1 morning push (Day1MorningPushService): once delivered, touch 2 is email only. */
const DAY1_PUSH_TYPE = 'day1_morning';

const CANDIDATE_LIMIT = 500;
const CHUNK = 100;

export function onboardingNudgesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.ONBOARDING_NUDGES_ENABLED ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

export function onboardingNudgesForcedDryRun(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.ONBOARDING_NUDGES_DRY_RUN ?? '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(v);
}

export interface OnboardingNudgeRunOptions {
  now?: Date;
  /** Only this user (ops / test sends). */
  userId?: string;
  /** Ops override of the "recent sign-ups only" cutoff (hours; clamped by the route). */
  maxAgeHours?: number;
  /** Only users on this onboarding flow (e.g. 'v3'). */
  flow?: string;
  dryRun?: boolean;
}

export interface PlannedNudge {
  /** First 8 characters of the user id (never the full id, email or token). */
  user: string;
  ageHours: number;
  flow: string | null;
  slots: NudgeSlot[];
}

export interface OnboardingNudgeRunSummary {
  enabled: boolean;
  dryRun: boolean;
  maxAgeHours: number;
  candidates: number;
  excluded: Record<string, number>;
  waiting: Record<string, number>;
  /** dry run: what would be sent; real run: what was attempted. */
  planned: PlannedNudge[];
  sent: Record<string, number>;
  notSent: Record<string, number>;
}

interface ProfileRow {
  id: string;
  email: string | null;
  created_at: string;
  onboarding_completed: boolean | null;
  onboarding_flow: string | null;
  is_admin: boolean | null;
  is_active: boolean | null;
  preferences: Record<string, any> | null;
  metadata: Record<string, any> | null;
}

const chunks = <T>(xs: T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

export class OnboardingNudgeService {
  static async run(opts: OnboardingNudgeRunOptions = {}): Promise<OnboardingNudgeRunSummary> {
    const now = opts.now ?? new Date();
    const maxAgeHours = opts.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
    const dryRun = !!opts.dryRun || onboardingNudgesForcedDryRun();
    const summary: OnboardingNudgeRunSummary = {
      enabled: onboardingNudgesEnabled(),
      dryRun,
      maxAgeHours,
      candidates: 0,
      excluded: {},
      waiting: {},
      planned: [],
      sent: {},
      notSent: {},
    };
    if (!summary.enabled && !dryRun) return summary;

    const supabase = createAdminSupabase();
    let query = supabase
      .from('profiles')
      .select('id, email, created_at, onboarding_completed, onboarding_flow, is_admin, is_active, preferences, metadata')
      .not('onboarding_completed', 'is', true)
      .gte('created_at', new Date(now.getTime() - maxAgeHours * HOUR_MS).toISOString())
      .lte('created_at', new Date(now.getTime() - TOUCH_1_AFTER_MS).toISOString())
      .order('created_at', { ascending: true });
    if (opts.userId) query = query.eq('id', opts.userId);
    if (opts.flow) query = query.eq('onboarding_flow', opts.flow);
    const { data, error } = await query.limit(CANDIDATE_LIMIT);
    if (error) throw new Error(`onboarding nudge candidates read failed: ${error.message}`);
    const rows = (data ?? []) as ProfileRow[];
    summary.candidates = rows.length;
    if (rows.length === 0) return summary;

    const facts = await this.loadFacts(rows.map((r) => r.id));

    for (const row of rows) {
      const devices = facts.devices.get(row.id) ?? [];
      const candidate: NudgeCandidate = {
        userId: row.id,
        createdAt: row.created_at,
        onboardingCompleted: row.onboarding_completed,
        isActive: row.is_active,
        email: row.email,
        preferences: row.preferences,
        metadata: row.metadata,
        hasPushToken: devices.length > 0,
        pushDelivered: facts.delivered.get(row.id) ?? new Set(),
        day1PushDelivered: facts.day1Delivered.has(row.id),
      };

      const ineligible = ineligibleReason(candidate, now, maxAgeHours);
      if (ineligible) {
        bump(summary.excluded, ineligible);
        continue;
      }
      const testReason =
        classifyTestUser({ email: row.email, isAdmin: row.is_admin, mockAttribution: facts.mockAttribution.has(row.id) }) ??
        (flaggedTestDevice(row.metadata) ? 'test_device' : null) ??
        (onlyEmulatorDevices(devices) ? 'emulator' : null);
      if (testReason) {
        bump(summary.excluded, `test:${testReason}`);
        continue;
      }

      const plan = planNudges(candidate, now);
      if (plan.actions.length === 0) {
        bump(summary.waiting, plan.wait ?? 'nothing_due');
        continue;
      }
      summary.planned.push({
        user: row.id.slice(0, 8),
        ageHours: Math.round(((now.getTime() - Date.parse(row.created_at)) / HOUR_MS) * 10) / 10,
        flow: row.onboarding_flow,
        slots: plan.actions.map((a) => a.slot),
      });
      if (dryRun) continue;

      for (const action of plan.actions) {
        try {
          await this.execute(row, action, now, summary);
        } catch (err: any) {
          console.error('[OnboardingNudge] send failed:', row.id, action.slot, err?.message ?? err);
          bump(summary.notSent, `${action.slot}:error`);
        }
      }
    }

    if (!dryRun && (Object.keys(summary.sent).length || Object.keys(summary.notSent).length)) {
      console.log('[OnboardingNudge] run', JSON.stringify({ ...summary, planned: summary.planned.length }));
    }
    return summary;
  }

  /** Active push devices, delivered nudge pushes (by touch), mock-attribution users. */
  private static async loadFacts(ids: string[]) {
    const supabase = createAdminSupabase();
    const devices = new Map<string, Array<string | null>>();
    const delivered = new Map<string, Set<1 | 2>>();
    const mockAttribution = new Set<string>();
    const day1Delivered = new Set<string>();
    for (const part of chunks(ids)) {
      const [tokens, logs, attribution] = await Promise.all([
        supabase.from('push_tokens').select('user_id, device_name').in('user_id', part).eq('is_active', true),
        supabase
          .from('notification_log')
          .select('user_id, notification_type, data')
          .in('user_id', part)
          .in('notification_type', [NUDGE_PUSH_TYPE, DAY1_PUSH_TYPE])
          .eq('suppressed', false),
        supabase.from('user_attribution').select('user_id, is_test').in('user_id', part),
      ]);
      if (tokens.error) throw new Error(`push_tokens read failed: ${tokens.error.message}`);
      if (logs.error) throw new Error(`notification_log read failed: ${logs.error.message}`);
      for (const t of (tokens.data ?? []) as Array<{ user_id: string; device_name: string | null }>) {
        const list = devices.get(t.user_id) ?? [];
        list.push(t.device_name);
        devices.set(t.user_id, list);
      }
      for (const l of (logs.data ?? []) as Array<{ user_id: string; notification_type?: string; data: Record<string, any> | null }>) {
        if (l.notification_type === DAY1_PUSH_TYPE) {
          day1Delivered.add(l.user_id);
          continue;
        }
        const touch = Number(l.data?.touch) === 2 ? 2 : 1;
        const set = delivered.get(l.user_id) ?? new Set<1 | 2>();
        set.add(touch);
        delivered.set(l.user_id, set);
      }
      // Attribution is optional context; a read error just means "not known to be a test".
      for (const a of (attribution.data ?? []) as Array<{ user_id: string; is_test: boolean | null }>) {
        if (a.is_test === true) mockAttribution.add(a.user_id);
      }
    }
    return { devices, delivered, mockAttribution, day1Delivered };
  }

  private static async execute(row: ProfileRow, action: NudgeAction, now: Date, summary: OnboardingNudgeRunSummary): Promise<void> {
    if (!(await this.claim(row.id, action.slot, now))) {
      bump(summary.notSent, `${action.slot}:already_claimed`);
      return;
    }

    if (action.channel === 'push') {
      const res = await NotificationOrchestrator.send(row.id, NUDGE_PUSH_TYPE, {
        touch: action.touch,
        dedupeKey: nudgeDedupeKey(row.id, action.touch),
      });
      const d = pushDisposition(res);
      if (d.kind === 'release') {
        await this.release(row.id, action.slot);
        bump(summary.notSent, `${action.slot}:${d.reason}`);
        return;
      }
      await this.finish(row.id, action.slot, { ...d.record, at: now.toISOString() });
      bump(d.record.status === 'sent' ? summary.sent : summary.notSent, d.record.status === 'sent' ? action.slot : `${action.slot}:${d.record.reason}`);
      if (d.fallbackToEmail && action.emailFallback) {
        await this.execute(row, { slot: 'email_1', channel: 'email', touch: 1 }, now, summary);
      }
      return;
    }

    const email = onboardingNudgeEmail(row.id, action.touch);
    const res = await sendEmail({
      to: row.email!,
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers: {
        'List-Unsubscribe': `<${email.unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      idempotencyKey: nudgeIdempotencyKey(row.id, action.touch),
      category: 'onboarding_nudge',
      tags: { touch: String(action.touch) },
    });
    const d = emailDisposition(res);
    if (d.kind === 'release') {
      await this.release(row.id, action.slot);
      bump(summary.notSent, `${action.slot}:${d.reason}`);
      return;
    }
    await this.finish(row.id, action.slot, { ...d.record, at: now.toISOString() });
    bump(d.record.status === 'sent' ? summary.sent : summary.notSent, d.record.status === 'sent' ? action.slot : `${action.slot}:${d.record.reason}`);
  }

  // -------------------------------------------------------------------------
  // profiles.metadata.onboarding_nudges ledger
  // -------------------------------------------------------------------------

  private static async readMetadata(userId: string): Promise<Record<string, any> | null | undefined> {
    const { data, error } = await createAdminSupabase().from('profiles').select('metadata').eq('id', userId).maybeSingle();
    if (error) throw error;
    if (!data) return undefined;
    return ((data as { metadata?: Record<string, any> | null }).metadata ?? null);
  }

  private static withSlot(metadata: Record<string, any> | null, slot: NudgeSlot, record: SlotRecord | null): Record<string, any> {
    const base = metadata ?? {};
    const nudges = { ...((base[NUDGE_METADATA_KEY] as Record<string, any> | undefined) ?? {}) };
    if (record) nudges[slot] = record;
    else delete nudges[slot];
    return { ...base, [NUDGE_METADATA_KEY]: nudges };
  }

  /** Exactly-once claim: the update only matches while the slot is still absent. */
  static async claim(userId: string, slot: NudgeSlot, now: Date): Promise<boolean> {
    const metadata = await this.readMetadata(userId);
    if (metadata === undefined) return false;
    if (metadata?.[NUDGE_METADATA_KEY]?.[slot]) return false;
    const next = this.withSlot(metadata, slot, { status: 'pending', at: now.toISOString() });
    const { data, error } = await createAdminSupabase()
      .from('profiles')
      .update({ metadata: next })
      .eq('id', userId)
      .not('onboarding_completed', 'is', true) // finished meanwhile → no claim, no send
      .is(`metadata->${NUDGE_METADATA_KEY}->${slot}`, null)
      .select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  /** Replace our pending claim with the outcome. */
  static async finish(userId: string, slot: NudgeSlot, record: SlotRecord): Promise<void> {
    const metadata = await this.readMetadata(userId);
    if (metadata === undefined) return;
    const { error } = await createAdminSupabase()
      .from('profiles')
      .update({ metadata: this.withSlot(metadata, slot, record) })
      .eq('id', userId)
      .eq(`metadata->${NUDGE_METADATA_KEY}->${slot}->>status`, 'pending');
    if (error) console.error('[OnboardingNudge] record failed:', userId, slot, error.message);
  }

  /** Drop our pending claim so a later run retries. */
  static async release(userId: string, slot: NudgeSlot): Promise<void> {
    const metadata = await this.readMetadata(userId);
    if (metadata === undefined) return;
    const { error } = await createAdminSupabase()
      .from('profiles')
      .update({ metadata: this.withSlot(metadata, slot, null) })
      .eq('id', userId)
      .eq(`metadata->${NUDGE_METADATA_KEY}->${slot}->>status`, 'pending');
    if (error) console.error('[OnboardingNudge] release failed:', userId, slot, error.message);
  }
}
