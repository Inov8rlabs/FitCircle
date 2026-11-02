import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireMobileAuth = vi.fn();
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: (...args: unknown[]) => requireMobileAuth(...args),
}));
const sendCheer = vi.fn();
vi.mock('@/lib/services/circle-cheer-service', async (orig) => {
  const actual = (await orig()) as any;
  return { ...actual, CircleCheerService: { sendCheer: (...a: unknown[]) => sendCheer(...a) } };
});

import { CheerError } from '@/lib/services/circle-cheer-service';

import { POST } from '../route';

const CIRCLE = '7d3f3a7d-1e1e-4ab1-85b5-bff9f619f0bf';
const RAV = '4850c193-f591-4169-9173-e26bd35242c7';

const call = (body: unknown, id = CIRCLE, tz?: string) =>
  POST(
    new Request(`http://localhost/api/mobile/circles/${id}/cheers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(tz ? { 'x-client-timezone': tz } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }) as any,
    { params: Promise.resolve({ id }) }
  );

beforeEach(() => {
  requireMobileAuth.mockReset().mockResolvedValue({ id: 'me' });
  sendCheer.mockReset();
});

describe('POST /api/mobile/circles/[id]/cheers', () => {
  it('201 with the cheer message; passes the parsed body + timezone to the service', async () => {
    const message = { id: 'm1', kind: 'user_text', body: '👏 @Raveesh Keep going!', cheer: { to_user_id: RAV } };
    sendCheer.mockResolvedValue(message);
    const res = await call(
      { to_user_id: RAV, reaction: 'clap', message: 'Keep going!', source: 'member_sheet', client_id: '11111111-1111-4111-8111-111111111111' },
      CIRCLE,
      'America/Toronto'
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ success: true, data: { message }, error: null });
    expect(sendCheer).toHaveBeenCalledWith(CIRCLE, 'me', {
      toUserId: RAV,
      reaction: 'clap',
      message: 'Keep going!',
      source: 'member_sheet',
      clientId: '11111111-1111-4111-8111-111111111111',
      clientTimezone: 'America/Toronto',
    });
  });

  it('only to_user_id is required', async () => {
    sendCheer.mockResolvedValue({ id: 'm1' });
    expect((await call({ to_user_id: RAV })).status).toBe(201);
    expect(sendCheer.mock.calls[0][2]).toMatchObject({ reaction: null, message: null, source: null, clientId: null });
  });

  it('400 on a bad circle id, a missing/invalid recipient, an unknown source, or a non-JSON body', async () => {
    expect((await call({ to_user_id: RAV }, 'nope')).status).toBe(400);
    for (const body of [{}, { to_user_id: 'x' }, { to_user_id: RAV, source: 'chat' }, 'not json']) {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    }
    expect(sendCheer).not.toHaveBeenCalled();
  });

  it.each([
    ['VALIDATION_ERROR', 400],
    ['CANNOT_CHEER_SELF', 400],
    ['FORBIDDEN', 403],
    ['BLOCKED', 403],
    ['RECIPIENT_NOT_FOUND', 404],
  ] as const)('maps %s → %i', async (code, status) => {
    sendCheer.mockRejectedValue(new CheerError(code, 'nope', { field: 'x' }));
    const res = await call({ to_user_id: RAV });
    expect(res.status).toBe(status);
    expect((await res.json()).error).toMatchObject({ code, message: 'nope', details: { field: 'x' } });
  });

  it('429 RATE_LIMITED with Retry-After and the friendly message', async () => {
    sendCheer.mockRejectedValue(
      new CheerError('RATE_LIMITED', 'You just cheered Raveesh — give it a minute', { reason: 'pair_cooldown', retry_after_seconds: 42 })
    );
    const res = await call({ to_user_id: RAV });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect((await res.json()).error).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'You just cheered Raveesh — give it a minute',
      details: { reason: 'pair_cooldown', retry_after_seconds: 42 },
    });
  });

  it('401 / 500', async () => {
    requireMobileAuth.mockRejectedValueOnce(new Error('Unauthorized'));
    expect((await call({ to_user_id: RAV })).status).toBe(401);
    sendCheer.mockRejectedValue(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await call({ to_user_id: RAV })).status).toBe(500);
    err.mockRestore();
  });
});
