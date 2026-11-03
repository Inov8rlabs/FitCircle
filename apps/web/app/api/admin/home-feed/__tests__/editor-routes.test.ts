/**
 * Home feed editor routes (Admin Tools "Home feed"): draft preview, publish,
 * revert, history. In-memory Supabase (fake-db) — nothing touches a real DB.
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
vi.mock('@/lib/services/campaign-service', () => ({ CampaignService: { fetchActiveRows: async () => [] }, featuredCampaign: () => null, viewerToday: () => '2026-10-22' }));
vi.mock('@/lib/services/feature-flag-service', () => ({ FeatureFlagService: { evaluate: () => ({ enabled: true }) } }));
vi.mock('@/lib/services/entitlement-service', () => ({
  normalizeTier: (raw: string | null | undefined) => (raw === 'premium' || raw === 'enterprise' ? 'premium' : 'free'),
}));
vi.mock('@/lib/services/vitals-service', () => ({ VitalsService: { getHydrationToday: async () => ({ todayMl: 0, goalMl: 2000, date: '2026-10-22' }) } }));

import { parseClientCards } from '@/lib/home-feed';
import { HomeFeedFakeDb, setHomeFeedDb } from '@/lib/home-feed/__tests__/fake-db';
import { rowToFlat, rulesetVersion } from '@/lib/home-feed/admin/ruleset';
import { readRequestInfo } from '@/lib/home-feed/context';
import { defaultClientDeclaration, PERSONA_USER_ID } from '@/lib/services/home-feed-admin-service';
import { HomeFeedService } from '@/lib/services/home-feed-service';

import { GET as changesRoute } from '../changes/route';
import { GET as previewGet, POST as previewPost } from '../preview/route';
import { POST as publishRoute } from '../publish/route';
import { POST as revertRoute } from '../revert/route';
import { GET as rulesGet } from '../rules/route';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_EMAIL = 'ani@inov8rlabs.com';
let db: HomeFeedFakeDb;

type Opts = { as?: string; secret?: boolean; actor?: string; method?: string; body?: unknown };
const req = (url: string, opts: Opts = {}) =>
  new NextRequest(`https://www.fitcircle.ai${url}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: {
      ...(opts.as ? { authorization: `Bearer user:${opts.as}` } : {}),
      ...(opts.secret ? { authorization: 'Bearer shh' } : {}),
      ...(opts.actor ? { 'x-admin-actor': opts.actor } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
const json = async (res: Response) => ({ status: res.status, body: await res.json() });
/** Admin Tools calls: API secret + X-Admin-Actor. */
const tools = (body?: unknown): Opts => ({ secret: true, actor: ADMIN_EMAIL, body });

const GOALS_FIRST = { key: 'new_user_goals_first', enabled: true, priority: 10, actions: [{ op: 'move', card: 'daily_goals', after: 'header' }] };
const HIDE_CHARTS = { key: 'hide_charts', enabled: true, priority: 0, platforms: ['android'], actions: [{ op: 'hide', card: 'charts' }] };

function seedRule(r: Record<string, unknown>) {
  const { key, enabled, priority, ...definition } = r as { key: string; enabled: boolean; priority: number };
  db.rows('home_feed_rules').push({ id: db.nextId(), key, enabled, priority, definition, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', updated_by: null });
}
const currentVersion = () => rulesetVersion(db.rows('home_feed_rules').map((r) => rowToFlat(r as any)));
const ids = (feed: { cards: { id: string }[] }) => feed.cards.map((c) => c.id);

beforeEach(() => {
  db = new HomeFeedFakeDb();
  setHomeFeedDb(db);
  HomeFeedService.clearCaches();
  db.rows('profiles').push(
    { id: ADMIN, email: ADMIN_EMAIL, display_name: 'Ani Bajirao', is_admin: true, timezone: 'UTC', subscription_tier: 'free', created_at: '2026-01-01T00:00:00Z' },
    { id: USER, email: 'u@example.com', display_name: 'Test User', is_admin: false, timezone: 'America/New_York', subscription_tier: 'free', created_at: '2026-10-20T00:00:00Z' }
  );
  process.env.ADMIN_API_SECRET = 'shh';
});
afterEach(() => {
  delete process.env.ADMIN_API_SECRET;
  delete process.env.HOME_FEED_RULES_ENABLED;
  delete process.env.HOME_FEED_ENABLED;
  delete process.env.HOME_FEED_PUBLISH_ENABLED;
});

describe('auth on every editor route', () => {
  it('401 signed out, 403 non-admin, 200 for admins and the API secret', async () => {
    const routes: Array<[string, (r: NextRequest) => Promise<Response>, unknown]> = [
      ['/api/admin/home-feed/rules', rulesGet, undefined],
      ['/api/admin/home-feed/changes', changesRoute, undefined],
      ['/api/admin/home-feed/preview', previewPost, { persona: 'typical', platform: 'ios', version: '1.1.0' }],
      ['/api/admin/home-feed/publish', publishRoute, { baseVersion: rulesetVersion([]), changes: [{ op: 'create', rule: GOALS_FIRST }], summary: 'x' }],
      ['/api/admin/home-feed/revert', revertRoute, { changeId: '11111111-1111-4111-8111-111111111111', baseVersion: rulesetVersion([]) }],
    ];
    for (const [url, handler, body] of routes) {
      expect((await handler(req(url, { body }))).status, `${url} signed out`).toBe(401);
      expect((await handler(req(url, { body, as: USER }))).status, `${url} non-admin`).toBe(403);
      expect((await handler(req(url, { body, secret: false, as: undefined, actor: ADMIN_EMAIL }))).status, `${url} actor header alone`).toBe(401);
    }
    expect((await rulesGet(req('/api/admin/home-feed/rules', { secret: true }))).status).toBe(200);
    expect((await changesRoute(req('/api/admin/home-feed/changes', { as: ADMIN }))).status).toBe(200);
  });

  it('publish / revert through the API secret require X-Admin-Actor (who to audit)', async () => {
    const res = await json(await publishRoute(req('/api/admin/home-feed/publish', { secret: true, body: { baseVersion: currentVersion(), changes: [{ op: 'create', rule: GOALS_FIRST }], summary: 'x' } })));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('missing_actor');
    expect(db.rows('home_feed_rules')).toHaveLength(0);
    const rev = await revertRoute(req('/api/admin/home-feed/revert', { secret: true, body: { changeId: '11111111-1111-4111-8111-111111111111', baseVersion: currentVersion() } }));
    expect(rev.status).toBe(400);
  });
});

describe('GET rules (editor state)', () => {
  it('adds the ruleset version, catalog, kill switches and the last change', async () => {
    seedRule(GOALS_FIRST);
    const { body } = await json(await rulesGet(req('/api/admin/home-feed/rules', tools())));
    expect(body.data.rules.map((r: any) => r.key)).toEqual(['new_user_goals_first']);
    expect(body.data.version).toBe(currentVersion());
    expect(body.data.catalog.defaultOrder[1]).toBe('header');
    expect(body.data.catalog.cards.find((c: any) => c.type === 'referral').kind).toBe('promo');
    expect(body.data.killSwitch).toMatchObject({ rulesEnabled: true, publishEnabled: true });
    expect(body.data.lastChange).toBeNull();
  });
});

describe('POST preview (draft)', () => {
  const base = { platform: 'ios', version: '1.1.0' };

  it('with no draft, before == after == what GET /api/mobile/home-feed would serve the same user', async () => {
    seedRule(GOALS_FIRST);
    seedRule(HIDE_CHARTS);
    const now = new Date('2026-10-22T16:00:00Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });
    try {
      const { status, body } = await json(await previewPost(req('/api/admin/home-feed/preview', tools({ ...base, userId: USER }))));
      expect(status).toBe(200);
      const d = body.data;
      const declared = defaultClientDeclaration('ios', '1.1.0');
      const profile = db.rows('profiles').find((p) => p.id === USER)!;
      const info = readRequestInfo({ headers: new Headers({ 'x-app-platform': 'ios', 'x-app-version': '1.1.0' }) });
      const prod = await HomeFeedService.getFeed(profile as any, info, parseClientCards(declared.cards), { record: false, now });
      expect(ids(d.before.feed)).toEqual(ids(prod));
      expect(ids(d.after.feed)).toEqual(ids(prod));
      expect(d.before.feed.layout_key).toBe(prod.layout_key);
      expect(d.after.feed.layout_key).toBe(prod.layout_key);
      expect(d.draft).toMatchObject({ baseVersion: currentVersion(), valid: true, changes: [] });
      // new user (2 days) → the goals rule applied; iOS → the android-only rule didn't.
      expect(d.after.trace.appliedRules).toEqual(['new_user_goals_first']);
      expect(d.subject).toMatchObject({ kind: 'user', userId: USER, displayName: 'Test User' });
      expect(db.rows('home_feed_decisions')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a full draft ruleset changes only `after`, reports the changeset, and the guardrails still apply', async () => {
    const draftRules = [{ key: 'referral_top', enabled: true, priority: 5, actions: [{ op: 'move', card: 'referral', after: 'header' }] }];
    const { body } = await json(await previewPost(req('/api/admin/home-feed/preview', tools({ ...base, persona: 'typical', draft: { rules: draftRules } }))));
    const d = body.data;
    expect(d.before.trace.appliedRules).toEqual([]);
    expect(d.after.trace.appliedRules).toEqual(['referral_top']);
    // The ranker put referral right under the header…
    expect(d.after.trace.ranked.slice(0, 3)).toEqual(['offline_banner', 'header', 'referral']);
    // …but G4 keeps hydration directly above referral, so hydration comes with it.
    const order: string[] = d.after.order;
    expect(order.indexOf('hydration')).toBe(order.indexOf('referral') - 1);
    expect(d.after.trace.guardrailAdjustments).toContain('hydration moved above referral');
    expect(d.draft.changes).toEqual([{ op: 'create', rule: draftRules[0] }]);
    expect(d.draft.rules).toEqual([{ key: 'referral_top', enabledBefore: null, enabledAfter: true, appliedBefore: false, appliedAfter: true }]);
    expect(d.subject).toMatchObject({ kind: 'persona', userId: null });
    expect(d.render.user).toMatchObject({ firstName: 'Alex', isPro: false });
  });

  it('invalid draft rules come back as issues (200), never as a partial publish', async () => {
    const { status, body } = await json(
      await previewPost(req('/api/admin/home-feed/preview', tools({ ...base, persona: 'typical', draft: { rules: [{ key: 'bad', enabled: true, actions: [{ op: 'move', card: 'vitals' }] }] } })))
    );
    expect(status).toBe(200);
    expect(body.data.draft.valid).toBe(false);
    expect(body.data.draft.issues[0]).toMatchObject({ key: 'bad' });
    expect(body.data.draft.issues[0].message).toMatch(/exactly one/);
  });

  it('previews as the admin matching X-Admin-Actor by default, 400 when no admin profile matches', async () => {
    const me = await json(await previewPost(req('/api/admin/home-feed/preview', tools(base))));
    expect(me.body.data.subject).toMatchObject({ kind: 'actor', userId: ADMIN });
    const stranger = await json(await previewPost(req('/api/admin/home-feed/preview', { secret: true, actor: 'nobody@inov8rlabs.com', body: base })));
    expect(stranger.status).toBe(400);
    expect(stranger.body.error.code).toBe('USER_REQUIRED');
    expect((await previewPost(req('/api/admin/home-feed/preview', tools({ ...base, userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })))).status).toBe(404);
  });

  it('reports kill switches: rules off → before == after == no rules; feed off → static default', async () => {
    process.env.HOME_FEED_RULES_ENABLED = 'false';
    const off = (await json(await previewPost(req('/api/admin/home-feed/preview', tools({ ...base, persona: 'typical', draft: { rules: [GOALS_FIRST] } }))))).body.data;
    expect(off.killSwitch).toMatchObject({ rulesEnabled: false, feedEnabled: true });
    expect(off.after.order).toEqual(off.before.order);
    process.env.HOME_FEED_ENABLED = 'off';
    const dead = (await json(await previewPost(req('/api/admin/home-feed/preview', tools({ ...base, persona: 'typical' }))))).body.data;
    expect(dead.killSwitch.feedEnabled).toBe(false);
    expect(dead.after.feed.layout_key).toBe('default-v1');
  });

  it('never exposes other members’ chat names or messages', async () => {
    const { body } = await json(await previewPost(req('/api/admin/home-feed/preview', tools({ ...base, persona: 'typical' }))));
    const chat = body.data.after.feed.cards.find((c: any) => c.type === 'circle_chat');
    if (chat?.props) expect(Object.keys(chat.props).sort()).toEqual(['circles_with_unread', 'total_unread', 'unread_count']);
    expect(JSON.stringify(body.data)).not.toMatch(/sender_display_name|"preview":"/);
  });

  it('keeps the GET preview working', async () => {
    expect((await previewGet(req(`/api/admin/home-feed/preview?userId=${USER}`, tools()))).status).toBe(200);
  });

  describe('profile_completion@1 (clients that declare it)', () => {
    const withCard = (platform: 'ios' | 'android') => `${defaultClientDeclaration(platform, '1.1.0').cards},profile_completion@1`;

    it('the typical persona shows the card (below the top 3) with its open questions; shipped declarations do not', async () => {
      for (const platform of ['ios', 'android'] as const) {
        const { body } = await json(await previewPost(req('/api/admin/home-feed/preview', tools({ platform, version: '1.1.0', persona: 'typical', cards: withCard(platform) }))));
        for (const s of [body.data.before, body.data.after]) {
          const order = ids(s.feed).filter((id) => id !== 'offline_banner');
          const at = order.indexOf('profile_completion');
          expect(at).toBeGreaterThanOrEqual(3); // G10
          const card = s.feed.cards.find((c: any) => c.type === 'profile_completion');
          expect(card.props).toMatchObject({ remaining: ['goal', 'goal_weight', 'birth_year', 'activity'], answered: 3, total: 7, percent: 43, goal: null });
        }
        const shipped = (await json(await previewPost(req('/api/admin/home-feed/preview', tools({ platform, version: '1.1.0', persona: 'typical' }))))).body.data;
        expect(ids(shipped.after.feed)).not.toContain('profile_completion');
      }
    });

    it('previewing a real user matches GET /api/mobile/home-feed, card included', async () => {
      Object.assign(db.rows('profiles').find((p) => p.id === USER)!, { onboarding_completed: true, height_cm: 180, gender: 'male', goals: [], preferences: {} });
      const now = new Date('2026-10-22T16:00:00Z');
      vi.useFakeTimers({ now, toFake: ['Date'] });
      try {
        const cards = withCard('ios');
        const { body } = await json(await previewPost(req('/api/admin/home-feed/preview', tools({ platform: 'ios', version: '1.1.0', userId: USER, cards }))));
        const profile = db.rows('profiles').find((p) => p.id === USER)!;
        const info = readRequestInfo({ headers: new Headers({ 'x-app-platform': 'ios', 'x-app-version': '1.1.0' }) });
        const prod = await HomeFeedService.getFeed(profile as any, info, parseClientCards(cards), { record: false, now });
        expect(ids(prod)).toContain('profile_completion');
        expect(ids(body.data.after.feed)).toEqual(ids(prod));
        const card = body.data.after.feed.cards.find((c: any) => c.type === 'profile_completion');
        expect(card.props).toEqual(prod.cards.find((c) => c.type === 'profile_completion')!.props);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('persona id is never a real user', () => {
    expect(PERSONA_USER_ID).toMatch(/^00000000-0000-4000-8000-0000000000/);
  });
});

describe('POST publish', () => {
  it('applies every change together, records the audit row with the actor, and clears the rules cache', async () => {
    seedRule(GOALS_FIRST);
    seedRule(HIDE_CHARTS);
    // Warm the per-instance cache with the old rules.
    expect((await HomeFeedService.loadRules()).map((r) => r.key).sort()).toEqual(['hide_charts', 'new_user_goals_first']);
    const before = currentVersion();
    const body = {
      baseVersion: before,
      changes: [
        { op: 'disable', key: 'hide_charts' },
        { op: 'update', key: 'new_user_goals_first', rule: { ...GOALS_FIRST, priority: 30 } },
        { op: 'create', rule: { key: 'campaign_below_vitals', enabled: true, priority: 40, actions: [{ op: 'move', card: 'campaign', after: 'vitals' }] } },
      ],
      summary: 'Move Campaign after Vitals; disable hide_charts',
      note: 'testing',
      descriptions: ['Move Campaign to after Vitals'],
    };
    const res = await json(await publishRoute(req('/api/admin/home-feed/publish', tools(body))));
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.version).toBe(currentVersion());
    expect(d.version).not.toBe(before);
    expect(d.change).toMatchObject({ seq: 1, action: 'publish', status: 'applied', actorEmail: ADMIN_EMAIL, summary: body.summary, note: 'testing', baseVersion: before, versionAfter: d.version });
    expect(d.change.changes.map((c: any) => c.op)).toEqual(['create', 'disable', 'update']);
    expect(d.change.descriptions).toEqual(['Move Campaign to after Vitals']);
    expect(d.change.rulesBefore.map((r: any) => r.key).sort()).toEqual(['hide_charts', 'new_user_goals_first']);
    expect(d.change.layoutBefore).toMatchObject({ persona: 'typical', appVersion: '1.1.0' });
    expect(d.change.layoutAfter.ios.length).toBeGreaterThan(5);
    expect(d.propagation.otherInstances).toMatch(/30 s/);

    const rows = db.rows('home_feed_rules');
    expect(rows.find((r) => r.key === 'hide_charts')!.enabled).toBe(false);
    expect(rows.find((r) => r.key === 'new_user_goals_first')!.priority).toBe(30);
    expect(rows.find((r) => r.key === 'campaign_below_vitals')).toMatchObject({ enabled: true, updated_by: ADMIN });
    expect(db.rows('home_feed_rule_changes')).toHaveLength(1);
    expect(db.rows('home_feed_rule_changes')[0]).toMatchObject({ actor_email: ADMIN_EMAIL, actor_user_id: ADMIN, status: 'applied' });
    // Cache invalidated on this instance: the next feed sees the new rules immediately.
    expect((await HomeFeedService.loadRules()).map((r) => r.key).sort()).toEqual(['campaign_below_vitals', 'new_user_goals_first']);
  });

  it('409 STALE_DRAFT when the rules changed since the draft was opened (nothing written)', async () => {
    seedRule(GOALS_FIRST);
    const stale = currentVersion();
    db.rows('home_feed_rules')[0].priority = 99; // someone else (legacy PATCH) changed it
    const res = await json(await publishRoute(req('/api/admin/home-feed/publish', tools({ baseVersion: stale, changes: [{ op: 'disable', key: GOALS_FIRST.key }], summary: 'x' }))));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STALE_DRAFT');
    expect(res.body.error.message).toMatch(/Reload/);
    expect(db.rows('home_feed_rules')[0].enabled).toBe(true);
    expect(db.rows('home_feed_rule_changes')).toHaveLength(0);
  });

  it('409 when another publish claimed the same revision, or one is in flight', async () => {
    const v = currentVersion();
    db.rows('home_feed_rule_changes').push({ id: db.nextId(), seq: 1, created_at: new Date(Date.now() - 600_000).toISOString(), status: 'applied', actor_email: 'x@inov8rlabs.com', summary: 's', base_version: v, rules_before: [] });
    // Simulate a racing writer grabbing seq 2 between our read and our insert.
    const origInsertGuard = db.unique.home_feed_rule_changes;
    db.rows('home_feed_rule_changes').push({ id: db.nextId(), seq: 2, created_at: new Date().toISOString(), status: 'pending', actor_email: 'y@inov8rlabs.com', summary: 's', base_version: v, rules_before: [] });
    const inFlight = await json(await publishRoute(req('/api/admin/home-feed/publish', tools({ baseVersion: v, changes: [{ op: 'create', rule: GOALS_FIRST }], summary: 'x' }))));
    expect(inFlight.status).toBe(409);
    expect(inFlight.body.error.code).toBe('PUBLISH_IN_PROGRESS');
    expect(inFlight.body.error.message).toMatch(/y@inov8rlabs.com/);
    expect(origInsertGuard).toEqual(['seq']);
    expect(db.rows('home_feed_rules')).toHaveLength(0);
  });

  it('409 when a concurrent publish claims the same revision between our read and our insert (UNIQUE seq)', async () => {
    const v = currentVersion();
    const racer = { id: db.nextId(), seq: 1, created_at: new Date().toISOString(), status: 'applied', actor_email: 'racer@inov8rlabs.com', summary: 's', base_version: v, rules_before: [] };
    const real = db.client.bind(db);
    // Our latest-change read sees an empty log; the racer's row lands right after it.
    let reads = 0;
    db.client = () => {
      const c = real();
      return {
        from: (t: string) => {
          const q = c.from(t);
          if (t === 'home_feed_rule_changes' && reads++ === 0) {
            const origThen = (q as any).then.bind(q);
            (q as any).then = (ok: any, ko: any) => origThen((r: any) => (db.rows('home_feed_rule_changes').push(racer), ok(r)), ko);
          }
          return q;
        },
      } as any;
    };
    const res = await json(await publishRoute(req('/api/admin/home-feed/publish', tools({ baseVersion: v, changes: [{ op: 'create', rule: GOALS_FIRST }], summary: 'x' }))));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STALE_DRAFT');
    expect(res.body.error.message).toMatch(/same moment/);
    expect(db.rows('home_feed_rules')).toHaveLength(0);
    expect(db.rows('home_feed_rule_changes')).toEqual([racer]);
  });

  it('400 with the issues when a change does not validate (nothing written)', async () => {
    const res = await json(
      await publishRoute(req('/api/admin/home-feed/publish', tools({ baseVersion: currentVersion(), changes: [{ op: 'create', rule: { key: 'bad', actions: [{ op: 'move', card: 'vitals' }] } }], summary: 'x' })))
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/bad.*exactly one/);
    expect(res.body.data.issues[0].key).toBe('bad');
    expect(db.rows('home_feed_rules')).toHaveLength(0);
    expect(db.rows('home_feed_rule_changes')).toHaveLength(0);
  });

  it('400 NO_CHANGES when the changes are a no-op', async () => {
    seedRule(GOALS_FIRST);
    const res = await json(await publishRoute(req('/api/admin/home-feed/publish', tools({ baseVersion: currentVersion(), changes: [{ op: 'enable', key: GOALS_FIRST.key }], summary: 'x' }))));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_CHANGES');
  });

  it('rolls back the upsert when the delete batch fails, and records the attempt as rolled_back', async () => {
    seedRule(GOALS_FIRST);
    seedRule(HIDE_CHARTS);
    const snapshot = JSON.parse(JSON.stringify(db.rows('home_feed_rules')));
    const v = currentVersion();
    db.failNext.push({ table: 'home_feed_rules', op: 'delete' });
    const res = await json(
      await publishRoute(
        req(
          '/api/admin/home-feed/publish',
          tools({
            baseVersion: v,
            changes: [
              { op: 'update', key: GOALS_FIRST.key, rule: { ...GOALS_FIRST, priority: 77 } },
              { op: 'create', rule: { key: 'brand_new', enabled: true, actions: [{ op: 'hide', card: 'vitals' }] } },
              { op: 'delete', key: 'hide_charts' },
            ],
            summary: 'x',
          })
        )
      )
    );
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('PUBLISH_ROLLED_BACK');
    expect(res.body.error.message).toMatch(/nothing changed/);
    // Every rule back to exactly what it was; the created one is gone.
    expect(currentVersion()).toBe(v);
    expect(db.rows('home_feed_rules').map((r) => [r.key, r.priority, r.enabled]).sort()).toEqual(snapshot.map((r: any) => [r.key, r.priority, r.enabled]).sort());
    expect(db.rows('home_feed_rule_changes')[0]).toMatchObject({ status: 'rolled_back', actor_email: ADMIN_EMAIL });
    expect(db.rows('home_feed_rule_changes')[0].error).toMatch(/injected/);
  });

  it('503 when publishing is switched off or the audit table is missing', async () => {
    process.env.HOME_FEED_PUBLISH_ENABLED = 'off';
    const off = await json(await publishRoute(req('/api/admin/home-feed/publish', tools({ baseVersion: currentVersion(), changes: [{ op: 'create', rule: GOALS_FIRST }], summary: 'x' }))));
    expect([off.status, off.body.error.code]).toEqual([503, 'PUBLISH_DISABLED']);
    delete process.env.HOME_FEED_PUBLISH_ENABLED;
    delete (db.tables as any).home_feed_rule_changes;
    db.failing.add('home_feed_rule_changes');
    db.tables.home_feed_rule_changes = [];
    const origRun = db.client;
    db.client = () => {
      const c = origRun.call(db);
      return { from: (t: string) => (t === 'home_feed_rule_changes' ? { select: () => ({ order: () => ({ limit: async () => ({ data: null, error: { code: '42P01', message: 'relation "home_feed_rule_changes" does not exist' } }) }) }) } : c.from(t)) } as any;
    };
    const missing = await json(await publishRoute(req('/api/admin/home-feed/publish', tools({ baseVersion: currentVersion(), changes: [{ op: 'create', rule: GOALS_FIRST }], summary: 'x' }))));
    expect([missing.status, missing.body.error.code]).toEqual([503, 'AUDIT_LOG_MISSING']);
    expect(db.rows('home_feed_rules')).toHaveLength(0);
    // History reads degrade to empty instead of failing the editor.
    expect((await json(await changesRoute(req('/api/admin/home-feed/changes', tools())))).body.data).toEqual({ changes: [], nextBefore: null });
  });
});

describe('POST revert + GET changes', () => {
  async function publish(changes: unknown[], summary: string) {
    const res = await json(await publishRoute(req('/api/admin/home-feed/publish', tools({ baseVersion: currentVersion(), changes, summary }))));
    expect(res.status).toBe(200);
    return res.body.data.change;
  }

  it('re-publishes the rules from before a change as a new audited `revert` change', async () => {
    seedRule(GOALS_FIRST);
    const original = currentVersion();
    const first = await publish([{ op: 'disable', key: GOALS_FIRST.key }, { op: 'create', rule: HIDE_CHARTS }], 'Disable goals rule, hide charts on Android');
    expect(currentVersion()).not.toBe(original);

    const res = await json(await revertRoute(req('/api/admin/home-feed/revert', tools({ changeId: first.id, baseVersion: currentVersion() }))));
    expect(res.status).toBe(200);
    const change = res.body.data.change;
    expect(change).toMatchObject({ seq: 2, action: 'revert', status: 'applied', revertsChangeId: first.id, actorEmail: ADMIN_EMAIL });
    expect(change.summary).toMatch(/^Revert change #1/);
    expect(change.changes.map((c: any) => `${c.op}:${c.key ?? c.rule.key}`).sort()).toEqual(['delete:hide_charts', 'enable:new_user_goals_first']);
    expect(currentVersion()).toBe(original);

    // Reverting again: already matches.
    const again = await json(await revertRoute(req('/api/admin/home-feed/revert', tools({ changeId: first.id, baseVersion: currentVersion() }))));
    expect([again.status, again.body.error.code]).toEqual([400, 'NOTHING_TO_REVERT']);
    // Stale base → 409 like publish.
    const stale = await json(await revertRoute(req('/api/admin/home-feed/revert', tools({ changeId: change.id, baseVersion: original.replace(/.$/, original.endsWith('0') ? '1' : '0') }))));
    expect(stale.status).toBe(409);
    expect((await revertRoute(req('/api/admin/home-feed/revert', tools({ changeId: '11111111-1111-4111-8111-111111111111', baseVersion: currentVersion() })))).status).toBe(404);
  });

  it('draft preview can show a revert before confirming (draft.revertOf)', async () => {
    seedRule(GOALS_FIRST);
    const first = await publish([{ op: 'disable', key: GOALS_FIRST.key }], 'Disable goals rule');
    const { body } = await json(await previewPost(req('/api/admin/home-feed/preview', tools({ platform: 'ios', version: '1.1.0', userId: USER, draft: { revertOf: first.id } }))));
    expect(body.data.draft.changes).toEqual([{ op: 'enable', key: GOALS_FIRST.key }]);
    expect(body.data.draft.revertOf.id).toBe(first.id);
    expect(body.data.after.trace.appliedRules).toEqual(['new_user_goals_first']);
    expect(body.data.before.trace.appliedRules).toEqual([]);
  });

  it('lists changes newest first with paging', async () => {
    seedRule(GOALS_FIRST);
    await publish([{ op: 'disable', key: GOALS_FIRST.key }], 'one');
    await publish([{ op: 'enable', key: GOALS_FIRST.key }], 'two');
    await publish([{ op: 'disable', key: GOALS_FIRST.key }], 'three');
    const page1 = (await json(await changesRoute(req('/api/admin/home-feed/changes?limit=2', tools())))).body.data;
    expect(page1.changes.map((c: any) => [c.seq, c.summary])).toEqual([
      [3, 'three'],
      [2, 'two'],
    ]);
    expect(page1.nextBefore).toBe(2);
    const page2 = (await json(await changesRoute(req('/api/admin/home-feed/changes?limit=2&before=2', tools())))).body.data;
    expect(page2.changes.map((c: any) => c.summary)).toEqual(['one']);
    expect(page2.nextBefore).toBeNull();
    const state = (await json(await rulesGet(req('/api/admin/home-feed/rules', tools())))).body.data;
    expect(state.lastChange).toMatchObject({ seq: 3, summary: 'three' });
  });
});
