/**
 * Throwaway-inbox domains refused at sign-up (and never counted as a real
 * referral). Not exhaustive by design: it stops casual burner-account farms;
 * rate limits and device checks do the rest. Keep the list sorted; a domain
 * here also matches its subdomains (e.g. `x.mailinator.com`).
 */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  '33mail.com',
  'anonaddy.me',
  'burnermail.io',
  'byom.de',
  'dispostable.com',
  'discard.email',
  'dropmail.me',
  'emailfake.com',
  'emailondeck.com',
  'emailtemporanea.com',
  'fakeinbox.com',
  'fakemail.net',
  'getairmail.com',
  'getnada.com',
  'grr.la',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.info',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'harakirimail.com',
  'inboxbear.com',
  'inboxkitten.com',
  'jetable.org',
  'luxusmail.org',
  'mail.tm',
  'mail-temp.com',
  'maildrop.cc',
  'mailcatch.com',
  'maildim.com',
  'mailinator.com',
  'mailinator.net',
  'mailnesia.com',
  'mailpoof.com',
  'mailsac.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'nada.email',
  'pokemail.net',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempail.com',
  'tempinbox.com',
  'tempmail.com',
  'tempmail.dev',
  'tempmail.net',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'tmail.ws',
  'tmpmail.net',
  'tmpmail.org',
  'trash-mail.com',
  'trashmail.com',
  'trashmail.de',
  'trashmail.net',
  'wegwerfmail.de',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

/** Shown when sign-up refuses a throwaway inbox. */
export const DISPOSABLE_EMAIL_MESSAGE = 'Please use a permanent email address. Temporary inboxes are not supported.';

/** Lower-cased domain of an address, or null. */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.+$/, '');
  return domain || null;
}

export function isDisposableEmail(email: string | null | undefined): boolean {
  const domain = emailDomain(email);
  if (!domain) return false;
  const labels = domain.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    if (DISPOSABLE_EMAIL_DOMAINS.has(labels.slice(i).join('.'))) return true;
  }
  return false;
}
