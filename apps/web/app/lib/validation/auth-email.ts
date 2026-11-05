/**
 * Server side of the forgiving email field (lib/validation/email-input.ts) for
 * the auth routes: sign up, log in, password reset, resend confirmation.
 *
 * Clients already clean the address before sending it, but shipped builds and
 * other callers may not, so the routes apply the same clean-up instead of
 * answering 400 for a difference the person can't see: surrounding whitespace
 * or a newline, a space around "@" or between domain labels (`gmail com`),
 * upper-case letters. The address is lower-cased as a whole — Supabase Auth
 * stores and matches emails lower-cased, so `X@Gmail.Com` signs in to
 * `x@gmail.com`, and `profiles.email` should hold the same value.
 *
 * The routes never apply the invite validator's TLD / typo verdicts: a
 * well-formed address is accepted (log in must work for whatever the account
 * really uses); anything not well-formed still fails `z.string().email()`.
 */
import { z } from 'zod';

import { checkEmailInput } from './email-input';

export function normalizeAuthEmail(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const r = checkEmailInput(raw);
  const wellFormed = r.valid || r.reason === 'unknown_tld' || r.reason === 'typo_likely';
  return (wellFormed ? r.email : raw.trim()).toLowerCase();
}

export const authEmailSchema = (message = 'Invalid email address') =>
  z.preprocess(normalizeAuthEmail, z.string().email(message));
