import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  addReaction: vi.fn(),
  setReaction: vi.fn(),
  clearReaction: vi.fn(),
  listReactors: vi.fn(),
  removeReaction: vi.fn(),
  reportMessage: vi.fn(),
}));

vi.mock('@/lib/services/circle-chat-service', () => ({ CircleChatService: service }));
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async (request: Request) => {
    if (!request.headers.get('Authorization')?.startsWith('Bearer ')) throw new Error('Unauthorized');
    return { id: 'user-1' };
  },
}));

import { DELETE as removeOneReaction } from '../reactions/[reaction]/route';
import {
  POST as addReaction,
  DELETE as clearReaction,
  GET as listReactors,
  PUT as setReaction,
} from '../reactions/route';
import { POST as report } from '../report/route';
import { PATCH as editMessage } from '../route';

const MESSAGE = '99999999-9999-4999-8999-999999999999';
const ctx = { params: Promise.resolve({ id: MESSAGE }) };

function request(method: string, body?: unknown, raw?: string) {
  const payload = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return new Request(`http://localhost/api/mobile/messages/${MESSAGE}`, {
    method,
    headers: { Authorization: 'Bearer t', ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: payload,
  }) as any;
}

const reactors = [
  { user_id: 'user-1', display_name: 'Ani', avatar_url: null, reaction: 'clap', emoji: '👏', reacted_at: '2026-11-02T10:00:00.000Z' },
];
const message = { id: MESSAGE, kind: 'user_text', body: 'edited', editedAt: '2026-09-28T12:01:00.000Z' };
const reactions = [{ reaction: 'thumbs_up', emoji: '👍', count: 1, reactedByMe: true }];

beforeEach(() => {
  service.editMessage.mockReset().mockResolvedValue(message);
  service.addReaction.mockReset().mockResolvedValue(reactions);
  service.setReaction.mockReset().mockResolvedValue(reactions);
  service.clearReaction.mockReset().mockResolvedValue([]);
  service.removeReaction.mockReset().mockResolvedValue([]);
  service.listReactors.mockReset().mockResolvedValue(reactors);
  service.reportMessage.mockReset().mockResolvedValue({ reportId: 'r-1', status: 'open' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('POST /api/mobile/messages/[id]/report', () => {
  it('accepts an explicit null reason (what Android sent)', async () => {
    const res = await report(request('POST', { reason: null }), ctx);
    expect(res.status).toBe(201);
    expect(service.reportMessage).toHaveBeenCalledWith(MESSAGE, 'user-1', null);
  });

  it('still accepts the old shapes: no reason, and a reason', async () => {
    expect((await report(request('POST', {}), ctx)).status).toBe(201);
    expect(service.reportMessage).toHaveBeenLastCalledWith(MESSAGE, 'user-1', null);

    expect((await report(request('POST', { reason: 'spam' }), ctx)).status).toBe(201);
    expect(service.reportMessage).toHaveBeenLastCalledWith(MESSAGE, 'user-1', 'spam');
  });

  it('accepts a request with no body at all', async () => {
    const res = await report(request('POST'), ctx);
    expect(res.status).toBe(201);
    expect(service.reportMessage).toHaveBeenCalledWith(MESSAGE, 'user-1', null);
  });

  it('returns the report payload untouched', async () => {
    const body = await (await report(request('POST', { reason: 'spam' }), ctx)).json();
    expect(body.data).toEqual({ reportId: 'r-1', status: 'open' });
    expect(Object.keys(body).sort()).toEqual(['data', 'error', 'meta', 'success']);
  });

  it('still rejects a reason that is too long or of the wrong type, with a readable message', async () => {
    const tooLong = await report(request('POST', { reason: 'x'.repeat(1001) }), ctx);
    expect(tooLong.status).toBe(400);
    const body = await tooLong.json();
    expect(Object.keys(body.error).sort()).toEqual(['code', 'details', 'message', 'timestamp']);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/^reason: /);
    expect(body.error.details.reason).toBeTruthy();

    expect((await report(request('POST', { reason: 5 }), ctx)).status).toBe(400);
    expect((await report(request('POST', undefined, '{oops'), ctx)).status).toBe(400);
    expect(service.reportMessage).not.toHaveBeenCalled();
  });
});

describe('POST /api/mobile/messages/[id]/reactions', () => {
  it('accepts every known reaction and returns the summaries untouched', async () => {
    const res = await addReaction(request('POST', { reaction: 'thumbs_up' }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ reactions });
    expect(service.addReaction).toHaveBeenCalledWith(MESSAGE, 'user-1', 'thumbs_up');
  });

  it('ignores unrelated null keys', async () => {
    const res = await addReaction(request('POST', { reaction: 'heart', note: null }), ctx);
    expect(res.status).toBe(200);
  });

  it('still requires a known reaction: null and unknown values are 400', async () => {
    for (const bad of [{ reaction: null }, {}, { reaction: 'party' }]) {
      const res = await addReaction(request('POST', bad), ctx);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toMatch(/^reaction: /);
      expect(body.error.details.reaction).toBeTruthy();
    }
    expect(service.addReaction).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/mobile/messages/[id]', () => {
  it('accepts the edit body and returns { message } untouched', async () => {
    const res = await editMessage(request('PATCH', { body: '  edited  ' }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ message });
    expect(service.editMessage).toHaveBeenCalledWith('user-1', MESSAGE, 'edited');
  });

  it('still requires a non-empty body of at most 2000 characters', async () => {
    for (const bad of [{ body: null }, {}, { body: '   ' }, { body: 'x'.repeat(2001) }]) {
      const res = await editMessage(request('PATCH', bad), ctx);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toMatch(/^body: /);
    }
    expect(service.editMessage).not.toHaveBeenCalled();
  });
});

describe('Chat Reactions v2 routes', () => {
  it('PUT sets the reaction, canonicalising a named-kind emoji to the kind', async () => {
    const res = await setReaction(request('PUT', { reaction: '👏' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['data', 'error', 'meta', 'success']);
    expect(body.data).toEqual({ reactions });
    expect(service.setReaction).toHaveBeenCalledWith(MESSAGE, 'user-1', 'clap');
  });

  it('PUT accepts the new muscle kind and a single custom emoji', async () => {
    expect((await setReaction(request('PUT', { reaction: 'muscle' }), ctx)).status).toBe(200);
    expect((await setReaction(request('PUT', { reaction: '🥳' }), ctx)).status).toBe(200);
    expect(service.setReaction).toHaveBeenLastCalledWith(MESSAGE, 'user-1', '🥳');
  });

  it('PUT rejects text and multiple emoji with VALIDATION_ERROR', async () => {
    for (const bad of [{ reaction: 'party' }, { reaction: '👏👏' }, { reaction: 7 }, {}]) {
      const res = await setReaction(request('PUT', bad), ctx);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.reaction).toBeTruthy();
    }
    expect(service.setReaction).not.toHaveBeenCalled();
  });

  it('legacy POST accepts custom emoji too (replace semantics live in the service)', async () => {
    const res = await addReaction(request('POST', { reaction: '🔥' }), ctx);
    expect(res.status).toBe(200);
    expect(service.addReaction).toHaveBeenCalledWith(MESSAGE, 'user-1', 'flame');
  });

  it('DELETE (no suffix) clears the viewer reaction', async () => {
    const res = await clearReaction(request('DELETE'), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ reactions: [] });
    expect(service.clearReaction).toHaveBeenCalledWith(MESSAGE, 'user-1');
  });

  it('GET returns reactors', async () => {
    const res = await listReactors(request('GET'), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ reactors });
    expect(service.listReactors).toHaveBeenCalledWith(MESSAGE, 'user-1');
  });

  it('maps service errors: 401 / 403 / 404 / 409', async () => {
    expect((await listReactors(new Request('http://x', { method: 'GET' }) as any, ctx)).status).toBe(401);
    service.listReactors.mockRejectedValueOnce(new Error('Forbidden'));
    expect((await listReactors(request('GET'), ctx)).status).toBe(403);
    service.clearReaction.mockRejectedValueOnce(new Error('NotFound'));
    expect((await clearReaction(request('DELETE'), ctx)).status).toBe(404);
    service.setReaction.mockRejectedValueOnce(new Error('MessageDeleted'));
    const res = await setReaction(request('PUT', { reaction: 'clap' }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('MESSAGE_DELETED');
  });

  it('legacy DELETE /[reaction] accepts kinds and (encoded) emoji, rejects text', async () => {
    const at = (reaction: string) => ({ params: Promise.resolve({ id: MESSAGE, reaction }) });
    expect((await removeOneReaction(request('DELETE'), at('heart'))).status).toBe(200);
    expect(service.removeReaction).toHaveBeenLastCalledWith(MESSAGE, 'user-1', 'heart');
    expect((await removeOneReaction(request('DELETE'), at(encodeURIComponent('🥳')))).status).toBe(200);
    expect(service.removeReaction).toHaveBeenLastCalledWith(MESSAGE, 'user-1', '🥳');
    const bad = await removeOneReaction(request('DELETE'), at('party'));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('VALIDATION_ERROR');
  });
});
