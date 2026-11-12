/**
 * Server-side `Push Sent` Amplitude events (analytics/tracking-plan.json v33):
 * one event per notification_log row NotificationOrchestrator writes —
 * delivered, suppressed, failed (tokens exist, every send failed) or no_token.
 * See docs/PUSH_NOTIFICATIONS.md §7.
 *
 * Events are queued in-process and flushed in batches over the Amplitude HTTP
 * V2 API after the response (Next `after()` via runAfterResponse — works for
 * cron route handlers too, so one cron tick becomes one batch, or a few when it
 * is large). Bounded timeout (sendEvents), never throws, and a no-op when
 * AMPLITUDE_SERVER_API_KEY is unset / "off" (same key resolution as Identify).
 * insert_id = `push-sent:<notification_log id>` so a retried flush is deduped.
 */
import { amplitudeServerKey, sendEvents, type AmplitudeServerEvent } from '../analytics/amplitude-server';
import { AnalyticsEvents } from '../analytics/events.generated';
import { runAfterResponse } from '../utils/after-response';

export type PushSentOutcome = 'sent' | 'suppressed' | 'failed' | 'no_token';
export type PushPlatform = 'ios' | 'android' | 'both';

export interface PushSentInput {
  notificationId: string;
  userId: string;
  notificationType: string;
  notificationCategory?: string;
  outcome: PushSentOutcome;
  suppressionReason?: string;
  pushPlatform?: PushPlatform;
  /** Epoch ms; default now. */
  time?: number;
}

/** Max events per HTTP V2 request (Amplitude allows 2000 / 1 MB; stay well under). */
export const PUSH_SENT_BATCH_MAX = 500;
/** Memory bound on the in-process queue; beyond it events are dropped (logged). */
export const PUSH_SENT_QUEUE_MAX = 10_000;

let queue: AmplitudeServerEvent[] = [];
let flushScheduled = false;

/** ios | android | both from the targeted tokens' platforms (web tokens ignored). */
export function pushPlatformFor(platforms: readonly string[] | undefined): PushPlatform | undefined {
  const ios = platforms?.includes('ios') ?? false;
  const android = platforms?.includes('android') ?? false;
  if (ios && android) return 'both';
  if (ios) return 'ios';
  if (android) return 'android';
  return undefined;
}

/** The Amplitude event for one notification_log row. Pure. */
export function buildPushSentEvent(i: PushSentInput): AmplitudeServerEvent {
  const e = AnalyticsEvents.pushSent({
    notification_type: i.notificationType,
    outcome: i.outcome,
    notification_category: i.notificationCategory,
    suppression_reason: i.outcome === 'sent' ? undefined : i.suppressionReason,
    push_platform: i.pushPlatform,
    notification_id: i.notificationId,
  });
  return {
    event_type: e.name,
    user_id: i.userId,
    event_properties: { ...e.properties },
    time: i.time ?? Date.now(),
    insert_id: `push-sent:${i.notificationId}`,
  };
}

/** Queue one event; flushed after the response. Never throws; no-op without a key. */
export function recordPushSent(input: PushSentInput): void {
  try {
    if (!amplitudeServerKey()) return;
    if (queue.length >= PUSH_SENT_QUEUE_MAX) {
      console.warn('[push-sent] queue full; dropping event', input.notificationType);
      return;
    }
    queue.push(buildPushSentEvent(input));
    if (!flushScheduled) {
      flushScheduled = true;
      runAfterResponse(flushPushSentEvents, 'amplitude push-sent');
    }
  } catch (err: any) {
    console.warn('[push-sent] record failed:', err?.message ?? err);
  }
}

/** Send everything queued now, in batches. Resolves the number of events accepted. Never throws. */
export async function flushPushSentEvents(opts: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}): Promise<number> {
  // Swap synchronously: anything recorded from here on schedules its own flush.
  flushScheduled = false;
  const batch = queue;
  queue = [];
  let accepted = 0;
  for (let i = 0; i < batch.length; i += PUSH_SENT_BATCH_MAX) {
    const part = batch.slice(i, i + PUSH_SENT_BATCH_MAX);
    if (await sendEvents(part, opts)) accepted += part.length;
  }
  return accepted;
}

/** Test hook: the queued events (copy) and a reset. */
export function pendingPushSentEvents(): AmplitudeServerEvent[] {
  return [...queue];
}
export function resetPushSentEvents(): void {
  queue = [];
  flushScheduled = false;
}
