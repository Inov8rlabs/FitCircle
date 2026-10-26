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

import { introCopy, introDedupeKey, introSkip, lockScreenSafe, pushConfig, BODY_MAX, TITLE_MAX } from '../../fitzy/push';
import { FitzyPushService, introFacts } from '../fitzy-push-service';

/**
 * fitzy_intro (ACTIVATION_JOURNEY_SPEC §6): day 2–4, activated, never opened
 * Fitzy, once ever, coach toggle + caps via the shared gates, dedupe key.
 */
const ON = pushConfig({ FITZY_PUSH_ENABLED: 'true' } as any);

describe('introSkip (pure)', () => {
  const base = { signupLocalDate: '2026-10-25', today: '2026-10-26', fitzyOpenedAt: null, activated: true, introEverSent: false };
  it('day 2 (first day after the sign-up day) through day 4', () => {
    expect(introSkip(base)).toBeNull();
    expect(introSkip({ ...base, today: '2026-10-28' })).toBeNull();
    expect(introSkip({ ...base, today: '2026-10-25' })).toBe('intro_not_day');
    expect(introSkip({ ...base, today: '2026-10-29' })).toBe('intro_not_day');
  });
  it('only activated users who never opened Fitzy, once ever; unknown → never', () => {
    expect(introSkip({ ...base, activated: false })).toBe('not_activated');
    expect(introSkip({ ...base, fitzyOpenedAt: '2026-10-25T20:00:00Z' })).toBe('fitzy_opened');
    expect(introSkip({ ...base, introEverSent: true })).toBe('intro_sent');
    expect(introSkip({ ...base, fitzyOpenedAt: undefined })).toBe('intro_unknown');
    expect(introSkip({ ...base, signupLocalDate: null })).toBe('intro_unknown');
  });
});

describe('introFacts + copy', () => {
  const u = { tz: 'America/New_York', local: { date: '2026-10-26' } };
  it('derives the local sign-up day, activation, yesterday, once-ever; null without the 110 column', () => {
    const f = introFacts(u, { created_at: '2026-10-25T03:00:00Z', fitzy_opened_at: null }, [{ entry_date: '2026-10-25', entry_type: 'food' }, { entry_date: '2026-10-26', entry_type: 'water' }], [{ notification_type: 'meal_reminder_lunch' }]);
    expect(f).toEqual({ signupLocalDate: '2026-10-24', fitzyOpenedAt: null, activated: true, introEverSent: false, loggedYesterday: true });
    expect(introFacts(u, { created_at: '2026-10-25T03:00:00Z' } as any, [], [])).toBeNull();
    expect(introFacts(u, { created_at: '2026-10-25T03:00:00Z', fitzy_opened_at: null }, [{ entry_date: '2026-10-26', entry_type: 'water' }], [{ notification_type: 'fitzy_intro' }])).toMatchObject({ activated: false, introEverSent: true });
  });
  it('copy is lock-screen safe, within limits, and only mentions yesterday when true', () => {
    for (const c of [introCopy(true), introCopy(false)]) {
      expect(lockScreenSafe(`${c.title} ${c.body}`)).toBe(true);
      expect([...c.title].length).toBeLessThanOrEqual(TITLE_MAX);
      expect([...c.body].length).toBeLessThanOrEqual(BODY_MAX);
      expect(c.tip.length).toBeLessThanOrEqual(400);
    }
    expect(introCopy(true).title).toMatch(/yesterday/);
    expect(`${introCopy(false).title} ${introCopy(false).body}`).not.toMatch(/yesterday/);
    expect(introDedupeKey('u1')).toBe('fitzy_intro:u1');
  });
});

describe('FitzyPushService.processUser — morning slot with the intro', () => {
  const m = { userId: 'u1', tz: 'America/New_York', local: { date: '2026-10-26', hour: 10, weekday: 1 }, slot: 'morning' as const, slotKind: 'morning' as const };
  const intro = { signupLocalDate: '2026-10-25', fitzyOpenedAt: null, activated: true, introEverSent: false, loggedYesterday: true };
  const x = { now: new Date('2026-10-26T14:10:00Z'), cfg: ON, dryRun: false, force: null, prefs: { coach_enabled: null, quiet_hours_start: '22:00:00', quiet_hours_end: '07:00:00' }, sent: [], activityDates: ['2026-10-25'], food: [], aiEligible: false, intro };

  beforeEach(() => {
    inserts.length = 0;
    updates.length = 0;
    insertResult = { data: null, error: null };
    for (const k of Object.keys(tables)) delete tables[k];
    send.mockReset().mockResolvedValue({ sent: true });
  });

  it('sends fitzy_intro (template, tip, dedupe key) and claims the morning slot', async () => {
    const d = await FitzyPushService.processUser(m, x);
    expect(d).toMatchObject({ kind: 'fitzy_intro', sent: true, source: 'template' });
    expect(inserts[0].row).toMatchObject({ delivery_key: 'morning:2026-10-26', kind: 'fitzy_intro' });
    expect(send).toHaveBeenCalledWith('u1', 'fitzy_intro', expect.objectContaining({ title: introCopy(true).title, fitzyTip: introCopy(true).tip, dedupeKey: 'fitzy_intro:u1' }));
  });

  it('respects the coach toggle, quiet hours, the kill switch and the cap budget', async () => {
    expect((await FitzyPushService.processUser(m, { ...x, prefs: { ...x.prefs, coach_enabled: false } })).skip).toBe('coach_off');
    expect((await FitzyPushService.processUser(m, { ...x, cfg: pushConfig({} as any) })).skip).toBe('disabled');
    const today = (h: number) => new Date(Date.parse('2026-10-26T04:00:00Z') + h * 3_600_000).toISOString();
    const sent = [{ type: 'daily_drop', sentAt: today(1) }, { type: 'weekly_summary', sentAt: today(2) }];
    expect((await FitzyPushService.processUser(m, { ...x, sent })).skip).toBe('cap_budget');
    expect(send).not.toHaveBeenCalled();
  });

  it('not eligible (opened Fitzy / already sent / FITZY_PUSH_DISABLED_KINDS) → the normal morning logic runs instead', async () => {
    tables.fitzy_plans = { data: null, error: null };
    tables.fitzy_daily = { data: null, error: null };
    for (const variant of [{ intro: { ...intro, fitzyOpenedAt: '2026-10-25T20:00:00Z' } }, { intro: { ...intro, introEverSent: true } }, { cfg: pushConfig({ FITZY_PUSH_ENABLED: 'true', FITZY_PUSH_DISABLED_KINDS: 'fitzy_intro' } as any) }]) {
      const d = await FitzyPushService.processUser(m, { ...x, ...variant });
      expect(d.kind).not.toBe('fitzy_intro');
    }
  });
});
