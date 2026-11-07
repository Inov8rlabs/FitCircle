/**
 * One mailbox, one identity: the canonical form of an address, used where
 * several spellings of the same inbox must count once (referral self-referral
 * checks, the lifetime free food-AI allowance). Never used to send mail or to
 * sign in: the stored address stays exactly as the user typed it.
 *
 *   - lower-cased, trimmed
 *   - `+tag` removed for every domain (sub-addressing)
 *   - Gmail / Googlemail: dots in the local part removed, googlemail.com → gmail.com
 */
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export function canonicalEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1).replace(/\.+$/, '');
  const plus = local.indexOf('+');
  if (plus >= 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  if (!local || !domain) return null;
  return `${local}@${domain}`;
}

/** True when the two addresses are the same mailbox. */
export function sameMailbox(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonicalEmail(a);
  return !!ca && ca === canonicalEmail(b);
}
