import { describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import { CircleChatService } from '../circle-chat-service';

describe('CircleChatService.normalizeActors', () => {
  const names = new Map([['u1', { name: 'Anki' }]]);

  it('fills missing names from the profile batch (the shape stored by the post engine)', () => {
    expect(CircleChatService.normalizeActors([{ id: 'u1' }], names)).toEqual([{ id: 'u1', name: 'Anki' }]);
  });

  it('keeps an explicit name for a non-profile actor, and never emits a null/absent name', () => {
    expect(CircleChatService.normalizeActors([{ id: 'x1', name: 'Grace' }, { id: 'c9' }], names)).toEqual([
      { id: 'x1', name: 'Grace' },
      { id: 'c9', name: '' },
    ]);
  });

  it('the current profile name wins over a name stored at post time (rename)', () => {
    expect(CircleChatService.normalizeActors([{ id: 'u1', name: 'Old Name' }], names)).toEqual([{ id: 'u1', name: 'Anki' }]);
  });

  it('drops malformed entries instead of sending them', () => {
    expect(CircleChatService.normalizeActors([null, 'x', { name: 'no id' }, { id: '' }], names)).toEqual([]);
    expect(CircleChatService.normalizeActors(undefined, names)).toEqual([]);
  });
});

describe('CircleChatService.withLiveRecipientName', () => {
  const cheer = {
    to_user_id: 'u2',
    to_display_name: 'Old Name',
    reaction: 'clap',
    emoji: '👏',
    message: null,
    source: 'member_sheet' as const,
    stat_snapshot: null,
  };

  it('renders the recipient\'s current name', () => {
    const live = CircleChatService.withLiveRecipientName(cheer, new Map([['u2', { name: 'New Name' }]]));
    expect(live?.to_display_name).toBe('New Name');
  });

  it('falls back to the stored copy when the profile is gone or blank', () => {
    expect(CircleChatService.withLiveRecipientName(cheer, new Map())?.to_display_name).toBe('Old Name');
    expect(CircleChatService.withLiveRecipientName(cheer, new Map([['u2', { name: ' ' }]]))?.to_display_name).toBe('Old Name');
  });

  it('passes null through', () => {
    expect(CircleChatService.withLiveRecipientName(null, new Map())).toBeNull();
  });
});
