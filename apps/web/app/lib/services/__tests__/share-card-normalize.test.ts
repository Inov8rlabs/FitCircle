import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CircleFakeDb, getCircleDb, setCircleDb } from './circle-fake-db';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => getCircleDb().client() }));

import { ShareCardService, normalizeShareCardData } from '../share-card-service';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** What the renderer receives: the `data` query parameter of the image url, decoded. */
function renderedData(imageUrl: string): Record<string, unknown> {
  const data = new URL(imageUrl).searchParams.get('data');
  return JSON.parse(Buffer.from(data!, 'base64').toString('utf-8'));
}

describe('normalizeShareCardData', () => {
  it('milestone: what iOS and Android send (ShareCardContext.momentumMilestone)', () => {
    const sent = { milestone_name: 'Week Warrior', days: '7', badge_emoji: '🔥' };

    expect(normalizeShareCardData('milestone', sent)).toEqual({
      ...sent,
      milestoneName: 'Week Warrior',
      dayCount: 7,
      badgeEmoji: '🔥',
    });
  });

  it('streak_milestone', () => {
    const sent = { streak_days: '30', milestone_title: '1-Month Master', badge: '🏆', display_name: 'Ani' };

    expect(normalizeShareCardData('streak_milestone', sent)).toEqual({
      ...sent,
      streakDays: 30,
      milestoneTitle: '1-Month Master',
      displayName: 'Ani',
    });
  });

  it('challenge_complete: the goal label gives the amount and the unit', () => {
    const sent = { challenge_name: 'Daily Push-Ups', goal: '50 reps', rank: '3' };

    expect(normalizeShareCardData('challenge_complete', sent)).toEqual({
      ...sent,
      challengeName: 'Daily Push-Ups',
      goalAmount: 50,
      unit: 'reps',
      rank: 3,
    });
  });

  it('challenge_complete: a goal label without a number invents nothing', () => {
    const out = normalizeShareCardData('challenge_complete', { challenge_name: 'Plank', goal: 'as long as you can' });

    expect(out.goalAmount).toBeUndefined();
    expect(out.unit).toBeUndefined();
    expect(out.goal).toBe('as long as you can');
  });

  it('perfect_week', () => {
    expect(normalizeShareCardData('perfect_week', { week_number: '12', streak_days: '84' })).toEqual({
      week_number: '12',
      streak_days: '84',
      weekNumber: 12,
      streakDays: 84,
    });
  });

  it('momentum_flame', () => {
    expect(normalizeShareCardData('momentum_flame', { flame_level: '3', current_momentum: '21' })).toEqual({
      flame_level: '3',
      current_momentum: '21',
      flameLevel: 3,
      currentMomentum: 21,
    });
  });

  it('circle_boost: "2.0x" becomes the number 2', () => {
    expect(normalizeShareCardData('circle_boost', { multiplier: '2.0x', circle_name: 'Morning Crew' })).toEqual({
      multiplier: 2,
      circle_name: 'Morning Crew',
      circleName: 'Morning Crew',
    });
    expect(normalizeShareCardData('circle_boost', { multiplier: '1.5x' }).multiplier).toBe(1.5);
  });

  it('OLD SHAPE: camelCase numbers (web ShareCardButton) pass through unchanged', () => {
    const sent = { milestoneName: '7-Day Warrior', dayCount: 7, badgeEmoji: '🔥', currentStreak: 7 };
    expect(normalizeShareCardData('milestone', sent)).toEqual(sent);

    const boost = { circleName: 'Crew', multiplier: 2, checkedInCount: 4, totalMembers: 5 };
    expect(normalizeShareCardData('circle_boost', boost)).toEqual(boost);

    const week = { weekStart: '2026-09-21', weekEnd: '2026-09-27', circleNames: ['A', 'B'] };
    expect(normalizeShareCardData('perfect_week', week)).toEqual(week);
  });

  it('a canonical key wins over its alias when both are sent', () => {
    expect(normalizeShareCardData('milestone', { days: '3', dayCount: 9 }).dayCount).toBe(9);
    expect(normalizeShareCardData('milestone', { dayCount: 9, days: '3' }).dayCount).toBe(9);
    expect(normalizeShareCardData('milestone', { milestone_name: 'snake', milestoneName: 'camel' }).milestoneName).toBe('camel');
  });

  it('only numeric fields are coerced: a name that looks like a number stays a string', () => {
    const out = normalizeShareCardData('milestone', { milestone_name: '100', days: '100' });
    expect(out.milestoneName).toBe('100');
    expect(out.dayCount).toBe(100);
  });

  it('leaves a numeric field alone when it is not a number', () => {
    expect(normalizeShareCardData('momentum_flame', { flame_level: 'max' }).flameLevel).toBe('max');
    expect(normalizeShareCardData('milestone', { days: '' }).dayCount).toBe('');
  });

  it('reads thousands separators', () => {
    expect(normalizeShareCardData('challenge_complete', { goal_amount: '10,000' }).goalAmount).toBe(10000);
  });

  it('drops nulls and survives input that is not an object', () => {
    expect(normalizeShareCardData('milestone', { days: null, milestone_name: 'x' })).toEqual({
      days: null,
      milestone_name: 'x',
      milestoneName: 'x',
    });
    expect(normalizeShareCardData('milestone', null)).toEqual({});
    expect(normalizeShareCardData('milestone', ['a'])).toEqual({});
    expect(normalizeShareCardData('milestone', 'text')).toEqual({});
  });
});

describe('ShareCardService.generateCard', () => {
  let db: CircleFakeDb;
  beforeEach(() => {
    db = new CircleFakeDb();
    setCircleDb(db);
  });

  it('stores and returns card_data EXACTLY as sent (iOS decodes it as [String: String])', async () => {
    const sent = { milestone_name: 'Week Warrior', days: '7', badge_emoji: '🔥' };

    const card = await ShareCardService.generateCard(USER, 'milestone', sent);

    expect(card.card_data).toEqual(sent);
    expect(db.tables.share_cards[0].card_data).toEqual(sent);
    expect(Object.values(card.card_data).every((value) => typeof value === 'string')).toBe(true);
    expect(card).toMatchObject({
      user_id: USER,
      card_type: 'milestone',
      template_name: 'milestone_achievement',
    });
  });

  it('gives the renderer the values it reads', async () => {
    const card = await ShareCardService.generateCard(USER, 'circle_boost', {
      multiplier: '2.0x',
      circle_name: 'Morning Crew',
    });

    expect(card.image_url).toContain('/api/og/share-card?');
    expect(new URL(card.image_url!).searchParams.get('type')).toBe('circle_boost');
    expect(renderedData(card.image_url!)).toMatchObject({ circleName: 'Morning Crew', multiplier: 2 });
  });

  it('OLD SHAPE: camelCase data renders as it did', async () => {
    const sent = { milestoneName: '7-Day Warrior', dayCount: 7, badgeEmoji: '🔥', currentStreak: 7 };

    const card = await ShareCardService.generateCard(USER, 'milestone', sent);

    expect(card.card_data).toEqual(sent);
    expect(renderedData(card.image_url!)).toEqual(sent);
  });
});
