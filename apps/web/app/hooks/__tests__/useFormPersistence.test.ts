import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { stripSecretFields, useFormPersistence } from '../useFormPersistence';

const KEY = 'fitcircle_signup_form';

describe('stripSecretFields', () => {
  it('drops password-like fields and keeps the rest', () => {
    expect(
      stripSecretFields({
        name: 'Anki',
        email: 'a@b.co',
        password: 'hunter22',
        confirmPassword: 'hunter22',
        passcode: '1234',
        apiToken: 't',
        termsAccepted: true,
      })
    ).toEqual({ name: 'Anki', email: 'a@b.co', termsAccepted: true });
  });
});

describe('useFormPersistence', () => {
  beforeEach(() => sessionStorage.clear());

  it('never writes a password to sessionStorage', () => {
    renderHook(() => useFormPersistence(KEY, { email: 'a@b.co', password: 'hunter22' }));
    const raw = sessionStorage.getItem(KEY)!;
    expect(raw).not.toContain('hunter22');
    expect(JSON.parse(raw)).toEqual({ email: 'a@b.co' });
  });

  it('scrubs a password saved by an older build and does not restore it', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ email: 'a@b.co', password: 'hunter22' }));
    const { result } = renderHook(() => useFormPersistence(KEY, { email: '' }, { enabled: true }));
    // The auto-save effect has already overwritten the key; read via loadForm too.
    sessionStorage.setItem(KEY, JSON.stringify({ email: 'a@b.co', password: 'hunter22' }));
    expect(result.current.loadForm()).toEqual({ email: 'a@b.co' });
    expect(sessionStorage.getItem(KEY)).not.toContain('hunter22');
  });
});
