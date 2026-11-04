/**
 * Links in lifecycle messages: every CTA carries UTM (utm_source=email,
 * utm_medium=lifecycle|transactional, utm_campaign=<message_key>,
 * utm_content=<variant>, utm_term=<cta id>) plus two attribution params the
 * apps can forward on open (docs/ENGAGEMENT_MESSAGING.md §7):
 *
 *   msg     = message key            (e.g. weekly_report)
 *   msg_id  = engagement_sends row id (absent in previews)
 *
 * App destinations use https://fitcircle.ai/open?screen=<screen>: the apex
 * /open path is claimed in apple-app-site-association (the iOS app opens) and
 * falls through to /get (the right store) when the app isn't installed.
 * Campaign links use /c/<slug>, an App Link on both platforms.
 */
import type { AppScreen, Medium, MessageKey } from './types';

export const SITE = 'https://www.fitcircle.ai';
/** Apex host: Safari hands taps on it to the universal link (lib/app-links). */
export const APEX = 'https://fitcircle.ai';

/** Raw destination for an in-app screen (decorated later by `trackedUrl`). */
export function appScreenUrl(screen: AppScreen, params: Record<string, string> = {}): string {
  const qs = new URLSearchParams({ screen, ...params });
  return `${APEX}/open?${qs.toString()}`;
}

export function campaignUrl(slug: string): string {
  return `${SITE}/c/${encodeURIComponent(slug)}`;
}

export function personalInviteUrl(code: string): string {
  return `${SITE}/i/${encodeURIComponent(code)}`;
}

export interface LinkContext {
  messageKey: MessageKey;
  medium: Medium;
  /** utm_content: the variant the link belongs to. */
  content?: string;
  /** utm_term: the CTA id. */
  ctaId?: string;
  /** engagement_sends.id, when known. */
  sendId?: string | null;
}

const TOKEN_SAFE = /[^A-Za-z0-9_.:-]+/g;
const token = (s: string) => s.replace(TOKEN_SAFE, '_').slice(0, 64);

/**
 * Adds UTM + msg params to a FitCircle URL. Non-FitCircle hosts are returned
 * untouched (we never decorate third-party links), as are mailto: links.
 */
export function trackedUrl(raw: string, ctx: LinkContext): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.protocol !== 'https:' || !/(^|\.)fitcircle\.ai$/i.test(url.hostname)) return raw;
  const set = (k: string, v: string | undefined | null) => {
    if (v) url.searchParams.set(k, v);
  };
  set('utm_source', 'email');
  set('utm_medium', ctx.medium);
  set('utm_campaign', ctx.messageKey);
  set('utm_content', ctx.content ? token(ctx.content) : undefined);
  set('utm_term', ctx.ctaId ? token(ctx.ctaId) : undefined);
  set('msg', ctx.messageKey);
  set('msg_id', ctx.sendId && /^[0-9a-f-]{36}$/i.test(ctx.sendId) ? ctx.sendId : undefined);
  return url.toString();
}

/** Reads the CTA id back out of a clicked URL (Resend `email.clicked` → analytics). */
export function ctaIdFromUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const term = u.searchParams.get('utm_term');
    if (term) return token(term);
    if (/unsubscribe/.test(u.pathname)) return 'unsubscribe';
    return null;
  } catch {
    return null;
  }
}
