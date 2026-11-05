import { describe, expect, it } from 'vitest';

import fixture from '../__fixtures__/email-cases.json';
import { validateEmailAddress } from '../email-address';
import {
  AUTH_EMAIL_COPY,
  authEmailVerdict,
  checkEmailInput,
  checkEmailInputWhileTyping,
} from '../email-input';

interface InputCase {
  input: string;
  email: string;
  valid: boolean;
  reason?: string;
  suggestion?: string;
  fixedSpace: boolean;
}

interface TypingCase {
  input: string;
  reason?: string;
  suggestion?: string;
}

const inputCases = fixture.input_cases as InputCase[];
const typingCases = fixture.typing_cases as TypingCase[];

describe('checkEmailInput — shared fixture (mirrored in iOS + Android tests)', () => {
  it.each(inputCases.map((c) => [JSON.stringify(c.input), c] as const))('%s', (_label, c) => {
    const r = checkEmailInput(c.input);
    expect(r.email).toBe(c.email);
    expect(r.valid).toBe(c.valid);
    expect(r.reason).toBe(c.reason);
    expect(r.suggestion).toBe(c.suggestion);
    expect(r.fixedSpace).toBe(c.fixedSpace);
  });

  it('covers the spaces and autocorrect artefacts', () => {
    const inputs = inputCases.map((c) => c.input);
    for (const needed of ['x@gmail com', 'x @gmail.com', 'x@gmail .com', 'X@Gmail.Com', 'x@gmail.com ', 'x@gmail.com\n']) {
      expect(inputs).toContain(needed);
    }
  });

  it('a valid result is always a valid address with no whitespace', () => {
    for (const c of inputCases) {
      const r = checkEmailInput(c.input);
      if (!r.valid) continue;
      expect(validateEmailAddress(r.email).valid).toBe(true);
      expect(r.email).not.toMatch(/\s/);
      expect(r.suggestion).toBeUndefined();
    }
  });

  it('every suggestion is itself valid (one tap fixes it)', () => {
    for (const c of inputCases) {
      const s = checkEmailInput(c.input).suggestion;
      if (s) expect(checkEmailInput(s).valid).toBe(true);
    }
  });

  it('agrees with the invite validator when there is nothing to clean', () => {
    for (const c of fixture.cases) {
      if (/\s/.test(c.input.trim())) continue;
      const r = checkEmailInput(c.input);
      expect(r.valid).toBe(c.valid);
      expect(r.email).toBe(c.normalized);
    }
  });

  it('handles null/undefined as empty', () => {
    expect(checkEmailInput(null)).toEqual({ email: '', valid: false, reason: 'empty', fixedSpace: false });
    expect(checkEmailInput(undefined).reason).toBe('empty');
  });
});

describe('checkEmailInputWhileTyping — shared fixture', () => {
  it.each(typingCases.map((c) => [JSON.stringify(c.input), c] as const))('%s', (_label, c) => {
    const r = checkEmailInputWhileTyping(c.input);
    expect(r?.reason).toBe(c.reason);
    expect(r?.suggestion).toBe(c.suggestion);
  });
});

describe('authEmailVerdict', () => {
  it('fixes the Gboard space silently on every form', () => {
    for (const purpose of ['sign_up', 'log_in', 'reset'] as const) {
      expect(authEmailVerdict('abajirao.apps@gmail com', purpose)).toEqual({
        email: 'abajirao.apps@gmail.com',
        blocking: false,
      });
    }
  });

  it('blocks an ambiguous space with the corrected address on offer', () => {
    expect(authEmailVerdict('john smith@gmail.com', 'log_in')).toEqual({
      email: 'john smith@gmail.com',
      message: AUTH_EMAIL_COPY.space,
      suggestion: 'johnsmith@gmail.com',
      blocking: true,
    });
  });

  it('empty and malformed always block', () => {
    expect(authEmailVerdict('  ', 'sign_up')).toMatchObject({ message: AUTH_EMAIL_COPY.missing, blocking: true });
    expect(authEmailVerdict('ani@example', 'log_in')).toMatchObject({ message: AUTH_EMAIL_COPY.invalid, blocking: true });
  });

  it('sign up warns about a typo once, then accepts it as typed', () => {
    const first = authEmailVerdict('sam@gmial.com', 'sign_up');
    expect(first).toMatchObject({ message: AUTH_EMAIL_COPY.typo, suggestion: 'sam@gmail.com', blocking: true });
    expect(authEmailVerdict('sam@gmial.com', 'sign_up', first.email)).toEqual({ email: 'sam@gmial.com', blocking: false });
    // A different address is warned about again.
    expect(authEmailVerdict('sam@gmail.con', 'sign_up', first.email).blocking).toBe(true);
  });

  it('log in and reset never second-guess a well-formed address', () => {
    for (const purpose of ['log_in', 'reset'] as const) {
      expect(authEmailVerdict('sam@gmail.co', purpose)).toEqual({ email: 'sam@gmail.co', blocking: false });
    }
  });

  it('lower-cases the domain only', () => {
    expect(authEmailVerdict('X@Gmail.Com', 'log_in').email).toBe('X@gmail.com');
  });
});
