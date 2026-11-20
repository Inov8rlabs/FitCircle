import { describe, expect, it } from 'vitest';

import { isUnreadFor, isVisibleTo, type WindowRow } from '../chat-inbox-service';

const base: WindowRow = {
  id: 'm1',
  fitcircle_id: 'c1',
  sender_id: null,
  created_at: '2026-11-17T21:00:00Z',
  deleted_at: null,
};

describe('daily check-in summary cards stay out of the inbox', () => {
  it('a daily_summary post is never visible as the preview nor unread', () => {
    const row = { ...base, system_event_type: 'daily_summary' };
    expect(isVisibleTo(row, new Set())).toBe(false);
    expect(isUnreadFor(row, 'me', null, new Set())).toBe(false);
  });

  it('other system posts and member messages are unaffected', () => {
    expect(isVisibleTo({ ...base, system_event_type: 'meal_logged' }, new Set())).toBe(true);
    expect(isVisibleTo({ ...base, sender_id: 'u2' }, new Set())).toBe(true);
    expect(isUnreadFor({ ...base, sender_id: 'u2' }, 'me', null, new Set())).toBe(true);
  });
});
