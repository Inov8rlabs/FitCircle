import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ setMute: vi.fn() }));

vi.mock('@/lib/services/circle-chat-service', () => ({ CircleChatService: service }));
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async () => ({ id: 'user-1' }),
}));

import { POST } from '../route';

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const mute = (body: unknown) =>
  POST(
    new Request(`http://localhost/api/mobile/circles/${CIRCLE}/mute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as any,
    { params: Promise.resolve({ id: CIRCLE }) }
  );

beforeEach(() => {
  service.setMute.mockReset().mockImplementation(async (_c: string, _u: string, muted: boolean) => ({ muted }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('POST /api/mobile/circles/[id]/mute', () => {
  it('accepts the body both apps send and returns { muted } untouched', async () => {
    for (const muted of [true, false]) {
      const res = await mute({ muted });
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ muted });
      expect(service.setMute).toHaveBeenLastCalledWith(CIRCLE, 'user-1', muted);
    }
  });

  it('still requires muted: null or missing is a 400 that says so', async () => {
    for (const bad of [{ muted: null }, {}, { muted: 'yes' }]) {
      const res = await mute(bad);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(Object.keys(body.error).sort()).toEqual(['code', 'details', 'message', 'timestamp']);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toMatch(/^muted: /);
    }
    expect(service.setMute).not.toHaveBeenCalled();
  });
});
