import { describe, expect, it } from 'vitest';

import {
  CIRCLE_CODE_RE,
  REFERRAL_CODE_RE,
  circleInviteUrl,
  classifyCode,
  generateReferralCode,
  normalizeCode,
  personalInviteUrl,
  playStoreUrl,
} from '../links';

describe('normalizeCode', () => {
  it('trims, uppercases and strips whitespace', () => {
    expect(normalizeCode('  maya 7k2 ')).toBe('MAYA7K2');
    expect(normalizeCode(null)).toBe('');
    expect(normalizeCode(undefined)).toBe('');
  });
});

describe('classifyCode', () => {
  it('recognises circle codes with and without the dash', () => {
    expect(classifyCode('FITAB12CD')).toBe('circle');
    expect(classifyCode('fit-ab12cd')).toBe('circle');
  });

  it('recognises personal codes case-insensitively', () => {
    expect(classifyCode('maya7k2')).toBe('personal');
    expect(classifyCode('ABCD')).toBe('personal');
    expect(classifyCode('ABCDEFGHJKMN')).toBe('personal');
  });

  it('rejects codes out of bounds or with bad characters', () => {
    expect(classifyCode('ABC')).toBeNull();
    expect(classifyCode('ABCDEFGHJKMNP')).toBeNull();
    expect(classifyCode('MAYA_7K2')).toBeNull();
    expect(classifyCode('')).toBeNull();
    expect(classifyCode(null)).toBeNull();
  });

  it('never treats a FIT-prefixed code as personal', () => {
    expect(classifyCode('FITNESS1')).toBeNull();
    expect(REFERRAL_CODE_RE.test('FITX')).toBe(false);
    expect(CIRCLE_CODE_RE.test('FITAB12CD')).toBe(true);
  });
});

describe('invite URLs', () => {
  it('builds canonical www URLs', () => {
    expect(personalInviteUrl('MAYA7K2')).toBe('https://www.fitcircle.ai/i/MAYA7K2');
    expect(circleInviteUrl('FITAB12CD')).toBe('https://www.fitcircle.ai/join/FITAB12CD');
    expect(circleInviteUrl('FITAB12CD', 'MAYA7K2')).toBe('https://www.fitcircle.ai/join/FITAB12CD?ref=MAYA7K2');
  });
});

describe('playStoreUrl', () => {
  const base = 'https://play.google.com/store/apps/details?id=com.inov8rlabs.apps.fitcircle';

  it('returns the bare listing with no invite', () => {
    expect(playStoreUrl({})).toBe(base);
  });

  it('double-encodes the install referrer so Play hands back fc_ref/fc_circle intact', () => {
    const url = playStoreUrl({ ref: 'MAYA7K2', circle: 'FITAB12CD' });
    expect(url).toBe(`${base}&referrer=fc_ref%3DMAYA7K2%26fc_circle%3DFITAB12CD`);
    const referrer = new URL(url).searchParams.get('referrer');
    expect(referrer).toBe('fc_ref=MAYA7K2&fc_circle=FITAB12CD');
    const inner = new URLSearchParams(referrer!);
    expect(inner.get('fc_ref')).toBe('MAYA7K2');
    expect(inner.get('fc_circle')).toBe('FITAB12CD');
  });

  it('carries only the circle when there is no ref', () => {
    const referrer = new URL(playStoreUrl({ circle: 'FITAB12CD' })).searchParams.get('referrer');
    expect(referrer).toBe('fc_circle=FITAB12CD');
  });
});

describe('generateReferralCode', () => {
  const seq = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };

  it('uses the first-name stem plus 3 chars', () => {
    const code = generateReferralCode('Maya', seq([0, 0.5, 0.99]));
    expect(code.startsWith('MAYA')).toBe(true);
    expect(code).toHaveLength(7);
    expect(REFERRAL_CODE_RE.test(code)).toBe(true);
  });

  it('never starts with FIT', () => {
    for (const name of ['Fitz', 'FITNESS', 'fiterman', 'Fit']) {
      const code = generateReferralCode(name);
      expect(code.startsWith('FIT')).toBe(false);
      expect(classifyCode(code)).toBe('personal');
    }
  });

  it('falls back to PAL for empty/non-latin names and stays within 4–12 chars', () => {
    expect(generateReferralCode('').startsWith('PAL')).toBe(true);
    expect(generateReferralCode(null).startsWith('PAL')).toBe(true);
    expect(generateReferralCode('李').startsWith('PAL')).toBe(true);
    for (const name of ['A', 'Bo', 'Alexandria', 'José', "O'Neil", 'Maximilian-Josef']) {
      for (let i = 0; i < 20; i++) {
        const code = generateReferralCode(name);
        expect(code.length).toBeGreaterThanOrEqual(4);
        expect(code.length).toBeLessThanOrEqual(12);
        expect(REFERRAL_CODE_RE.test(code)).toBe(true);
      }
    }
  });

  it('strips accents to ASCII', () => {
    expect(generateReferralCode('José', seq([0])).startsWith('JOSE')).toBe(true);
  });
});
