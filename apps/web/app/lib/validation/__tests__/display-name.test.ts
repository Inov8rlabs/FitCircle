import { describe, expect, it } from 'vitest';

import {
  DISPLAY_NAME_MAX_LENGTH,
  cleanDisplayName,
  coerceDisplayName,
  displayNameLength,
  validateDisplayName,
} from '../display-name';

describe('cleanDisplayName', () => {
  it('trims and collapses whitespace, including tabs, newlines and NBSP', () => {
    expect(cleanDisplayName('  Ani \t\n  Rao\u00A0 ')).toBe('Ani Rao');
  });

  it('removes control and invisible format characters but keeps ZWJ emoji', () => {
    expect(cleanDisplayName('A\u0000n\u0007i')).toBe('Ani');
    expect(cleanDisplayName('\u200BAni\u200E\u202E\uFEFF')).toBe('Ani');
    expect(cleanDisplayName('Ani 👨\u200D👩\u200D👧')).toBe('Ani 👨\u200D👩\u200D👧');
  });

  it('removes blank-looking letters', () => {
    expect(cleanDisplayName('\u3164\u3164')).toBe('');
    expect(cleanDisplayName('\u2800Ani')).toBe('Ani');
  });

  it('composes to NFC', () => {
    expect(cleanDisplayName('Jose\u0301')).toBe('José');
  });

  it('handles non-strings', () => {
    expect(cleanDisplayName(undefined)).toBe('');
    expect(cleanDisplayName(null)).toBe('');
  });
});

describe('validateDisplayName', () => {
  it('accepts any script, accents, apostrophes, hyphens and emoji', () => {
    for (const name of ['José', '李雷', "Siobhán O'Neil", 'Anne-Marie', 'Ani 🏃', 'अनिर\u0941द\u094Dध', 'Ж']) {
      expect(validateDisplayName(name)).toEqual({ ok: true, value: name });
    }
  });

  it('returns the normalized value', () => {
    expect(validateDisplayName('  Ani   Rao ')).toEqual({ ok: true, value: 'Ani Rao' });
  });

  it('rejects empty, whitespace-only and zero-width-only names', () => {
    for (const name of ['', '   ', '\u200B\u200B', '\u200D', '\u3164', '\u0301', '...']) {
      expect(validateDisplayName(name)).toMatchObject({ ok: false, error: 'empty', message: 'Enter a name' });
    }
  });

  it('allows exactly 40 characters and rejects 41', () => {
    expect(validateDisplayName('a'.repeat(DISPLAY_NAME_MAX_LENGTH)).ok).toBe(true);
    expect(validateDisplayName('a'.repeat(DISPLAY_NAME_MAX_LENGTH + 1))).toMatchObject({
      ok: false,
      error: 'too_long',
      message: 'Names can be up to 40 characters',
    });
  });

  it('counts user-perceived characters (an emoji family is one)', () => {
    const family = '👨\u200D👩\u200D👧';
    expect(displayNameLength(family)).toBe(1);
    expect(validateDisplayName(family.repeat(40)).ok).toBe(true);
    expect(validateDisplayName(family.repeat(41)).ok).toBe(false);
  });

  it('measures length after normalization (whitespace runs count once)', () => {
    expect(validateDisplayName(`${'a'.repeat(20)}          ${'b'.repeat(19)}`).ok).toBe(true);
  });

  it('rejects angle brackets', () => {
    expect(validateDisplayName('<b>Ani</b>')).toMatchObject({ ok: false, error: 'invalid_characters' });
  });
});

describe('coerceDisplayName (account creation never rejects)', () => {
  it('normalizes, strips angle brackets and cuts to the limit', () => {
    expect(coerceDisplayName('  <Ani>  Rao ', 'ani')).toBe('Ani Rao');
    expect(coerceDisplayName('x'.repeat(60), 'ani')).toBe('x'.repeat(40));
  });

  it('falls back when nothing usable is left', () => {
    expect(coerceDisplayName('\u200B ', 'ani_r')).toBe('ani_r');
    expect(coerceDisplayName(undefined, 'ani_r')).toBe('ani_r');
  });

  it('keeps non-Latin names (the old sanitizer erased them)', () => {
    expect(coerceDisplayName('李雷', 'u')).toBe('李雷');
  });
});
