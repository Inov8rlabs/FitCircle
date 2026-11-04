/**
 * Pro lifecycle pushes: timing (10:00 local the day before, right after the
 * downgrade), quiet hours, dedupe across runs, dry run, kill switches, and the
 * downgrade-cron hook. The orchestrator is mocked: nothing is ever sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ sends: [] as Array<{ userId: string; type: string; data: Record<string, unknown> }>, reply: { sent: true } as { sent: boolean; reason?: string } }));

vi.mock('@/lib/supabase-admin', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return { createAdminSupabase: () => getHomeFeedDb().client() };
});
vi.mock('@/lib/services/notification-orchestrator', async (orig) => {
  const mod: any = await orig();
  return {
    ...mod,
    NotificationOrchestrator: {
      send: vi.fn(async (userId: string, type: string, data: Record<string, unknown>) => {
        h.sends.push({ userId, type, data });
        if (h.reply.sent) {
          const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
          getHomeFeedDb().rows('notification_log').push({ user_id: userId, notification_type: type, data, suppressed: false, sent_at: new Date().toISOString() });
        }
        return h.reply;
      }),
    },
  };
});
vi.mock('@/lib/services/notification-preferences-service', () => ({
  NotificationPreferencesService: {
    getPreferences: async (userId: string) => {
      const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
      return getHomeFeedDb().rows('notification_preferences').find((p) => p.user_id === userId) ?? { quiet_hours_start: '22:00:00', quiet_hours_end: '07:00:00', quiet_hours_timezone: 'America/New_York' };
    },
  },
}));

import { HomeFeedFakeDb, setHomeFeedDb } from '@/lib/home-feed/__tests__/fake-db';
import { DEFAULT_CONFIG } from '@/lib/pro-lifecycle';

import { ProLifecyclePushService } from '../pro-lifecycle-push-service';

const ASAEL = 'a20dedd6-3c66-416e-aaa0-07540d772f11';
const KALPANA = 'ccf45952-7ceb-4e3b-aa66-8f02000ee8da';
const END_A = '2026-11-09T19:17:45.902Z'; // Mon 1:17 PM CST
const END_K = '2026-11-10T12:41:57.379Z'; // Tue 7:41 AM EST
let db: HomeFeedFakeDb;

const profile = (id: string, tz: string, end: string, extra: Record<string, unknown> = {}) => ({
  id,
  email: `${id.slice(0, 4)}@gmail.com`,
  is_admin: false,
  display_name: 'Friend',
  timezone: tz,
  subscription_tier: 'premium',
  subscription_status: 'active',
  subscription_platform: 'promotional',
  subscription_product_id: 'referral',
  subscription_expires_at: end,
  subscription_will_renew: false,
  trial_started_at: null,
  trial_ends_at: null,
  trial_converted_at: null,
  ...extra,
});
const grant = (user: string, end: string) => ({ id: `g-${user}`, user_id: user, granted_by: 'referral-program', created_at: new Date(Date.parse(end) - 7 * 86_400_000).toISOString(), expires_at: end, revoked_at: null });
const run = (iso: string, opts: { dryRun?: boolean } = {}) => ProLifecyclePushService.run({ now: new Date(iso), ...opts });

beforeEach(() => {
  db = new HomeFeedFakeDb();
  setHomeFeedDb(db);
  h.sends.length = 0;
  h.reply = { sent: true };
  delete process.env.PRO_ENDING_PROMPTS_ENABLED;
  delete process.env.PRO_ENDING_PUSH_DRY_RUN;
  db.rows('profiles').push(profile(ASAEL, 'America/Chicago', END_A), profile(KALPANA, 'America/Toronto', END_K));
  db.rows('complimentary_grants').push(grant(ASAEL, END_A), grant(KALPANA, END_K));
});
afterEach(() => {
  delete process.env.PRO_ENDING_PROMPTS_ENABLED;
  delete process.env.PRO_ENDING_PUSH_DRY_RUN;
});

describe('pro_expiring_reminder', () => {
  it('waits for 10:00 local the day before, then sends once (dedupe across hourly runs)', async () => {
    const early = await run('2026-11-08T15:25:00Z'); // 9:25 CST
    expect(early.planned.find((p) => p.userId === ASAEL)).toMatchObject({ outcome: 'not_yet', dueAt: '2026-11-08T16:00:00.000Z' });
    expect(early.planned.find((p) => p.userId === ASAEL)?.dueLocal).toMatch(/Sun, Nov 8, 10:00 AM CST/);
    expect(h.sends).toHaveLength(0);

    const due = await run('2026-11-08T16:25:00Z'); // 10:25 CST
    expect(due.sent).toBe(1);
    expect(h.sends[0]).toMatchObject({ userId: ASAEL, type: 'pro_expiring_reminder', data: { title: 'Your free Pro week ends tomorrow', dedupeKey: `pro_expiring_reminder:${ASAEL}:2026-11-09T19:17`, trialAvailable: true } });
    expect(String(h.sends[0].data.body)).toMatch(/3-day free trial/);

    const again = await run('2026-11-08T17:25:00Z');
    expect(again.planned.find((p) => p.userId === ASAEL)?.outcome).toBe('already_sent');
    expect(h.sends).toHaveLength(1);
    // Kalpana (Toronto) is due Mon 10:00 EST = 15:00 UTC.
    expect(again.planned.find((p) => p.userId === KALPANA)).toMatchObject({ outcome: 'not_yet', dueAt: '2026-11-09T15:00:00.000Z' });
  });

  it('quiet hours defer (prefs time zone), no device is final, other failures retry next hour', async () => {
    db.rows('notification_preferences').push({ user_id: ASAEL, quiet_hours_start: '08:00:00', quiet_hours_end: '12:00:00', quiet_hours_timezone: 'America/Chicago' });
    expect((await run('2026-11-08T16:25:00Z')).planned.find((p) => p.userId === ASAEL)?.outcome).toBe('quiet_hours');
    expect(h.sends).toHaveLength(0);
    h.reply = { sent: false, reason: 'no_delivery' };
    db.rows('notification_preferences').length = 0;
    const r = await run('2026-11-08T18:25:00Z');
    expect(r.planned.find((p) => p.userId === ASAEL)?.outcome).toBe('final_no_delivery');
    db.rows('notification_log').push({ user_id: ASAEL, notification_type: 'pro_expiring_reminder', data: h.sends[0].data, suppressed: true, suppression_reason: 'no_delivery', sent_at: '2026-11-08T18:25:00Z' });
    expect((await run('2026-11-08T19:25:00Z')).planned.find((p) => p.userId === ASAEL)?.outcome).toBe('already_sent');
  });

  it('renewed referral days move the end: a new reminder for the new end, none for the old one', async () => {
    await run('2026-11-08T16:25:00Z');
    const newEnd = '2026-11-16T19:17:45.902Z';
    db.rows('complimentary_grants').find((g) => g.user_id === ASAEL)!.expires_at = newEnd;
    db.rows('profiles').find((p) => p.id === ASAEL)!.subscription_expires_at = newEnd;
    expect((await run('2026-11-09T16:25:00Z')).planned.find((p) => p.userId === ASAEL)).toBeUndefined(); // not ending soon any more
    const later = await run('2026-11-15T16:25:00Z');
    expect(later.planned.find((p) => p.userId === ASAEL)).toMatchObject({ outcome: 'sent' });
    expect(h.sends.filter((s) => s.userId === ASAEL).map((s) => s.data.dedupeKey)).toEqual([`pro_expiring_reminder:${ASAEL}:2026-11-09T19:17`, `pro_expiring_reminder:${ASAEL}:2026-11-16T19:17`]);
  });

  it('dry run (query or env) reports would_send with the copy, sends and writes nothing', async () => {
    const r = await run('2026-11-08T16:25:00Z', { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.planned.find((p) => p.userId === ASAEL)).toMatchObject({ outcome: 'would_send', title: 'Your free Pro week ends tomorrow' });
    process.env.PRO_ENDING_PUSH_DRY_RUN = 'true';
    expect((await run('2026-11-08T16:25:00Z')).dryRun).toBe(true);
    expect(h.sends).toHaveLength(0);
    expect(db.rows('notification_log')).toHaveLength(0);
  });

  it('kill switches: env, admin master switch, per-state push toggle', async () => {
    process.env.PRO_ENDING_PROMPTS_ENABLED = 'false';
    expect(await run('2026-11-08T16:25:00Z')).toMatchObject({ enabled: false, planned: [] });
    delete process.env.PRO_ENDING_PROMPTS_ENABLED;
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.states.pro_expiring.push.enabled = false;
    db.rows('feature_flags').push({ name: 'pro_lifecycle_prompts', is_enabled: true, metadata: cfg, updated_at: 'x' });
    expect((await run('2026-11-08T16:25:00Z')).planned.find((p) => p.userId === ASAEL)?.outcome).toBe('push_disabled');
    db.rows('feature_flags')[0].is_enabled = false;
    expect((await run('2026-11-08T16:25:00Z')).enabled).toBe(false);
    expect(h.sends).toHaveLength(0);
  });

  it('a user who already had a trial gets the no-trial body', async () => {
    db.rows('profiles').find((p) => p.id === ASAEL)!.trial_started_at = '2026-09-01T00:00:00Z';
    await run('2026-11-08T16:25:00Z');
    expect(String(h.sends[0].data.body)).not.toMatch(/free trial/);
  });
});

describe('pro_expired', () => {
  const downgrade = (id: string) => Object.assign(db.rows('profiles').find((p) => p.id === id)!, { subscription_tier: 'free', subscription_status: 'cancelled' });

  it('notifyExpired after the downgrade sends once; before the downgrade it does nothing', async () => {
    expect(await ProLifecyclePushService.notifyExpired(ASAEL, { now: new Date('2026-11-09T19:20:00Z') })).toBeNull(); // still premium
    downgrade(ASAEL);
    expect(await ProLifecyclePushService.notifyExpired(ASAEL, { now: new Date('2026-11-09T19:20:00Z') })).toMatchObject({ outcome: 'sent' });
    expect(h.sends.at(-1)).toMatchObject({ type: 'pro_expired', data: { title: 'Your free Pro week ended', dedupeKey: `pro_expired:${ASAEL}:2026-11-09T19:17` } });
    expect((await run('2026-11-09T19:25:00Z')).planned.find((p) => p.userId === ASAEL)?.outcome).toBe('already_sent');
    expect(h.sends.filter((s) => s.type === 'pro_expired')).toHaveLength(1);
  });

  it('quiet hours at the downgrade → the hourly cron sends it later; given up after 36 h', async () => {
    downgrade(KALPANA);
    db.rows('notification_preferences').push({ user_id: KALPANA, quiet_hours_start: '06:00:00', quiet_hours_end: '09:00:00', quiet_hours_timezone: 'America/Toronto' });
    expect(await ProLifecyclePushService.notifyExpired(KALPANA, { now: new Date('2026-11-10T12:45:00Z') })).toMatchObject({ outcome: 'quiet_hours' });
    expect((await run('2026-11-10T14:25:00Z')).planned.find((p) => p.userId === KALPANA)?.outcome).toBe('sent');
    downgrade(ASAEL);
    expect((await run('2026-11-11T08:25:00Z')).planned.find((p) => p.userId === ASAEL)?.outcome).toBe('too_late');
  });

  it('a store purchase at expiry (sync held it) → no "ended" push', async () => {
    Object.assign(db.rows('profiles').find((p) => p.id === ASAEL)!, { subscription_platform: 'app_store', subscription_expires_at: '2027-11-09T00:00:00Z' });
    db.rows('subscription_events').push({ user_id: ASAEL, type: 'INITIAL_PURCHASE', environment: 'PRODUCTION', raw: { period_type: 'NORMAL' } });
    expect(await ProLifecyclePushService.notifyExpired(ASAEL, { now: new Date('2026-11-09T19:20:00Z') })).toBeNull();
    expect(h.sends).toHaveLength(0);
  });
});
