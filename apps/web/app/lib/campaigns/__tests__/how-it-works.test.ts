import { describe, expect, it } from 'vitest';

import { howItWorksFor } from '../campaign-utils';

describe('howItWorksFor', () => {
  it('Hold the Line: crew → daily check-in → streak → in-range milestones, with dates filled in', () => {
    const steps = howItWorksFor({
      template: 'seasonal_circle',
      startsAt: '2026-11-15',
      endsAt: '2026-12-15',
      marks: [
        { date: '2026-11-26', emoji: '🦃', label: 'Thanksgiving' },
        { date: '2026-12-15', emoji: '🏁', label: 'Finish' },
      ],
    });
    expect(steps.map((s) => s.title)).toEqual(['Start your crew', 'Check in every day', 'Keep the streak together', 'Hit the milestones together']);
    expect(steps[0].body).toContain('before Nov 15');
    expect(steps[1].body).toContain('Nov 15–Dec 15');
    expect(steps[3].body).toBe('🦃 Thanksgiving (Nov 26)'); // the end-date "Finish" mark isn't a milestone
    for (const s of steps) {
      expect(s.emoji).toBeTruthy();
      expect(s.body.length).toBeLessThanOrEqual(160);
    }
  });

  it('calendar and spotlight templates have their own steps; no marks → no milestone step', () => {
    expect(howItWorksFor({ template: 'daily_calendar', startsAt: '2026-12-01', endsAt: '2026-12-24' }).map((s) => s.title)).toEqual([
      'Open a door a day',
      'Do the tiny task',
      'See your friends',
    ]);
    expect(howItWorksFor({ template: 'spotlight', startsAt: '2027-01-01', endsAt: '2027-01-31', marks: [] })).toHaveLength(1);
  });
});
