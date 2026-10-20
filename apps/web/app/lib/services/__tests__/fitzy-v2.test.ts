import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => getReferralDb().client() }));
vi.mock('../entitlement-service', () => ({ EntitlementService: { isFeatureAllowed: async () => false } }));
vi.mock('../dietary-preferences-service', () => ({ DietaryPreferencesService: { getPrefs: async () => ({ diet: 'none', allergens: [] }) } }));

/** Scripted model: each call pops the next behaviour for that model id. */
const ai = vi.hoisted(() => ({
  calls: [] as Array<{ fn: 'generate' | 'stream'; model: string; messages: any[]; opts: any }>,
  generate: new Map<string, Array<string | Error | { text: string; finishReason: string }>>(),
  stream: new Map<string, Array<string[] | Error | { chunks: string[]; failAfter: number }>>(),
}));
vi.mock('ai', () => ({
  generateText: async (opts: any) => {
    ai.calls.push({ fn: 'generate', model: opts.model, messages: opts.messages, opts });
    const next = ai.generate.get(opts.model)?.shift();
    if (next === undefined) throw new Error(`no scripted reply for ${opts.model}`);
    if (next instanceof Error) throw next;
    if (typeof next === 'object') return { text: next.text, finishReason: next.finishReason, usage: { inputTokens: 1200, outputTokens: 900 } };
    return { text: next, finishReason: 'stop', usage: { inputTokens: 1200, outputTokens: 90 } };
  },
  streamText: (opts: any) => {
    ai.calls.push({ fn: 'stream', model: opts.model, messages: opts.messages, opts });
    const next = ai.stream.get(opts.model)?.shift();
    async function* gen() {
      if (next === undefined) throw new Error(`no scripted stream for ${opts.model}`);
      if (next instanceof Error) throw next;
      const chunks = Array.isArray(next) ? next : next.chunks;
      for (const [i, c] of chunks.entries()) {
        if (!Array.isArray(next) && i === next.failAfter) throw new Error('stream dropped');
        yield c;
      }
    }
    return { textStream: gen(), usage: Promise.resolve({ inputTokens: 1500, outputTokens: 120 }) };
  },
}));

import { META_MARKER, applyGuardrails, growthNudgeAllowed, parseMeta, splitMeta } from '../../fitzy/meta';
import { CACHE_EPHEMERAL, DEFAULT_CHAT_MODEL, DEFAULT_DEEP_MODEL, thinkingOptions } from '../../fitzy/models';
import { StreamGuard } from '../../fitzy/stream-guard';
import { FitzyConversationService } from '../fitzy-conversation-service';
import { FitzyFocusService, fitBody } from '../fitzy-focus-service';
import { FitzyMemoryService, MEMORY_CAP, isExcludedMemory } from '../fitzy-memory-service';
import { FitzyPlanService, sanitizeCommitments } from '../fitzy-plan-service';
import { FitzyService, SAFE_FALLBACK, SYSTEM_PROMPT, setFitzyBackgroundScheduler, type FitzyStreamEvent } from '../fitzy-service';
import { UpgradeRequiredError } from '../usage-service';

import { ReferralFakeDb, getReferralDb, setReferralDb } from './referral-fake-db';

const FREE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db: ReferralFakeDb;
const background: Array<() => Promise<unknown>> = [];
const meta = (o: unknown) => `\n${META_MARKER}\n${JSON.stringify(o)}`;
const guard = (t: string) => FitzyService.containsForbiddenContent(t);

beforeEach(() => {
  db = new ReferralFakeDb();
  setReferralDb(db);
  ai.calls.length = 0;
  ai.generate.clear();
  ai.stream.clear();
  background.length = 0;
  setFitzyBackgroundScheduler((fn) => void background.push(fn));
  db.addProfile({ id: FREE, display_name: 'Sam Lee', subscription_tier: 'free' });
  db.addProfile({ id: PRO, display_name: 'Ani Rao', subscription_tier: 'premium' });
  db.rows('feature_gates').push({ feature_key: 'fitzy_unlimited', required_tier: 'premium' });
  db.rows('engagement_streaks').push({ user_id: PRO, current_streak: 9 });
  delete process.env.FITZY_CHAT_MODEL;
  delete process.env.FITZY_DEEP_MODEL;
});
afterEach(() => vi.useRealTimers());

// ---------------------------------------------------------------- routing + caching
describe('model routing, fallback, caching', () => {
  it('chat uses Haiku with a cached static system message + uncached grounding', async () => {
    ai.generate.set(DEFAULT_CHAT_MODEL, [`Great question!${meta({ suggestions: ['More ideas?'], actions: [] })}`]);
    const res = await FitzyService.chat(PRO, [{ role: 'user', content: 'Give me a dinner idea' }]);
    const call = ai.calls[0];
    expect(call.model).toBe('anthropic/claude-haiku-5.5');
    expect(call.opts.allowSystemInMessages).toBe(true);
    expect(call.opts.timeout).toBe(25_000);
    expect(call.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT, providerOptions: CACHE_EPHEMERAL });
    expect(CACHE_EPHEMERAL).toEqual({ anthropic: { cacheControl: { type: 'ephemeral' } } });
    expect(call.messages[1].role).toBe('system');
    expect(call.messages[1].providerOptions).toBeUndefined();
    expect(call.messages[1].content).toContain("first name is Ani");
    expect(call.messages[1].content).toContain('streak: 9 days');
    expect(call.messages.at(-1)).toEqual({ role: 'user', content: 'Give me a dinner idea' });
    expect(res).toMatchObject({ answer: 'Great question!', suggestions: ['More ideas?'], actions: [], tier: 'pro', remaining: null });
    expect(SYSTEM_PROMPT).toContain('Keep replies under ~170 words');
    expect(SYSTEM_PROMPT).toContain('NEVER prescribe, recommend, or calculate a calorie deficit');
    // tokens + model recorded on the assistant message
    expect(db.rows('fitzy_messages').find((m) => m.role === 'assistant')).toMatchObject({ model: DEFAULT_CHAT_MODEL, input_tokens: 1200, output_tokens: 90 });
  });

  it('falls back to the other model once, then SAFE_FALLBACK', async () => {
    ai.generate.set(DEFAULT_CHAT_MODEL, [new Error('timeout')]);
    ai.generate.set(DEFAULT_DEEP_MODEL, ['Sonnet saved the day.']);
    const ok = await FitzyService.chat(FREE, [{ role: 'user', content: 'hi' }]);
    expect(ai.calls.map((c) => c.model)).toEqual([DEFAULT_CHAT_MODEL, DEFAULT_DEEP_MODEL]);
    expect(ok.answer).toBe('Sonnet saved the day.');

    ai.calls.length = 0;
    ai.generate.set(DEFAULT_CHAT_MODEL, [new Error('down')]);
    ai.generate.set(DEFAULT_DEEP_MODEL, [new Error('down too')]);
    const safe = await FitzyService.chat(FREE, [{ role: 'user', content: 'hi again' }]);
    expect(safe.answer).toBe(SAFE_FALLBACK);
    expect(safe.actions).toEqual([]);
  });

  it('env overrides the models', async () => {
    process.env.FITZY_CHAT_MODEL = 'anthropic/claude-haiku-4.5';
    ai.generate.set('anthropic/claude-haiku-4.5', ['ok.']);
    await FitzyService.chat(FREE, [{ role: 'user', content: 'hi' }]);
    expect(ai.calls[0].model).toBe('anthropic/claude-haiku-4.5');
  });

  it('guard trips on unsafe model output (non-stream)', async () => {
    ai.generate.set(DEFAULT_CHAT_MODEL, ['Try a calorie deficit of 500 a day.']);
    const res = await FitzyService.chat(FREE, [{ role: 'user', content: 'lose weight fast?' }]);
    expect(res.answer).toBe(SAFE_FALLBACK);
    expect(db.rows('fitzy_messages').find((m) => m.role === 'assistant')).toMatchObject({ guard_tripped: true });
  });
});

// ---------------------------------------------------------------- streaming
async function collect(userId: string, input: Parameters<typeof FitzyService.streamChat>[1]) {
  const events: FitzyStreamEvent[] = [];
  await FitzyService.streamChat(userId, input, (e) => events.push(e));
  return events;
}

describe('SSE streaming', () => {
  it('meta → sentence deltas → done; meta block never streamed', async () => {
    ai.stream.set(DEFAULT_CHAT_MODEL, [
      ['Hey Sam! ', 'A brisk 20-minute', ' walk is a great start. Want', ' a stretch routine too?', `\n${META_MARKER}`, '\n{"suggestions":["Stretch ideas?"],"actions":[{"type":"log_workout","label":"Log a walk"}]}'],
    ]);
    const events = await collect(FREE, { message: 'Quick workout idea?' });
    expect(events.map((e) => e.event)).toEqual(['meta', 'delta', 'delta', 'delta', 'done']);
    expect(events[0].data).toMatchObject({ tier: 'free', remaining: 4 });
    const deltas = events.filter((e) => e.event === 'delta').map((e) => (e.data as any).text);
    expect(deltas.join('')).toBe('Hey Sam! A brisk 20-minute walk is a great start. Want a stretch routine too?');
    expect(deltas.join('')).not.toContain('FITZY_META');
    const done = events.at(-1)!.data as any;
    expect(done).toMatchObject({ answer: deltas.join(''), suggestions: ['Stretch ideas?'], actions: [{ type: 'log_workout', label: 'Log a walk' }], remaining: 4 });
    expect(done.disclaimer).toContain('not medical');
    const conv = db.rows('fitzy_conversations')[0];
    expect(conv).toMatchObject({ user_id: FREE, title: 'Quick workout idea?' });
    expect(db.rows('fitzy_messages').map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('never emits the unsafe sentence: replace after earlier safe text', async () => {
    ai.stream.set(DEFAULT_CHAT_MODEL, [['You are doing great. ', 'Honestly you should skip breakfast ', 'tomorrow. Then more.']]);
    const events = await collect(FREE, { message: 'help' });
    const seq = events.map((e) => e.event);
    expect(seq).toEqual(['meta', 'delta', 'replace', 'done']);
    expect((events[1].data as any).text).toBe('You are doing great.');
    expect((events[2].data as any).text).toBe(SAFE_FALLBACK);
    expect(JSON.stringify(events)).not.toMatch(/skip breakfast/);
    expect((events.at(-1)!.data as any)).toMatchObject({ answer: SAFE_FALLBACK, actions: [] });
  });

  it('unsafe first sentence → single safe delta, no replace', async () => {
    ai.stream.set(DEFAULT_CHAT_MODEL, [['Eat less and run a calorie deficit. ', 'Bye.']]);
    const events = await collect(FREE, { message: 'help' });
    expect(events.map((e) => e.event)).toEqual(['meta', 'delta', 'done']);
    expect((events[1].data as any).text).toBe(SAFE_FALLBACK);
  });

  it('stream failure before any text falls back to the other model; mid-answer failure replaces', async () => {
    ai.stream.set(DEFAULT_CHAT_MODEL, [new Error('gateway 500')]);
    ai.stream.set(DEFAULT_DEEP_MODEL, [['From Sonnet. ', 'All good.']]);
    let events = await collect(FREE, { message: 'hi' });
    expect(events.filter((e) => e.event === 'delta').map((e) => (e.data as any).text).join('')).toBe('From Sonnet. All good.');
    expect(db.rows('fitzy_messages').find((m) => m.role === 'assistant')!.model).toBe(DEFAULT_DEEP_MODEL);

    ai.stream.set(DEFAULT_CHAT_MODEL, [{ chunks: ['First sentence. ', 'second never', ' arrives.'], failAfter: 1 }]);
    events = await collect(FREE, { message: 'hi' });
    expect(events.map((e) => e.event)).toEqual(['meta', 'delta', 'replace', 'done']);
  });

  it('quota exhausted → UpgradeRequiredError before any event', async () => {
    for (let i = 0; i < 5; i++) db.rows('fitzy_message_log').push({ user_id: FREE, created_at: new Date().toISOString() });
    const events: FitzyStreamEvent[] = [];
    await expect(FitzyService.streamChat(FREE, { message: 'hi' }, (e) => events.push(e))).rejects.toBeInstanceOf(UpgradeRequiredError);
    expect(events).toEqual([]);
  });

  it('server-held history wins with conversationId; clientMessages seed a new conversation once', async () => {
    ai.stream.set(DEFAULT_CHAT_MODEL, [['First answer.'], ['Second answer.']]);
    const first = await collect(PRO, {
      message: 'And for lunch?',
      clientMessages: [
        { role: 'user', content: 'Breakfast idea?' },
        { role: 'assistant', content: 'Oats with berries.' },
      ],
    });
    const conversationId = (first[0].data as any).conversationId;
    expect(ai.calls[0].messages.slice(2)).toEqual([
      { role: 'user', content: 'Breakfast idea?' },
      { role: 'assistant', content: 'Oats with berries.' },
      { role: 'user', content: 'And for lunch?' },
    ]);
    await collect(PRO, { message: 'Dinner?', conversationId, clientMessages: [{ role: 'user', content: 'IGNORED' }] });
    const turns = ai.calls[1].messages.slice(2).map((m: any) => m.content);
    expect(turns).toEqual(['Breakfast idea?', 'Oats with berries.', 'And for lunch?', 'First answer.', 'Dinner?']);
    expect(db.rows('fitzy_conversations')).toHaveLength(1);
    await expect(collect(FREE, { message: 'x', conversationId })).rejects.toMatchObject({ name: 'FitzyNotFoundError' });
  });

  it('StreamGuard holds back partial markers and only emits at sentence boundaries', () => {
    const g = new StreamGuard(guard, SAFE_FALLBACK);
    expect(g.push('Hello there')).toEqual([]);
    expect(g.push('. How are')).toEqual([{ type: 'delta', text: 'Hello there.' }]);
    expect(g.push(' you?\n<<<FIT')).toEqual([{ type: 'delta', text: ' How are you?\n' }]);
    expect(g.push('ZY_META>>>{"suggestions":[]}')).toEqual([]);
    expect(g.finish()).toEqual([]);
    expect(g.emittedText).toBe('Hello there. How are you?\n');
  });
});

// ---------------------------------------------------------------- meta + guardrails
describe('meta parsing + growth guardrails', () => {
  it('parses tolerantly and validates', () => {
    expect(splitMeta(`Answer.${meta({ a: 1 })}`).answer).toBe('Answer.');
    const p = parseMeta('```json\n{"suggestions":["ok","' + 'x'.repeat(41) + '",3],"actions":[{"type":"log_meal","label":"Log lunch"},{"type":"hack","label":"x"},{"type":"invite_buddy","label":"' + 'y'.repeat(29) + '"},],}\n```');
    expect(p).toMatchObject({ ok: true, suggestions: ['ok'], actions: [{ type: 'log_meal', label: 'Log lunch' }] });
    expect(parseMeta('not json').ok).toBe(false);
  });

  it('drops share_tip in sensitive contexts and invite_buddy when not allowed', () => {
    const actions = [
      { type: 'share_tip' as const, label: 'Share this tip', payload: { text: 'Add a veggie to every lunch.' } },
      { type: 'invite_buddy' as const, label: 'Invite a buddy' },
    ];
    expect(applyGuardrails(actions, { userMessage: 'lunch ideas', answer: 'Add a veggie.', growthAllowed: true, guard }).map((a) => a.type)).toEqual(['share_tip', 'invite_buddy']);
    expect(applyGuardrails(actions, { userMessage: 'my knee pain when running', answer: 'See a physio.', growthAllowed: false, guard })).toEqual([]);
    expect(applyGuardrails(actions, { userMessage: 'what is my body fat trend', answer: 'x', growthAllowed: true, guard }).map((a) => a.type)).toEqual(['invite_buddy']);
    expect(applyGuardrails([{ type: 'share_tip', label: 'Share', payload: { text: 'Skip breakfast to save calories' } }], { userMessage: 'tip', answer: 'tip', growthAllowed: false, guard })).toEqual([]);
  });

  it('invite_buddy: topic-gated and ≤ 1 per 7 days, stamped when sent', async () => {
    expect(growthNudgeAllowed('dinner ideas', null)).toBe(false);
    expect(growthNudgeAllowed('help me stay consistent', null)).toBe(true);
    expect(growthNudgeAllowed('help me stay consistent', new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe(false);
    expect(growthNudgeAllowed('help me stay consistent', new Date(Date.now() - 8 * 86_400_000).toISOString())).toBe(true);

    const reply = `Consistency beats intensity.${meta({ suggestions: [], actions: [{ type: 'invite_buddy', label: 'Invite a buddy' }] })}`;
    ai.generate.set(DEFAULT_CHAT_MODEL, [reply, reply]);
    const first = await FitzyService.chat(FREE, [{ role: 'user', content: 'How do I stay motivated?' }]);
    expect(first.actions).toEqual([{ type: 'invite_buddy', label: 'Invite a buddy' }]);
    expect(ai.calls[0].messages[1].content).toContain('growthNudgeAllowed: true');
    expect(db.rows('fitzy_memory')[0].last_growth_nudge_at).toBeTruthy();
    const second = await FitzyService.chat(FREE, [{ role: 'user', content: 'Still need motivation' }]);
    expect(second.actions).toEqual([]);
    expect(ai.calls[1].messages[1].content).toContain('growthNudgeAllowed: false');
  });

  it('missing meta → static topic suggestions', async () => {
    ai.generate.set(DEFAULT_CHAT_MODEL, ['Try a bean chili tonight.']);
    const res = await FitzyService.chat(FREE, [{ role: 'user', content: 'vegetarian dinner?' }]);
    expect(res.suggestions).toEqual(['Another quick dinner idea?', 'High-protein breakfast ideas?', 'Make it vegetarian?']);
  });
});

// ---------------------------------------------------------------- conversations
describe('conversations', () => {
  it('free sees only the latest; pro sees all; title trimmed to 48', async () => {
    ai.generate.set(DEFAULT_CHAT_MODEL, ['a.', 'b.', 'c.', 'd.']);
    const long = 'Can you build me a four week plan for running my first 5K this spring?';
    await FitzyService.chat(PRO, [{ role: 'user', content: long }], undefined, { conversationId: null });
    // legacy route reuses a conversation touched in the last 6 hours
    await FitzyService.chat(PRO, [{ role: 'user', content: long }, { role: 'assistant', content: 'a.' }, { role: 'user', content: 'and week 2?' }]);
    expect(db.rows('fitzy_conversations')).toHaveLength(1);
    db.rows('fitzy_conversations')[0].updated_at = new Date(Date.now() - 7 * 3600_000).toISOString();
    await FitzyService.chat(PRO, [{ role: 'user', content: 'New topic' }]);
    const pro = await FitzyConversationService.list(PRO, 'pro');
    expect(pro.conversations).toHaveLength(2);
    expect(pro.historyLocked).toBe(false);
    const titles = db.rows('fitzy_conversations').map((c) => c.title);
    expect(titles[0]).toHaveLength(48);
    expect(titles[0].endsWith('…')).toBe(true);
    const free = await FitzyConversationService.list(PRO, 'free');
    expect(free).toMatchObject({ historyLocked: true, conversations: [{ title: 'New topic', preview: 'c.' }] });
    const older = db.rows('fitzy_conversations')[0].id;
    await expect(FitzyConversationService.get(PRO, 'free', older)).rejects.toMatchObject({ name: 'FitzyLockedError', trigger: 'history' });
    const full = await FitzyConversationService.get(PRO, 'pro', older);
    expect(full.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    await FitzyConversationService.remove(PRO, older);
    await expect(FitzyConversationService.get(PRO, 'pro', older)).rejects.toMatchObject({ name: 'FitzyNotFoundError' });
  });
});

// ---------------------------------------------------------------- daily focus
describe('daily focus', () => {
  const NOW = new Date('2026-10-21T15:00:00Z'); // Wednesday
  const focusJson = JSON.stringify({ kind: 'tip', headline: 'Protein at breakfast', body: 'Add eggs or yogurt to breakfast today. It keeps energy steady.', cta: { label: 'Log breakfast', type: 'log_meal' } });

  it('welcome for new users, generated once per local day and cached', async () => {
    const w = await FitzyFocusService.get(FREE, 'America/Los_Angeles', NOW);
    expect(w).toMatchObject({ kind: 'welcome', date: '2026-10-21', cta: { action: { type: 'start_plan' } }, tier: 'free' });
    expect(ai.calls).toHaveLength(0);

    db.rows('food_log_entries').push({ id: 'f1', user_id: PRO, entry_date: '2026-10-20', calories: 400, deleted_at: null });
    ai.generate.set(DEFAULT_CHAT_MODEL, [focusJson]);
    const f = await FitzyFocusService.get(PRO, 'America/Los_Angeles', NOW);
    expect(f).toMatchObject({ kind: 'tip', headline: 'Protein at breakfast', cta: { label: 'Log breakfast', action: { type: 'log_meal' } }, tier: 'pro' });
    const again = await FitzyFocusService.get(PRO, 'America/Los_Angeles', NOW);
    expect(again).toEqual(f);
    expect(ai.calls).toHaveLength(1);
    expect(db.rows('fitzy_daily')).toHaveLength(2);
  });

  it('free gets the full focus with the start_plan CTA; unsafe output is not cached', async () => {
    db.rows('food_log_entries').push({ id: 'f2', user_id: FREE, entry_date: '2026-10-20', calories: 300, deleted_at: null });
    ai.generate.set(DEFAULT_CHAT_MODEL, [JSON.stringify({ kind: 'tip', headline: 'Try a calorie deficit', body: 'Eat less today.', cta: { label: 'x', type: 'log_meal' } }), focusJson]);
    const unsafe = await FitzyFocusService.get(FREE, 'UTC', NOW);
    expect(unsafe.headline).toBe('A 10-minute walk counts');
    expect(db.rows('fitzy_daily')).toHaveLength(0);
    const ok = await FitzyFocusService.get(FREE, 'UTC', NOW);
    expect(ok).toMatchObject({ headline: 'Protein at breakfast', cta: { label: 'Make this my plan', action: { type: 'start_plan' } } });
  });

  it('Sunday recap for Pro with a plan uses the deep model', async () => {
    const sunday = new Date('2026-10-25T18:00:00Z');
    db.rows('food_log_entries').push({ id: 'f3', user_id: PRO, entry_date: '2026-10-24', calories: 300, deleted_at: null });
    db.rows('fitzy_plans').push({ id: 'p1', user_id: PRO, week_of: '2026-10-19', goal: 'Move more', note: '', is_preview: false, created_at: '', updated_at: '', commitments: [{ id: 'c1', kind: 'move', title: '3 walks', detail: '', target: { count: 3, per: 'week' }, doneDates: ['2026-10-20', '2026-10-22'] }] });
    ai.generate.set(DEFAULT_DEEP_MODEL, [JSON.stringify({ headline: 'Two walks this week!', body: 'You showed up twice. Carry one walk into Monday.' })]);
    const recap = await FitzyFocusService.get(PRO, 'America/New_York', sunday);
    expect(recap).toMatchObject({ kind: 'recap', headline: 'Two walks this week!', cta: { action: { type: 'start_plan' } } });
    expect(ai.calls[0].model).toBe(DEFAULT_DEEP_MODEL);
    expect(ai.calls[0].messages.at(-1).content).toContain('3 walks: 2 of 3 done');
  });
});

// ---------------------------------------------------------------- weekly plan
describe('weekly plan', () => {
  const planJson = JSON.stringify({
    goal: 'Feel energised all week',
    note: 'Small steps add up.',
    commitments: [
      { kind: 'move', title: '3 walks of 15 min', detail: 'Any pace.', count: 3 },
      { kind: 'eat', title: 'Protein at breakfast 4 days', detail: 'Eggs, yogurt or tofu.', count: 4 },
      { kind: 'eat', title: 'Stay under 1500 calories', detail: 'Track it.', count: 7 },
      { kind: 'sleep', title: 'Lights out by 11 on 3 nights', detail: 'Wind down.', count: 3 },
      { kind: 'mind', title: 'x'.repeat(60), detail: 'too long', count: 2 },
    ],
  });

  it('pro: Sonnet plan, prohibited commitments dropped, check-off within the week', async () => {
    ai.generate.set(DEFAULT_DEEP_MODEL, [planJson]);
    const plan = await FitzyPlanService.create(PRO, '2026-10-21', 'more energy', await FitzyService.grounding(PRO, 'pro'), guard);
    expect(ai.calls[0].model).toBe(DEFAULT_DEEP_MODEL);
    expect(plan).toMatchObject({ weekOf: '2026-10-19', goal: 'Feel energised all week' });
    expect(plan.commitments.map((c) => c.title)).toEqual(['3 walks of 15 min', 'Protein at breakfast 4 days', 'Lights out by 11 on 3 nights']);
    const c = plan.commitments[0];
    let checked = await FitzyPlanService.check(PRO, c.id, '2026-10-20', true, '2026-10-21', true);
    checked = await FitzyPlanService.check(PRO, c.id, '2026-10-21', true, '2026-10-21', true);
    expect(checked.commitments[0].doneDates).toEqual(['2026-10-20', '2026-10-21']);
    checked = await FitzyPlanService.check(PRO, c.id, '2026-10-20', false, '2026-10-21', true);
    expect(checked.commitments[0].doneDates).toEqual(['2026-10-21']);
    await expect(FitzyPlanService.check(PRO, c.id, '2026-10-27', true, '2026-10-21', true)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(FitzyPlanService.check(FREE, c.id, '2026-10-20', true, '2026-10-21', false)).rejects.toMatchObject({ name: 'FitzyLockedError', trigger: 'weekly_plan' });
    expect(FitzyPlanService.progressLine(checked)).toContain('3 walks of 15 min: 1 of 3 done');
  });

  it('free: Haiku teaser cached for the week (goal + first commitment + N more)', async () => {
    ai.generate.set(DEFAULT_CHAT_MODEL, [planJson]);
    const preview = await FitzyPlanService.preview(FREE, '2026-10-21', null, 'g', guard);
    expect(ai.calls[0].model).toBe(DEFAULT_CHAT_MODEL);
    expect(preview).toMatchObject({ goal: 'Feel energised all week', firstCommitment: { title: '3 walks of 15 min' }, moreCount: 2 });
    const again = await FitzyPlanService.preview(FREE, '2026-10-23', 'other goal', 'g', guard);
    expect(again).toEqual(preview);
    expect(ai.calls).toHaveLength(1);
    expect(await FitzyPlanService.current(FREE, '2026-10-21')).toBeNull(); // a preview isn't a plan
  });

  it('model failure → safe default commitments', async () => {
    ai.generate.set(DEFAULT_DEEP_MODEL, [new Error('x')]);
    ai.generate.set(DEFAULT_CHAT_MODEL, [new Error('y')]);
    const plan = await FitzyPlanService.create(PRO, '2026-10-21', null, 'g', guard);
    expect(plan.commitments).toHaveLength(3);
    expect(plan.commitments.every((c) => !guard(`${c.title} ${c.detail}`))).toBe(true);
  });
});

// ---------------------------------------------------------------- memory
describe('memory (Pro)', () => {
  it('extracts after a Pro turn, enforcing exclusions, dedupe and the cap', async () => {
    expect(isExcludedMemory('Takes metformin for diabetes')).toBe(true);
    expect(isExcludedMemory('Weighs 80 kg')).toBe(true);
    expect(isExcludedMemory('Has a sore knee')).toBe(true);
    expect(isExcludedMemory('My wife hates running')).toBe(true);
    expect(isExcludedMemory('Prefers morning workouts')).toBe(false);

    ai.generate.set(DEFAULT_CHAT_MODEL, [
      'Morning workouts are a great habit.',
      JSON.stringify({ items: [{ text: 'Prefers morning workouts', kind: 'routine' }, { text: 'Has asthma', kind: 'constraint' }, { text: 'Has dumbbells at home', kind: 'preference' }] }),
    ]);
    const free = await FitzyService.chat(FREE, [{ role: 'user', content: 'hi' }]).catch(() => null);
    expect(background).toHaveLength(0); // free never extracts
    void free;
    ai.generate.set(DEFAULT_CHAT_MODEL, [
      'Morning workouts are a great habit.',
      JSON.stringify({ items: [{ text: 'Prefers morning workouts', kind: 'routine' }, { text: 'Has asthma', kind: 'constraint' }, { text: 'Has dumbbells at home', kind: 'preference' }] }),
    ]);
    await FitzyService.chat(PRO, [{ role: 'user', content: 'I like working out at 6am with my dumbbells' }]);
    expect(background).toHaveLength(1);
    await background[0]();
    const items = await FitzyMemoryService.items(PRO);
    expect(items.map((i) => i.text)).toEqual(['Prefers morning workouts', 'Has dumbbells at home']);

    // dedupe + cap
    const existing = Array.from({ length: MEMORY_CAP }, (_, i) => ({ id: `m${i}`, text: `Item ${i}`, kind: 'preference', createdAt: '' }));
    db.rows('fitzy_memory')[0].items = existing;
    ai.generate.set(DEFAULT_CHAT_MODEL, [JSON.stringify({ items: [{ text: 'Item 3', kind: 'preference' }, { text: 'Loves spicy food', kind: 'preference' }] })]);
    const next = await FitzyMemoryService.extract(PRO, 'I love spicy food', 'Nice', guard);
    expect(next).toHaveLength(MEMORY_CAP);
    expect(next.at(-1)!.text).toBe('Loves spicy food');
    expect(next[0].text).toBe('Item 1'); // oldest dropped
    // memory is in Pro grounding
    expect(await FitzyService.grounding(PRO, 'pro')).toContain('Loves spicy food');
    expect(await FitzyService.grounding(PRO, 'free')).not.toContain('Loves spicy food');

    await FitzyMemoryService.remove(PRO, next[0].id);
    expect(await FitzyMemoryService.items(PRO)).toHaveLength(MEMORY_CAP - 1);
    await FitzyMemoryService.clear(PRO);
    expect(await FitzyMemoryService.items(PRO)).toEqual([]);
  });
});

describe('bake-off fixes (2026-10-20)', () => {
  it('structured tasks disable Anthropic thinking; chat keeps the default', () => {
    expect(thinkingOptions('anthropic/claude-sonnet-5.5', false)).toEqual({ providerOptions: { anthropic: { thinking: { type: 'disabled' } } } });
    expect(thinkingOptions('anthropic/claude-haiku-5.5', true)).toEqual({});
    expect(thinkingOptions('google/gemini-3.8-flash', false)).toEqual({});
  });

  it('plan filter keeps equipment weights but still drops body-weight targets', () => {
    const c = (title: string) => ({ kind: 'move', title, detail: '', count: 2 });
    const kept = sanitizeCommitments(
      { commitments: [c('Strength with your 5 kg weights'), c('Weighted vest walk'), c('Lose 2 kg this week'), c('Daily weigh-in'), c('Hit your weight goal')] },
      () => false
    ).map((x) => x.title);
    expect(kept).toEqual(['Strength with your 5 kg weights', 'Weighted vest walk']);
  });

  it('plan filter: kind "skip it" phrasing and kettlebells survive; skipping meals does not', () => {
    const c = (title: string) => ({ kind: 'move', title, detail: '', count: 2 });
    const kept = sanitizeCommitments(
      { commitments: [c('Walk 15 min, win or skip'), c('Skip it any day you need rest'), c('Keep your 12 kg bell going'), c('Skip breakfast twice'), c('Skip your evening snack')] },
      () => false
    ).map((x) => x.title);
    expect(kept).toEqual(['Walk 15 min, win or skip', 'Skip it any day you need rest', 'Keep your 12 kg bell going']);
  });

  it('plan filter: "nothing to cut out" passes; over-long details are trimmed, not dropped', () => {
    const kept = sanitizeCommitments(
      {
        commitments: [
          { kind: 'eat', title: 'Add protein at breakfast 4 days', detail: 'Try yogurt, eggs, tofu scramble, or a lentil wrap. Add it in, nothing to cut out.', count: 4 },
          { kind: 'eat', title: 'Add something you enjoy at breakfast', detail: 'Add one thing you like to your first meal, such as fruit, yogurt, eggs, nuts, or toast with something tasty. Nothing needs to be swapped out.', count: 3 },
          { kind: 'eat', title: 'Cut out sugar', detail: 'Avoid dessert.', count: 7 },
        ],
      },
      () => false
    );
    expect(kept.map((x) => x.title)).toEqual(['Add protein at breakfast 4 days', 'Add something you enjoy at breakfast']);
    expect([...kept[1].detail].length).toBeLessThanOrEqual(140);
    expect(kept[1].detail.endsWith('.')).toBe(true);
  });

  it('daily focus: long bodies are trimmed at a sentence end, not rejected', () => {
    const long = 'Two short walks today will keep your streak glowing and your energy up. ' + 'A walk after lunch is perfect, even ten minutes counts and adds up nicely over the week. ' + 'Bring a friend along if you can, it makes the time fly and keeps you both going strong.';
    const out = fitBody(long, 240)!;
    expect([...out].length).toBeLessThanOrEqual(240);
    expect(out.endsWith('.')).toBe(true);
    expect(fitBody('Short and sweet.', 240)).toBe('Short and sweet.');
    expect(fitBody('x'.repeat(300), 240)).toBeNull();
  });

  it('prompt handles disordered-eating signals without appetite tips', () => {
    expect(SYSTEM_PROMPT).toContain('do NOT give fullness, appetite');
    expect(SYSTEM_PROMPT).toContain('eating-disorder helpline');
  });

  it('prompt tells Fitzy not to echo numbers when declining', () => {
    expect(SYSTEM_PROMPT).toContain("don't repeat the user's specific numbers");
  });
});

// ---------------------------------------------------------------- model-call contracts
// The scripted model above returns whatever it's given, so token budgets and provider options
// were never exercised (a real model with adaptive thinking truncated plan JSON). These pin the
// options every call site sends, and what happens when output is cut off.
describe('model-call contracts', () => {
  const planJson = JSON.stringify({
    goal: 'Feel energised',
    note: 'Small steps.',
    commitments: [
      { kind: 'move', title: '3 walks of 15 min', detail: 'Any pace.', count: 3 },
      { kind: 'eat', title: 'Protein at breakfast', detail: 'Eggs or yogurt.', count: 4 },
      { kind: 'sleep', title: 'Lights out by 11', detail: 'Wind down.', count: 3 },
    ],
  });
  const DISABLED = { anthropic: { thinking: { type: 'disabled' } } };

  it('structured calls (plan, preview, focus, memory) disable thinking with a real token budget', async () => {
    ai.generate.set(DEFAULT_DEEP_MODEL, [planJson]);
    await FitzyPlanService.create(PRO, '2026-10-21', null, 'g', guard);
    ai.generate.set(DEFAULT_CHAT_MODEL, [planJson]);
    await FitzyPlanService.preview(FREE, '2026-10-21', null, 'g', guard);
    db.rows('food_log_entries').push({ id: 'fc', user_id: PRO, entry_date: '2026-10-20', calories: 400, deleted_at: null });
    ai.generate.set(DEFAULT_CHAT_MODEL, [JSON.stringify({ kind: 'tip', headline: 'Protein at breakfast', body: 'Add eggs today.', cta: { label: 'Log breakfast', type: 'log_meal' } })]);
    await FitzyFocusService.get(PRO, 'UTC', new Date('2026-10-21T15:00:00Z'));
    ai.generate.set(DEFAULT_CHAT_MODEL, [JSON.stringify({ items: [] })]);
    await FitzyMemoryService.extract(PRO, 'I like 6am workouts', 'Nice', guard);

    expect(ai.calls).toHaveLength(4);
    for (const c of ai.calls) {
      expect(c.fn).toBe('generate');
      expect(c.opts.providerOptions).toEqual(DISABLED);
      expect(c.opts.maxOutputTokens).toBeGreaterThanOrEqual(200);
    }
    expect(ai.calls[0].opts.maxOutputTokens).toBeGreaterThanOrEqual(900); // full weekly plan
  });

  it('chat (stream and non-stream) keeps the model default (no thinking override)', async () => {
    ai.generate.set(DEFAULT_CHAT_MODEL, ['Hi there.']);
    await FitzyService.chat(FREE, [{ role: 'user', content: 'hi' }]);
    ai.stream.set(DEFAULT_CHAT_MODEL, [['Hello! ', 'Nice to see you.']]);
    await collect(FREE, { message: 'hello' });
    const chatCalls = ai.calls.filter((c) => c.messages[0]?.content === SYSTEM_PROMPT);
    expect(chatCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of chatCalls) expect(c.opts.providerOptions?.anthropic?.thinking).toBeUndefined();
  });

  it('truncated structured output (finishReason length) tries the other model instead of using defaults', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ai.generate.set(DEFAULT_DEEP_MODEL, [{ text: planJson.slice(0, 120), finishReason: 'length' }]);
    ai.generate.set(DEFAULT_CHAT_MODEL, [planJson]);
    const plan = await FitzyPlanService.create(PRO, '2026-10-21', null, 'g', guard);
    expect(ai.calls.map((c) => c.model)).toEqual([DEFAULT_DEEP_MODEL, DEFAULT_CHAT_MODEL]);
    expect(plan.goal).toBe('Feel energised');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hit maxOutputTokens'));
    warn.mockRestore();
  });

  it('both models truncated → safe defaults (never a half-parsed plan)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    ai.generate.set(DEFAULT_DEEP_MODEL, [{ text: planJson.slice(0, 120), finishReason: 'length' }]);
    ai.generate.set(DEFAULT_CHAT_MODEL, [{ text: planJson.slice(0, 150), finishReason: 'length' }]);
    const plan = await FitzyPlanService.create(PRO, '2026-10-21', null, 'g', guard);
    expect(plan.commitments).toHaveLength(3);
    expect(plan.commitments.every((c) => !guard(`${c.title} ${c.detail}`))).toBe(true);
    warn.mockRestore();
  });
});
