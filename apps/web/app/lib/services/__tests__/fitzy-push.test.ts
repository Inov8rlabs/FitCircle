import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Supabase fake: per-table canned results + recorded writes ----------------------------
type Result = { data: any; error: any };
const tables: Record<string, Result> = {};
const inserts: Array<{ table: string; row: any }> = [];
const updates: Array<{ table: string; row: any }> = [];
let insertResult: Result = { data: null, error: null };

function builder(table: string) {
  const res = () => tables[table] ?? { data: [], error: null };
  const b: any = {
    select: () => b,
    eq: () => b,
    in: () => b,
    gte: () => b,
    lte: () => b,
    is: () => b,
    not: () => b,
    order: () => b,
    limit: () => b,
    maybeSingle: () => Promise.resolve(res()),
    single: () => Promise.resolve(res()),
    then: (ok: any, ko: any) => Promise.resolve(res()).then(ok, ko),
    insert: (row: any) => {
      inserts.push({ table, row });
      return Promise.resolve(insertResult);
    },
    update: (row: any) => {
      updates.push({ table, row });
      const u: any = { eq: () => u, then: (ok: any) => Promise.resolve({ error: null }).then(ok) };
      return u;
    },
  };
  return b;
}
vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => ({ from: (t: string) => builder(t) }) }));

const send = vi.fn();
vi.mock('../notification-orchestrator', async (orig) => {
  const real: any = await orig();
  return { ...real, NotificationOrchestrator: { ...real.NotificationOrchestrator, send: (...a: any[]) => send(...a) } };
});
const generate = vi.fn();
vi.mock('../../fitzy/models', async (orig) => ({ ...((await orig()) as any), generateWithFallback: (...a: any[]) => generate(...a) }));
vi.mock('../usage-service', () => ({ UsageService: { fitzyTier: vi.fn(async () => 'free') } }));
vi.mock('../dietary-preferences-service', () => ({ DietaryPreferencesService: { getPrefs: vi.fn(async () => ({ diet: 'vegetarian', allergens: ['nuts'] })) } }));
const focusGet = vi.fn();
vi.mock('../fitzy-focus-service', () => ({ FitzyFocusService: { get: (...a: any[]) => focusGet(...a) } }));
vi.mock('../fitzy-service', async (orig) => {
  const real: any = await orig();
  const guard = (t: string) => real.FitzyService.containsForbiddenContent(t);
  return { ...real, FitzyService: { guard, containsForbiddenContent: guard, grounding: vi.fn(async () => 'GROUNDING') } };
});

import {
  CONTEXTUAL_PER_WEEK,
  FITZY_PUSH_TYPES,
  commonSkip,
  focusPushCopy,
  hydrationCopy,
  hydrationRelevant,
  localParts,
  lockScreenSafe,
  mentionsAllergen,
  morningKind,
  parseNudge,
  proteinBehind,
  proteinIdeas,
  proteinTemplate,
  pushConfig,
  slotForHour,
  weeklyPlanCopy,
  BODY_MAX,
  FOCUS_BODY_MAX,
  TITLE_MAX,
  type CommonContext,
} from '../../fitzy/push';
import { FitzyPushService, proteinDays } from '../fitzy-push-service';
import { PUSH_OPEN_TURN, withUserFirst } from '../fitzy-service';
import { CAP_EXEMPT_TYPES, NOTIFICATION_TEMPLATES, TYPE_SCREEN_MAP, isCapExempt } from '../notification-orchestrator';
import { NotificationPreferencesService } from '../notification-preferences-service';

const guard = (t: string) => /calorie deficit|skip lunch/i.test(t);
const ON = pushConfig({ FITZY_PUSH_ENABLED: 'true' } as any);
const NOW = new Date('2026-10-22T13:10:00Z'); // 09:10 in New York (EDT)

function ctx(over: Partial<CommonContext> = {}): CommonContext {
  return {
    now: NOW,
    startOfDay: new Date('2026-10-22T04:00:00Z'),
    sent: [],
    countsTowardCap: (t) => !CAP_EXEMPT_TYPES.has(t as any),
    coachEnabled: true,
    inQuietHours: false,
    active: true,
    ...over,
  };
}
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

describe('config + kill switch', () => {
  it('is OFF unless FITZY_PUSH_ENABLED is exactly true', () => {
    expect(pushConfig({} as any).enabled).toBe(false);
    expect(pushConfig({ FITZY_PUSH_ENABLED: '1' } as any).enabled).toBe(false);
    expect(ON.enabled).toBe(true);
    expect(commonSkip('fitzy_daily_focus', ctx(), pushConfig({} as any))).toBe('disabled');
  });
  it('parses hours and per-kind disables, ignoring out-of-range values', () => {
    const c = pushConfig({ FITZY_PUSH_ENABLED: 'true', FITZY_FOCUS_LOCAL_HOUR: '7', FITZY_PROTEIN_LOCAL_HOUR: '23', FITZY_PUSH_DISABLED_KINDS: 'fitzy_protein_nudge, x' } as any);
    expect(c.focusHour).toBe(7);
    expect(c.proteinHour).toBe(15);
    expect(commonSkip('fitzy_protein_nudge', ctx(), c)).toBe('kind_disabled');
  });
});

describe('timing windows (local hour)', () => {
  it('maps hours to slots', () => {
    expect(slotForHour(7, ON)).toBeNull();
    for (const h of [8, 9, 10]) expect(slotForHour(h, ON)?.slot).toBe('morning');
    expect(slotForHour(11, ON)?.kind).toBe('fitzy_hydration_nudge');
    expect(slotForHour(12, ON)).toBeNull();
    for (const h of [15, 16]) expect(slotForHour(h, ON)?.kind).toBe('fitzy_protein_nudge');
    for (const h of [13, 14, 17, 18, 19, 22, 0]) expect(slotForHour(h, ON)).toBeNull();
  });
  it('computes local date / hour / weekday in the user timezone', () => {
    expect(localParts('America/New_York', NOW)).toEqual({ date: '2026-10-22', hour: 9, weekday: 4 });
    expect(localParts('Asia/Kolkata', NOW)).toEqual({ date: '2026-10-22', hour: 18, weekday: 4 });
    expect(localParts('Pacific/Auckland', NOW).date).toBe('2026-10-23');
  });
});

describe('shared eligibility, caps, spacing, quiet hours, preference', () => {
  it('respects the coach toggle, quiet hours and activity', () => {
    expect(commonSkip('fitzy_daily_focus', ctx({ coachEnabled: false }), ON)).toBe('coach_off');
    expect(commonSkip('fitzy_daily_focus', ctx({ inQuietHours: true }), ON)).toBe('quiet_hours');
    expect(commonSkip('fitzy_daily_focus', ctx({ active: false }), ON)).toBe('inactive');
    expect(commonSkip('fitzy_daily_focus', ctx(), ON)).toBeNull();
  });
  it('keeps one daily-cap slot free for the evening streak reminder; exempt types do not count', () => {
    const two = [{ type: 'daily_drop', sentAt: ago(300) }, { type: 'campaign', sentAt: ago(240) }];
    expect(commonSkip('fitzy_daily_focus', ctx({ sent: two }), ON)).toBe('cap_budget');
    const one = [{ type: 'daily_drop', sentAt: ago(300) }];
    expect(commonSkip('fitzy_daily_focus', ctx({ sent: one }), ON)).toBeNull();
    const exempt = [{ type: 'chat_message', sentAt: ago(300) }, { type: 'meal_reminder_lunch', sentAt: ago(200) }, { type: 'daily_drop', sentAt: ago(190) }];
    expect(commonSkip('fitzy_daily_focus', ctx({ sent: exempt }), ON)).toBeNull();
    // Yesterday's pushes don't count toward today.
    const yesterday = [{ type: 'daily_drop', sentAt: '2026-10-21T20:00:00Z' }, { type: 'campaign', sentAt: '2026-10-21T21:00:00Z' }];
    expect(commonSkip('fitzy_daily_focus', ctx({ sent: yesterday }), ON)).toBeNull();
  });
  it('waits 90 minutes after any delivered push (meal reminder, campaign, chat …)', () => {
    expect(commonSkip('fitzy_hydration_nudge', ctx({ sent: [{ type: 'chat_message', sentAt: ago(30) }] }), ON)).toBe('spacing');
    expect(commonSkip('fitzy_hydration_nudge', ctx({ sent: [{ type: 'meal_reminder_lunch', sentAt: ago(91) }] }), ON)).toBeNull();
  });
  it('caps each contextual kind per rolling week', () => {
    const sent = Array.from({ length: CONTEXTUAL_PER_WEEK }, (_, i) => ({ type: 'fitzy_protein_nudge', sentAt: ago(1440 * (i + 1)) }));
    expect(commonSkip('fitzy_protein_nudge', ctx({ sent }), ON)).toBe('weekly_cap');
    expect(commonSkip('fitzy_hydration_nudge', ctx({ sent }), ON)).toBeNull();
    const old = [{ type: 'fitzy_protein_nudge', sentAt: ago(1440 * 8) }, { type: 'fitzy_protein_nudge', sentAt: ago(1440 * 9) }];
    expect(commonSkip('fitzy_protein_nudge', ctx({ sent: old }), ON)).toBeNull();
  });
  it('Fitzy pushes count toward the daily cap (never exempt)', () => {
    for (const t of FITZY_PUSH_TYPES) expect(isCapExempt(t), t).toBe(false);
  });
});

describe('morning slot', () => {
  const base = { weekday: 4, tier: 'free' as const, hasPlanThisWeek: false, hasPreviewThisWeek: false, lastTeaserAt: null, aiEligible: true, focusAlreadyGenerated: false, now: NOW };
  it('sends the daily focus to Fitzy users who have not opened it yet', () => {
    expect(morningKind(base)).toEqual({ kind: 'fitzy_daily_focus' });
    expect(morningKind({ ...base, focusAlreadyGenerated: true })).toEqual({ skip: 'already_seen' });
    expect(morningKind({ ...base, aiEligible: false })).toEqual({ skip: 'not_ai_eligible' });
  });
  it('Monday: plan prompt for Pro without a plan; free teaser at most every 14 days', () => {
    expect(morningKind({ ...base, weekday: 1, tier: 'pro' })).toEqual({ kind: 'fitzy_weekly_plan' });
    expect(morningKind({ ...base, weekday: 1, tier: 'pro', hasPlanThisWeek: true })).toEqual({ kind: 'fitzy_daily_focus' });
    expect(morningKind({ ...base, weekday: 1 })).toEqual({ kind: 'fitzy_weekly_plan' });
    expect(morningKind({ ...base, weekday: 1, aiEligible: false })).toEqual({ kind: 'fitzy_weekly_plan' });
    expect(morningKind({ ...base, weekday: 1, lastTeaserAt: ago(1440 * 7) })).toEqual({ kind: 'fitzy_daily_focus' });
    expect(morningKind({ ...base, weekday: 1, lastTeaserAt: ago(1440 * 14) })).toEqual({ kind: 'fitzy_weekly_plan' });
    expect(morningKind({ ...base, weekday: 1, hasPreviewThisWeek: true })).toEqual({ kind: 'fitzy_daily_focus' });
  });
});

describe('relevance', () => {
  it('hydration: water loggers with nothing today', () => {
    expect(hydrationRelevant(['2026-10-20', '2026-10-21'], '2026-10-22')).toBe(true);
    expect(hydrationRelevant(['2026-10-20', '2026-10-21', '2026-10-22'], '2026-10-22')).toBe(false);
    expect(hydrationRelevant(['2026-10-21'], '2026-10-22')).toBe(false);
    expect(hydrationRelevant(['2026-10-01', '2026-10-02'], '2026-10-22')).toBe(false);
  });
  it('protein: well below the user OWN usual, only when logging today', () => {
    const usual = ['2026-10-19', '2026-10-20', '2026-10-21'].map((date) => ({ date, entries: 3, proteinG: 90 }));
    expect(proteinBehind([...usual, { date: '2026-10-22', entries: 1, proteinG: 20 }], '2026-10-22')).toBe(true);
    expect(proteinBehind([...usual, { date: '2026-10-22', entries: 1, proteinG: 40 }], '2026-10-22')).toBe(false);
    expect(proteinBehind(usual, '2026-10-22')).toBe(false); // nothing logged today → meal reminders' job
    expect(proteinBehind([...usual.slice(0, 2), { date: '2026-10-22', entries: 1, proteinG: 0 }], '2026-10-22')).toBe(false);
    const light = usual.map((d) => ({ ...d, proteinG: 25 }));
    expect(proteinBehind([...light, { date: '2026-10-22', entries: 1, proteinG: 0 }], '2026-10-22')).toBe(false);
  });
  it('proteinDays ignores water rows', () => {
    expect(proteinDays([
      { entry_date: 'd', entry_type: 'food', protein_g: 10 },
      { entry_date: 'd', entry_type: 'water', protein_g: null },
      { entry_date: 'd', entry_type: 'food', protein_g: null },
    ])).toEqual([{ date: 'd', entries: 2, proteinG: 10 }]);
  });
});

describe('content: lock-screen privacy, limits, templates', () => {
  it('rejects health values on the lock screen', () => {
    for (const t of ['You had 20g of protein', 'Down 2 kg!', 'Your weight is trending down', '1,800 kcal so far', 'Body fat looks steady', 'Your macros today'])
      expect(lockScreenSafe(t), t).toBe(false);
    for (const t of ['Try a 10-minute walk', 'Day 5 of your streak', '3 workouts this week', 'Weights at the gym count too', 'Strength training today?'])
      expect(lockScreenSafe(t), t).toBe(true);
  });
  const focus = (headline: string, body: string, kind: any = 'tip') => ({ date: '2026-10-22', kind, headline, body, cta: { label: 'x', action: { type: 'log_meal' as const, label: 'x' } }, tier: 'free' as const });
  it('uses the focus card when it is short and safe, else a generic teaser; the tip always carries the card', () => {
    const ok = focusPushCopy(focus('Walk after lunch', 'A 10-minute stroll after lunch helps digestion and mood.'), guard, 'ai');
    expect(ok).toMatchObject({ title: 'Walk after lunch', body: 'A 10-minute stroll after lunch helps digestion and mood.', source: 'ai' });
    const unsafe = focusPushCopy(focus('Nice trend', 'Your weight is trending down, keep it up.'), guard, 'ai');
    expect(unsafe.title).toBe("Today's focus from Fitzy");
    expect(unsafe.tip).toContain('trending down');
    expect(unsafe.body).toBe('One small, doable idea for today is waiting for you.');
    const longTitle = focusPushCopy(focus('x'.repeat(TITLE_MAX + 1), 'Fine body here.'), guard, 'ai');
    expect(longTitle).toMatchObject({ title: "Today's focus from Fitzy", body: 'Fine body here.' });
    const recap = focusPushCopy(focus('', '', 'recap'), guard, 'template');
    expect(recap.title).toBe('Your week with Fitzy');
  });
  it('trims a long focus body at a sentence end within the push limit', () => {
    const body = 'Pack a piece of fruit and some yogurt for the afternoon dip. It keeps energy steady and your mood bright. Then take the stairs once or twice today, slowly and with a smile on your face.';
    const c = focusPushCopy(focus('Steady energy', body), guard, 'ai');
    expect([...c.body].length).toBeLessThanOrEqual(FOCUS_BODY_MAX);
    expect(c.body.endsWith('.')).toBe(true);
    expect(c.tip).toContain(body);
  });
  it('templates are deterministic per user+day, within limits and lock-screen safe', () => {
    expect(hydrationCopy('u:2026-10-22')).toEqual(hydrationCopy('u:2026-10-22'));
    for (const c of [hydrationCopy('a'), hydrationCopy('b'), hydrationCopy('c'), weeklyPlanCopy('pro'), weeklyPlanCopy('free'), proteinTemplate('none', [], 'a'), proteinTemplate('vegan', ['soy'], 'b')]) {
      expect([...c.title].length).toBeLessThanOrEqual(TITLE_MAX);
      expect([...c.body].length).toBeLessThanOrEqual(BODY_MAX);
      expect(lockScreenSafe(`${c.title} ${c.body}`)).toBe(true);
      expect(c.source).toBe('template');
    }
  });
  it('protein ideas respect diet and allergens', () => {
    expect(proteinIdeas('vegan', [], 10)).not.toContain('Greek yogurt');
    expect(proteinIdeas('vegetarian', [], 10)).not.toContain('a tuna wrap');
    const noNuts = proteinIdeas('none', ['nuts', 'peanuts'], 10);
    expect(noNuts.join(' ')).not.toMatch(/almond|peanut/);
    expect(proteinIdeas('none', ['dairy'], 10)).not.toContain('Greek yogurt');
  });
});

describe('AI nudge parsing (fallback to template on anything off)', () => {
  it('accepts a short, safe JSON reply', () => {
    expect(parseNudge('{"title":"Snack idea 🥚","body":"A boiled egg and some hummus could round out your afternoon."}', guard)).toMatchObject({ source: 'ai', title: 'Snack idea' }); // emoji stripped server-side
    expect(parseNudge('```json\n{"title":"Snack idea","body":"Edamame is a tasty afternoon pick.",}\n```', guard)).not.toBeNull();
  });
  it('rejects numbers, judging words, guard hits, overlong text and junk', () => {
    expect(parseNudge('{"title":"Protein","body":"Add 20g of protein with yogurt."}', guard)).toBeNull();
    expect(parseNudge('{"title":"Protein","body":"You are behind on protein today."}', guard)).toBeNull();
    expect(parseNudge('{"title":"Tip","body":"Keep a calorie deficit going."}', guard)).toBeNull();
    expect(parseNudge(`{"title":"Tip","body":"${'a'.repeat(BODY_MAX + 1)}"}`, guard)).toBeNull();
    expect(parseNudge('Sure! Here is a nudge.', guard)).toBeNull();
  });
});

describe('allergen check on AI nudges', () => {
  it('rejects copy that names or shows an allergen, keeps compatible copy', () => {
    const ok = '{"title":"Afternoon fuel idea 🥣","body":"Roasted chickpeas or a boiled egg would make an easy pick-me-up."}';
    expect(parseNudge(ok, guard, ['peanuts'])).not.toBeNull();
    expect(parseNudge('{"title":"Afternoon fuel idea 🥜","body":"Roasted chickpeas make an easy pick-me-up."}', guard, ['peanuts'])).toBeNull();
    expect(parseNudge('{"title":"Snack idea","body":"A handful of almonds is an easy pick-me-up."}', guard, ['tree nuts'])).toBeNull();
    expect(parseNudge('{"title":"Snack idea","body":"Greek yogurt with berries is an easy pick-me-up."}', guard, ['dairy'])).toBeNull();
    expect(parseNudge('{"title":"Snack idea","body":"Edamame is an easy pick-me-up."}', guard, ['soy'])).toBeNull();
    expect(parseNudge('{"title":"Snack idea","body":"Hummus with veggies is an easy pick-me-up."}', guard, ['sesame'])).toBeNull();
    expect(parseNudge('{"title":"Snack idea","body":"Edamame is an easy pick-me-up."}', guard, [])).not.toBeNull();
  });
  it('does not over-match unrelated words', () => {
    expect(mentionsAllergen('Butternut squash soup is cosy', ['dairy'])).toBe(false);
    expect(mentionsAllergen('Lentil soup is cosy', ['nuts', 'shellfish', 'gluten'])).toBe(false);
  });
});

describe('catalog + preference wiring', () => {
  it('every Fitzy type is category coach, opens fitzy_chat, and has a template', () => {
    for (const t of FITZY_PUSH_TYPES) {
      expect(NotificationPreferencesService.getCategoryForType(t)).toBe('coach');
      expect(NOTIFICATION_TEMPLATES[t]({}).category).toBe('coach');
      expect(TYPE_SCREEN_MAP[t]).toBe('fitzy_chat');
    }
  });
  it('a tip-seeded chat gets a synthetic first user turn for the model', () => {
    expect(withUserFirst([{ role: 'assistant', content: 'tip' }, { role: 'user', content: 'tell me more' }])[0]).toEqual({ role: 'user', content: PUSH_OPEN_TURN });
    const normal = [{ role: 'user' as const, content: 'hi' }];
    expect(withUserFirst(normal)).toBe(normal);
  });
});

describe('FitzyPushService.processUser (claim, dedupe, fallback)', () => {
  const u = { userId: 'u1', tz: 'America/New_York', local: { date: '2026-10-22', hour: 15, weekday: 4 }, slot: 'contextual' as const, slotKind: 'fitzy_protein_nudge' as const };
  const food = [
    ...['2026-10-19', '2026-10-20', '2026-10-21'].flatMap((d) => [1, 2].map(() => ({ entry_date: d, entry_type: 'food', protein_g: 45, water_ml: null }))),
    { entry_date: '2026-10-22', entry_type: 'food', protein_g: 5, water_ml: null },
  ];
  const x = { now: new Date('2026-10-22T19:10:00Z'), cfg: ON, dryRun: false, force: null, prefs: { coach_enabled: null, quiet_hours_start: '22:00:00', quiet_hours_end: '07:00:00' }, sent: [], activityDates: ['2026-10-22'], food, aiEligible: true };

  beforeEach(() => {
    inserts.length = 0;
    updates.length = 0;
    insertResult = { data: null, error: null };
    for (const k of Object.keys(tables)) delete tables[k];
    send.mockReset().mockResolvedValue({ sent: true });
    generate.mockReset();
    focusGet.mockReset();
  });

  it('claims, generates with the model, sends via the orchestrator with the tip, records the outcome', async () => {
    generate.mockResolvedValue({ text: '{"title":"Snack idea 🥚","body":"Some edamame or lentil soup could round out your afternoon."}' });
    const d = await FitzyPushService.processUser(u, x);
    expect(d).toMatchObject({ kind: 'fitzy_protein_nudge', sent: true, source: 'ai' });
    expect(inserts).toEqual([{ table: 'fitzy_push_deliveries', row: expect.objectContaining({ delivery_key: 'contextual:2026-10-22', kind: 'fitzy_protein_nudge' }) }]);
    expect(send).toHaveBeenCalledWith('u1', 'fitzy_protein_nudge', expect.objectContaining({ title: 'Snack idea', fitzyTip: expect.stringContaining('edamame') }));
    expect(updates[0].row.status).toBe('sent');
  });

  it('falls back to the template when the model fails or returns unsafe copy', async () => {
    generate.mockRejectedValue(new Error('timeout'));
    const d1 = await FitzyPushService.processUser(u, x);
    expect(d1.source).toBe('template');
    generate.mockResolvedValue({ text: '{"title":"Protein","body":"You only had 5g so far."}' });
    insertResult = { data: null, error: null };
    const d2 = await FitzyPushService.processUser(u, x);
    expect(d2.source).toBe('template');
    const body = send.mock.calls[1][2].body as string;
    expect(body).not.toMatch(/almond|peanut|tuna/); // vegetarian + nut allergy
  });

  it('users who never chatted with Fitzy get the template (no model call)', async () => {
    const d = await FitzyPushService.processUser(u, { ...x, aiEligible: false });
    expect(d.source).toBe('template');
    expect(generate).not.toHaveBeenCalled();
  });

  it('a duplicate claim (cron retry / concurrent run) sends nothing', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'duplicate key' } };
    const d = await FitzyPushService.processUser(u, x);
    expect(d.skip).toBe('duplicate');
    expect(send).not.toHaveBeenCalled();
  });

  it('fails closed when the ledger is missing (migration 107 not applied)', async () => {
    insertResult = { data: null, error: { code: '42P01', message: 'relation does not exist' } };
    const d = await FitzyPushService.processUser(u, x);
    expect(d.skip).toBe('claim_failed');
    expect(send).not.toHaveBeenCalled();
  });

  it('dry run decides without claiming or sending', async () => {
    const d = await FitzyPushService.processUser(u, { ...x, dryRun: true });
    expect(d).toMatchObject({ kind: 'fitzy_protein_nudge', reason: 'dry_run' });
    expect(inserts).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('skips when the coach toggle is off, in quiet hours, or protein is not behind', async () => {
    expect((await FitzyPushService.processUser(u, { ...x, prefs: { ...x.prefs, coach_enabled: false } })).skip).toBe('coach_off');
    expect((await FitzyPushService.processUser(u, { ...x, prefs: { ...x.prefs, quiet_hours_start: '14:00', quiet_hours_end: '18:00' } })).skip).toBe('quiet_hours');
    const fine = food.map((f) => (f.entry_date === '2026-10-22' ? { ...f, protein_g: 80 } : f));
    expect((await FitzyPushService.processUser(u, { ...x, food: fine })).skip).toBe('not_relevant');
    expect(send).not.toHaveBeenCalled();
  });

  it('morning: the daily focus becomes the push; a Sunday recap card is typed fitzy_weekly_recap', async () => {
    const m = { ...u, local: { date: '2026-10-25', hour: 8, weekday: 0 }, slot: 'morning' as const, slotKind: 'morning' as const };
    tables.fitzy_plans = { data: null, error: null };
    tables.fitzy_daily = { data: null, error: null };
    focusGet.mockResolvedValue({ date: '2026-10-25', kind: 'recap', headline: 'What a week', body: 'You showed up for two walks. Carry that into next week.', cta: { label: 'x', action: { type: 'start_plan', label: 'x' } }, tier: 'pro' });
    const d = await FitzyPushService.processUser(m, { ...x, now: new Date('2026-10-25T12:10:00Z') });
    expect(d).toMatchObject({ kind: 'fitzy_weekly_recap', sent: true });
    expect(inserts[0].row.delivery_key).toBe('morning:2026-10-25');
  });

  it('morning: skips when the user already opened today’s focus in the app', async () => {
    const m = { ...u, local: { date: '2026-10-22', hour: 8, weekday: 4 }, slot: 'morning' as const, slotKind: 'morning' as const };
    tables.fitzy_plans = { data: null, error: null };
    tables.fitzy_daily = { data: { user_id: 'u1' }, error: null };
    const d = await FitzyPushService.processUser(m, { ...x, now: new Date('2026-10-22T12:10:00Z') });
    expect(d.skip).toBe('already_seen');
    expect(focusGet).not.toHaveBeenCalled();
  });
});
