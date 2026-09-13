import { describe, expect, it, vi } from 'vitest';

// The catalog modules import the Supabase admin client at module load; stub it
// so this stays a pure contract test.
vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import {
  NOTIFICATION_TEMPLATES,
  TYPE_SCREEN_MAP,
  screenFor,
  type NotificationType,
} from '../notification-orchestrator';
import { NotificationPreferencesService } from '../notification-preferences-service';

const ALL_TYPES = Object.keys(NOTIFICATION_TEMPLATES) as NotificationType[];
const SCREENS = [
  'dashboard',
  'food_log',
  'exercise_log',
  'circles',
  'circle_detail',
  'circle_chat',
  'challenges',
  'streaks',
];

describe('notification catalog contract', () => {
  it('every type has a preference category, and it matches the template', () => {
    for (const type of ALL_TYPES) {
      const mapped = NotificationPreferencesService.getCategoryForType(type);
      const template = NOTIFICATION_TEMPLATES[type]({}).category;
      expect(mapped, `${type} missing from TYPE_CATEGORY_MAP`).not.toBeNull();
      expect(mapped, `${type}: map says ${mapped}, template says ${template}`).toBe(template);
    }
  });

  it('every type resolves to a screen the mobile apps allowlist', () => {
    for (const type of ALL_TYPES) {
      expect(SCREENS, `${type} → ${TYPE_SCREEN_MAP[type]}`).toContain(TYPE_SCREEN_MAP[type]);
    }
  });

  it('circle screens fall back to the circles list without a circleId', () => {
    expect(screenFor('chat_message', {})).toBe('circles');
    expect(screenFor('chat_message', { circleId: 'c1' })).toBe('circle_chat');
    expect(screenFor('perfect_day', {})).toBe('circles');
    expect(screenFor('perfect_day', { circleId: 'c1' })).toBe('circle_detail');
    expect(screenFor('streak_lost', {})).toBe('streaks');
  });
});
