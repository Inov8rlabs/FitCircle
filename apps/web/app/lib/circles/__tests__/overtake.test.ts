import { describe, expect, it } from 'vitest';

import { competitionRanks, detectOvertakes, overtakeCopy } from '../overtake';

const all = new Set(['a', 'b', 'c', 'd', 'bot']);

describe('overtake detection', () => {
  it('competition ranks', () => {
    const r = competitionRanks([
      { userId: 'a', value: 10 },
      { userId: 'b', value: 10 },
      { userId: 'c', value: 5 },
    ]);
    expect([r.get('a'), r.get('b'), r.get('c')]).toEqual([1, 1, 3]);
  });

  it('finds a genuine day-over-day pass', () => {
    const passes = detectOvertakes({
      previous: [
        { userId: 'a', value: 1000 },
        { userId: 'b', value: 800 },
        { userId: 'c', value: 100 },
      ],
      current: [
        { userId: 'a', value: 1500 },
        { userId: 'b', value: 1840 },
        { userId: 'c', value: 200 },
      ],
      real: all,
      recipients: all,
    });
    expect(passes).toEqual([{ recipientId: 'a', overtakerId: 'b', gap: 340, overtakerRank: 1, recipientRank: 2 }]);
  });

  it('ignores ties (either day), joiners, test overtakers and non-recipients', () => {
    const base = { real: new Set(['a', 'b', 'c']), recipients: new Set(['a', 'b', 'c']) };
    // Tied yesterday → not a pass.
    expect(detectOvertakes({ ...base, previous: [{ userId: 'a', value: 5 }, { userId: 'b', value: 5 }], current: [{ userId: 'a', value: 5 }, { userId: 'b', value: 9 }] })).toEqual([]);
    // Tied today → not a pass.
    expect(detectOvertakes({ ...base, previous: [{ userId: 'a', value: 5 }, { userId: 'b', value: 3 }], current: [{ userId: 'a', value: 7 }, { userId: 'b', value: 7 }] })).toEqual([]);
    // New member (not in yesterday's snapshot) is ahead → not a pass.
    expect(detectOvertakes({ ...base, previous: [{ userId: 'a', value: 5 }], current: [{ userId: 'a', value: 5 }, { userId: 'c', value: 50 }] })).toEqual([]);
    // Test-account overtaker.
    expect(
      detectOvertakes({ real: new Set(['a']), recipients: new Set(['a']), previous: [{ userId: 'a', value: 5 }, { userId: 'bot', value: 1 }], current: [{ userId: 'a', value: 5 }, { userId: 'bot', value: 9 }] })
    ).toEqual([]);
    // Recipient not eligible (e.g. dormant).
    expect(detectOvertakes({ real: all, recipients: new Set(['b']), previous: [{ userId: 'a', value: 5 }, { userId: 'b', value: 1 }], current: [{ userId: 'a', value: 5 }, { userId: 'b', value: 9 }] })).toEqual([]);
  });

  it('one pass per recipient: the overtaker now closest ahead', () => {
    const passes = detectOvertakes({
      previous: [
        { userId: 'a', value: 100 },
        { userId: 'b', value: 50 },
        { userId: 'c', value: 60 },
      ],
      current: [
        { userId: 'a', value: 100 },
        { userId: 'b', value: 300 },
        { userId: 'c', value: 120 },
      ],
      real: all,
      recipients: new Set(['a']),
    });
    expect(passes).toEqual([{ recipientId: 'a', overtakerId: 'c', gap: 20, overtakerRank: 2, recipientRank: 3 }]);
  });
});

describe('overtake copy', () => {
  it('steps: real gap + a walk estimate', () => {
    expect(overtakeCopy({ metric: 'total_steps', overtakerName: 'Priya', circleName: 'Morning Movers', gap: 340, overtakerRank: 2 })).toEqual({
      title: 'Priya just moved past you in Morning Movers',
      body: "You're 340 steps behind #2. About 4 minutes of walking gets it back.",
      variant: 'steps_walk',
    });
    expect(overtakeCopy({ metric: 'total_steps', overtakerName: 'Priya', circleName: 'M', gap: 12_400, overtakerRank: 1 })!.body).toBe("You're 12,400 steps behind #1. A walk today closes the gap.");
  });

  it('goal progress: points + the action for their goal', () => {
    expect(overtakeCopy({ metric: 'goal_progress', overtakerName: 'Sam', circleName: 'Crew', gap: 3.4, overtakerRank: 1, goalType: 'weight_loss' })!.body).toBe(
      "You're 3 points behind #1 on goal progress. Log today's weigh-in to update your spot."
    );
    expect(overtakeCopy({ metric: 'goal_progress', overtakerName: 'Sam', circleName: 'Crew', gap: 0.4, overtakerRank: 1, goalType: 'custom' })!.body).toBe("It's close. Check in today to update your progress.");
  });

  it('no copy without a name or a real gap', () => {
    expect(overtakeCopy({ metric: 'total_steps', overtakerName: ' ', circleName: 'C', gap: 10, overtakerRank: 1 })).toBeNull();
    expect(overtakeCopy({ metric: 'total_steps', overtakerName: 'A', circleName: 'C', gap: 0, overtakerRank: 1 })).toBeNull();
  });
});
