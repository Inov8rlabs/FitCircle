/**
 * Compliance guard (2026-11-06): SERVER-INITIATED AI (daily focus, Sunday recap, free plan teaser,
 * AI push copy) must make ZERO model calls for users without server-side evidence of AI consent
 * (lib/fitzy/ai-consent.ts), and must be unchanged for users who have it.
 *
 * The model layer is mocked at the `ai` package, so any path that would reach Anthropic/Google
 * is counted here, whatever service it goes through.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => getReferralDb().client() }));
vi.mock('../entitlement-service', () => ({ EntitlementService: { isFeatureAllowed: async () => false } }));
vi.mock('../dietary-preferences-service', () => ({ DietaryPreferencesService: { getPrefs: async () => ({ diet: 'none', allergens: [] }) } }));
vi.mock('../../fitzy/meta-recovery', () => ({ recoverMeta: async () => null }));

const ai = vi.hoisted(() => ({ calls: [] as Array<{ model: string }>, replies: [] as string[] }));
vi.mock('ai', () => ({
  generateText: async (opts: any) => {
    ai.calls.push({ model: opts.model });
    const text = ai.replies.shift();
    if (text === undefined) throw new Error('no scripted reply');
    return { text, finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } };
  },
  streamText: (opts: any) => {
    ai.calls.push({ model: opts.model });
    throw new Error('stream not expected');
  },
}));

const sent = vi.hoisted(() => [] as Array<{ userId: string; kind: string; payload: any }>);
vi.mock('../notification-orchestrator', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    NotificationOrchestrator: {
      ...real.NotificationOrchestrator,
      send: async (userId: string, kind: string, payload: any) => {
        sent.push({ userId, kind, payload });
        return { sent: true };
      },
    },
  };
});

import { hasAiConsentEvidence, usersWithAiConsentEvidence } from '../../fitzy/ai-consent';
import { pushConfig } from '../../fitzy/push';
import { FitzyFocusService } from '../fitzy-focus-service';
import { FALLBACK_COMMITMENTS, FitzyPlanService } from '../fitzy-plan-service';
import { FitzyPushService } from '../fitzy-push-service';
import { FitzyService } from '../fitzy-service';

import { ReferralFakeDb, getReferralDb, setReferralDb } from './referral-fake-db';

const NO_CONSENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONSENTED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRO_NO_CONSENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const WEDNESDAY = new Date('2026-10-21T12:30:00Z'); // 08:30 New York
const SUNDAY = new Date('2026-10-25T12:30:00Z'); // 08:30 New York
const guard = (t: string) => FitzyService.containsForbiddenContent(t);
const focusJson = JSON.stringify({ kind: 'tip', headline: 'Protein at breakfast', body: 'Add eggs or yogurt today. It keeps energy steady.', cta: { label: 'Log breakfast', type: 'log_meal' } });
const planJson = JSON.stringify({
  goal: 'Feel energised',
  note: 'Small steps.',
  commitments: [
    { kind: 'move', title: '3 walks of 15 min', detail: 'Any pace.', count: 3 },
    { kind: 'eat', title: 'Protein at breakfast', detail: 'Eggs or yogurt.', count: 4 },
    { kind: 'sleep', title: 'Lights out by 11', detail: 'Wind down.', count: 3 },
  ],
});

let db: ReferralFakeDb;
beforeEach(() => {
  db = new ReferralFakeDb();
  setReferralDb(db);
  ai.calls.length = 0;
  ai.replies.length = 0;
  sent.length = 0;
  db.addProfile({ id: NO_CONSENT, display_name: 'Sam Lee', subscription_tier: 'free', created_at: '2026-09-01T00:00:00Z', fitzy_opened_at: '2026-10-01T00:00:00Z' });
  db.addProfile({ id: CONSENTED, display_name: 'Ani Rao', subscription_tier: 'free', created_at: '2026-09-01T00:00:00Z', fitzy_opened_at: '2026-10-01T00:00:00Z' });
  db.addProfile({ id: PRO_NO_CONSENT, display_name: 'Pat Doe', subscription_tier: 'premium', created_at: '2026-09-01T00:00:00Z' });
  db.rows('feature_gates').push({ feature_key: 'fitzy_unlimited', required_tier: 'premium' });
  // Only CONSENTED has chatted with Fitzy (the apps require the AI consent sheet before a send).
  db.rows('fitzy_conversations').push({ id: 'cv1', user_id: CONSENTED, title: 'hi', created_at: '', updated_at: '', archived_at: null });
  // Everyone has recent logs (the case that used to reach the model) and a Pro plan this week.
  for (const id of [NO_CONSENT, CONSENTED, PRO_NO_CONSENT]) {
    db.rows('food_log_entries').push({ id: `f-${id}`, user_id: id, entry_date: '2026-10-20', entry_type: 'meal', protein_g: 5, calories: 400, deleted_at: null });
    db.rows('push_tokens').push({ user_id: id, is_active: true });
    db.rows('streak_claims').push({ id: `s-${id}`, user_id: id, claim_date: '2026-10-21', timezone: 'America/New_York' });
  }
  db.rows('fitzy_plans').push({
    id: 'p1', user_id: PRO_NO_CONSENT, week_of: '2026-10-19', goal: 'Move more', note: '', is_preview: false, created_at: '', updated_at: '',
    commitments: [{ id: 'c1', kind: 'move', title: '3 walks', detail: '', target: { count: 3, per: 'week' }, doneDates: ['2026-10-20'] }],
  });
});

describe('consent evidence', () => {
  it('a Fitzy conversation is evidence; opening the Fitzy tab (fitzy_opened_at) is not', async () => {
    expect(await hasAiConsentEvidence(CONSENTED)).toBe(true);
    expect(await hasAiConsentEvidence(NO_CONSENT)).toBe(false);
    expect([...(await usersWithAiConsentEvidence([NO_CONSENT, CONSENTED, PRO_NO_CONSENT]))]).toEqual([CONSENTED]);
  });
});

describe('daily focus (GET /fitzy/today, home card)', () => {
  it('no consent: static welcome, not cached, zero model calls (free, and Pro on a recap Sunday)', async () => {
    const f = await FitzyFocusService.get(NO_CONSENT, 'America/New_York', WEDNESDAY);
    expect(f).toMatchObject({ kind: 'welcome' });
    const recap = await FitzyFocusService.get(PRO_NO_CONSENT, 'America/New_York', SUNDAY);
    expect(recap).toMatchObject({ kind: 'welcome' });
    expect(ai.calls).toHaveLength(0);
    expect(db.rows('fitzy_daily')).toHaveLength(0);
  });

  it('consent: unchanged (AI focus, cached)', async () => {
    ai.replies.push(focusJson);
    const f = await FitzyFocusService.get(CONSENTED, 'America/New_York', WEDNESDAY);
    expect(f).toMatchObject({ kind: 'tip', headline: 'Protein at breakfast' });
    expect(ai.calls).toHaveLength(1);
    expect(db.rows('fitzy_daily')).toHaveLength(1);
  });
});

describe('free weekly plan teaser (GET /fitzy/plan on opening Fitzy)', () => {
  it('no consent: static default commitments, not cached, zero model calls', async () => {
    const p = await FitzyPlanService.preview(NO_CONSENT, '2026-10-21', null, 'g', guard);
    expect(p.firstCommitment.title).toBe(FALLBACK_COMMITMENTS[0].title);
    expect(p.moreCount).toBe(FALLBACK_COMMITMENTS.length - 1);
    expect(ai.calls).toHaveLength(0);
    expect(db.rows('fitzy_plans').filter((r) => r.user_id === NO_CONSENT)).toHaveLength(0);
  });

  it('consent: unchanged (AI teaser, cached for the week)', async () => {
    ai.replies.push(planJson);
    const p = await FitzyPlanService.preview(CONSENTED, '2026-10-21', null, 'g', guard);
    expect(p).toMatchObject({ goal: 'Feel energised', firstCommitment: { title: '3 walks of 15 min' } });
    expect(ai.calls).toHaveLength(1);
    expect(db.rows('fitzy_plans').filter((r) => r.user_id === CONSENTED)).toHaveLength(1);
  });
});

describe('Fitzy push (cron /api/cron/fitzy-coach)', () => {
  const cfg = { ...pushConfig({ FITZY_PUSH_ENABLED: 'true' } as any) };

  it('hourly run: no model call for a non-consenting user in the morning and protein slots', async () => {
    const morning = await FitzyPushService.run({ now: WEDNESDAY, userId: NO_CONSENT, config: cfg });
    expect(morning.skipped).toMatchObject({ not_ai_eligible: 1 });
    const protein = await FitzyPushService.run({ now: new Date('2026-10-21T19:30:00Z'), userId: NO_CONSENT, config: cfg }); // 15:30 NY
    expect(protein.inWindow).toBe(1);
    expect(ai.calls).toHaveLength(0);
  });

  it('forced test sends of every AI-capable kind: zero model calls without consent, templates only', async () => {
    for (const force of ['fitzy_daily_focus', 'fitzy_weekly_recap', 'fitzy_protein_nudge'] as const) {
      await FitzyPushService.run({ now: WEDNESDAY, userId: NO_CONSENT, force, config: cfg });
      await FitzyPushService.run({ now: SUNDAY, userId: PRO_NO_CONSENT, force, config: cfg });
    }
    expect(ai.calls).toHaveLength(0);
    expect(sent.length).toBeGreaterThan(0);
    for (const s of sent) expect(s.payload.fitzySource).toBe('template');
  });

  it('consent: forced daily focus and protein nudge still use the model', async () => {
    ai.replies.push(focusJson);
    await FitzyPushService.run({ now: WEDNESDAY, userId: CONSENTED, force: 'fitzy_daily_focus', config: cfg });
    ai.replies.push(JSON.stringify({ title: 'A protein boost', body: 'Add beans or yogurt to your next snack.' }));
    await FitzyPushService.run({ now: WEDNESDAY, userId: CONSENTED, force: 'fitzy_protein_nudge', config: cfg });
    expect(ai.calls).toHaveLength(2);
    expect(sent[0]).toMatchObject({ userId: CONSENTED, kind: 'fitzy_daily_focus', payload: { fitzySource: 'ai' } });
  });
});
