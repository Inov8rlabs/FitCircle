import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReferralFakeDb, getReferralDb, setReferralDb } from '@/lib/services/__tests__/referral-fake-db';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getReferralDb().client() }));
vi.mock('@/lib/services/entitlement-service', () => ({ EntitlementService: { isFeatureAllowed: async () => false } }));
vi.mock('@/lib/services/dietary-preferences-service', () => ({ DietaryPreferencesService: { getPrefs: async () => ({ diet: 'none', allergens: [] }) } }));
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async (request: Request) => {
    const auth = request.headers.get('authorization') ?? '';
    const id = auth.startsWith('Bearer user:') ? auth.slice('Bearer user:'.length) : null;
    const profile = id ? getReferralDb().profile(id) : null;
    if (!profile) throw new Error('Unauthorized');
    return { ...profile };
  },
}));
const ai = vi.hoisted(() => ({ generate: [] as string[], stream: [] as string[][] }));
vi.mock('ai', () => ({
  generateText: async () => ({ text: ai.generate.shift() ?? 'ok.', usage: { inputTokens: 10, outputTokens: 5 } }),
  streamText: () => {
    const chunks = ai.stream.shift() ?? ['ok.'];
    async function* gen() {
      for (const c of chunks) yield c;
    }
    return { textStream: gen(), usage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }) };
  },
}));

import { POST as legacyChat } from '../chat/route';
import { POST as streamChat } from '../chat/stream/route';
import { GET as listConversations } from '../conversations/route';
import { GET as getMemory } from '../memory/route';
import { GET as getPlan, POST as postPlan } from '../plan/route';
import { GET as today } from '../today/route';

const FREE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db: ReferralFakeDb;

const req = (url: string, o: { as?: string; method?: string; body?: unknown } = {}) =>
  new NextRequest(`https://www.fitcircle.ai${url}`, {
    method: o.method ?? 'GET',
    headers: { ...(o.as ? { authorization: `Bearer user:${o.as}` } : {}), 'content-type': 'application/json', 'x-client-timezone': 'UTC' },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });

/** Parse an SSE body into [{event, data}] (+ comment lines). */
async function sse(res: Response) {
  const text = await res.text();
  return {
    text,
    events: text
      .split('\n\n')
      .filter((b) => b.startsWith('event:'))
      .map((b) => {
        const [e, d] = b.split('\n');
        return { event: e.slice(7), data: JSON.parse(d.slice(6)) };
      }),
  };
}

beforeEach(() => {
  db = new ReferralFakeDb();
  setReferralDb(db);
  ai.generate.length = 0;
  ai.stream.length = 0;
  db.addProfile({ id: FREE, display_name: 'Sam', subscription_tier: 'free' });
  db.addProfile({ id: PRO, display_name: 'Ani', subscription_tier: 'premium' });
  db.rows('feature_gates').push({ feature_key: 'fitzy_unlimited', required_tier: 'premium' });
});

describe('POST /api/mobile/fitzy/chat/stream', () => {
  it('streams meta → delta → done with SSE headers', async () => {
    ai.stream.push(['Nice work today! ', 'A 15-minute walk after dinner ', 'is a lovely habit.', '\n<<<FITZY_META>>>{"suggestions":["Walk ideas?"],"actions":[]}']);
    const res = await streamChat(req('/api/mobile/fitzy/chat/stream', { as: FREE, method: 'POST', body: { message: 'Evening routine idea?' } }));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    const { events, text } = await sse(res);
    expect(events.map((e) => e.event)).toEqual(['meta', 'delta', 'delta', 'done']);
    expect(events[0].data).toMatchObject({ tier: 'free', remaining: 4, conversationId: expect.any(String) });
    expect(events[3].data).toMatchObject({ answer: 'Nice work today! A 15-minute walk after dinner is a lovely habit.', suggestions: ['Walk ideas?'], remaining: 4 });
    expect(text).not.toContain('FITZY_META');
  });

  it('quota → single error event with the paywall; bad body → VALIDATION_ERROR; no auth → UNAUTHORIZED', async () => {
    for (let i = 0; i < 5; i++) db.rows('fitzy_message_log').push({ user_id: FREE, created_at: new Date().toISOString() });
    let { events } = await sse(await streamChat(req('/api/mobile/fitzy/chat/stream', { as: FREE, method: 'POST', body: { message: 'hi' } })));
    expect(events).toEqual([
      {
        event: 'error',
        data: {
          code: 'UPGRADE_REQUIRED',
          message: expect.any(String),
          paywall: { trigger: 'fitzy_quota', headline: 'Keep the momentum going', bullets: expect.arrayContaining([expect.any(String)]), cta: 'Unlock Fitzy Pro' },
        },
      },
    ]);
    expect(events[0].data.paywall.bullets).toHaveLength(3);
    ({ events } = await sse(await streamChat(req('/api/mobile/fitzy/chat/stream', { as: PRO, method: 'POST', body: { message: '' } }))));
    expect(events[0]).toMatchObject({ event: 'error', data: { code: 'VALIDATION_ERROR' } });
    ({ events } = await sse(await streamChat(req('/api/mobile/fitzy/chat/stream', { method: 'POST', body: { message: 'hi' } }))));
    expect(events[0]).toMatchObject({ event: 'error', data: { code: 'UNAUTHORIZED' } });
  });
});

describe('POST /api/mobile/fitzy/chat (old route)', () => {
  it('old request shape still works and gains the v2 fields', async () => {
    ai.generate.push('Try oats with berries.\n<<<FITZY_META>>>{"suggestions":["More breakfasts?"],"actions":[{"type":"log_meal","label":"Log breakfast"}]}');
    const res = await legacyChat(req('/api/mobile/fitzy/chat', { as: FREE, method: 'POST', body: { messages: [{ role: 'user', content: 'Breakfast idea?' }] } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      answer: 'Try oats with berries.',
      disclaimer: expect.stringContaining('not medical'),
      conversationId: expect.any(String),
      messageId: expect.any(String),
      suggestions: ['More breakfasts?'],
      actions: [{ type: 'log_meal', label: 'Log breakfast' }],
      remaining: 4,
      tier: 'free',
    });
  });

  it('429 UPGRADE_REQUIRED keeps its old shape and adds the paywall', async () => {
    for (let i = 0; i < 5; i++) db.rows('fitzy_message_log').push({ user_id: FREE, created_at: new Date().toISOString() });
    const res = await legacyChat(req('/api/mobile/fitzy/chat', { as: FREE, method: 'POST', body: { messages: [{ role: 'user', content: 'hi' }] } }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: 'UPGRADE_REQUIRED', details: { feature: 'fitzy_unlimited', used: 5, limit: 5, paywall: { trigger: 'fitzy_quota' } } });
  });
});

describe('locked Pro surfaces for free users', () => {
  it('plan preview, memory, history and today', async () => {
    ai.generate.push(JSON.stringify({ goal: 'Move a little every day', commitments: [{ kind: 'move', title: '3 walks', detail: 'Any pace.', count: 3 }, { kind: 'sleep', title: 'Bed by 11, 3 nights', detail: 'Wind down.', count: 3 }, { kind: 'hydrate', title: 'Water with lunch 5 days', detail: 'A glass.', count: 5 }] }));
    const plan = await (await getPlan(req('/api/mobile/fitzy/plan', { as: FREE }))).json();
    expect(plan.data).toMatchObject({ plan: null, locked: true, preview: { goal: 'Move a little every day', firstCommitment: { title: '3 walks' }, moreCount: 2 }, paywall: { trigger: 'weekly_plan', headline: 'Your plan is ready' } });
    const posted = await (await postPlan(req('/api/mobile/fitzy/plan', { as: FREE, method: 'POST', body: { goal: 'run' } }))).json();
    expect(posted.data.locked).toBe(true);

    const mem = await (await getMemory(req('/api/mobile/fitzy/memory', { as: FREE }))).json();
    expect(mem.data).toMatchObject({ items: [], locked: true, paywall: { trigger: 'memory', headline: 'Fitzy can remember what matters to you' } });
    const proMem = await (await getMemory(req('/api/mobile/fitzy/memory', { as: PRO }))).json();
    expect(proMem.data).toEqual({ items: [], locked: false });

    const conv = await (await listConversations(req('/api/mobile/fitzy/conversations', { as: FREE }))).json();
    expect(conv.data).toMatchObject({ conversations: [], historyLocked: true, paywall: { trigger: 'history' } });

    const focus = await (await today(req('/api/mobile/fitzy/today', { as: FREE }))).json();
    expect(focus.data).toMatchObject({ kind: 'welcome', tier: 'free', cta: { label: 'Make this my plan', action: { type: 'start_plan' } } });
  });
});
