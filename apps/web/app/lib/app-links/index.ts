/**
 * Web → app handoff: store URLs, the `/get` smart link, universal / App Link
 * "open in app" URLs and attribution plumbing. Pure functions (no React, no
 * Next imports) so they run in server components, route handlers, client
 * components and tests alike.
 *
 * IDs are the shipped ones, not guesses:
 * - App Store id 6811432467: FitCircle-iOS ReviewPrompt.swift (write-review URL),
 *   ASC_APP_ID in docs/CAMPAIGNS_SPEC.md, and the existing Smart App Banner.
 * - Android package com.inov8rlabs.apps.fitcircle: public/.well-known/assetlinks.json
 *   and the Android applicationId.
 */

import { ANDROID_PACKAGE, INVITE_HOST, normalizeCode } from '@/lib/referrals/links';
import { detectPlatform, type InvitePlatform } from '@/lib/referrals/web';

export { ANDROID_PACKAGE };
export type DevicePlatform = InvitePlatform;
export { detectPlatform };

export const APP_STORE_ID = '6811432467';
/** Apex host: a different host than www, so Safari hands taps on it to the universal link. */
export const APEX_HOST = 'https://fitcircle.ai';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type Utm = Partial<Record<UtmKey, string>>;

export interface GetAppParams {
  /** Personal referral code of the inviter. */
  ref?: string | null;
  /** Circle invite code. */
  circle?: string | null;
  /** Where on the site the CTA lives (hero, banner, post_signup …). */
  placement?: string | null;
  utm?: Utm;
}

const SAFE_CODE_RE = /^[A-Z0-9-]{4,16}$/;
const SAFE_TOKEN_RE = /^[A-Za-z0-9_.-]{1,64}$/;

function safeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = normalizeCode(raw);
  return SAFE_CODE_RE.test(code) ? code : null;
}

function safeToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  return SAFE_TOKEN_RE.test(v) ? v : null;
}

/** Reads `/get` params from a query string, dropping anything unsafe or unknown. */
export function parseGetAppParams(search: URLSearchParams | Record<string, string | string[] | undefined>): GetAppParams {
  const get = (k: string): string | null => {
    if (search instanceof URLSearchParams) return search.get(k);
    const v = search[k];
    return Array.isArray(v) ? v[0] ?? null : v ?? null;
  };
  const utm: Utm = {};
  for (const k of UTM_KEYS) {
    const v = safeToken(get(k));
    if (v) utm[k] = v;
  }
  return {
    ref: safeCode(get('ref')),
    circle: safeCode(get('circle')),
    placement: safeToken(get('placement')),
    utm,
  };
}

export function hasInvite(p: GetAppParams): boolean {
  return Boolean(p.ref || p.circle);
}

/** Default UTM for a placement when the page didn't arrive with its own. */
function withDefaultUtm(p: GetAppParams): Utm {
  return {
    utm_source: p.utm?.utm_source ?? 'web',
    utm_medium: p.utm?.utm_medium ?? (hasInvite(p) ? 'invite' : 'get_app'),
    ...(p.utm?.utm_campaign || p.placement ? { utm_campaign: p.utm?.utm_campaign ?? p.placement ?? undefined } : {}),
    ...(p.utm?.utm_content ? { utm_content: p.utm.utm_content } : {}),
    ...(p.utm?.utm_term ? { utm_term: p.utm.utm_term } : {}),
  };
}

/**
 * App Store listing. Opening an apps.apple.com/app/id… URL from Safari (or any
 * in-app browser) launches the App Store app natively.
 *
 * Apple only attributes campaign links that carry the team's provider token
 * (`pt`, App Store Connect → App Analytics → Campaigns). It is optional here:
 * set NEXT_PUBLIC_ASC_PROVIDER_TOKEN to add `pt` + `ct` (campaign, ≤ 40 chars).
 */
export function appStoreUrl(p: GetAppParams = {}, providerToken: string | null | undefined = undefined): string {
  const base = `https://apps.apple.com/app/id${APP_STORE_ID}`;
  const pt = safeToken(providerToken ?? null);
  if (!pt) return base;
  const utm = withDefaultUtm(p);
  const ct = [utm.utm_campaign ?? utm.utm_medium, p.ref ?? p.circle].filter(Boolean).join('-').slice(0, 40);
  const qs = new URLSearchParams({ pt, ct, mt: '8' });
  return `${base}?${qs.toString()}`;
}

/**
 * Google Play listing whose install referrer carries the invite
 * (`fc_ref` / `fc_circle`, read by the Android app's InstallReferrerReader)
 * plus UTM (Play Console acquisition reports read utm_* from the referrer).
 */
export function playStoreUrl(p: GetAppParams = {}): string {
  const referrer = new URLSearchParams();
  if (p.ref) referrer.set('fc_ref', p.ref);
  if (p.circle) referrer.set('fc_circle', p.circle);
  const utm = withDefaultUtm(p);
  for (const k of UTM_KEYS) {
    const v = utm[k];
    if (v) referrer.set(k, v);
  }
  return `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}&referrer=${encodeURIComponent(referrer.toString())}`;
}

/** Same-origin `/get` link every "Get the app" CTA uses. */
export function getAppHref(p: GetAppParams = {}): string {
  const qs = new URLSearchParams();
  if (p.placement) qs.set('placement', p.placement);
  if (p.ref) qs.set('ref', p.ref);
  if (p.circle) qs.set('circle', p.circle);
  for (const k of UTM_KEYS) {
    const v = p.utm?.[k];
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `/get?${s}` : '/get';
}

/** Absolute `/get` link, e.g. for the desktop QR code (scanned on the phone it lands in the right store). */
export function absoluteGetAppUrl(p: GetAppParams = {}, host: string = INVITE_HOST): string {
  return `${host}${getAppHref({ ...p, utm: { utm_medium: 'qr', ...p.utm } })}`;
}

export type StoreTarget = { store: 'app_store' | 'play_store'; url: string } | { store: 'none'; url: null };

/** Where `/get` sends a visitor. Desktop (and unknown) get the fallback page. */
export function storeTargetFor(platform: DevicePlatform, p: GetAppParams, providerToken?: string | null): StoreTarget {
  if (platform === 'ios') return { store: 'app_store', url: appStoreUrl(p, providerToken) };
  if (platform === 'android') return { store: 'play_store', url: playStoreUrl(p) };
  return { store: 'none', url: null };
}

/** Paths the Android app claims as App Links (AndroidManifest intent filters). */
export const ANDROID_APP_LINK_PATH_RE = /^\/(i|join|c)\//;

/**
 * "Open FitCircle" when the app may already be installed.
 * - iOS: the apex host (fitcircle.ai) path is claimed in apple-app-site-association,
 *   so with the app installed iOS opens it; otherwise the apex redirects to www,
 *   which serves `path` (and `/open` forwards to the App Store).
 * - Android: for /i/, /join/ and /c/ an intent:// URL for the same https path
 *   (App Link filters); for anything else a launcher intent. Not installed →
 *   Chrome follows `browser_fallback_url` (the Play listing with the referrer).
 * - Desktop: null.
 */
export function openAppUrl(platform: DevicePlatform, path: string, fallbackUrl: string): string | null {
  const url = new URL(path, INVITE_HOST);
  if (platform === 'ios') return `${APEX_HOST}${url.pathname}${url.search}`;
  if (platform === 'android') {
    const fallback = `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`;
    // Only /i/, /join/ and /c/ have App Link filters in the Android manifest; any
    // other path would never resolve to the app, so launch it from its icon instead.
    if (ANDROID_APP_LINK_PATH_RE.test(url.pathname)) {
      return `intent://www.fitcircle.ai${url.pathname}${url.search}#Intent;scheme=https;package=${ANDROID_PACKAGE};${fallback};end`;
    }
    return `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${ANDROID_PACKAGE};${fallback};end`;
  }
  return null;
}

/** `/open` path carrying the same params as `/get` (claimed by the iOS app via AASA). */
export function openPath(p: GetAppParams = {}): string {
  return getAppHref(p).replace(/^\/get/, '/open');
}

/**
 * Whether the browser shows Apple's Smart App Banner itself (Safari on iPhone/iPad
 * only, never Chrome/Firefox/Edge for iOS or in-app browsers). We skip our own
 * banner there so the visitor never sees two.
 */
export function showsNativeSmartBanner(ua: string | null | undefined): boolean {
  const s = ua ?? '';
  if (!/iphone|ipad|ipod/i.test(s)) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA\/|FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|Snapchat|LinkedInApp/i.test(s)) return false;
  return /Safari\//.test(s);
}
