import { describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import { REACTION_EMOJI, REACTION_KINDS } from '../../types/circle-chat';
import { ChatNotificationService } from '../chat-notification-service';
import { NOTIFICATION_TEMPLATES, isCapExempt, screenFor } from '../notification-orchestrator';

describe('reaction kinds', () => {
  it('offers thumbs up and the high five (same) first, keeps eyes decodable, and has an emoji for each', () => {
    expect(REACTION_KINDS.slice(0, 3)).toEqual(['thumbs_up', 'same', 'heart']);
    expect(REACTION_KINDS).toContain('eyes');
    for (const kind of REACTION_KINDS) expect(REACTION_EMOJI[kind]).toBeTruthy();
    expect(REACTION_EMOJI.thumbs_up).toBe('👍');
    expect(REACTION_EMOJI.same).toBe('🙌');
  });
});

describe('ChatNotificationService.reactionRecipient', () => {
  it("notifies a user message's author", () => {
    expect(ChatNotificationService.reactionRecipient({ sender_id: 'author' }, 'reactor')).toBe('author');
  });

  it('never notifies someone reacting to their own message', () => {
    expect(ChatNotificationService.reactionRecipient({ sender_id: 'me' }, 'me')).toBeNull();
  });

  it('routes a reaction on a meal card / streak post to the member it is about', () => {
    const mealCard = { sender_id: null, system_payload: { render_hint: 'meal_card', actors: [{ id: 'owner' }] } };
    expect(ChatNotificationService.reactionRecipient(mealCard, 'reactor')).toBe('owner');
    expect(ChatNotificationService.reactionRecipient(mealCard, 'owner')).toBeNull();
  });

  it('stays quiet for posts with no person behind them (daily summary) or malformed actors', () => {
    expect(ChatNotificationService.reactionRecipient({ sender_id: null, system_payload: { actors: [] } }, 'r')).toBeNull();
    expect(ChatNotificationService.reactionRecipient({ sender_id: null, system_payload: null }, 'r')).toBeNull();
    expect(ChatNotificationService.reactionRecipient({ sender_id: null, system_payload: { actors: ['x'] } }, 'r')).toBeNull();
  });
});

describe('chat_reaction notification type', () => {
  it('renders "<name> reacted <emoji>" with the message preview and lands in the circle chat', () => {
    const content = NOTIFICATION_TEMPLATES.chat_reaction({
      friendName: 'Grace',
      emoji: '🙌',
      preview: 'Leg day done',
      circleId: 'c1',
    });
    expect(content.title).toBe('Grace reacted 🙌');
    expect(content.body).toBe('to "Leg day done"');
    expect(content.category).toBe('social');
    expect(screenFor('chat_reaction', { circleId: 'c1' })).toBe('circle_chat');
    expect(screenFor('chat_reaction', {})).toBe('circles');
  });

  it('is conversation traffic: exempt from the daily nudge cap', () => {
    expect(isCapExempt('chat_reaction')).toBe(true);
  });
});
