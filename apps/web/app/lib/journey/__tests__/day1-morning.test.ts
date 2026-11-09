import { describe, expect, it } from 'vitest';

import { NOTIFICATION_TEMPLATES, TYPE_SCREEN_MAP, isCapChecked, isCapExempt, screenFor } from '@/lib/services/notification-orchestrator';
import { NotificationPreferencesService } from '@/lib/services/notification-preferences-service';

import { chooseDay1Message, day1Window, stepsRank, type Day1Facts } from '../day1-morning';

const CHI = 'America/Chicago';
const U = 'user-1';
const base: Day1Facts = { userId: U, onboardingCompleted: true, circles: [], stepsDay0: null, loggedMealDay0: false, streakDays: 0 };
// Emoji / pictograph code points (no emoji as icons in copy).
const EMOJI = /\p{Extended_Pictographic}/u;

describe('day1Window', () => {
  const signup = '2026-11-09T23:00:00Z'; // 17:00 Chicago, Nov 9
  it('due 08:00–08:59 local on the day after the sign-up day', () => {
    expect(day1Window(new Date('2026-11-10T14:00:00Z'), signup, CHI)).toMatchObject({ due: true, localDate: '2026-11-10', signupLocalDate: '2026-11-09' });
    expect(day1Window(new Date('2026-11-10T14:59:00Z'), signup, CHI).due).toBe(true);
  });
  it('not before 08:00, not from 09:00, not on the sign-up day or 2 days later', () => {
    expect(day1Window(new Date('2026-11-10T13:59:00Z'), signup, CHI)).toMatchObject({ due: false, wait: 'too_early' });
    expect(day1Window(new Date('2026-11-10T15:00:00Z'), signup, CHI)).toMatchObject({ due: false, wait: 'too_late' });
    expect(day1Window(new Date('2026-11-09T23:30:00Z'), signup, CHI)).toMatchObject({ due: false, wait: 'too_early' });
    expect(day1Window(new Date('2026-11-11T14:00:00Z'), signup, CHI)).toMatchObject({ due: false, wait: 'too_late' });
  });
  it('the hour is configurable (remote config day1_morning_push_hour)', () => {
    expect(day1Window(new Date('2026-11-10T15:30:00Z'), signup, CHI, 9).due).toBe(true);
  });
  it('a 00:30 sign-up gets its push the NEXT morning, not 8 h later', () => {
    const lateNight = '2026-11-10T06:30:00Z'; // 00:30 Chicago Nov 10
    expect(day1Window(new Date('2026-11-10T14:00:00Z'), lateNight, CHI).due).toBe(false);
    expect(day1Window(new Date('2026-11-11T14:00:00Z'), lateNight, CHI).due).toBe(true);
  });
});

describe('stepsRank', () => {
  it('needs the user and at least one other member with steps', () => {
    expect(stepsRank([{ userId: U, steps: 5000 }], U)).toBeNull();
    expect(stepsRank([{ userId: 'x', steps: 5000 }, { userId: 'y', steps: 10 }], U)).toBeNull();
    expect(stepsRank([{ userId: U, steps: 5000 }, { userId: 'x', steps: 0 }], U)).toBeNull();
    expect(stepsRank([{ userId: U, steps: 6412 }, { userId: 'x', steps: 9000 }, { userId: 'y', steps: 3000 }], U)).toEqual({ rank: 2, of: 3, steps: 6412 });
  });
});

describe('chooseDay1Message', () => {
  const circle = { id: 'c1', name: 'Office Walkers', memberSteps: [] as Array<{ userId: string; steps: number }>, challengeName: null };

  it('1a. circle with real steps from others → rank, quoting only synced numbers', () => {
    const m = chooseDay1Message({ ...base, circles: [{ ...circle, memberSteps: [{ userId: U, steps: 6412 }, { userId: 'x', steps: 9000 }] }], stepsDay0: 6412 });
    expect(m).toMatchObject({ variant: 'circle_rank', screen: 'circle_detail', circleId: 'c1', title: 'Office Walkers yesterday' });
    expect(m.body).toBe('You finished #2 of 2 with 6,412 steps. Today is a new race.');
  });
  it('1b. circle with an active challenge → today’s challenge', () => {
    const m = chooseDay1Message({ ...base, circles: [{ ...circle, challengeName: 'November Steps' }] });
    expect(m).toMatchObject({ variant: 'circle_challenge', title: 'November Steps is on today', circleId: 'c1' });
  });
  it('1c. solo circle + own steps → their steps; 1d. nothing to quote → no numbers', () => {
    expect(chooseDay1Message({ ...base, circles: [circle], stepsDay0: 4200 })).toMatchObject({ variant: 'circle_steps', title: 'Yesterday: 4,200 steps' });
    const plain = chooseDay1Message({ ...base, circles: [circle] });
    expect(plain.variant).toBe('circle');
    expect(`${plain.title} ${plain.body}`).not.toMatch(/\d{2,}/);
  });
  it('circle beats meal (priority order)', () => {
    expect(chooseDay1Message({ ...base, circles: [circle], loggedMealDay0: true }).variant).toBe('circle');
  });
  it('2. logged a meal → breakfast to keep the streak going (only claims a streak that exists)', () => {
    expect(chooseDay1Message({ ...base, loggedMealDay0: true, streakDays: 1 })).toMatchObject({ variant: 'meal_logged', screen: 'food_log', body: 'Log breakfast to keep your streak going.' });
    expect(chooseDay1Message({ ...base, loggedMealDay0: true }).body).toBe('Log breakfast to start your streak.');
  });
  it('3. neither → start a circle with a friend (or finish setup when onboarding is open)', () => {
    expect(chooseDay1Message(base)).toMatchObject({ variant: 'start_circle', screen: 'circles' });
    expect(chooseDay1Message({ ...base, onboardingCompleted: false })).toMatchObject({ variant: 'finish_setup', screen: 'dashboard' });
  });
  it('long circle names are shortened; no copy uses emoji', () => {
    const m = chooseDay1Message({ ...base, circles: [{ ...circle, name: 'The Very Long Name Of Our Lovely Walking Circle' }] });
    expect(m.title.length).toBeLessThanOrEqual(45);
    const all: Day1Facts[] = [
      base,
      { ...base, onboardingCompleted: false },
      { ...base, loggedMealDay0: true, streakDays: 2 },
      { ...base, circles: [circle] },
      { ...base, circles: [circle], stepsDay0: 10 },
      { ...base, circles: [{ ...circle, challengeName: 'Steps' }] },
      { ...base, circles: [{ ...circle, memberSteps: [{ userId: U, steps: 1 }, { userId: 'x', steps: 2 }] }] },
    ];
    for (const f of all) {
      const msg = chooseDay1Message(f);
      expect(EMOJI.test(msg.title + msg.body), msg.variant).toBe(false);
      expect(msg.body).not.toMatch(/people like you|users who|\d+%/i); // no unmeasured social proof
    }
  });
});

describe('day1_morning in the notification catalog', () => {
  it('journey category (Journey toggle), counts toward and respects the daily cap', () => {
    expect(NotificationPreferencesService.getCategoryForType('day1_morning')).toBe('journey');
    expect(isCapExempt('day1_morning')).toBe(false);
    expect(isCapChecked('day1_morning')).toBe(true);
  });
  it('screen comes from the variant, limited to an allowlist the shipped apps route', () => {
    expect(TYPE_SCREEN_MAP.day1_morning).toBe('dashboard');
    expect(screenFor('day1_morning', { screen: 'circles' })).toBe('circles');
    expect(screenFor('day1_morning', { screen: 'circle_detail', circleId: 'c1' })).toBe('circle_detail');
    expect(screenFor('day1_morning', { screen: 'circle_detail' })).toBe('circles');
    expect(screenFor('day1_morning', { screen: 'fitzy_chat' })).toBe('dashboard');
    expect(screenFor('meal_reminder_lunch', { screen: 'circles' })).toBe('food_log'); // other types ignore data.screen
  });
  it('template uses the built copy and strips emoji', () => {
    expect(NOTIFICATION_TEMPLATES.day1_morning({ title: 'Good morning', body: 'Log breakfast to keep your streak going.' })).toEqual({
      title: 'Good morning',
      body: 'Log breakfast to keep your streak going.',
      category: 'journey',
    });
    expect(NOTIFICATION_TEMPLATES.day1_morning({ title: 'Walkers \u{1F525}', body: 'x' }).title).toBe('Walkers');
  });
});
