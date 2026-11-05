'use client';

/**
 * The email field on sign up, log in and password reset: input attributes that
 * keep keyboards from "helping" (no autocorrect, no capitalisation, the email
 * keyboard), plus the forgiving clean-up from lib/validation/email-input.ts.
 *
 *  - submit: `resolveForSubmit(raw)` cleans the address (`gmail com` →
 *    `gmail.com`, trims, lower-cases the domain), writes it back into the
 *    field and returns it — or returns null and shows why;
 *  - blur: shows a problem (never "missing"), or applies a safe clean-up;
 *  - typing: after a pause, only a "space in your email" hint, never a
 *    half-typed-domain error.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AUTH_EMAIL_COPY,
  EMAIL_TYPING_PAUSE_MS,
  authEmailVerdict,
  checkEmailInput,
  checkEmailInputWhileTyping,
  type AuthEmailPurpose,
} from '@/lib/validation/email-input';

/** Spread onto every email `<input>` (iOS/Android set the same options natively). */
export const EMAIL_INPUT_ATTRS = {
  type: 'email',
  inputMode: 'email',
  autoComplete: 'email',
  autoCapitalize: 'off',
  autoCorrect: 'off',
  spellCheck: false,
} as const;

export interface AuthEmailHint {
  message?: string;
  suggestion?: string;
}

export function useAuthEmailField(purpose: AuthEmailPurpose, setEmail: (value: string) => void) {
  const [hint, setHint] = useState<AuthEmailHint | null>(null);
  const accepted = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancelTimer, []);

  const resolveForSubmit = useCallback(
    (raw: string): string | null => {
      cancelTimer();
      const verdict = authEmailVerdict(raw, purpose, accepted.current);
      if (verdict.email !== raw) setEmail(verdict.email);
      if (verdict.blocking) {
        const r = checkEmailInput(raw);
        if (r.reason === 'unknown_tld' || r.reason === 'typo_likely') accepted.current = verdict.email;
        setHint({ message: verdict.message, suggestion: verdict.suggestion });
        return null;
      }
      setHint(null);
      return verdict.email;
    },
    [purpose, setEmail]
  );

  const onChange = useCallback((raw: string) => {
    setHint(null);
    cancelTimer();
    if (!raw.includes('@')) return;
    timer.current = setTimeout(() => {
      const r = checkEmailInputWhileTyping(raw);
      if (r) setHint({ message: AUTH_EMAIL_COPY.space, suggestion: r.suggestion });
    }, EMAIL_TYPING_PAUSE_MS);
  }, []);

  const onBlur = useCallback(
    (raw: string) => {
      cancelTimer();
      if (!raw.trim()) return;
      const verdict = authEmailVerdict(raw, purpose, accepted.current);
      if (verdict.blocking) {
        setHint({ message: verdict.message, suggestion: verdict.suggestion });
      } else if (verdict.email !== raw) {
        setEmail(verdict.email);
      }
    },
    [purpose, setEmail]
  );

  const applySuggestion = useCallback(() => {
    if (!hint?.suggestion) return;
    setEmail(hint.suggestion);
    setHint(null);
  }, [hint, setEmail]);

  return { hint, resolveForSubmit, onChange, onBlur, applySuggestion };
}

/** "Did you mean …?" under the email field; one tap puts the address in the field. */
export function EmailSuggestionChip({ suggestion, onApply }: { suggestion?: string; onApply: () => void }) {
  if (!suggestion) return null;
  return (
    <button
      type="button"
      onClick={onApply}
      data-testid="email-suggestion"
      className="mt-1.5 inline-flex items-center rounded-full border border-brand-purple/40 bg-brand-purple/10 px-3 py-1 text-sm text-white hover:bg-brand-purple/20"
    >
      {AUTH_EMAIL_COPY.didYouMean(suggestion)}
    </button>
  );
}
