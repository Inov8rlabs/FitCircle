import { describe, expect, it } from 'vitest';

import { howItWorksFor } from '../campaign-utils';

describe('howItWorksFor', () => {
  it('Hold the Line: three short steps with the dates filled in (milestones live in the timeline)', () => {
    const steps = howItWorksFor({
      template: 'seasonal_circle',
      startsAt: '2026-11-15',
      endsAt: '2026-12-15',
      marks: [{ date: '2026-11-26', emoji: '🦃', label: 'Thanksgiving' }],
    });
    expect(steps.map((s) => s.title)).toEqual(['Fill 5 seats', 'Check in daily', 'Keep the streak']);
    expect(steps[0].body).toBe('Invite 4 friends before Nov 15.');
    expect(steps[1].body).toContain('Nov 15–Dec 15');
    for (const s of steps) {
      expect(s.title.length).toBeLessThanOrEqual(20);
      expect(s.body.length).toBeLessThanOrEqual(60);
    }
  });

  it('calendar and spotlight templates have their own short steps', () => {
    expect(howItWorksFor({ template: 'daily_calendar', startsAt: '2026-12-01', endsAt: '2026-12-24' }).map((s) => s.title)).toEqual([
      'A door a day',
      'Do the tiny task',
      'Cheer friends on',
    ]);
    expect(howItWorksFor({ template: 'spotlight', startsAt: '2027-01-01', endsAt: '2027-01-31', marks: [] })).toHaveLength(1);
  });
});
