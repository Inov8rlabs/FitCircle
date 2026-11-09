/**
 * "Finish setting up" re-engagement for sign-ups who left onboarding midway.
 * Pure: who qualifies, what is due, and how a send outcome is recorded.
 * I/O lives in lib/services/onboarding-nudge-service.ts.
 *
 * Touches (account age = now - profiles.created_at):
 *   touch 1, from 1 h:  push (`onboarding_finish_reminder`, touch 1) when the
 *                       user has an active push token; email instead when they
 *                       have none, or when the push could not be delivered for
 *                       a reason a retry won't fix (no device, push turned off).
 *                       A push that hits quiet hours is HELD by the
 *                       orchestrator and released when quiet hours end
 *                       (slot status 'deferred'; lib/notifications/quiet-hours-deferral.ts);
 *                       one held back by the daily cap is retried on later
 *                       runs until touch 2 is due.
 *   touch 2, from 24 h: email + a second push (token permitting), at least
 *                       12 h after a touch-1 send so they never land together.
 *                       No second push when the Day-1 morning push already
 *                       reached them (one morning push, not two).
 *   Then nothing: at most 2 pushes and 2 emails per user, ever.
 *
 * Only users created within `maxAgeHours` (default 72) are considered, so old
 * accounts are never swept up; ops can widen it for a one-off run.
 *
 * State: profiles.metadata.onboarding_nudges.<slot> = { status, at, reason?, id? }
 * (no migration — the same server-owned jsonb ConversionMilestoneService uses).
 * Any record, including `pending`, marks a slot as done; pushes are also
 * cross-checked against notification_log (delivered rows of this type).
 */

export const NUDGE_METADATA_KEY = 'onboarding_nudges';
export const NUDGE_PUSH_TYPE = 'onboarding_finish_reminder' as const;

export const HOUR_MS = 3_600_000;
export const TOUCH_1_AFTER_MS = 1 * HOUR_MS;
export const TOUCH_2_AFTER_MS = 24 * HOUR_MS;
/** Touch 2 waits this long after a touch-1 send that was delayed (quiet hours, cap). */
export const MIN_GAP_BETWEEN_TOUCHES_MS = 12 * HOUR_MS;
export const DEFAULT_MAX_AGE_HOURS = 72;
/** Hard ceiling for the ops override (`maxAgeHours`): two weeks. */
export const MAX_MAX_AGE_HOURS = 24 * 14;

export type NudgeSlot = 'push_1' | 'email_1' | 'push_2' | 'email_2';
export type NudgeChannel = 'push' | 'email';
export type SlotStatus = 'pending' | 'sent' | 'failed' | 'suppressed' | 'skipped' | 'deferred';

export interface SlotRecord {
  status: SlotStatus;
  at: string;
  /** Orchestrator / Resend reason for a non-send. */
  reason?: string;
  /** Resend email id. */
  id?: string;
  /** status 'deferred': when quiet hours end and the held push is released. */
  until?: string;
}

export type NudgeState = Partial<Record<NudgeSlot, SlotRecord>>;

export interface NudgeAction {
  slot: NudgeSlot;
  channel: NudgeChannel;
  touch: 1 | 2;
  /** push_1 only: send email_1 in the same run if the push fails for good. */
  emailFallback?: boolean;
}

export const slotOf = (channel: NudgeChannel, touch: 1 | 2): NudgeSlot => `${channel}_${touch}` as NudgeSlot;

export interface NudgeCandidate {
  userId: string;
  createdAt: string;
  onboardingCompleted: boolean | null;
  isActive?: boolean | null;
  email: string | null;
  preferences: Record<string, any> | null;
  metadata: Record<string, any> | null;
  /** At least one active push token. */
  hasPushToken: boolean;
  /** Touches whose push notification_log already shows as delivered. */
  pushDelivered: ReadonlySet<1 | 2>;
  /** A Day-1 morning push (day1_morning) was delivered: touch 2 is email only. */
  day1PushDelivered?: boolean;
}

export function nudgeState(metadata: Record<string, any> | null | undefined): NudgeState {
  const raw = metadata?.[NUDGE_METADATA_KEY];
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as NudgeState) : {};
}

/** Email allowed: an address, and no marketing / email opt-out (campaign unsubscribe or settings toggle). */
export function emailAllowed(c: Pick<NudgeCandidate, 'email' | 'preferences'>): boolean {
  if (!c.email || !c.email.includes('@')) return false;
  const p = c.preferences ?? {};
  if (p.marketingEmails === false) return false;
  if (p.notifications?.email === false) return false;
  return true;
}

/** Clamp the ops override; anything unparseable falls back to the default. */
export function resolveMaxAgeHours(raw: string | number | null | undefined): number {
  const n = typeof raw === 'number' ? raw : raw == null || raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_AGE_HOURS;
  return Math.min(Math.max(n, 1), MAX_MAX_AGE_HOURS);
}

/** Why this person isn't eligible at all right now (null = eligible). Test-user screening is separate. */
export function ineligibleReason(c: NudgeCandidate, now: Date, maxAgeHours: number): string | null {
  if (c.onboardingCompleted === true) return 'onboarding_completed';
  if (c.isActive === false) return 'inactive';
  const age = now.getTime() - Date.parse(c.createdAt);
  if (!Number.isFinite(age)) return 'no_created_at';
  if (age < TOUCH_1_AFTER_MS) return 'too_new';
  if (age > maxAgeHours * HOUR_MS) return 'too_old';
  return null;
}

/** When a sent record for this touch went out (latest of its push/email), or null. A held push counts from its release. */
function sentAt(state: NudgeState, touch: 1 | 2): number | null {
  const times = (['push', 'email'] as const)
    .map((ch) => state[slotOf(ch, touch)])
    .filter((r): r is SlotRecord => !!r && (r.status === 'sent' || r.status === 'deferred'))
    .map((r) => Date.parse(r.status === 'deferred' && r.until ? r.until : r.at))
    .filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

export interface NudgePlan {
  actions: NudgeAction[];
  /** Why nothing is due yet / anymore (when actions is empty). */
  wait?: string;
}

/**
 * What to send now. Assumes ineligibleReason() returned null. At most one
 * touch per run; touch 1 is abandoned once touch 2 is due.
 */
export function planNudges(c: NudgeCandidate, now: Date): NudgePlan {
  const state = nudgeState(c.metadata);
  const age = now.getTime() - Date.parse(c.createdAt);
  const canEmail = emailAllowed(c);
  const done = (slot: NudgeSlot) =>
    !!state[slot] || (slot === 'push_1' && c.pushDelivered.has(1)) || (slot === 'push_2' && c.pushDelivered.has(2));

  if (age >= TOUCH_2_AFTER_MS) {
    const t1 = sentAt(state, 1);
    if (t1 !== null && now.getTime() - t1 < MIN_GAP_BETWEEN_TOUCHES_MS) return { actions: [], wait: 'touch_2_gap' };
    const actions: NudgeAction[] = [];
    if (c.hasPushToken && !done('push_2') && !c.day1PushDelivered) actions.push({ slot: 'push_2', channel: 'push', touch: 2 });
    if (canEmail && !done('email_2')) actions.push({ slot: 'email_2', channel: 'email', touch: 2 });
    return actions.length ? { actions } : { actions, wait: 'touch_2_done' };
  }

  if (age >= TOUCH_1_AFTER_MS) {
    const push1 = state.push_1;
    if (c.hasPushToken && !done('push_1')) {
      return { actions: [{ slot: 'push_1', channel: 'push', touch: 1, emailFallback: canEmail && !done('email_1') }] };
    }
    const pushFailedForGood = !!push1 && (push1.status === 'failed' || push1.status === 'suppressed' || push1.status === 'skipped');
    const pushReached = c.pushDelivered.has(1) || push1?.status === 'sent' || push1?.status === 'pending' || push1?.status === 'deferred';
    if (!pushReached && (!c.hasPushToken || pushFailedForGood) && canEmail && !done('email_1')) {
      return { actions: [{ slot: 'email_1', channel: 'email', touch: 1 }] };
    }
    return { actions: [], wait: 'touch_1_done' };
  }

  return { actions: [], wait: 'too_new' };
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/** Orchestrator reasons that end a push slot (retrying won't change them). */
const FINAL_PUSH_FAILURES = new Set(['no_delivery', 'category_disabled', 'unknown_type']);

export type PushDisposition =
  | { kind: 'record'; record: Omit<SlotRecord, 'at'>; fallbackToEmail: boolean }
  | { kind: 'release'; reason: string };

/** The orchestrator's answer to a send. */
export interface PushSendResult {
  sent: boolean;
  reason?: string;
  /** reason 'deferred': when the held push is released. */
  deferUntil?: string;
}

/**
 * Orchestrator result → what to store. Quiet hours, the daily cap, suppression
 * chains and burst control are temporary: release the claim so a later run
 * retries. `duplicate` means this push already went out (dedupe key) → sent.
 */
export function pushDisposition(res: PushSendResult): PushDisposition {
  if (res.sent) return { kind: 'record', record: { status: 'sent' }, fallbackToEmail: false };
  const reason = res.reason ?? 'not_sent';
  // Held by quiet hours: the release job sends it at the end of quiet hours. Keep the slot.
  if (reason === 'deferred') {
    return { kind: 'record', record: { status: 'deferred', reason, ...(res.deferUntil ? { until: res.deferUntil } : {}) }, fallbackToEmail: false };
  }
  if (reason === 'duplicate') return { kind: 'record', record: { status: 'sent', reason }, fallbackToEmail: false };
  if (FINAL_PUSH_FAILURES.has(reason)) {
    return {
      kind: 'record',
      record: { status: reason === 'no_delivery' ? 'failed' : 'suppressed', reason },
      fallbackToEmail: true,
    };
  }
  return { kind: 'release', reason };
}

/** Resend errors worth retrying on a later run (rate limits, outages, network). */
const TRANSIENT_EMAIL_ERRORS = new Set([
  'rate_limit_exceeded',
  'daily_quota_exceeded',
  'application_error',
  'internal_server_error',
  'concurrent_idempotent_requests',
  'network_error',
  'not_configured',
  // Marketing email without EMAIL_POSTAL_ADDRESS / unsubscribe (lib/email/compliance.ts): retry once configured.
  'compliance_blocked',
]);

export type EmailDisposition = { kind: 'record'; record: Omit<SlotRecord, 'at'> } | { kind: 'release'; reason: string };

export function emailDisposition(res: { success: boolean; id?: string; errorName?: string }): EmailDisposition {
  if (res.success) return { kind: 'record', record: { status: 'sent', ...(res.id ? { id: res.id } : {}) } };
  const reason = res.errorName || 'unknown_error';
  if (TRANSIENT_EMAIL_ERRORS.has(reason)) return { kind: 'release', reason };
  // On the bounce/complaint suppression list: final, never retried.
  if (reason === 'suppressed') return { kind: 'record', record: { status: 'suppressed', reason } };
  return { kind: 'record', record: { status: 'failed', reason } };
}

/** Orchestrator dedupe key: one delivered push per (user, touch). */
export const nudgeDedupeKey = (userId: string, touch: 1 | 2) => `onboarding_finish:${userId}:${touch}`;
/** Resend idempotency key: one email per (user, touch) even if a run is retried. */
export const nudgeIdempotencyKey = (userId: string, touch: 1 | 2) => `onboarding-finish/${userId}/${touch}`;

// ---------------------------------------------------------------------------
// Test devices (Firebase Test Lab / Play pre-launch robots, emulators)
// ---------------------------------------------------------------------------

/** Push-token device names of emulators / simulators (dev builds, robots). */
const EMULATOR_DEVICE_RE = /sdk_gphone|Android SDK built for|\bemulator\b|\bsimulator\b/i;

export function isEmulatorDevice(deviceName: string | null | undefined): boolean {
  return !!deviceName && EMULATOR_DEVICE_RE.test(deviceName);
}

/** True when every registered device is an emulator (and there is at least one). */
export function onlyEmulatorDevices(deviceNames: ReadonlyArray<string | null | undefined>): boolean {
  return deviceNames.length > 0 && deviceNames.every(isEmulatorDevice);
}

/** profiles.metadata.test_device, set from the `X-Test-Device: 1` header (lib/services/test-device-service.ts). */
export function flaggedTestDevice(metadata: Record<string, any> | null | undefined): boolean {
  return !!metadata?.test_device;
}
