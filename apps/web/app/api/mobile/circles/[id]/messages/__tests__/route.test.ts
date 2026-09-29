import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  listMessages: vi.fn(),
}));

vi.mock('@/lib/services/circle-chat-service', () => ({ CircleChatService: service }));
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async (request: Request) => {
    if (!request.headers.get('Authorization')?.startsWith('Bearer ')) throw new Error('Unauthorized');
    return { id: 'user-1' };
  },
}));

import { GET, POST } from '../route';

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const CLIENT_ID = '7b0f2c1e-3d4a-4f5b-8c6d-9e0f1a2b3c4d';

/** Exactly what CircleChatService returns today (camelCase ChatMessageDTO). */
const dto = {
  id: 'm-1',
  circleId: CIRCLE,
  kind: 'user_text',
  sender: { id: 'user-1', name: 'Ana', avatarUrl: null },
  body: 'hello',
  photoUrl: null,
  system: null,
  reactions: [{ reaction: 'heart', count: 2, reactedByMe: true }],
  clientId: CLIENT_ID,
  createdAt: '2026-09-28T12:00:00.000Z',
  editedAt: null,
  deletedAt: null,
};

const ctx = { params: Promise.resolve({ id: CIRCLE }) };
const url = `http://localhost/api/mobile/circles/${CIRCLE}/messages`;
const send = (body: unknown, authed = true) =>
  POST(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authed ? { Authorization: 'Bearer t' } : {}) },
      body: JSON.stringify(body),
    }) as any,
    ctx
  );

beforeEach(() => {
  service.sendMessage.mockReset().mockResolvedValue(dto);
  service.listMessages.mockReset().mockResolvedValue({ messages: [dto], hasMore: false, nextBefore: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('POST /api/mobile/circles/[id]/messages', () => {
  it('accepts a text send whose optional fields are explicit nulls (what Android sent)', async () => {
    const res = await send({ kind: 'user_text', body: 'hello', photoUrl: null, clientId: null });

    expect(res.status).toBe(201);
    expect((await res.json()).success).toBe(true);
    expect(service.sendMessage).toHaveBeenCalledWith(CIRCLE, 'user-1', {
      kind: 'user_text',
      body: 'hello',
      photoUrl: null,
      clientId: null,
    });
  });

  it('accepts a photo send with a null caption', async () => {
    const res = await send({ kind: 'user_photo', body: null, photoUrl: 'https://cdn.example.com/p.jpg', clientId: CLIENT_ID });

    expect(res.status).toBe(201);
    expect(service.sendMessage).toHaveBeenCalledWith(CIRCLE, 'user-1', {
      kind: 'user_photo',
      body: null,
      photoUrl: 'https://cdn.example.com/p.jpg',
      clientId: CLIENT_ID,
    });
  });

  it('still accepts the old shape with the optional keys omitted (what iOS sends)', async () => {
    const res = await send({ kind: 'user_text', body: 'hello', clientId: CLIENT_ID.toUpperCase() });

    expect(res.status).toBe(201);
    expect(service.sendMessage).toHaveBeenCalledWith(CIRCLE, 'user-1', {
      kind: 'user_text',
      body: 'hello',
      photoUrl: null,
      clientId: CLIENT_ID.toUpperCase(),
    });
  });

  it('returns the message payload untouched, in the same envelope', async () => {
    const body = await (await send({ kind: 'user_text', body: 'hello' })).json();

    expect(Object.keys(body).sort()).toEqual(['data', 'error', 'meta', 'success']);
    expect(body.data).toEqual(dto);
    expect(body.error).toBeNull();
    expect(typeof body.meta.requestTime).toBe('number');
  });

  it('validates exactly as before: null does not excuse a required or malformed field', async () => {
    for (const bad of [
      { kind: null, body: 'hello' },
      { body: 'hello' },
      { kind: 'system_event', body: 'hello' },
      { kind: 'user_photo', photoUrl: 'not a url' },
      { kind: 'user_text', body: 'x'.repeat(4001) },
      { kind: 'user_text', body: 'hi', clientId: 'not-a-uuid' },
      { kind: 'user_text', body: 42 },
    ]) {
      const res = await send(bad);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
    }
    expect(service.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps every key of the validation error and makes the message specific', async () => {
    const body = await (await send({ kind: 'user_photo', photoUrl: 'not a url' })).json();

    expect(Object.keys(body).sort()).toEqual(['data', 'error', 'meta', 'success']);
    expect(body).toMatchObject({ success: false, data: null, meta: null });
    expect(Object.keys(body.error).sort()).toEqual(['code', 'details', 'message', 'timestamp']);
    expect(body.error.details).toEqual({ photoUrl: 'Invalid url' });
    expect(body.error.message).toBe('photoUrl: Invalid url');
  });

  it('still answers 401 / 403 / 404 with the same codes', async () => {
    expect((await send({ kind: 'user_text', body: 'hi' }, false)).status).toBe(401);

    service.sendMessage.mockRejectedValueOnce(new Error('Forbidden'));
    const forbidden = await send({ kind: 'user_text', body: 'hi' });
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe('FORBIDDEN');

    service.sendMessage.mockRejectedValueOnce(new Error('NotFound'));
    expect((await send({ kind: 'user_text', body: 'hi' })).status).toBe(404);
  });
});

describe('GET /api/mobile/circles/[id]/messages', () => {
  it('returns the page untouched', async () => {
    const res = await GET(
      new Request(`${url}?limit=20&before=2026-09-28T12:00:00.000Z`, { headers: { Authorization: 'Bearer t' } }) as any,
      ctx
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ messages: [dto], hasMore: false, nextBefore: null });
    expect(service.listMessages).toHaveBeenCalledWith(CIRCLE, 'user-1', {
      limit: 20,
      before: '2026-09-28T12:00:00.000Z',
    });
  });
});
