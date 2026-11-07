import { describe, expect, it } from 'vitest';

import { isDisposableEmail } from '../disposable-email';
import { canonicalEmail, sameMailbox } from '../email-canonical';

describe('canonicalEmail', () => {
  it.each([
    ['Jane.Doe+fitcircle@Gmail.com', 'janedoe@gmail.com'],
    ['j.a.n.e.doe@googlemail.com', 'janedoe@gmail.com'],
    ['first.last+tag@example.com', 'first.last@example.com'],
    ['  USER@Example.COM ', 'user@example.com'],
  ])('%s → %s', (input, out) => expect(canonicalEmail(input)).toBe(out));

  it('rejects junk', () => {
    expect(canonicalEmail('')).toBeNull();
    expect(canonicalEmail('no-at-sign')).toBeNull();
    expect(canonicalEmail('+tag@gmail.com')).toBeNull();
  });

  it('sameMailbox', () => {
    expect(sameMailbox('ab.c@gmail.com', 'abc+ref@googlemail.com')).toBe(true);
    expect(sameMailbox('ab.c@example.com', 'abc@example.com')).toBe(false);
    expect(sameMailbox(null, null)).toBe(false);
  });
});

describe('isDisposableEmail', () => {
  it('matches listed domains and their subdomains, case-insensitively', () => {
    expect(isDisposableEmail('x@mailinator.com')).toBe(true);
    expect(isDisposableEmail('x@Sub.YOPMAIL.com')).toBe(true);
    expect(isDisposableEmail('x@gmail.com')).toBe(false);
    expect(isDisposableEmail('x@notmailinator.com')).toBe(false);
    expect(isDisposableEmail(null)).toBe(false);
  });
});
