import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireMobileAuth = vi.fn();
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
}));
const listChats = vi.fn();
vi.mock('@/lib/services/chat-inbox-service', () => ({ ChatInboxService: { listChats: (...a: unknown[]) => listChats(...a) } }));

import { GET } from '../route';

const call = () => GET(new Request('http://localhost/api/mobile/chats') as any);

const INBOX = {
  chats: [
    {
      circle_id: 'c1', circle_name: 'Nov steps challenge', circle_avatar_url: null, circle_type: 'step_count',
      unread_count: 3, muted: false, last_read_at: null, last_activity_at: '2026-11-02T18:01:00Z',
      last_message: { id: 'm1', sender_id: 'u1', sender_display_name: 'Raveesh', preview: "Let's go!", kind: 'user_text', is_cheer: false, created_at: '2026-11-02T18:01:00Z' },
    },
  ],
  total_unread: 3,
  muted_unread: 0,
  default_circle_id: 'c1',
};

beforeEach(() => {
  requireMobileAuth.mockReset();
  listChats.mockReset();
});

describe('GET /api/mobile/chats', () => {
  it('returns the inbox in the mobile envelope, uncached', async () => {
    requireMobileAuth.mockResolvedValue({ id: 'me' });
    listChats.mockResolvedValue(INBOX);
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toMatchObject({ success: true, error: null, data: INBOX });
    expect(listChats).toHaveBeenCalledWith('me');
  });

  it('401 without a valid token', async () => {
    requireMobileAuth.mockRejectedValue(new Error('Unauthorized'));
    const res = await call();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('500 on a service failure, without leaking details', async () => {
    requireMobileAuth.mockResolvedValue({ id: 'me' });
    listChats.mockRejectedValue(new Error('db exploded'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call();
    err.mockRestore();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(JSON.stringify(body)).not.toContain('exploded');
  });
});
