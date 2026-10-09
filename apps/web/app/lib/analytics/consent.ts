/**
 * Reads the analytics choice stored by CookieConsentBanner / privacy settings
 * in the `fc_consent` cookie: `{ essential, analytics, marketing }`.
 */
export const CONSENT_COOKIE = 'fc_consent';

export function readAnalyticsConsent(cookieString?: string): boolean {
  const source = cookieString ?? (typeof document !== 'undefined' ? document.cookie : '');
  if (!source) return false;
  const entry = source
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CONSENT_COOKIE}=`));
  if (!entry) return false;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(entry.slice(CONSENT_COOKIE.length + 1)));
    return typeof parsed === 'object' && parsed !== null && (parsed as { analytics?: unknown }).analytics === true;
  } catch {
    return false;
  }
}
