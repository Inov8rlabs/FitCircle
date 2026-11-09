import { describe, expect, it } from 'vitest';

import { REVIEW_EMAILS } from '@/lib/ads/test-users';

import { codeDefault, validValue } from '../registry';

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
