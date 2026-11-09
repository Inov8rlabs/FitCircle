/**
 * Admin Tools "Pro lifecycle" routes (docs/PRO_LIFECYCLE_PROMPTS.md §6):
 * auth, state (defaults without a row), preview (each state's card in the
 * persona's real feed, before/after), publish (validation, optimistic
 * concurrency, audit), history, audience, and the home feed editor's new
 * personas. In-memory Supabase.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return { createAdminSupabase: () => getHomeFeedDb().client() };
});
vi.mock('@/lib/middleware/mobile-auth', async () => {
  const { getHomeFeedDb } = await import('@/lib/home-feed/__tests__/fake-db');
  return {
    requireMobileAuth: async (request: Request) => {
      const auth = request.headers.get('authorization') ?? '';
      const id = auth.startsWith('Bearer user:') ? auth.slice('Bearer user:'.length) : null;
      const profile = id ? getHomeFeedDb().rows('profiles').find((p) => p.id === id) : null;
      if (!profile) throw new Error('Unauthorized');
      return { ...profile };
    },
  };
});
vi.mock('@/lib/services/campaign-service', () => ({ CampaignService: { fetchActiveRows: async () => [] }, featuredCampaign: () => null, viewerToday: () => '2026-11-08' }));
vi.mock('@/lib/services/feature-flag-service', () => ({ FeatureFlagService: { evaluate: () => ({ enabled: true }) } }));
vi.mock('@/lib/services/entitlement-service', () => ({
  normalizeTier: (raw: string | null | undefined) => (raw === 'premium' || raw === 'enterprise' ? 'premium' : 'free'),
}));
vi.mock('@/lib/services/vitals-service', () => ({ VitalsService: { getHydrationToday: async () => ({ todayMl: 0, goalMl: 2000, date: '2026-11-08' }) } }));
vi.mock('@/lib/services/notification-preferences-service', () => ({ NotificationPreferencesService: { getPreferences: async () => null } }));

import { HomeFeedFakeDb, setHomeFeedDb } from '@/lib/home-feed/__tests__/fake-db';
import { DEFAULT_CONFIG, configVersion } from '@/lib/pro-lifecycle';
import { promoPropsSchema } from '@/lib/promos/creative';
import { HomeFeedService } from '@/lib/services/home-feed-service';

import { POST as feedPreview } from '../preview/route';
import { GET as audienceGet } from '../pro-lifecycle/audience/route';
import { GET as changesGet } from '../pro-lifecycle/changes/route';
import { POST as previewPost } from '../pro-lifecycle/preview/route';
import { POST as publishPost } from '../pro-lifecycle/publish/route';
import { GET as stateGet } from '../pro-lifecycle/route';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FRIEND = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ADMIN_EMAIL = 'ani@inov8rlabs.com';
let db: HomeFeedFakeDb;

type Opts = { as?: string; secret?: boolean; actor?: string; body?: unknown };
const req = (url: string, opts: Opts = {}) =>
  new NextRequest(`https://www.fitcircle.ai${url}`, {
    method: opts.body !== undefined ? 'POST' : 'GET',
    headers: {
      ...(opts.as ? { authorization: `Bearer user:${opts.as}` } : {}),
      ...(opts.secret ? { authorization: 'Bearer shh' } : {}),
      ...(opts.actor ? { 'x-admin-actor': opts.actor } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const tools = (body?: unknown): Opts => ({ secret: true, actor: ADMIN_EMAIL, body });
const BASE = '/api/admin/home-feed/pro-lifecycle';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T16:00:00Z'));
  db = new HomeFeedFakeDb();
  setHomeFeedDb(db);
  HomeFeedService.clearCaches();
  process.env.ADMIN_API_SECRET = 'shh';
  process.env.PROMOS_ENABLED = 'true';
  db.rows('profiles').push(
    { id: ADMIN, email: ADMIN_EMAIL, display_name: 'Ani', is_admin: true, timezone: 'UTC', subscription_tier: 'free', created_at: '2026-01-01T00:00:00Z' },
    { id: USER, email: 'u@example.com', display_name: 'Test User', is_admin: false, timezone: 'America/New_York', subscription_tier: 'free', created_at: '2026-10-20T00:00:00Z' },
    {
      id: FRIEND,
      email: 'asael@gmail.com',
      display_name: 'Asael Vargas',
      is_admin: false,
      timezone: 'America/Chicago',
      subscription_tier: 'premium',
      subscription_status: 'active',
      subscription_platform: 'promotional',
      subscription_product_id: 'referral',
      subscription_expires_at: '2026-11-09T19:17:45.902Z',
      created_at: '2026-10-20T00:00:00Z',
    }
  );
  db.rows('complimentary_grants').push({ id: 'g1', user_id: FRIEND, granted_by: 'referral-program', created_at: '2026-11-02T19:17:45.965Z', expires_at: '2026-11-09T19:17:45.902Z', revoked_at: null });
  db.rows('push_tokens').push({ user_id: FRIEND, platform: 'ios', is_active: true, last_used_at: '2026-11-08T00:00:00Z' });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.ADMIN_API_SECRET;
  delete process.env.PROMOS_ENABLED;
});

describe('auth', () => {
  it('401 signed out, 403 non-admin, ok for admins / the API secret', async () => {
    const routes: Array<[string, (r: NextRequest) => Promise<Response>, unknown]> = [
      [BASE, stateGet, undefined],
      [`${BASE}/audience`, audienceGet, undefined],
      [`${BASE}/changes`, changesGet, undefined],
      [`${BASE}/preview`, previewPost, {}],
      [`${BASE}/publish`, publishPost, { baseVersion: 'x', config: DEFAULT_CONFIG, enabled: true, summary: 'x' }],
    ];
    for (const [url, handler, body] of routes) {
      expect((await handler(req(url, { body }))).status, `${url} signed out`).toBe(401);
      expect((await handler(req(url, { body, as: USER }))).status, `${url} non-admin`).toBe(403);
    }
    expect((await stateGet(req(BASE, { as: ADMIN }))).status).toBe(200);
    expect((await stateGet(req(BASE, { secret: true }))).status).toBe(200);
  });

  it('publish via the API secret needs X-Admin-Actor', async () => {
    const res = await json(await publishPost(req(`${BASE}/publish`, { secret: true, body: { baseVersion: configVersion(true, DEFAULT_CONFIG), config: DEFAULT_CONFIG, enabled: true, summary: 'x' } })));
    expect(res).toMatchObject({ status: 400, body: { error: { code: 'missing_actor' } } });
    expect(db.rows('feature_flags')).toHaveLength(0);
  });
});

describe('state + preview', () => {
  it('no row yet → defaults, versioned, with limits / placeholders / states', async () => {
    const { body } = await json(await stateGet(req(BASE, tools())));
    expect(body.data).toMatchObject({ source: 'defaults', enabled: true, version: configVersion(true, DEFAULT_CONFIG), config: DEFAULT_CONFIG, killSwitch: { promptsEnabled: true, promosEnabled: true } });
    expect(body.data.states.map((s: any) => [s.state, s.paywallSource, s.pushType])).toEqual([
      ['pro_expiring', 'pro_expiring_card', 'pro_expiring_reminder'],
      ['pro_expired', 'pro_expired_card', 'pro_expired'],
      ['trial_expiring', 'trial_expiring_card', null],
    ]);
  });

  it('preview: each state card in the persona feed (right under the header), push copy; draft vs published', async () => {
    const draft = structuredClone(DEFAULT_CONFIG);
    draft.states.pro_expired.copy.title = 'Miss Pro, {{first_name}}?';
    draft.states.pro_expired.layout = 'banner';
    draft.states.trial_expiring.enabled = true;
    const { status, body } = await json(await previewPost(req(`${BASE}/preview`, tools({ config: draft, platform: 'ios', version: '1.1.0', timezone: 'America/Chicago', sample: { trialAvailable: false, usage: 'sample' } }))));
    expect(status).toBe(200);
    const d = body.data;
    expect(d.draft).toMatchObject({ valid: true, issues: [] });
    expect(d.draft.changes.map((c: any) => c.path)).toEqual(['states.pro_expired.copy.title', 'states.pro_expired.layout', 'states.trial_expiring.enabled']);
    expect(d.before.pro_expired.card.props).toMatchObject({ layout: 'hero', title: 'Your free Pro week ended', primary: { label: 'Get Pro back' } });
    expect(d.after.pro_expired.card.props).toMatchObject({ layout: 'banner', title: 'Miss Pro, Alex?' });
    expect(d.after.pro_expired.position).toBe(2);
    expect(d.after.pro_expiring.card.props.body).toBe('So far with Pro: 5 meals analyzed by AI and 1 weekly plan from Fitzy. Keep the momentum going.');
    expect(d.after.pro_expiring.push).toMatchObject({ type: 'pro_expiring_reminder', title: 'Your free Pro week ends tomorrow', enabled: true, error: null });
    expect(d.after.pro_expiring.push.body).not.toMatch(/free trial/);
    expect(d.before.trial_expiring).toMatchObject({ card: null, outcome: 'audience:state_disabled', push: null });
    expect(d.after.trial_expiring.card.props.primary.action.params.placement).toBe('trial_expiring_card');
    for (const s of ['pro_expiring', 'pro_expired', 'trial_expiring']) expect(promoPropsSchema.safeParse(d.after[s].card.props).success).toBe(true);
  });

  it('preview of an invalid draft reports issues and renders the published side', async () => {
    const bad = structuredClone(DEFAULT_CONFIG) as any;
    bad.states.pro_expiring.copy.cta = 'A button label that is far, far too long to ever fit';
    bad.states.pro_expired.copy.body = 'Hi {{nickname}}';
    const { body } = await json(await previewPost(req(`${BASE}/preview`, tools({ config: bad }))));
    expect(body.data.draft.valid).toBe(false);
    expect(body.data.draft.issues.map((i: any) => i.path)).toContain('states.pro_expiring.copy.cta');
    expect(body.data.after.pro_expiring.card).not.toBeNull();
  });

  it('a 1.0.9 client never gets the card in preview either', async () => {
    const { body } = await json(await previewPost(req(`${BASE}/preview`, tools({ version: '1.0.9' }))));
    expect(body.data.after.pro_expiring).toMatchObject({ card: null, outcome: 'client_no_promo' });
  });
});

describe('publish + history', () => {
  it('first publish inserts the flag row + audit row; the feed config cache picks it up; history lists it', async () => {
    const draft = structuredClone(DEFAULT_CONFIG);
    draft.states.pro_expired.snoozeDays = 5;
    const res = await json(await publishPost(req(`${BASE}/publish`, tools({ baseVersion: configVersion(true, DEFAULT_CONFIG), config: draft, enabled: true, summary: 'Snooze 5 days', note: 'test' }))));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ enabled: true, version: configVersion(true, draft), change: { actorEmail: ADMIN_EMAIL, summary: 'Snooze 5 days', note: 'test', diff: [{ path: 'states.pro_expired.snoozeDays', before: 3, after: 5 }] } });
    expect(db.rows('feature_flags')).toEqual([expect.objectContaining({ name: 'pro_lifecycle_prompts', is_enabled: true, metadata: draft })]);
    expect(db.rows('experiment_audit_log')).toEqual([expect.objectContaining({ experiment_key: 'config:pro_lifecycle_prompts', action: 'config_publish', actor: ADMIN_EMAIL })]);

    const state = await json(await stateGet(req(BASE, tools())));
    expect(state.body.data).toMatchObject({ source: 'database', version: configVersion(true, draft), lastChange: { summary: 'Snooze 5 days' } });
    const hist = await json(await changesGet(req(`${BASE}/changes`, tools())));
    expect(hist.body.data.changes).toHaveLength(1);
  });

  it('stale baseVersion → 409; identical → 400; invalid → 400 with issues; nothing written', async () => {
    const stale = await json(await publishPost(req(`${BASE}/publish`, tools({ baseVersion: 'pl1-old', config: DEFAULT_CONFIG, enabled: false, summary: 'x' }))));
    expect(stale).toMatchObject({ status: 409, body: { error: { code: 'STALE_DRAFT' } } });
    const bad = structuredClone(DEFAULT_CONFIG) as any;
    bad.states.pro_expired.daysAfter = 0;
    const invalid = await json(await publishPost(req(`${BASE}/publish`, tools({ baseVersion: configVersion(true, DEFAULT_CONFIG), config: bad, enabled: true, summary: 'x' }))));
    expect(invalid).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });
    expect(db.rows('feature_flags')).toHaveLength(0);

    // Publish once, then the same content again → NO_CHANGES; a concurrent writer → STALE.
    await publishPost(req(`${BASE}/publish`, tools({ baseVersion: configVersion(true, DEFAULT_CONFIG), config: DEFAULT_CONFIG, enabled: false, summary: 'off' })));
    const same = await json(await publishPost(req(`${BASE}/publish`, tools({ baseVersion: configVersion(false, DEFAULT_CONFIG), config: DEFAULT_CONFIG, enabled: false, summary: 'x' }))));
    expect(same).toMatchObject({ status: 400, body: { error: { code: 'NO_CHANGES' } } });
    db.rows('feature_flags')[0].updated_at = '2030-01-01T00:00:00Z';
    db.rows('feature_flags')[0].is_enabled = true;
    const raced = await json(await publishPost(req(`${BASE}/publish`, tools({ baseVersion: configVersion(false, DEFAULT_CONFIG), config: DEFAULT_CONFIG, enabled: true, summary: 'x' }))));
    expect(raced.status).toBe(409);
  });
});

describe('audience (read-only)', () => {
  it('lists the referral user in pro_expiring with platform, local end, usage and the scheduled push', async () => {
    const { body } = await json(await audienceGet(req(`${BASE}/audience`, tools())));
    const s = body.data.states;
    expect(s.pro_expiring.count).toBe(1);
    expect(s.pro_expiring.users[0]).toMatchObject({
      userId: FRIEND,
      displayName: 'Asael Vargas',
      platforms: ['ios'],
      timezone: 'America/Chicago',
      trialAvailable: true,
      push: { type: 'pro_expiring_reminder', status: 'due' },
    });
    expect(s.pro_expiring.users[0].endsAtLocal).toMatch(/Mon, Nov 9, 1:17 PM CST/);
    expect(s.pro_expired.count).toBe(0);
    expect(db.rows('notification_log')).toHaveLength(0);
  });
});

describe('home feed editor personas', () => {
  it('pro_expiring / pro_expired personas show the lifecycle card in the full feed', async () => {
    for (const [persona, id] of [['pro_expiring', 'promo:pro_expiring'], ['pro_expired', 'promo:pro_expired']] as const) {
      const { status, body } = await json(await feedPreview(req('/api/admin/home-feed/preview', tools({ persona, platform: 'android', version: '1.1.0', timezone: 'America/Toronto' }))));
      expect(status).toBe(200);
      expect(body.data.after.order.filter((c: string) => c !== 'offline_banner')[1]).toBe(id);
      expect(body.data.subject).toMatchObject({ kind: 'persona', userId: null });
    }
    const typical = await json(await feedPreview(req('/api/admin/home-feed/preview', tools({ persona: 'typical', platform: 'ios', version: '1.1.0' }))));
    expect(typical.body.data.after.order.some((c: string) => c.startsWith('promo:'))).toBe(false);
  });
});
