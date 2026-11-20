/** Pure D+1 rules (docs/ENGAGEMENT_115_SPEC.md §5.1–5.2) + milestone celebration helpers (§5.4). */
import { describe, expect, it } from 'vitest';

import {
  clientShowsStreakCelebration,
  milestoneDedupeKey,
  milestonePushCopy,
  pendingCelebrationFrom,
  requestShowsStreakCelebration,
} from '../../streaks/celebration';
import {
  activityFacts,
  chooseDmt,
  dmtCopy,
  dmtDedupeKey,
  dontMissTwiceEnabled,
  episodeSkip,
  firstMissedDay,
  hourLabel,
  modal,
  saveOfferExpiresAt,
  sendHour,
  trailingAutoShields,
  type DayClaim,
  type DmtChoiceInput,
} from '../dont-miss-twice';

const claimsOf = (days: Array<string | [string, 'auto']>): Map<string, DayClaim> =>
  new Map(
    days.map((d): [string, DayClaim] =>
      Array.isArray(d) ? [d[0], { date: d[0], method: 'freeze', auto: true }] : [d, { date: d, method: 'manual_entry', auto: false }]
    )
  );

const TODAY = '2026-11-13';

describe('first missed day', () => {
  it('D = yesterday unclaimed, D−1 claimed → D', () => {
    expect(firstMissedDay(claimsOf(['2026-11-10', '2026-11-11']), TODAY)).toEqual({ missedDate: '2026-11-12' });
  });
  it('an automatic nightly shield on D still counts as missed (shield_saved)', () => {
    expect(firstMissedDay(claimsOf(['2026-11-11', ['2026-11-12', 'auto']]), TODAY)).toEqual({ missedDate: '2026-11-12' });
  });
  it('the user claimed D → skip; today already claimed → skip; D−1 unclaimed → not a first miss', () => {
    expect(firstMissedDay(claimsOf(['2026-11-11', '2026-11-12']), TODAY)).toEqual({ skip: 'claimed_yesterday' });
    expect(firstMissedDay(claimsOf(['2026-11-11', TODAY]), TODAY)).toEqual({ skip: 'claimed_today' });
    expect(firstMissedDay(claimsOf(['2026-11-09']), TODAY)).toEqual({ skip: 'not_first_miss' });
  });
});

describe('one per lapse episode', () => {
  it('same D again → already_sent; no user claim since the previous D → same_episode; a claim since → new episode', () => {
    const c = claimsOf(['2026-11-08', '2026-11-11']);
    expect(episodeSkip('2026-11-12', ['2026-11-12'], c)).toBe('already_sent');
    expect(episodeSkip('2026-11-12', ['2026-11-10'], claimsOf(['2026-11-09', ['2026-11-11', 'auto']]))).toBe('same_episode');
    expect(episodeSkip('2026-11-12', ['2026-11-09'], c)).toBeNull();
    expect(episodeSkip('2026-11-12', [], c)).toBeNull();
  });
  it('trailing automatic shields', () => {
    expect(trailingAutoShields(claimsOf(['2026-11-10', ['2026-11-11', 'auto'], ['2026-11-12', 'auto']]), '2026-11-12')).toBe(2);
    expect(trailingAutoShields(claimsOf(['2026-11-12']), '2026-11-12')).toBe(0);
  });
});

describe('send hour', () => {
  it('modal first-log hour, clamped to 8–20, fallback 12', () => {
    expect(sendHour([9, 9, 13], null)).toBe(9);
    expect(sendHour([6, 6, 7], null)).toBe(8);
    expect(sendHour([22, 22], null)).toBe(20);
    expect(sendHour([], null)).toBe(12);
    expect(modal([13, 9, 9, 13])).toBe(9); // tie → the earlier hour
  });
  it('inside quiet hours → the first whole hour after they end', () => {
    expect(sendHour([8], { start: '22:00', end: '09:00' })).toBe(9);
    expect(sendHour([8], { start: '22:00', end: '08:30' })).toBe(9);
    expect(sendHour([13], { start: '12:00', end: '14:00' })).toBe(14);
    expect(sendHour([8], { start: '22:00', end: '08:00' })).toBe(8); // ends exactly at 8
  });
  it('hour labels', () => {
    expect([0, 8, 12, 13, 20].map(hourLabel)).toEqual(['12 am', '8 am', '12 pm', '1 pm', '8 pm']);
  });
});

describe('variant picker + copy (user data only, no emoji)', () => {
  const activity = activityFacts(
    [
      { day: '2026-11-05', hour: 8, mealType: 'breakfast' },
      { day: '2026-11-05', hour: 13, mealType: 'lunch' },
      { day: '2026-11-06', hour: 8, mealType: 'breakfast' },
      { day: '2026-11-08', hour: 9, mealType: 'breakfast' },
    ],
    ['2026-11-07']
  );
  const base: DmtChoiceInput & { pro: boolean } = {
    shieldSavedD: false, currentStreak: 0, shieldsLeft: null, lastAutoProtect: false,
    outcome: { broken: false, zombieGuard: false, lostStreak: 0 }, saveOfferOn: true, saveOfferMinStreak: 3, activity, pro: false,
  };
  const pick = (over: Partial<typeof base>) => {
    const i = { ...base, ...over };
    const choice = chooseDmt(i);
    return { choice, copy: dmtCopy(choice, i) };
  };

  it('activity facts: top slot, modal first-log hour, distinct days', () => {
    expect(activity).toEqual({ foodDays: 3, workoutDays: 1, topSlot: 'breakfast', usualHour: 8 });
  });

  it('save offer: a free user, broken (not zombie), lost >= min', () => {
    const r = pick({ outcome: { broken: true, zombieGuard: false, lostStreak: 12 } });
    expect(r.choice).toEqual({ type: 'streak_save_offer', variant: 'save_offer' });
    expect(r.copy).toEqual({
      title: 'Save your 12-day streak',
      body: 'You missed yesterday. A streak shield can still keep all 12 days. Today only.',
      screen: 'streaks', route: 'streak_save', mealType: null,
    });
    expect(pick({ outcome: { broken: true, zombieGuard: false, lostStreak: 12 }, pro: true }).copy.body).toBe('You missed yesterday. Use a shield and keep all 12 days. Today only.');
  });

  it('save offer switched off → falls through to the activity variants', () => {
    expect(pick({ outcome: { broken: true, zombieGuard: false, lostStreak: 12 }, saveOfferOn: false }).choice.variant).toBe('meal');
  });

  it('streak_restart: zombie guard, or below the save minimum', () => {
    expect(pick({ outcome: { broken: true, zombieGuard: true, lostStreak: 12 } }).choice.variant).toBe('streak_restart');
    const r = pick({ outcome: { broken: true, zombieGuard: false, lostStreak: 2 } });
    expect(r.copy).toMatchObject({ title: 'Yesterday slipped by', body: 'Log one meal today and day 1 of your next streak is yours.', screen: 'food_log', route: 'log_meal_camera' });
  });

  it('shield_saved: n days, shields left (free), last automatic save, Pro without a count', () => {
    expect(pick({ shieldSavedD: true, currentStreak: 9, shieldsLeft: 1 }).copy).toMatchObject({
      title: 'A shield saved your 9-day streak', body: 'Log breakfast today to keep it going. 1 shield left.', mealType: 'breakfast',
    });
    expect(pick({ shieldSavedD: true, currentStreak: 9, shieldsLeft: 2, lastAutoProtect: true }).copy.body).toBe(
      'Log breakfast today to keep it going. That was your last automatic save, so today counts.'
    );
    expect(pick({ shieldSavedD: true, currentStreak: 9, pro: true }).copy.body).toBe('Log breakfast today to keep it going.');
  });

  it('meal / workout / plain', () => {
    expect(pick({}).copy).toEqual({
      title: "Don't miss two days", body: "You usually log breakfast around 8 am. Snap today's and you're back on track.",
      screen: 'food_log', route: 'log_meal_camera', mealType: 'breakfast',
    });
    const w = pick({ activity: { foodDays: 1, workoutDays: 4, topSlot: null, usualHour: null } });
    expect(w.choice.variant).toBe('workout');
    expect(w.copy).toMatchObject({ screen: 'exercise_log', route: null, body: "One workout or one meal today and you're back on track." });
    expect(pick({ activity: { foodDays: 1, workoutDays: 0, topSlot: 'lunch', usualHour: 12 } }).choice.variant).toBe('plain');
  });

  it('never an emoji in any copy', () => {
    const all = [
      pick({}), pick({ shieldSavedD: true, currentStreak: 3, shieldsLeft: 0 }), pick({ outcome: { broken: true, zombieGuard: true, lostStreak: 4 } }),
      pick({ outcome: { broken: true, zombieGuard: false, lostStreak: 5 } }), pick({ activity: { foodDays: 0, workoutDays: 0, topSlot: null, usualHour: null } }),
    ];
    for (const { copy } of all) expect(`${copy.title} ${copy.body}`).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('switch, keys, expiry', () => {
  it('DONT_MISS_TWICE_PUSH_ENABLED is OFF unless explicitly enabled', () => {
    expect(dontMissTwiceEnabled({})).toBe(false);
    expect(dontMissTwiceEnabled({ DONT_MISS_TWICE_PUSH_ENABLED: 'false' })).toBe(false);
    expect(dontMissTwiceEnabled({ DONT_MISS_TWICE_PUSH_ENABLED: 'true' })).toBe(true);
    expect(dontMissTwiceEnabled({ DONT_MISS_TWICE_PUSH_ENABLED: '1' })).toBe(true);
  });
  it('dedupe keys', () => {
    expect(dmtDedupeKey('dont_miss_twice', '2026-11-12')).toBe('dmt:2026-11-12');
    expect(dmtDedupeKey('streak_save_offer', '2026-11-12')).toBe('streak_save:2026-11-12');
    expect(milestoneDedupeKey(30, '2026-11-13')).toBe('streak_milestone:30:2026-11-13');
  });
  it('offer expiry = end of D+1 local + the 3 am grace', () => {
    expect(saveOfferExpiresAt('2026-11-12', 'America/New_York', 3).toISOString()).toBe('2026-11-14T08:00:00.000Z');
  });
});

describe('milestone celebration helpers', () => {
  it('streak_celebration_v1 in X-Client-Features', () => {
    expect(clientShowsStreakCelebration('icon_keys, streak_celebration_v1')).toBe(true);
    expect(clientShowsStreakCelebration('icon_keys,promo@1')).toBe(false);
    expect(requestShowsStreakCelebration({ headers: new Headers({ 'X-Client-Features': 'STREAK_CELEBRATION_V1' }) })).toBe(true);
    expect(requestShowsStreakCelebration(null)).toBe(false);
  });
  it('push copy', () => {
    expect(milestonePushCopy({ days: 7, name: '1-Week Warrior', shieldsGranted: 1 })).toEqual({
      title: '7-day streak', body: '1-Week Warrior: 7 days in a row. Tap to celebrate. You earned a streak shield.',
    });
    expect(milestonePushCopy({ days: 30, name: 'Monthly Master', shieldsGranted: 0 }).body).toBe('Monthly Master: 30 days in a row. Tap to celebrate.');
  });
  it('pending only within 72 h', () => {
    const now = new Date('2026-11-13T12:00:00Z');
    const meta = { pending_celebration: { days: 7, name: '1-Week Warrior', icon: 'flame', day: '2026-11-12', at: '2026-11-12T12:00:00Z', shieldsGranted: 1 } };
    expect(pendingCelebrationFrom(meta, now)).toEqual({ milestone: 7, name: '1-Week Warrior', icon: 'flame', shields_granted: 1, reached_on: '2026-11-12' });
    expect(pendingCelebrationFrom(meta, new Date('2026-11-15T12:00:01Z'))).toBeNull();
    expect(pendingCelebrationFrom({}, now)).toBeNull();
  });
});
