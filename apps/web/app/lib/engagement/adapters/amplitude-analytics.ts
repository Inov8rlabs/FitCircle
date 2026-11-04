/**
 * AnalyticsSink → Amplitude HTTP API (server-side events from the tracking
 * plan: Email Sent/Delivered/Opened/Clicked/…, Push Sent, Weekly Report Sent,
 * Lifecycle Message Skipped/Converted). Fire-and-forget after the response;
 * no-op without AMPLITUDE_SERVER_API_KEY. `insertId` makes replays (webhook
 * retries, cron re-runs) count once — Amplitude dedupes it for 7 days.
 */
import { trackServerEventsInBackground } from '../../analytics/amplitude-server';

import type { AnalyticsSink } from './types';

export class AmplitudeAnalyticsSink implements AnalyticsSink {
  track(userId: string, event: string, properties: Record<string, string | number | boolean>, insertId?: string): void {
    trackServerEventsInBackground([{ user_id: userId, event_type: event, event_properties: properties, ...(insertId ? { insert_id: insertId } : {}) }], event);
  }
}
