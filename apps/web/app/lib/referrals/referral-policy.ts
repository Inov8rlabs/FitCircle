/**
 * Referral program rules — the single source of truth for every number in
 * docs/REFERRALS_SPEC.md §2. Services read these; clients receive them via the
 * hub payload (`program`) and never hardcode them.
 */

export const REFERRAL_POLICY = {
  /** Pro days the inviter earns per qualified friend. */
  inviterRewardDays: 7,
  /** Qualified friends needed for Lifetime Pro. */
  lifetimeThreshold: 100,
  /** A new account can be attributed this long after it was created. */
  attributionWindowDays: 7,
  /**
   * A friend counts once they've checked in on this many DIFFERENT days — a
   * real habit start, not a throwaway signup (and the progress bar gives the
   * inviter a natural reason to cheer them on).
   */
  qualifyingDays: 3,
  /** …within this many days of attribution. */
  qualifyWindowDays: 14,
  /** More qualifications than this for one inviter in 24h ⇒ held for review. */
  velocityPer24h: 10,
} as const;

/** Pro days the invitee earns once they qualify (0 disables). Env-tunable. */
export function inviteeRewardDays(): number {
  const raw = process.env.REFERRAL_INVITEE_REWARD_DAYS;
  if (raw === undefined || raw === '') return 7;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 30) : 7;
}

export interface Milestone {
  count: number;
  key: string;
  title: string;
  blurb: string;
}

export const MILESTONES: readonly Milestone[] = [
  { count: 1, key: 'first_friend', title: 'First Recruit', blurb: "Your first friend is in. That's how it starts." },
  { count: 3, key: 'crew', title: 'Crew', blurb: "Three's a crew. Accountability unlocked." },
  { count: 5, key: 'full_circle', title: 'Full Circle', blurb: 'Five friends. Your circle is complete.' },
  { count: 10, key: 'squad_leader', title: 'Squad Leader', blurb: 'Ten people moving because of you.' },
  { count: 25, key: 'captain', title: 'Captain', blurb: "You're building a movement." },
  { count: 50, key: 'legend', title: 'Legend', blurb: 'Halfway to forever.' },
  { count: 100, key: 'lifetime', title: 'Lifetime Pro', blurb: '100 friends. Pro is yours for life.' },
];

/** Grant `granted_by` markers on complimentary_grants rows owned by the program. */
export const REFERRAL_GRANT = {
  timeBoxed: 'referral-program',
  lifetime: 'referral-lifetime',
} as const;

/**
 * Throwaway-inbox domains. Not exhaustive by design — it stops the casual
 * "ten Gmail-less burner accounts" farm; velocity + device checks do the rest.
 */
export const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com',
  '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'throwawaymail.com',
  'yopmail.com', 'yopmail.net', 'getnada.com', 'nada.email', 'trashmail.com', 'trashmail.de',
  'dispostable.com', 'maildrop.cc', 'mintemail.com', 'mohmal.com', 'emailondeck.com',
  'fakeinbox.com', 'tempinbox.com', 'mailnesia.com', 'spamgourmet.com', 'mytemp.email',
  'tempr.email', 'discard.email', 'burnermail.io', 'inboxkitten.com', 'mail.tm', 'tmpmail.org',
  'tmail.ws', 'moakt.com', 'emailfake.com', 'tempail.com', 'luxusmail.org', 'mailpoof.com',
]);

export function isDisposableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.split('@')[1]?.trim().toLowerCase();
  return !!domain && DISPOSABLE_EMAIL_DOMAINS.has(domain);
}
