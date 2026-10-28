/**
 * Home crown marker + "member since" for GET /api/mobile/entitlements
 * (docs/USER_TARGETS_CONTRACT.md §4, docs/RELEASE_1.1.0_PLAN.md W3) — pure.
 *
 * proBadge.offerId — the active Pro offer, first match wins:
 *   1. Admin Tools: a published, non-archived campaign that is LIVE today (viewer's
 *      local day) and whose CTA opens the paywall (cta.action === 'paywall').
 *      offerId = "campaign:<slug>", started at local midnight of starts_at.
 *      Several → the most recently started (then highest priority).
 *      Editable without a deploy: creating / publishing / unpublishing such a
 *      campaign in Admin Tools arms or disarms the marker.
 *   2. Env fallback: PRO_BADGE_OFFER_ID (+ optional PRO_BADGE_OFFER_STARTS_AT,
 *      ISO 8601). Without a start, only users who have never opened the paywall
 *      get the marker. Unset → no offer.
 *   No offer → offerId null, marker false: the client keeps its own schedule.
 *
 * proBadge.marker — true only when ALL hold: an offer is active, the user has no
 * Pro (not subscribed, not in a trial, no promotional grant), the subscription
 * surface is on, and the user has not opened the paywall since the offer
 * started (profiles.paywall_last_opened_at, written by POST
 * /api/mobile/me/journey/events {event:'paywall_shown'} for automatic AND
 * user-initiated opens; unknown → treated as never opened).
 *
 * memberSince — the earliest paid or trial start we have on record: the first
 * real RevenueCat purchase event (INITIAL_PURCHASE / NON_RENEWING_PURCHASE /
 * RENEWAL / PRODUCT_CHANGE / UNCANCELLATION; TEST and promotional-store events
 * never count, SANDBOX only where sandbox purchases are applied) and
 * profiles.trial_started_at. Null when neither exists (free users, promotional
 * grants only).
 */
import type { CampaignRow } from '../campaigns/model';
import { localDayOf } from '../streaks/streak-calculator';
import { tzOffsetMs } from '../trials/reminder';

export interface ProBadge {
  marker: boolean;
  offerId: string | null;
}

export interface ProOffer {
  id: string;
  /** ISO 8601 instant the offer started, or null when unknown. */
  startedAt: string | null;
}

type Env = Record<string, string | undefined>;

const OFFER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

/** Local midnight of `ymd` in `timezone`, as an ISO instant. */
function localMidnightIso(ymd: string, timezone: string): string {
  const utcMidnight = new Date(`${ymd}T00:00:00Z`);
  let offset = 0;
  try {
    offset = tzOffsetMs(utcMidnight, timezone);
  } catch {
    offset = 0;
  }
  return new Date(utcMidnight.getTime() - offset).toISOString();
}

/** The live paywall campaign (Admin Tools), if any. */
export function campaignOffer(rows: CampaignRow[], now: Date, timezone: string): ProOffer | null {
  const today = localDayOf(now, timezone);
  const live = rows.filter(
    (r) =>
      r.published &&
      !r.archived_at &&
      r.cta?.action === 'paywall' &&
      typeof r.starts_at === 'string' &&
      typeof r.ends_at === 'string' &&
      r.starts_at <= today &&
      today <= r.ends_at
  );
  if (live.length === 0) return null;
  live.sort((a, b) => (a.starts_at === b.starts_at ? (b.priority ?? 0) - (a.priority ?? 0) : a.starts_at < b.starts_at ? 1 : -1));
  const top = live[0];
  return { id: `campaign:${top.slug}`, startedAt: localMidnightIso(top.starts_at, timezone) };
}

/** PRO_BADGE_OFFER_ID / PRO_BADGE_OFFER_STARTS_AT, if set and well-formed. */
export function envOffer(env: Env = process.env): ProOffer | null {
  const id = (env.PRO_BADGE_OFFER_ID ?? '').trim();
  if (!id || !OFFER_ID_RE.test(id)) return null;
  const startsRaw = (env.PRO_BADGE_OFFER_STARTS_AT ?? '').trim();
  const startsMs = startsRaw ? Date.parse(startsRaw) : NaN;
  return { id, startedAt: Number.isNaN(startsMs) ? null : new Date(startsMs).toISOString() };
}

export function activeOffer(rows: CampaignRow[], now: Date, timezone: string, env: Env = process.env): ProOffer | null {
  return campaignOffer(rows, now, timezone) ?? envOffer(env);
}

export function proBadgeFor(input: {
  offer: ProOffer | null;
  isPro: boolean;
  isTrial: boolean;
  subscriptionsEnabled: boolean;
  paywallLastOpenedAt: string | null;
}): ProBadge {
  const { offer } = input;
  if (!offer) return { marker: false, offerId: null };
  const eligible = !input.isPro && !input.isTrial && input.subscriptionsEnabled;
  if (!eligible) return { marker: false, offerId: offer.id };
  const opened = input.paywallLastOpenedAt ? Date.parse(input.paywallLastOpenedAt) : NaN;
  let seenSinceStart: boolean;
  if (Number.isNaN(opened)) seenSinceStart = false;
  else if (offer.startedAt === null) seenSinceStart = true; // start unknown: any open counts
  else seenSinceStart = opened >= Date.parse(offer.startedAt);
  return { marker: !seenSinceStart, offerId: offer.id };
}

// ---------------------------------------------------------------------------- member since

export const MEMBER_EVENT_TYPES = ['INITIAL_PURCHASE', 'NON_RENEWING_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION'] as const;

export interface SubscriptionEventRow {
  type?: string | null;
  store?: string | null;
  environment?: string | null;
  event_timestamp?: string | null;
  raw?: Record<string, any> | null;
}

/** Sandbox purchases count only where the webhook applies them (mirrors api/webhooks/revenuecat). */
export function sandboxCounts(env: Env = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.ALLOW_SANDBOX_WEBHOOKS === 'true';
}

function iso(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

export function memberSinceFrom(events: SubscriptionEventRow[], trialStartedAt: string | null, env: Env = process.env): string | null {
  const allowSandbox = sandboxCounts(env);
  let earliest: number | null = iso(trialStartedAt);
  for (const e of events) {
    if (!e?.type || !(MEMBER_EVENT_TYPES as readonly string[]).includes(e.type)) continue;
    if (e.store === 'PROMOTIONAL' || e.raw?.store === 'PROMOTIONAL') continue;
    if (e.environment === 'SANDBOX' && !allowSandbox) continue;
    const at = iso(e.raw?.purchased_at_ms) ?? iso(e.event_timestamp);
    if (at !== null && (earliest === null || at < earliest)) earliest = at;
  }
  return earliest === null ? null : new Date(earliest).toISOString();
}
