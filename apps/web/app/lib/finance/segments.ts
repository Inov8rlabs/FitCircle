/** Paying / trial / free per user from RevenueCat events (pure; reuses the ads revenue rules). */
import { classifyEvent, dedupeEvents, eventTime, type RevenueEvent } from '../ads/metrics';

import type { Segment } from './types';

/**
 * Segment as of `asOf` (epoch ms): paying = a paid charge not cancelled out by a refund; trial =
 * started a free trial and never paid; free otherwise. Production events only (classifyEvent).
 */
export function segmentFromEvents(events: RevenueEvent[], asOf: number): Segment {
  let paid = 0;
  let refunds = 0;
  let trial = false;
  for (const e of dedupeEvents(events).events) {
    const t = eventTime(e);
    if (t === null || t > asOf) continue;
    const c = classifyEvent(e);
    if (c.excluded === 'trial' && e.type === 'INITIAL_PURCHASE') trial = true;
    if (c.kind === 'charge' && (c.grossUsd > 0 || c.missingPrice)) paid += 1;
    if (c.kind === 'refund') refunds += 1;
    if (c.kind === 'refund_reversal') refunds -= 1;
  }
  if (paid - Math.max(0, refunds) > 0) return 'paying';
  return trial ? 'trial' : 'free';
}

/** Time (ms) of the user's first paid charge, or null (a later full refund does not move it). */
export function firstPaidAt(events: RevenueEvent[]): number | null {
  let first: number | null = null;
  for (const e of dedupeEvents(events).events) {
    const c = classifyEvent(e);
    if (c.kind !== 'charge' || !(c.grossUsd > 0 || c.missingPrice)) continue;
    const t = eventTime(e);
    if (t !== null && (first === null || t < first)) first = t;
  }
  return first;
}

/** Group events by user id (events without one are dropped). */
export function eventsByUser(events: RevenueEvent[]): Map<string, RevenueEvent[]> {
  const out = new Map<string, RevenueEvent[]>();
  for (const e of events) {
    if (!e.user_id) continue;
    const list = out.get(e.user_id) ?? [];
    list.push(e);
    out.set(e.user_id, list);
  }
  return out;
}
