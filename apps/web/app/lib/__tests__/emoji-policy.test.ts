/**
 * DESIGN_LANGUAGE §6: push copy and circle system posts never carry emoji.
 * Every push template and every system-post type is rendered with typical data
 * (and with data that itself carries emoji where the copy embeds server/LLM
 * text) and checked. User content (chat previews, reaction emoji) is exempt.
 */
import { describe, expect, it } from 'vitest';

import { focusPushCopy, hydrationCopy, introCopy, proteinTemplate, weeklyPlanCopy } from '../fitzy/push';
import { NOTIFICATION_TEMPLATES, type NotificationType } from '../services/notification-orchestrator';
import { SystemPostEngine } from '../services/system-post-engine';
import { hasEmoji } from '../text/strip-emoji';
import type { SystemEventType } from '../types/circle-chat';

const USER_CONTENT: NotificationType[] = ['chat_message', 'chat_mention', 'chat_reaction'];
// Title/body are composed upstream from circle names (user content) by DailySummaryService.
const PASSTHROUGH: NotificationType[] = ['circle_daily_summary'];

const DATA = {
  circleName: 'Morning Movers',
  friendName: 'Maya',
  inviterName: 'Sam',
  challengeName: 'Step Sprint',
  challengeTitle: 'Plank day',
  milestoneName: '1-Week Warrior',
  currentMomentum: 6,
  streakDays: 7,
  lostStreak: 9,
  shieldsRemaining: 1,
  shieldsGranted: 1,
  daysAway: 2,
  days: 7,
  rank: 2,
  checkedIn: 3,
  total: 5,
  workoutsThisMonth: 12,
  mealsThisMonth: 20,
  bestStreak: 9,
  workoutsThisWeek: 3,
  mealsThisWeek: 5,
  kickoffReason: 'full',
  otherCircleCount: 1,
  // Server/LLM text embedded in titles: must come out clean.
  headline: "Ani's on a 7-day streak 🔥",
  body: 'Something big 🎉',
  title: 'Door 7 is open 😴',
} as any;

describe('push templates', () => {
  for (const type of Object.keys(NOTIFICATION_TEMPLATES) as NotificationType[]) {
    if (USER_CONTENT.includes(type)) continue;
    it(type, () => {
      const runs = PASSTHROUGH.includes(type) ? [{}] : [{}, DATA, { ...DATA, otherCircleCount: 0, kickoffReason: 'time' }];
      for (const data of runs) {
        const c = NOTIFICATION_TEMPLATES[type](data);
        expect(hasEmoji(c.title), `${type} title: ${c.title}`).toBe(false);
        expect(hasEmoji(c.body), `${type} body: ${c.body}`).toBe(false);
      }
    });
  }

  it('Fitzy template copy', () => {
    const all = [
      ...['a', 'b', 'c', 'd'].map(hydrationCopy),
      ...['a', 'b', 'c'].map((s) => proteinTemplate('omnivore', [], s)),
      introCopy(true),
      introCopy(false),
      weeklyPlanCopy('pro'),
      weeklyPlanCopy('free'),
      focusPushCopy({ date: '2026-10-28', kind: 'tip', headline: 'Walk after lunch 🚶', body: 'A short walk helps. Try 10 minutes 🌞', cta: { label: 'Log', action: { type: 'log_workout', label: 'Log' } }, tier: 'free' } as any, () => false, 'ai'),
      focusPushCopy({ date: '2026-10-28', kind: 'recap', headline: 'x'.repeat(90), body: 'y', cta: null, tier: 'pro' } as any, () => false, 'ai'),
    ];
    for (const c of all) for (const t of [c.title, c.body, c.tip]) expect(hasEmoji(t), t).toBe(false);
  });
});

describe('circle system posts', () => {
  const engine = new SystemPostEngine();
  const types: SystemEventType[] = ['workout_done', 'notable_meal', 'streak_milestone', 'circle_streak', 'quest_done', 'challenge_milestone', 'challenge_resolved', 'daily_summary', 'meal_logged', 'member_joined', 'new_challenge', 'circle_streak_saved', 'circle_kickoff'];
  for (const eventType of types) {
    it(eventType, () => {
      for (const actors of [[{ name: 'Mike' }], [{ name: 'Mike' }, { name: 'Sarah' }, { name: 'Priya' }]]) {
        for (const payload of [
          {},
          { streakDays: 14, checkedIn: 4, total: 5, challengeName: 'Spring Cut', questName: 'Hydration Quest', mealDescriptor: 'high-protein lunch', kickoffReason: 'full', memberCount: 3, circleName: 'Crew', coveredName: 'Bo', challengeMilestone: 50 },
          { checkedIn: 5, total: 5, kickoffReason: 'time' },
          { checkedIn: 1, total: 1 },
        ]) {
          const out = engine.renderCopy({ eventType, actors, payload: payload as any });
          expect(hasEmoji(out), `${eventType}: ${out}`).toBe(false);
        }
      }
    });
  }
});
