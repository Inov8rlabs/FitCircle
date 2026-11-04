import { describe, expect, it } from 'vitest';

import fixture from '../__fixtures__/email-cases.json';
import { IANA_TLDS } from '../email-tlds.generated';
import { editDistance, isValidEmailAddress, validateEmailAddress } from '../email-address';

interface Case {
  input: string;
  valid: boolean;
  normalized: string;
  reason?: string;
  suggestion?: string;
}

describe('validateEmailAddress — shared fixture (mirrored in iOS + Android tests)', () => {
  it.each((fixture.cases as Case[]).map((c) => [JSON.stringify(c.input), c] as const))('%s', (_label, c) => {
    const result = validateEmailAddress(c.input);
    expect(result.valid).toBe(c.valid);
    expect(result.normalized).toBe(c.normalized);
    expect(result.reason).toBe(c.reason);
    expect(result.suggestion).toBe(c.suggestion);
  });

  it('has a healthy number of vectors', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(60);
  });
});

describe('validateEmailAddress — properties', () => {
  it('never suggests for a valid address', () => {
    for (const c of fixture.cases as Case[]) {
      const r = validateEmailAddress(c.input);
      if (r.valid) expect(r.suggestion).toBeUndefined();
    }
  });

  it('every suggestion is itself valid (one tap fixes it)', () => {
    for (const c of fixture.cases as Case[]) {
      const r = validateEmailAddress(c.input);
      if (r.suggestion) expect(validateEmailAddress(r.suggestion).valid).toBe(true);
    }
  });

  it('handles null/undefined as empty', () => {
    expect(validateEmailAddress(null)).toEqual({ valid: false, normalized: '', reason: 'empty' });
    expect(validateEmailAddress(undefined).reason).toBe('empty');
    expect(isValidEmailAddress('sam@gmail.com')).toBe(true);
    expect(isValidEmailAddress('sam@yahoo.comr')).toBe(false);
  });

  it('rejects an over-long address', () => {
    const domain = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(50)}.com`;
    expect(validateEmailAddress(`${'x'.repeat(10)}@${domain}`).reason).toBe('syntax');
  });

  it('bundles the IANA TLD list', () => {
    expect(IANA_TLDS.size).toBeGreaterThan(1000);
    for (const tld of ['com', 'net', 'org', 'io', 'uk', 'me', 'co', 'app']) expect(IANA_TLDS.has(tld)).toBe(true);
    for (const typo of ['comr', 'con', 'cmo', 'ocm', 'coom', 'c']) expect(IANA_TLDS.has(typo)).toBe(false);
  });
});

describe('editDistance', () => {
  it('counts adjacent transpositions as one edit', () => {
    expect(editDistance('gmail', 'gmial')).toBe(1);
    expect(editDistance('gmail', 'gamil')).toBe(1);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('hotmail', 'hotmail')).toBe(0);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});
