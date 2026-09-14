import { describe, expect, it } from 'vitest';
import {
  deriveUsernameBase,
  ensureUniqueUsername,
  isValidUsername,
} from '../username-service';

describe('username rules', () => {
  it('accepts letters, digits, underscores and periods within 3–30', () => {
    for (const ok of ['ani', 'fitcircle.user', 'a_b.c', 'abajirao', 'x'.repeat(30)]) {
      expect(isValidUsername(ok), ok).toBe(true);
    }
  });
  it('rejects leading/trailing periods, plus signs, spaces and bad lengths', () => {
    for (const bad of ['.ani', 'ani.', 'a+b', 'a b', 'ab', 'x'.repeat(31), 'jöhn']) {
      expect(isValidUsername(bad), bad).toBe(false);
    }
  });
});

describe('deriveUsernameBase', () => {
  it('turns the email that broke production into a valid username', () => {
    expect(deriveUsernameBase('fitcircle.user@gmail.com')).toBe('fitcircle.user');
  });
  it('drops gmail +tags, lowercases, and sanitizes odd characters', () => {
    expect(deriveUsernameBase('Ani+promo@bajirao.me')).toBe('ani');
    expect(deriveUsernameBase('john-o\'brien@x.com')).toBe('john_o_brien');
    expect(deriveUsernameBase('..weird..@x.com')).toBe('weird');
  });
  it('pads very short local parts and caps very long ones', () => {
    expect(deriveUsernameBase('al@x.com')).toBe('al_user');
    expect(deriveUsernameBase('a'.repeat(40) + '@x.com')).toHaveLength(30);
  });
});

describe('ensureUniqueUsername', () => {
  it('returns the base when free, else appends the first free suffix', async () => {
    const taken = new Set(['ani', 'ani2']);
    const exists = async (c: string) => taken.has(c);
    expect(await ensureUniqueUsername('ani', exists)).toBe('ani3');
    expect(await ensureUniqueUsername('anki', exists)).toBe('anki');
  });
  it('keeps suffixed names within the max length', async () => {
    const base = 'x'.repeat(30);
    const exists = async (c: string) => c === base;
    const out = await ensureUniqueUsername(base, exists);
    expect(out).toHaveLength(30);
    expect(out.endsWith('2')).toBe(true);
  });
});
