import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_EMAIL_COPY, EMAIL_TYPING_PAUSE_MS } from '@/lib/validation/email-input';

import { EMAIL_INPUT_ATTRS, useAuthEmailField } from '../useAuthEmailField';

describe('EMAIL_INPUT_ATTRS', () => {
  it('turns off every keyboard "help" and asks for the email keyboard', () => {
    expect(EMAIL_INPUT_ATTRS).toEqual({
      type: 'email',
      inputMode: 'email',
      autoComplete: 'email',
      autoCapitalize: 'off',
      autoCorrect: 'off',
      spellCheck: false,
    });
  });
});

describe('useAuthEmailField', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (purpose: 'sign_up' | 'log_in' | 'reset' = 'sign_up') => {
    const setEmail = vi.fn();
    const hook = renderHook(() => useAuthEmailField(purpose, setEmail));
    return { setEmail, hook };
  };

  it('fixes the Gboard space on submit and writes it back into the field', () => {
    const { setEmail, hook } = setup();
    let out: string | null = null;
    act(() => { out = hook.result.current.resolveForSubmit('abajirao.apps@gmail com'); });
    expect(out).toBe('abajirao.apps@gmail.com');
    expect(setEmail).toHaveBeenCalledWith('abajirao.apps@gmail.com');
    expect(hook.result.current.hint).toBeNull();
  });

  it('blocks an ambiguous space and offers the corrected address', () => {
    const { setEmail, hook } = setup('log_in');
    let out: string | null = 'x';
    act(() => { out = hook.result.current.resolveForSubmit('john smith@gmail.com'); });
    expect(out).toBeNull();
    expect(hook.result.current.hint).toEqual({ message: AUTH_EMAIL_COPY.space, suggestion: 'johnsmith@gmail.com' });
    act(() => hook.result.current.applySuggestion());
    expect(setEmail).toHaveBeenLastCalledWith('johnsmith@gmail.com');
    expect(hook.result.current.hint).toBeNull();
  });

  it('sign up flags a typo once, then accepts it as typed', () => {
    const { hook } = setup('sign_up');
    let out: string | null = null;
    act(() => { out = hook.result.current.resolveForSubmit('sam@gmial.com'); });
    expect(out).toBeNull();
    expect(hook.result.current.hint?.suggestion).toBe('sam@gmail.com');
    act(() => { out = hook.result.current.resolveForSubmit('sam@gmial.com'); });
    expect(out).toBe('sam@gmial.com');
  });

  it('shows nothing while the domain is still being typed, and the space hint after a pause', () => {
    const { hook } = setup();
    act(() => hook.result.current.onChange('x@gmail c'));
    act(() => { vi.advanceTimersByTime(EMAIL_TYPING_PAUSE_MS + 50); });
    expect(hook.result.current.hint).toBeNull();

    act(() => hook.result.current.onChange('x@gmail com'));
    act(() => { vi.advanceTimersByTime(EMAIL_TYPING_PAUSE_MS - 100); });
    expect(hook.result.current.hint).toBeNull(); // debounced
    act(() => { vi.advanceTimersByTime(200); });
    expect(hook.result.current.hint).toEqual({ message: AUTH_EMAIL_COPY.space, suggestion: 'x@gmail.com' });
  });

  it('never shows a typo-style error while typing', () => {
    const { hook } = setup();
    act(() => hook.result.current.onChange('sam@gmial.com'));
    act(() => { vi.advanceTimersByTime(EMAIL_TYPING_PAUSE_MS + 50); });
    expect(hook.result.current.hint).toBeNull();
  });

  it('on blur: cleans silently, flags problems, ignores an empty field', () => {
    const { setEmail, hook } = setup('log_in');
    act(() => hook.result.current.onBlur('X@Gmail.Com '));
    expect(setEmail).toHaveBeenCalledWith('X@gmail.com');
    expect(hook.result.current.hint).toBeNull();
    act(() => hook.result.current.onBlur('   '));
    expect(hook.result.current.hint).toBeNull();
    act(() => hook.result.current.onBlur('ani@example'));
    expect(hook.result.current.hint?.message).toBe(AUTH_EMAIL_COPY.invalid);
  });
});
