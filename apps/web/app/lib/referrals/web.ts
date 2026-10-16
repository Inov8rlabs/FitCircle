/**
 * Web-only referral helpers: the `fc_ref` first-party cookie, platform
 * detection for the landing pages, and landing-page copy/metadata builders.
 * Pure functions (no React / no Next imports) so they are trivially testable
 * and usable from server components, route handlers and client components.
 */

import { INVITE_HOST, circleInviteUrl, normalizeCode, personalInviteUrl } from './links';
import type { ReferralPreview } from './types';

// ---------------------------------------------------------------------------
// fc_ref cookie
// ---------------------------------------------------------------------------

export const FC_REF_COOKIE = 'fc_ref';
export const FC_REF_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface PendingInvite {
  /** The code to claim: the personal code (`/i/CODE`) or the circle code (`/join/CODE`). */
  code: string;
  /** Personal referral code of the inviting member, when known. */
  ref: string | null;
  /** Circle invite code, when the invite was to a circle. */
  circle: string | null;
  /** Epoch ms when the link was opened. */
  ts: number;
}

const SAFE_CODE_RE = /^[A-Z0-9-]{4,16}$/;

function safeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = normalizeCode(raw);
  return SAFE_CODE_RE.test(code) ? code : null;
}

export function buildPendingInvite(input: {
  code: string;
  ref?: string | null;
  circle?: string | null;
  ts?: number;
}): PendingInvite | null {
  const code = safeCode(input.code);
  if (!code) return null;
  return {
    code,
    ref: safeCode(input.ref ?? null),
    circle: safeCode(input.circle ?? null),
    ts: input.ts ?? Date.now(),
  };
}

export function serializePendingInvite(invite: PendingInvite): string {
  return encodeURIComponent(JSON.stringify(invite));
}

/** Parses a raw cookie value; returns null when malformed or older than 7 days. */
export function parsePendingInvite(raw: string | null | undefined, now: number = Date.now()): PendingInvite | null {
  if (!raw) return null;
  try {
    let text = raw;
    try {
      text = decodeURIComponent(raw);
    } catch {
      // already decoded
    }
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const ts = typeof parsed.ts === 'number' ? parsed.ts : NaN;
    if (!Number.isFinite(ts) || now - ts > FC_REF_MAX_AGE_SECONDS * 1000 || ts - now > 60_000) return null;
    return buildPendingInvite({
      code: String(parsed.code ?? ''),
      ref: (parsed.ref as string | null) ?? null,
      circle: (parsed.circle as string | null) ?? null,
      ts,
    });
  } catch {
    return null;
  }
}

/** `document.cookie` assignment string that stores the pending invite. */
export function pendingInviteCookieString(invite: PendingInvite, secure: boolean): string {
  return `${FC_REF_COOKIE}=${serializePendingInvite(invite)}; Max-Age=${FC_REF_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${
    secure ? '; Secure' : ''
  }`;
}

/** Reads `fc_ref` out of a `document.cookie`-style header string. */
export function readPendingInviteFromCookieHeader(header: string | null | undefined): PendingInvite | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === FC_REF_COOKIE) return parsePendingInvite(rest.join('='));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

export type InvitePlatform = 'ios' | 'android' | 'desktop';

/**
 * Classifies a user agent. iPadOS 13+ reports a desktop Mac UA, so the client
 * passes `maxTouchPoints` to tell a touch "Mac" (an iPad) from a real Mac.
 */
export function detectPlatform(ua: string | null | undefined, opts: { maxTouchPoints?: number } = {}): InvitePlatform {
  const s = ua ?? '';
  if (/android/i.test(s)) return 'android';
  if (/iphone|ipad|ipod/i.test(s)) return 'ios';
  if (/macintosh/i.test(s) && (opts.maxTouchPoints ?? 0) > 1) return 'ios';
  return 'desktop';
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** The canonical (www) URL of the invite being viewed. */
export function canonicalInviteUrl(kind: 'personal' | 'circle', code: string, ref?: string | null): string {
  return kind === 'circle' ? circleInviteUrl(code, ref) : personalInviteUrl(code);
}

/**
 * "Already have the app?" link.
 * - Android: an intent:// URL that opens the app's App Link handler, falling back to the Play listing.
 * - iOS: Safari never hands a same-host tap to a universal link, so we point at the apex host
 *   (a different host than www); with the app installed iOS opens it, otherwise the apex
 *   redirects back to this page.
 */
export function openInAppUrl(platform: InvitePlatform, inviteUrl: string, fallbackUrl: string): string | null {
  const url = new URL(inviteUrl, INVITE_HOST);
  if (platform === 'android') {
    return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.inov8rlabs.apps.fitcircle;S.browser_fallback_url=${encodeURIComponent(
      fallbackUrl
    )};end`;
  }
  if (platform === 'ios') {
    return `https://fitcircle.ai${url.pathname}${url.search}`;
  }
  return null;
}

/** Web signup URL carrying the invite through registration. */
export function registerUrlFor(invite: { ref?: string | null; circle?: string | null; code: string }): string {
  const params = new URLSearchParams();
  const ref = invite.ref ?? (invite.circle ? null : invite.code);
  if (ref) params.set('ref', ref);
  if (invite.circle) params.set('circle', invite.circle);
  const qs = params.toString();
  return qs ? `/register?${qs}` : '/register';
}

/** Where a freshly registered invitee should land after onboarding (circle invites only). */
export function postSignupReturnUrl(circle: string | null | undefined, ref: string | null | undefined): string | null {
  const c = safeCode(circle ?? null);
  if (!c) return null;
  const r = safeCode(ref ?? null);
  return r ? `/join/${c}?ref=${r}` : `/join/${c}`;
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export function inviterFirstName(preview: ReferralPreview | null | undefined): string {
  return preview?.inviter?.firstName?.trim() || 'A friend';
}

export function inviteTitle(preview: ReferralPreview | null | undefined): string {
  if (!preview?.valid) return 'Join me on FitCircle';
  const name = inviterFirstName(preview);
  if (preview.kind === 'circle' && preview.circle?.name) {
    const owner = preview.inviter?.firstName?.trim() ? `${name}'s` : "a friend's";
    return `Join ${owner} circle “${preview.circle.name}” on FitCircle`;
  }
  return `${name} saved you a seat on FitCircle`;
}

export function rewardLine(days: number | undefined): string | null {
  if (!days || days <= 0) return null;
  const span = days === 7 ? 'a free week' : `${days} free days`;
  return `Check in on 3 different days and you both get ${span} of Pro.`;
}

export function inviteDescription(preview: ReferralPreview | null | undefined): string {
  const base =
    preview?.valid && preview.kind === 'circle'
      ? 'Log meals, keep your streak, and keep each other honest in a FitCircle.'
      : 'FitCircle keeps friends accountable: log meals, keep your streak, check in together.';
  const reward = preview?.valid ? rewardLine(preview.inviteeRewardDays) : null;
  return reward ? `${base} ${reward}` : base;
}

const CHALLENGE_LABELS: Record<string, string> = {
  weight_loss: 'Weight loss',
  step_count: 'Steps',
  workout_frequency: 'Workouts',
  custom: 'Custom goal',
  nutrition: 'Healthy eating',
};

export function challengeTypeLabel(type: string | null | undefined): string | null {
  if (!type) return null;
  return (
    CHALLENGE_LABELS[type] ??
    type
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  );
}
