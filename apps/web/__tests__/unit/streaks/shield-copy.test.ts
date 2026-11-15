import { describe, expect, it } from 'vitest';

import { outOfShieldsLine, shieldEarnLine, shieldStarterLine } from '@/lib/streaks/shield-copy';

describe('shield copy is driven by shield_rules', () => {
  const rules = { earn_interval_days: 7, starter_count: 2, max_balance: 3 };

  it('earn line', () => {
    expect(shieldEarnLine(rules)).toBe('Earn a shield every 7 days of streak · bank up to 3');
    expect(shieldEarnLine({ ...rules, earn_interval_days: 10, max_balance: 5 })).toBe('Earn a shield every 10 days of streak · bank up to 5');
  });

  it('starter line', () => {
    expect(shieldStarterLine(rules)).toBe('You start with 2 streak shields');
    expect(shieldStarterLine({ starter_count: 1 })).toBe('You start with 1 streak shield');
    expect(shieldStarterLine({ starter_count: 0 })).toBeNull();
  });

  it('out-of-shields line never mentions a monthly bonus and has a rule-free fallback', () => {
    expect(outOfShieldsLine(rules)).toContain('Earn one every 7 days of streak (bank up to 3)');
    expect(outOfShieldsLine(rules)).not.toMatch(/month/i);
    expect(outOfShieldsLine(null)).not.toMatch(/\d/);
  });
});
