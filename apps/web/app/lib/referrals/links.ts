/**
 * Invite link + code helpers shared by the API, the landing pages and tests.
 * Formats are the client contract in docs/REFERRALS_SPEC.md §3.
 */

export const INVITE_HOST = 'https://www.fitcircle.ai';
export const ANDROID_PACKAGE = 'com.inov8rlabs.apps.fitcircle';

/** Circle invite codes: FIT + 6 (optionally FIT-XXXXXX). */
export const CIRCLE_CODE_RE = /^FIT-?[A-Z0-9]{6}$/;
/** Personal referral codes: 4–12 alphanumerics, never starting with FIT. */
export const REFERRAL_CODE_RE = /^(?!FIT)[A-Z0-9]{4,12}$/;

export function normalizeCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

export type CodeKind = 'circle' | 'personal';

export function classifyCode(raw: string | null | undefined): CodeKind | null {
  const code = normalizeCode(raw);
  if (CIRCLE_CODE_RE.test(code)) return 'circle';
  if (REFERRAL_CODE_RE.test(code)) return 'personal';
  return null;
}

export function personalInviteUrl(code: string): string {
  return `${INVITE_HOST}/i/${encodeURIComponent(code)}`;
}

export function circleInviteUrl(circleCode: string, ref?: string | null): string {
  const base = `${INVITE_HOST}/join/${encodeURIComponent(circleCode)}`;
  return ref ? `${base}?ref=${encodeURIComponent(ref)}` : base;
}

/** Play Store link whose install referrer carries the invite (read by the Android app on first launch). */
export function playStoreUrl(params: { ref?: string | null; circle?: string | null }): string {
  const referrer = new URLSearchParams();
  if (params.ref) referrer.set('fc_ref', params.ref);
  if (params.circle) referrer.set('fc_circle', params.circle);
  const base = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
  const encoded = referrer.toString();
  return encoded ? `${base}&referrer=${encodeURIComponent(encoded)}` : base;
}

export function personalShareMessage(url: string): string {
  return `I'm using FitCircle to stay on track, join me so we keep each other honest. Check in 3 days and we both get a free week of Pro: ${url}`;
}

export function circleShareMessage(circleName: string, url: string): string {
  return `Join my circle "${circleName}" on FitCircle. We keep each other honest. Check in 3 days and we both get a free week of Pro: ${url}`;
}

/** Code generation: first-name stem (≤5 letters) + 3 random chars from an unambiguous alphabet. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateReferralCode(name: string | null | undefined, random: () => number = Math.random): string {
  let stem = (name ?? '')
    .normalize('NFKD')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 5);
  if (stem.startsWith('FIT')) stem = stem.replace(/^FIT/, 'FT');
  if (stem.length < 2) stem = 'PAL';
  let suffix = '';
  for (let i = 0; i < 3; i++) suffix += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return `${stem}${suffix}`;
}
