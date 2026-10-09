import { describe, expect, it } from 'vitest';

import plan from '../../../../../../analytics/tracking-plan.json';
import { readAnalyticsConsent } from '../consent';
import { BLOCKED_PROPERTY_KEYS, sanitizeProperties } from '../privacy';

interface PlanProperty {
  name: string;
}
interface PlanEvent {
  name: string;
  platforms: string[];
  properties?: PlanProperty[];
}

describe('privacy blocklist vs tracking plan', () => {
  it('never blocks a property the plan defines', () => {
    const names = new Set<string>();
    for (const event of plan.events as PlanEvent[]) {
      for (const prop of event.properties ?? []) names.add(prop.name);
    }
    for (const prop of plan.globalProperties as PlanProperty[]) names.add(prop.name);
    for (const prop of plan.userProperties as PlanProperty[]) names.add(prop.name);

    const blocked = [...names].filter((n) => BLOCKED_PROPERTY_KEYS.has(n));
    expect(blocked).toEqual([]);
  });

  it('drops health values, identity and long free text', () => {
    expect(
      sanitizeProperties({
        calories: 500,
        protein_g: 30,
        username: 'ani',
        display_name: 'Ani',
        query: 'chicken',
        long: 'x'.repeat(201),
        nested: { a: 1 },
        nan: Number.NaN,
        ok: 'fine',
        count: 3,
        flag: true,
      })
    ).toEqual({ ok: 'fine', count: 3, flag: true });
  });
});

describe('readAnalyticsConsent', () => {
  const cookie = (v: unknown) => `other=1; fc_consent=${encodeURIComponent(JSON.stringify(v))}`;

  it('is true only when analytics === true', () => {
    expect(readAnalyticsConsent(cookie({ essential: true, analytics: true }))).toBe(true);
    expect(readAnalyticsConsent(cookie({ essential: true, analytics: false }))).toBe(false);
    expect(readAnalyticsConsent(cookie({ analytics: 'true' }))).toBe(false);
    expect(readAnalyticsConsent('fc_consent=%7Bbroken')).toBe(false);
    expect(readAnalyticsConsent('')).toBe(false);
  });
});
