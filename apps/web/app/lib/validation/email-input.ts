/**
 * Forgiving clean-up for the address a person types for THEMSELVES (sign up,
 * log in, password reset). Keyboards leave artefacts in it that must never
 * hard-block sign-up:
 *  - `abajirao.apps@gmail com` — autocorrect / a suggestion strip turned the
 *    dot before "com" into a space (Gboard, 2026-11);
 *  - `x @gmail.com`, `x@ gmail.com` — a space either side of "@";
 *  - `x@gmail .com`, `x@gmail. com` — a space next to a dot;
 *  - a trailing space or newline from autofill, `X@Gmail.Com`.
 *
 * Built on the invite validator (`email-address.ts`) so "valid" means the same
 * thing everywhere. The iOS (`EmailInput.swift`) and Android (`EmailInput.kt`)
 * ports must behave identically; the shared vectors are the `input_cases` and
 * `typing_cases` in `__fixtures__/email-cases.json`.
 *
 * Rules (`checkEmailInput`):
 *  1. Trim; whitespace either side of "@" is removed (it never belongs there).
 *  2. Whitespace inside the domain: next to a dot it is dropped, otherwise it
 *     becomes a dot (`gmail com` → `gmail.com`). Applied ONLY when the result
 *     is a valid address; otherwise the answer is `space` with the validator's
 *     suggestion for the repaired address (`gmial com` → "Did you mean …gmail.com?").
 *  3. Whitespace inside the local part is ambiguous (`john smith`): `space`,
 *     suggesting the address with the spaces removed when that is valid.
 *  4. Everything else is the invite validator's verdict (domain lower-cased,
 *     local part kept as typed).
 */
import { validateEmailAddress, type EmailRejectReason } from './email-address';
import { IANA_TLDS } from './email-tlds.generated';

/** `space`: whitespace inside the address that could not be fixed safely. */
export type EmailInputReason = EmailRejectReason | 'space';

export interface EmailInputResult {
  /**
   * The address to submit (and show in the field) when valid. When invalid,
   * the trimmed text with whitespace around "@" removed.
   */
  email: string;
  valid: boolean;
  reason?: EmailInputReason;
  /** Full corrected address to offer as "Did you mean …?". */
  suggestion?: string;
  /** Whitespace inside the address was removed or turned into a dot. */
  fixedSpace: boolean;
}

const WS = /\s/;
const WS_AROUND_AT = /\s*@\s*/g;

export function checkEmailInput(raw: string | null | undefined): EmailInputResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { email: '', valid: false, reason: 'empty', fixedSpace: false };

  const text = trimmed.replace(WS_AROUND_AT, '@');
  const at = text.indexOf('@');
  const singleAt = at >= 0 && text.indexOf('@', at + 1) < 0;
  if (!WS.test(text) || !singleAt) {
    const r = validateEmailAddress(text);
    return {
      email: r.normalized,
      valid: r.valid,
      ...(r.reason ? { reason: r.reason } : {}),
      ...(r.suggestion ? { suggestion: r.suggestion } : {}),
      fixedSpace: r.valid && text !== trimmed,
    };
  }

  const local = text.slice(0, at);
  const domain = text
    .slice(at + 1)
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s+/g, '.');

  if (!WS.test(local)) {
    const repaired = validateEmailAddress(`${local}@${domain}`);
    if (repaired.valid) return { email: repaired.normalized, valid: true, fixedSpace: true };
    return spaceResult(text, repaired.suggestion);
  }

  const squashed = validateEmailAddress(`${local.replace(/\s+/g, '')}@${domain}`);
  return spaceResult(text, squashed.valid ? squashed.normalized : squashed.suggestion);
}

function spaceResult(email: string, suggestion: string | undefined): EmailInputResult {
  return suggestion
    ? { email, valid: false, reason: 'space', suggestion, fixedSpace: false }
    : { email, valid: false, reason: 'space', fixedSpace: false };
}

/**
 * The hint to show while the person is still typing (after `EMAIL_TYPING_PAUSE_MS`
 * without a keystroke), or null. Only whitespace problems are surfaced live —
 * syntax, unknown TLDs and typos wait for blur or submit — and never while the
 * repaired domain is still being typed (`x@gmail c` on the way to `gmail com`).
 */
export function checkEmailInputWhileTyping(raw: string | null | undefined): EmailInputResult | null {
  const trimmed = (raw ?? '').trim();
  const text = trimmed.replace(WS_AROUND_AT, '@');
  if (!text.includes('@') || !WS.test(text)) return null;
  const result = checkEmailInput(trimmed);
  if (result.valid) {
    // Fixed on submit anyway; say so now so the field doesn't look broken.
    return { email: text, valid: false, reason: 'space', suggestion: result.email, fixedSpace: false };
  }
  if (result.reason !== 'space' || stillTypingDomain(repairedCandidate(text))) return null;
  return result;
}

/** The address with every inner space removed / turned into a dot (may still be invalid). */
function repairedCandidate(text: string): string {
  const at = text.indexOf('@');
  const local = text.slice(0, at).replace(/\s+/g, '');
  const domain = text
    .slice(at + 1)
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s+/g, '.');
  return `${local}@${domain}`;
}

/**
 * True when the address's domain looks unfinished: no dot yet, ends in a dot,
 * the suggested fix only appends to it, or its TLD is the start of a real one.
 * Same gate as the invite field's typing check.
 */
function stillTypingDomain(address: string): boolean {
  const at = address.lastIndexOf('@');
  const domain = address.slice(at + 1).toLowerCase();
  const dot = domain.lastIndexOf('.');
  if (dot < 0 || dot === domain.length - 1) return true;
  const r = validateEmailAddress(address);
  if (r.valid) return false;
  if (r.suggestion && r.suggestion.length > r.normalized.length && r.suggestion.startsWith(r.normalized)) return true;
  if (r.reason === 'unknown_tld' && !r.suggestion) {
    const tld = domain.slice(dot + 1);
    for (const known of IANA_TLDS) if (known.length > tld.length && known.startsWith(tld)) return true;
  }
  return false;
}

export const EMAIL_TYPING_PAUSE_MS = 600;

// ---------------------------------------------------------------------------
// Auth policy: what the sign-up / log-in / reset field shows and whether it
// blocks. Shared copy; iOS `LoginInput` and Android `AuthInput` mirror it.
// ---------------------------------------------------------------------------

export type AuthEmailPurpose = 'sign_up' | 'log_in' | 'reset';

export const AUTH_EMAIL_COPY = {
  missing: 'Please enter your email address.',
  invalid: 'Please enter a valid email address, like name@example.com.',
  space: "Looks like there's a space in your email.",
  typo: "That email doesn't look right. Fix it, or tap Sign up again to use it as typed.",
  didYouMean: (suggestion: string) => `Did you mean ${suggestion}?`,
} as const;

export interface AuthEmailVerdict {
  /** What to submit, and what the field should show after a submit or blur. */
  email: string;
  /** Text under the field, or undefined. */
  message?: string;
  /** Offer as a "Did you mean …?" chip that replaces the field text. */
  suggestion?: string;
  /** Submit must stop. */
  blocking: boolean;
}

/**
 * Sign up warns about a likely typo of the person's own address (unknown TLD,
 * `gmial.com`) but lets a second submit of the same address through —
 * `acceptedAsTyped` is the address they were already warned about. Log in and
 * reset never second-guess a well-formed address: the account may really use it.
 */
export function authEmailVerdict(
  raw: string | null | undefined,
  purpose: AuthEmailPurpose,
  acceptedAsTyped?: string | null
): AuthEmailVerdict {
  const r = checkEmailInput(raw);
  const base = { email: r.email };
  switch (r.reason) {
    case undefined:
      return { ...base, blocking: false };
    case 'empty':
      return { ...base, message: AUTH_EMAIL_COPY.missing, blocking: true };
    case 'space':
      return { ...base, message: AUTH_EMAIL_COPY.space, suggestion: r.suggestion, blocking: true };
    case 'syntax':
      return { ...base, message: AUTH_EMAIL_COPY.invalid, blocking: true };
    case 'unknown_tld':
    case 'typo_likely':
      if (purpose !== 'sign_up' || (acceptedAsTyped && acceptedAsTyped === r.email)) return { ...base, blocking: false };
      return { ...base, message: AUTH_EMAIL_COPY.typo, suggestion: r.suggestion, blocking: true };
  }
}
