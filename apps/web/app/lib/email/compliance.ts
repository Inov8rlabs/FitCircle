/**
 * Marketing / lifecycle email compliance (CAN-SPAM, CASL, UK PECR, SG Spam Control Act;
 * docs/PRIVACY_COMPLIANCE_SPEC.md §6).
 *
 * Every marketing or lifecycle email must carry (1) the sender's postal address
 * (EMAIL_POSTAL_ADDRESS) and (2) a working unsubscribe (List-Unsubscribe header + a link in
 * the body). `sendEmail` enforces this centrally for MARKETING_EMAIL_CATEGORIES: when either is
 * missing the email is NOT sent (errorName `compliance_blocked`) and the reason is logged.
 * Transactional mail (Supabase auth, notifications the user asked for, reward receipts, the
 * internal ads report) is exempt but still shows the address when it is set (brand shell).
 */

/** Streams that are marketing or lifecycle (commercial) email. */
export const MARKETING_EMAIL_CATEGORIES: ReadonlySet<string> = new Set([
  'welcome',
  'campaign',
  'onboarding_nudge',
  'referral_invite',
  'referral_reminder',
]);

export type EmailComplianceProblem = 'missing_postal_address' | 'footer_missing_postal_address' | 'missing_unsubscribe';

type Env = Record<string, string | undefined>;

/** The configured postal address (trimmed), or null when unset. Never logged. */
export function emailPostalAddress(env: Env = process.env): string | null {
  const v = (env.EMAIL_POSTAL_ADDRESS ?? '').trim();
  return v ? v : null;
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function isMarketingCategory(category: string | undefined): boolean {
  return MARKETING_EMAIL_CATEGORIES.has(category ?? 'other');
}

/**
 * Null when a marketing email may be sent; otherwise the first problem. Non-marketing
 * categories always pass. Pure (env injectable).
 */
export function checkMarketingEmail(
  p: { category?: string; html: string; text?: string; headers?: Record<string, string> },
  env: Env = process.env
): EmailComplianceProblem | null {
  if (!isMarketingCategory(p.category)) return null;
  const address = emailPostalAddress(env);
  if (!address) return 'missing_postal_address';
  const inHtml = p.html.includes(escHtml(address)) || p.html.includes(address);
  if (!inHtml) return 'footer_missing_postal_address';
  const unsub = Object.entries(p.headers ?? {}).find(([k]) => k.toLowerCase() === 'list-unsubscribe')?.[1];
  if (!unsub || !/<https?:\/\//i.test(unsub)) return 'missing_unsubscribe';
  return null;
}
