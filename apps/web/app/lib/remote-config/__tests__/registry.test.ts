import { describe, expect, it } from 'vitest';

import { REVIEW_EMAILS } from '@/lib/ads/test-users';

import { CLIENT_VISIBLE_KEYS, codeDefault, keyDef, validValue } from '../registry';

describe('integrity_reviewer_emails', () => {
  it('defaults to the review demo account(s) and the Play pre-launch robot domain', () => {
    const d = codeDefault('integrity_reviewer_emails') as string[];
    expect(d).toEqual(['fitcircle.user@gmail.com', '@cloudtestlabaccounts.com']);
    for (const e of REVIEW_EMAILS) expect(d).toContain(e);
    expect(validValue('integrity_reviewer_emails', d)).toEqual(d);
  });

  it('accepts exact emails and @domain entries only', () => {
    expect(validValue('integrity_reviewer_emails', ['reviewer@apple.com', '@example.co.uk', 'A.B+c@Gmail.com'])).not.toBeNull();
    for (const bad of ['', 'gmail.com', '@', '@localhost', 'a b@gmail.com', 'x@@gmail.com', '*@gmail.com ']) {
      expect(validValue('integrity_reviewer_emails', [bad])).toBeNull();
    }
  });
});

describe('integrity_device_error_fail_open', () => {
  it('is a true/false switch, default true', () => {
    expect(codeDefault('integrity_device_error_fail_open')).toBe('true');
    expect(validValue('integrity_device_error_fail_open', 'false')).toBe('false');
    expect(validValue('integrity_device_error_fail_open', true)).toBeNull();
    expect(validValue('integrity_device_error_fail_open', 'off')).toBeNull();
  });
});

describe('paywall plan keys (docs/PAYWALL_DEFAULT_PLAN.md)', () => {
  it('paywall_default_plan: annual | monthly, default annual', () => {
    expect(codeDefault('paywall_default_plan')).toBe('annual');
    expect(validValue('paywall_default_plan', 'monthly')).toBe('monthly');
    expect(validValue('paywall_default_plan', 'annual')).toBe('annual');
    for (const bad of ['none', 'Annual', 'weekly', '', 1, null]) expect(validValue('paywall_default_plan', bad)).toBeNull();
  });

  it('paywall_badge_plan: annual | monthly | none, default annual', () => {
    expect(codeDefault('paywall_badge_plan')).toBe('annual');
    for (const ok of ['annual', 'monthly', 'none']) expect(validValue('paywall_badge_plan', ok)).toBe(ok);
    for (const bad of ['lifetime', true, ['annual']]) expect(validValue('paywall_badge_plan', bad)).toBeNull();
  });

  it('only the paywall keys are client visible', () => {
    expect([...CLIENT_VISIBLE_KEYS]).toEqual(['paywall_default_plan', 'paywall_badge_plan']);
    for (const k of CLIENT_VISIBLE_KEYS) expect(keyDef(k).type).toBe('enum');
  });
});
