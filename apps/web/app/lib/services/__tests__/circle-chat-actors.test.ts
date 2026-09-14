import { describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => ({}) }));

import { CircleChatService } from '../circle-chat-service';

describe('CircleChatService.normalizeActors', () => {
  const names = new Map([['u1', { name: 'Anki' }]]);

  it('fills missing names from the profile batch (the shape stored by the post engine)', () => {
    expect(CircleChatService.normalizeActors([{ id: 'u1' }], names)).toEqual([{ id: 'u1', name: 'Anki' }]);
  });

  it('keeps an explicit name, and never emits a null/absent name', () => {
    expect(CircleChatService.normalizeActors([{ id: 'u1', name: 'Grace' }, { id: 'c9' }], names)).toEqual([
      { id: 'u1', name: 'Grace' },
      { id: 'c9', name: '' },
    ]);
  });

  it('drops malformed entries instead of sending them', () => {
    expect(CircleChatService.normalizeActors([null, 'x', { name: 'no id' }, { id: '' }], names)).toEqual([]);
    expect(CircleChatService.normalizeActors(undefined, names)).toEqual([]);
  });
});
