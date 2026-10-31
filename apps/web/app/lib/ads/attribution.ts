/**
 * Attribution normalisation (docs/ADS_CONSOLE_SPEC.md §4). Pure: maps what the
 * apps report (POST /api/mobile/attribution) or what RevenueCat carries in
 * subscriber_attributes to one user_attribution row.
 */
import { z } from 'zod';

import { APPLE_MOCK_CAMPAIGN_ID } from './config';
import type { AttributionChannel, AttributionRow } from './types';

const id = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().max(64))
  .transform((v) => (v === '' ? null : v));

export const attributionBodySchema = z.object({
  platform: z.enum(['ios', 'android']),
  source: z.string().trim().min(1).max(64),
  campaignId: id.nullish(),
  adGroupId: id.nullish(),
  keywordId: id.nullish(),
  adId: id.nullish(),
  clickDate: z.string().max(64).nullish(),
  country: z.string().trim().max(8).nullish(),
  raw: z.record(z.unknown()).nullish(),
  /**
   * Firebase Analytics app instance id (Android, when analytics consent allows):
   * = user_pseudo_id in the GA4 BigQuery export (docs/ADS_ATTRIBUTION_GA4.md).
   * 32 hex chars today; anything not a plain token is dropped rather than rejected.
   */
  appInstanceId: z
    .string()
    .nullish()
    .transform((v) => {
      const t = v?.trim();
      return t && /^[A-Za-z0-9._:-]{8,128}$/.test(t) ? t : null;
    }),
});

export type AttributionBody = z.infer<typeof attributionBodySchema>;

const META_SOURCES = new Set(['meta', 'facebook', 'instagram', 'fb', 'ig', 'facebook_ads', 'meta_ads', 'audience_network', 'messenger']);
const APPLE_SOURCES = new Set(['apple_search_ads', 'apple_ads', 'asa', 'applesearchads', 'apple search ads', 'search_ads', 'searchads']);
const GOOGLE_PAID = new Set(['google_ads', 'googleads', 'adwords', 'google_adwords', 'google_ads_ga4']);
const ORGANIC = new Set(['organic', 'google-play', 'google_play', 'play_store', 'app_store', 'none', '(direct)', 'direct']);

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

function rawGet(raw: Record<string, unknown> | null | undefined, key: string): string {
  if (!raw) return '';
  const direct = raw[key];
  if (direct !== undefined && direct !== null) return norm(direct);
  // Play install referrer may arrive as a query string.
  const ref = raw.referrer ?? raw.installReferrer ?? raw.install_referrer;
  if (typeof ref === 'string' && ref.includes('=')) {
    try {
      return norm(new URLSearchParams(ref).get(key));
    } catch {
      return '';
    }
  }
  return '';
}

/** Map a reported source (+ raw payload) to a channel. */
export function classifyChannel(source: string, raw?: Record<string, unknown> | null, campaignId?: string | null): AttributionChannel {
  const s = norm(source);
  const utmSource = rawGet(raw, 'utm_source');
  const utmMedium = rawGet(raw, 'utm_medium');
  if (META_SOURCES.has(s) || META_SOURCES.has(utmSource) || rawGet(raw, 'fbclid')) return 'meta';
  if (APPLE_SOURCES.has(s)) {
    // AdServices: attribution=false means organic App Store install.
    const attributed = raw && 'attribution' in raw ? raw.attribution !== false && raw.attribution !== 'false' : true;
    return attributed && campaignId ? 'apple_ads' : 'organic';
  }
  if (GOOGLE_PAID.has(s) || rawGet(raw, 'gclid') || (utmSource === 'google' && ['cpc', 'ppc', 'paid'].includes(utmMedium))) return 'google_ads';
  if (ORGANIC.has(s) || (s === 'google' && (utmMedium === 'organic' || !utmMedium))) return 'organic';
  return 'unknown';
}

function parseClick(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const MAX_RAW_BYTES = 8_000;

function boundedRaw(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  try {
    const s = JSON.stringify(raw);
    return s.length <= MAX_RAW_BYTES ? raw : { truncated: true, bytes: s.length };
  } catch {
    return null;
  }
}

export function attributionFromBody(userId: string, body: AttributionBody): AttributionRow {
  const channel = classifyChannel(body.source, body.raw ?? null, body.campaignId ?? null);
  const paid = channel === 'apple_ads' || channel === 'meta' || channel === 'google_ads';
  const country = body.country ? body.country.toUpperCase().slice(0, 3) : null;
  return {
    user_id: userId,
    channel,
    platform: body.platform,
    source: body.source.slice(0, 64),
    campaign_external_id: paid ? (body.campaignId ?? null) : null,
    ad_group_external_id: paid ? (body.adGroupId ?? null) : null,
    keyword_external_id: paid ? (body.keywordId ?? null) : null,
    ad_external_id: paid ? (body.adId ?? null) : null,
    click_at: parseClick(body.clickDate),
    country,
    is_test: body.campaignId === APPLE_MOCK_CAMPAIGN_ID,
    raw: boundedRaw(body.raw ?? null),
    ...(body.appInstanceId ? { app_instance_id: body.appInstanceId } : {}),
  };
}

/** First touch wins; only an `unknown` row may be upgraded to a known channel. */
export function shouldReplace(existing: Pick<AttributionRow, 'channel'> | null, incoming: Pick<AttributionRow, 'channel'>): 'insert' | 'upgrade' | 'keep' {
  if (!existing) return 'insert';
  if (existing.channel === 'unknown' && incoming.channel !== 'unknown') return 'upgrade';
  return 'keep';
}

// ---------------------------------------------------------------------------
// RevenueCat fallback (subscriber_attributes from the Apple Search Ads integration)
// ---------------------------------------------------------------------------

const attr = (attrs: Record<string, any> | undefined, key: string): string | null => {
  const v = attrs?.[key];
  const value = v && typeof v === 'object' ? v.value : v;
  return value === undefined || value === null || value === '' ? null : String(value).slice(0, 128);
};

/** Row from a RevenueCat event, or null when it carries no attribution. */
export function attributionFromRevenueCat(event: Record<string, any>): AttributionRow | null {
  const attrs = event?.subscriber_attributes as Record<string, any> | undefined;
  const mediaSource = attr(attrs, '$mediaSource');
  if (!mediaSource) return null;
  const campaign = attr(attrs, '$campaign');
  const channel = classifyChannel(mediaSource, null, campaign);
  const store = String(event.store ?? '').toUpperCase();
  const platform = store === 'APP_STORE' || store === 'MAC_APP_STORE' ? 'ios' : store === 'PLAY_STORE' ? 'android' : store === 'STRIPE' ? 'web' : null;
  const paid = channel === 'apple_ads' || channel === 'meta' || channel === 'google_ads';
  return {
    user_id: String(event.app_user_id),
    channel,
    platform,
    source: 'revenuecat',
    campaign_external_id: paid ? campaign : null,
    ad_group_external_id: paid ? attr(attrs, '$adGroup') : null,
    keyword_external_id: paid ? attr(attrs, '$keyword') : null,
    ad_external_id: paid ? attr(attrs, '$ad') : null,
    click_at: null,
    country: event.country_code ? String(event.country_code).toUpperCase().slice(0, 3) : null,
    is_test: campaign === APPLE_MOCK_CAMPAIGN_ID,
    raw: { mediaSource, campaign, adGroup: attr(attrs, '$adGroup'), keyword: attr(attrs, '$keyword'), ad: attr(attrs, '$ad') },
  };
}
