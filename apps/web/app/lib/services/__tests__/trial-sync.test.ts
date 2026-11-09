/** TrialSyncService (docs/TRIAL_SYNC.md): status, plan, apply, hash guard, partial failure, retry, validation — mocked ASC / Play HTTP. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  // jsdom TextEncoder → cross-realm Uint8Array that jose (ASC JWT) rejects; install a same-realm one first.
  (globalThis as any).TextEncoder = class {
    readonly encoding = 'utf-8';
    encode(input = '') {
      return new Uint8Array(Buffer.from(input, 'utf8'));
    }
  };
});

import { resetRemoteConfigCache } from '@/lib/remote-config/service';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../__tests__/helpers/fake-supabase';
import { FakeAsc, FakePlay, SUBS, TERRITORIES } from '../../stores/__tests__/fake-stores';
import { TrialSyncService, effectiveTrialDays } from '../trial-sync';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));

const NOW = new Date('2026-11-09T18:00:00Z');
const WEB_RULE = '11111111-1111-4111-8111-111111111111';
const ACTOR = { email: 'ani@inov8rlabs.com' };

let db: FakeSupabase;
let asc: FakeAsc;
let play: FakePlay;

function seedProd() {
  db = new FakeSupabase({
    remote_config_defaults: { uniqueKey: ['config_key'], rows: [{ config_key: 'trial_days', value: 3, updated_by: 'ani@inov8rlabs.com', updated_at: '2026-11-06T00:00:00Z' }] },
    remote_config_rules: {
      rows: [
        {
          id: WEB_RULE,
          config_key: 'trial_days',
          name: 'Web (Stripe) trial: 7 days',
          enabled: true,
          priority: 100,
          audience: { platforms: ['web'] },
          value: 7,
          created_by: 'ani@inov8rlabs.com',
          created_at: '2026-11-06T00:00:00Z',
          updated_by: 'ani@inov8rlabs.com',
          updated_at: '2026-11-06T00:00:00Z',
        },
      ],
    },
    remote_config_changes: {},
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
}

const service = (opts: { playWrite?: boolean; ascConfigured?: boolean; env?: Record<string, string> } = {}) =>
  new TrialSyncService({
    asc: opts.ascConfigured === false ? null : asc.client(),
    play: play.client({ canWrite: opts.playWrite !== false }),
    now: () => NOW,
    env: opts.env ?? { STRIPE_TRIAL_DAYS: '7' },
  });

beforeEach(() => {
  seedProd();
  asc = new FakeAsc();
  play = new FakePlay();
  resetRemoteConfigCache();
});

const auditRows = () => db.getRows('remote_config_changes');

describe('effectiveTrialDays', () => {
  it('platform rules beat the default; conditional rules are ignored', () => {
    const rules = [
      { id: 'a', name: 'cond', enabled: true, priority: 200, audience: { platforms: ['ios'], countries: ['US'] }, value: 14, updatedAt: null, kind: 'conditional' as const },
      { id: 'b', name: 'web', enabled: true, priority: 100, audience: { platforms: ['web'] }, value: 7, updatedAt: null, kind: 'platform' as const },
      { id: 'c', name: 'off', enabled: false, priority: 300, audience: {}, value: 14, updatedAt: null, kind: 'platform' as const },
    ];
    expect(effectiveTrialDays(rules, 3, 7)).toEqual({ ios: 3, android: 3, web: 7 });
    expect(effectiveTrialDays([], null, 7)).toEqual({ ios: 7, android: 7, web: 7 });
  });
});

describe('status', () => {
  it('reports today’s prod: stores at 3 days, web rule at 7 → out of sync', async () => {
    const s = await service().status();
    expect(s.appStore).toMatchObject({ days: 3, consistent: true, territories: TERRITORIES, error: null });
    expect(s.appStore.subscriptions).toHaveLength(2);
    expect(s.googlePlay).toMatchObject({ days: 3, consistent: true, canWrite: true });
    expect(s.remoteConfig.effective).toEqual({ ios: 3, android: 3, web: 7 });
    expect(s.inSync).toBe(false);
    expect(s.issues.join(' ')).toMatch(/Web \(Stripe\) trial is 7 days but the stores give 3/);
    expect(asc.writes()).toEqual([]);
    expect(play.writes()).toEqual([]);
  });

  it('in sync when stores and every platform agree', async () => {
    db.getRows('remote_config_rules').length = 0;
    expect((await service().status()).inSync).toBe(true);
  });

  it('flags a store that differs and a missing ASC configuration', async () => {
    play = new FakePlay(7);
    const s = await service({ ascConfigured: false }).status();
    expect(s.appStore.error).toMatch(/not configured/);
    expect(s.googlePlay.days).toBe(7);
    expect(s.inSync).toBe(false);
    expect(s.issues.join(' ')).toMatch(/Android copy says 3 days but Google Play gives 7/);
  });
});

describe('plan', () => {
  it('7 days: exact store ops, then default 3 → 7 and delete the web rule; no writes', async () => {
    const p = await service().plan(7);
    expect(p.valid).toBe(true);
    expect(p.planHash).toMatch(/^[0-9a-f]{64}$/);
    const byStore = (s: string) => p.steps.filter((x) => x.store === s);
    expect(byStore('app_store')).toHaveLength(SUBS.length * TERRITORIES.length * 2);
    expect(byStore('google_play').map((x) => x.action)).toEqual(['create_offer', 'activate_offer', 'deactivate_offer', 'create_offer', 'activate_offer', 'deactivate_offer']);
    expect(byStore('remote_config').map((x) => x.action)).toEqual(['set_default', 'delete_rule']);
    expect(p.steps.at(-1)!.description).toMatch(/redundant once the default is 7/);
    expect(p.steps[1].request).toMatchObject({ method: 'POST', path: '/v1/subscriptionIntroductoryOffers' });
    const w = p.warnings.join('\n');
    expect(w).toMatch(/can't be edited/);
    expect(w).toMatch(/need no App Review/);
    expect(w).toMatch(/NOT eligible again/);
    expect(asc.writes()).toEqual([]);
    expect(play.writes()).toEqual([]);
    expect(auditRows()).toEqual([]);
  });

  it('the same state gives the same hash; a change gives another', async () => {
    const a = await service().plan(7);
    expect((await service().plan(7)).planHash).toBe(a.planHash);
    expect((await service().plan(14)).planHash).not.toBe(a.planHash);
    asc.add(SUBS[0].id, 'USA', 'ONE_WEEK', { startDate: '2026-12-01' });
    expect((await service().plan(7)).planHash).not.toBe(a.planHash);
  });

  it('rejects lengths the stores cannot both express', async () => {
    for (const d of [5, 30]) {
      const p = await service().plan(d);
      expect(p.valid).toBe(false);
      expect(p.errors[0]).toMatch(/not supported.*3, 7, 14/);
      expect(p.steps).toEqual([]);
    }
  });

  it('needs the Play monetization key when Play must change', async () => {
    const p = await service({ playWrite: false }).plan(7);
    expect(p.valid).toBe(false);
    expect(p.errors.join(' ')).toMatch(/GOOGLE_PLAY_MONETIZATION_SA_KEY.*Manage store presence/);
  });

  it('needs App Store credentials', async () => {
    const p = await service({ ascConfigured: false }).plan(7);
    expect(p.valid).toBe(false);
    expect(p.errors.join(' ')).toMatch(/Can't read the App Store/);
  });

  it('3 days today: no store ops, only the redundant web rule goes', async () => {
    const p = await service().plan(3);
    expect(p.steps.map((s) => s.action)).toEqual(['delete_rule']);
    expect(p.steps[0].description).toMatch(/contradict the stores/);
  });
});

describe('apply', () => {
  it('runs stores → verify → remote config and audits every step with the actor', async () => {
    const svc = service();
    const p = await svc.plan(7);
    const r = await svc.apply(7, p.planHash, ACTOR);
    expect(r.ok).toBe(true);
    expect(r.remoteConfigChanged).toBe(true);
    expect(r.steps.every((s) => s.status === 'done')).toBe(true);
    expect(r.steps.find((s) => s.id === 'verify')!.status).toBe('done');
    // Stores
    expect(asc.offers).toHaveLength(10);
    expect(asc.offers.every((o) => o.duration === 'ONE_WEEK' && o.offerMode === 'FREE_TRIAL' && o.targetSubscriptionPlanType === 'UPFRONT')).toBe(true);
    expect(play.offers.filter((o) => o.state === 'ACTIVE').map((o) => o.offerId).sort()).toEqual(['annual-trial7d', 'monthly-trial7d']);
    expect(play.offers.filter((o) => o.state === 'INACTIVE').map((o) => o.offerId).sort()).toEqual(['annual-trial3d', 'monthly-trial3d']);
    // Remote config
    expect(db.getRows('remote_config_defaults')[0]).toMatchObject({ config_key: 'trial_days', value: 7, updated_by: ACTOR.email });
    expect(db.getRows('remote_config_rules')).toEqual([]);
    // Audit: 26 store steps + verify + summary under trial_sync; default + rule delete under trial_days.
    const sync = auditRows().filter((c) => c.config_key === 'trial_sync');
    expect(sync).toHaveLength(26 + 2);
    expect(sync.every((c) => c.actor === ACTOR.email && c.before.runId === r.runId)).toBe(true);
    expect(auditRows().filter((c) => c.config_key === 'trial_days').map((c) => `${c.target}:${c.action}`)).toEqual(['default:update', 'rule:delete']);
    expect(r.status?.inSync).toBe(true);
  });

  it('is idempotent: a second run at the same length changes nothing', async () => {
    const svc = service();
    await svc.apply(7, (await svc.plan(7)).planHash, ACTOR);
    const writesBefore = asc.writes().length + play.writes().length;
    const again = await svc.plan(7);
    expect(again.noop).toBe(true);
    const r = await svc.apply(7, again.planHash, ACTOR);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Already in sync/);
    expect(asc.writes().length + play.writes().length).toBe(writesBefore);
  });

  it('refuses when the state changed since the preview (PLAN_STALE) and writes nothing', async () => {
    const svc = service();
    const p = await svc.plan(7);
    db.getRows('remote_config_defaults')[0].value = 5;
    await expect(svc.apply(7, p.planHash, ACTOR)).rejects.toMatchObject({ status: 409, code: 'PLAN_STALE' });
    expect(asc.writes()).toEqual([]);
    expect(play.writes()).toEqual([]);
    expect(auditRows()).toEqual([]);
  });

  it('refuses an invalid plan even with a matching hash', async () => {
    const svc = service({ playWrite: false });
    const p = await svc.plan(7);
    await expect(svc.apply(7, p.planHash, ACTOR)).rejects.toMatchObject({ status: 422, code: 'PLAN_INVALID' });
    expect(asc.writes()).toEqual([]);
  });

  it('a Play failure stops the run: App Store changed, remote config untouched, exact report; a retry finishes', async () => {
    play.fail.push((c) => (c.method === 'POST' && c.url.includes('offerId=monthly-trial7d') ? { status: 403, body: { error: { message: 'The caller does not have permission' } } } : null));
    const svc = service();
    const r = await svc.apply(7, (await svc.plan(7)).planHash, ACTOR);
    expect(r.ok).toBe(false);
    expect(r.remoteConfigChanged).toBe(false);
    expect(r.message).toMatch(/remote config was NOT changed/);
    const failed = r.steps.filter((s) => s.status === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ store: 'google_play', action: 'create_offer', error: expect.stringMatching(/does not have permission/) });
    expect(r.changed.filter((c) => c.startsWith('App Store'))).toHaveLength(20);
    expect(r.changed.filter((c) => c.startsWith('Google Play'))).toHaveLength(3); // annual done
    expect(r.steps.filter((s) => s.status === 'skipped').map((s) => s.action)).toEqual(['activate_offer', 'deactivate_offer', 'verify', 'set_default', 'delete_rule']);
    expect(db.getRows('remote_config_defaults')[0].value).toBe(3);
    expect(db.getRows('remote_config_rules')).toHaveLength(1);
    expect(auditRows().some((c) => c.config_key === 'trial_sync' && c.after?.status === 'failed')).toBe(true);
    expect(auditRows().some((c) => c.config_key === 'trial_days')).toBe(false);

    // Retry after the permission is fixed: only what is missing is planned.
    play.fail.length = 0;
    const p2 = await svc.plan(7);
    expect(p2.steps.filter((s) => s.store === 'app_store')).toEqual([]);
    expect(p2.steps.filter((s) => s.store === 'google_play').map((s) => s.action)).toEqual(['create_offer', 'activate_offer', 'deactivate_offer']);
    const r2 = await svc.apply(7, p2.planHash, ACTOR);
    expect(r2.ok).toBe(true);
    expect(r2.status?.inSync).toBe(true);
  });

  it('an App Store create failure re-creates the deleted offer and stops', async () => {
    let n = 0;
    asc.fail.push((c) => (c.method === 'POST' && ++n === 2 ? { status: 409, body: { errors: [{ status: '409', detail: 'ENTITY_ERROR' }] } } : null));
    const svc = service();
    const r = await svc.apply(7, (await svc.plan(7)).planHash, ACTOR);
    expect(r.ok).toBe(false);
    const failed = r.steps.find((s) => s.status === 'failed')!;
    expect(failed).toMatchObject({ store: 'app_store', action: 'create_offer', detail: { restored: 'FREE_TRIAL THREE_DAYS' } });
    // First territory switched, second restored to 3 days, the rest untouched: no territory is left without a trial.
    expect(asc.offers).toHaveLength(10);
    expect(asc.offers.filter((o) => o.duration === 'ONE_WEEK')).toHaveLength(1);
    expect(play.writes()).toEqual([]);
    expect(db.getRows('remote_config_defaults')[0].value).toBe(3);
  });

  it('an App Store 5xx on create that still created the offer counts as done', async () => {
    let n = 0;
    asc.fail.push((c) => {
      if (c.method === 'POST' && ++n === 1) {
        // Simulate Apple creating the offer and then answering 500.
        const b = c.body.data;
        asc.add(b.relationships.subscription.data.id, b.relationships.territory.data.id, b.attributes.duration, { startDate: '2026-11-09' });
        return { status: 500 };
      }
      return null;
    });
    const svc = service();
    const r = await svc.apply(7, (await svc.plan(7)).planHash, ACTOR);
    expect(r.ok).toBe(true);
    expect(r.steps[1].detail).toMatchObject({ note: expect.stringMatching(/offer exists/) });
  });

  it('a failed read-back leaves remote config alone', async () => {
    const svc = service();
    const p = await svc.plan(7);
    // Play silently ignores deactivate → two active trial offers remain.
    play.fail.push((c) => (c.url.endsWith(':deactivate') ? { status: 200, body: {} } : null));
    const r = await svc.apply(7, p.planHash, ACTOR);
    expect(r.ok).toBe(false);
    expect(r.steps.find((s) => s.id === 'verify')).toMatchObject({ status: 'failed', error: expect.stringMatching(/expected one active 7-day trial offer/) });
    expect(db.getRows('remote_config_defaults')[0].value).toBe(3);
  });
});
