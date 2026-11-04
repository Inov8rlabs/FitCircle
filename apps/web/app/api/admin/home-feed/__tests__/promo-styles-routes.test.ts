/**
 * Admin Tools "Promo looks" + the Pro lifecycle look controls (docs/PROMO_BUTTON_STYLE_SPEC.md §7):
 * auth, state (no row → no styles), preview (legacy vs 1.1.3 props per creative + variant, issues),
 * publish (validation incl. contrast, optimistic concurrency, audit), history; and the Pro lifecycle
 * preview's app-version switch, forced A/B variant and style warnings. In-memory Supabase.
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
import { DEFAULT_PROMO_STYLES, LOOK_PRESETS, PRESETS, promoStylesVersion } from '@/lib/promos';
import { promoPropsSchema } from '@/lib/promos/creative';
import { HomeFeedService } from '@/lib/services/home-feed-service';

import { POST as lcPreview } from '../pro-lifecycle/preview/route';
import { POST as lcPublish } from '../pro-lifecycle/publish/route';
import { GET as lcState } from '../pro-lifecycle/route';
import { GET as changesGet } from '../promo-styles/changes/route';
import { POST as previewPost } from '../promo-styles/preview/route';
import { POST as publishPost } from '../promo-styles/publish/route';
import { GET as stateGet } from '../promo-styles/route';

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
const BASE = '/api/admin/home-feed/promo-styles';
const LC = '/api/admin/home-feed/pro-lifecycle';

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


const PAYWALL_FIRST_MEAL = { version: 1, promos: { first_meal: { variants: [{ id: 'b', weight: 100, ...LOOK_PRESETS.paywall_style.appearance }] } } };
const BASE0 = promoStylesVersion(DEFAULT_PROMO_STYLES);

describe('auth', () => {
  it('401 signed out, 403 non-admin; publish via the API secret needs X-Admin-Actor', async () => {
    const routes: Array<[string, (r: NextRequest) => Promise<Response>, unknown]> = [
      [BASE, stateGet, undefined],
      [`${BASE}/changes`, changesGet, undefined],
      [`${BASE}/preview`, previewPost, {}],
      [`${BASE}/publish`, publishPost, { baseVersion: 'x', config: DEFAULT_PROMO_STYLES, summary: 'x' }],
    ];
    for (const [url, handler, body] of routes) {
      expect((await handler(req(url, { body }))).status, `${url} signed out`).toBe(401);
      expect((await handler(req(url, { body, as: USER }))).status, `${url} non-admin`).toBe(403);
    }
    expect((await stateGet(req(BASE, { as: ADMIN }))).status).toBe(200);
    const res = await json(await publishPost(req(`${BASE}/publish`, { secret: true, body: { baseVersion: BASE0, config: PAYWALL_FIRST_MEAL, summary: 'x' } })));
    expect(res).toMatchObject({ status: 400, body: { error: { code: 'missing_actor' } } });
    expect(db.rows('feature_flags')).toHaveLength(0);
  });
});

describe('promo looks: state + preview', () => {
  it('no row → no styles; presets, looks, the 4 system promos with their creatives', async () => {
    const { body } = await json(await stateGet(req(BASE, tools())));
    const d = body.data;
    expect(d).toMatchObject({ source: 'defaults', version: BASE0, config: DEFAULT_PROMO_STYLES, killSwitch: { stylesEnabled: true, promosEnabled: true }, capability: { feature: 'promo_style@1', firstVersion: '1.1.3' } });
    expect(d.presets.map((p: any) => p.id)).toEqual(['white', 'paywall', 'brand_purple']);
    expect(d.presets[1].style).toEqual(PRESETS.paywall.style);
    expect(d.promos.map((p: any) => p.key)).toEqual(['first_meal', 'log_meal_now', 'pro_value', 'meet_fitzy']);
    expect(d.promos[0].creatives).toEqual([expect.objectContaining({ id: 'first_meal_v1', layout: 'hero' })]);
    expect(d.promos[2].creatives).toHaveLength(3);
  });

  it('preview: legacy props carry no style; each variant has 1.1.3 props + issues; changes listed', async () => {
    const draft = { version: 1, promos: { first_meal: { variants: [{ id: 'a', weight: 50, ...LOOK_PRESETS.today.appearance }, { id: 'b', weight: 50, ...LOOK_PRESETS.paywall_style.appearance }] }, pro_value: { variants: [{ id: 'a', weight: 100, surface: 'dark', button: { preset: 'paywall' } }] } } };
    const { status, body } = await json(await previewPost(req(`${BASE}/preview`, tools({ config: draft, platform: 'android' }))));
    expect(status).toBe(200);
    const d = body.data;
    expect(d.draft).toMatchObject({ valid: true, issues: [], baseVersion: BASE0 });
    expect(d.draft.changes.map((c: any) => c.path)).toEqual(['promos.first_meal', 'promos.pro_value']);
    // pro_value is a banner: the button style is not drawn → a warning per creative, not an error.
    expect(d.draft.warnings.some((w: any) => w.path === 'promos.pro_value.variants.0.button')).toBe(true);
    const first = d.promos.find((p: any) => p.key === 'first_meal').creatives[0];
    for (const k of ['style', 'surface', 'eyebrowColor']) expect(JSON.stringify(first.legacy)).not.toContain(`"${k}"`);
    expect(first.variants.map((v: any) => [v.id, v.props.surface, v.props.primary.style.preset])).toEqual([
      ['a', 'gradient', 'white'],
      ['b', 'dark', 'paywall'],
    ]);
    for (const v of first.variants) expect(promoPropsSchema.safeParse(v.props).success).toBe(true);
    expect(d.promos.find((p: any) => p.key === 'meet_fitzy')).toMatchObject({ configured: false });
  });

  it('preview of a blocked look: invalid draft, the variant shows its error and falls back to the default look', async () => {
    const bad = { version: 1, promos: { first_meal: { variants: [{ id: 'b', weight: 100, surface: 'gradient', button: { preset: 'brand_purple' } }] } } };
    const { body } = await json(await previewPost(req(`${BASE}/preview`, tools({ config: bad }))));
    expect(body.data.draft.valid).toBe(false);
    expect(body.data.draft.issues[0].path).toBe('promos.first_meal.variants.0.button');
    const v = body.data.promos[0].creatives[0].variants[0];
    expect(v).toMatchObject({ fellBack: true, issues: [expect.objectContaining({ level: 'error', path: 'button' })] });
    expect(v.props.primary.style).toEqual(PRESETS.white.style);
  });
});

describe('promo looks: publish + history', () => {
  it('first publish inserts the row + audit; the feed cache sees it; history lists it', async () => {
    const res = await json(await publishPost(req(`${BASE}/publish`, tools({ baseVersion: BASE0, config: PAYWALL_FIRST_MEAL, summary: 'First meal: paywall style', note: 'test B' }))));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ version: promoStylesVersion(PAYWALL_FIRST_MEAL as any), change: { actorEmail: ADMIN_EMAIL, summary: 'First meal: paywall style', note: 'test B', diff: [{ path: 'promos.first_meal', before: null }] } });
    expect(db.rows('feature_flags')).toEqual([expect.objectContaining({ name: 'promo_styles', metadata: PAYWALL_FIRST_MEAL })]);
    expect(db.rows('experiment_audit_log')).toEqual([expect.objectContaining({ experiment_key: 'config:promo_styles', action: 'config_publish', actor: ADMIN_EMAIL })]);
    const state = await json(await stateGet(req(BASE, tools())));
    expect(state.body.data).toMatchObject({ source: 'database', lastChange: { summary: 'First meal: paywall style' } });
    expect((await json(await changesGet(req(`${BASE}/changes`, tools())))).body.data.changes).toHaveLength(1);
  });

  it('blocked contrast → 400 VALIDATION_ERROR; stale → 409; identical → 400 NO_CHANGES; race → 409', async () => {
    const bad = { version: 1, promos: { first_meal: { variants: [{ id: 'b', weight: 100, surface: 'dark', button: { kind: 'solid', fill: '#7C3AED', text: '#111111' } }] } } };
    expect(await json(await publishPost(req(`${BASE}/publish`, tools({ baseVersion: BASE0, config: bad, summary: 'x' }))))).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });
    expect(await json(await publishPost(req(`${BASE}/publish`, tools({ baseVersion: 'ps1-old', config: PAYWALL_FIRST_MEAL, summary: 'x' }))))).toMatchObject({ status: 409, body: { error: { code: 'STALE_DRAFT' } } });
    expect(await json(await publishPost(req(`${BASE}/publish`, tools({ baseVersion: BASE0, config: { version: 1, promos: { nope: PAYWALL_FIRST_MEAL.promos.first_meal } }, summary: 'x' }))))).toMatchObject({ status: 400 });
    expect(db.rows('feature_flags')).toHaveLength(0);
    await publishPost(req(`${BASE}/publish`, tools({ baseVersion: BASE0, config: PAYWALL_FIRST_MEAL, summary: 'x' })));
    const v1 = promoStylesVersion(PAYWALL_FIRST_MEAL as any);
    expect(await json(await publishPost(req(`${BASE}/publish`, tools({ baseVersion: v1, config: PAYWALL_FIRST_MEAL, summary: 'x' }))))).toMatchObject({ status: 400, body: { error: { code: 'NO_CHANGES' } } });
    // Someone else published in between (different content) → the base version no longer matches.
    db.rows('feature_flags')[0].updated_at = '2030-01-01T00:00:00Z';
    db.rows('feature_flags')[0].metadata = { version: 1, promos: { meet_fitzy: { variants: [{ id: 'a', weight: 100, surface: 'dark', button: { preset: 'white' } }] } } };
    HomeFeedService.clearCaches();
    expect((await publishPost(req(`${BASE}/publish`, tools({ baseVersion: v1, config: DEFAULT_PROMO_STYLES, summary: 'x' })))).status).toBe(409);
  });
});

describe('Pro lifecycle look controls', () => {
  const withLook = () => {
    const c = structuredClone(DEFAULT_CONFIG) as any;
    c.states.pro_expiring.style = { variants: [{ id: 'a', weight: 50, ...LOOK_PRESETS.today.appearance }, { id: 'b', weight: 50, ...LOOK_PRESETS.paywall_style.appearance }] };
    return c;
  };

  it('state exposes each state theme + the style presets', async () => {
    const { body } = await json(await lcState(req(LC, tools())));
    expect(body.data.states[0].theme).toEqual({ background: { kind: 'gradient', colors: ['#1E1B4B', '#4338CA', '#7C3AED'] }, foreground: 'light' });
    expect(body.data.styles).toMatchObject({ enabled: true, capability: { feature: 'promo_style@1', firstVersion: '1.1.3' } });
    expect(body.data.styles.looks.map((l: any) => l.id)).toEqual(['today', 'paywall_style', 'brand_purple']);
  });

  it('preview: 1.1.3 shows the forced variant, 1.1.2 shows today’s card unchanged', async () => {
    const styled = await json(await lcPreview(req(`${LC}/preview`, tools({ config: withLook(), platform: 'ios', version: '1.1.3', styleVariant: 'b' }))));
    expect(styled.body.data.draft.changes.map((c: any) => c.path)).toEqual(['states.pro_expiring.style']);
    expect(styled.body.data.after.pro_expiring.card.props).toMatchObject({ surface: 'dark', eyebrowColor: '#A78BFA', primary: { style: PRESETS.paywall.style } });
    expect(styled.body.data.before.pro_expiring.card.props.primary.style).toEqual(PRESETS.white.style);
    const legacy = await json(await lcPreview(req(`${LC}/preview`, tools({ config: withLook(), platform: 'ios', version: '1.1.2', styleVariant: 'b' }))));
    const card = legacy.body.data.after.pro_expiring.card.props;
    for (const k of ['style', 'surface', 'eyebrowColor', 'accent']) expect(JSON.stringify(card)).not.toContain(`"${k}"`);
  });

  it('a look that blends into the state card blocks the draft (preview + publish); banner looks warn', async () => {
    const bad = structuredClone(DEFAULT_CONFIG) as any;
    bad.states.pro_expired.style = { variants: [{ id: 'b', weight: 100, surface: 'gradient', button: { preset: 'paywall' } }] };
    const p = await json(await lcPreview(req(`${LC}/preview`, tools({ config: bad, version: '1.1.3' }))));
    expect(p.body.data.draft.valid).toBe(false);
    expect(p.body.data.draft.issues[0].path).toBe('states.pro_expired.style.variants.0.button');
    const pub = await json(await lcPublish(req(`${LC}/publish`, tools({ baseVersion: configVersion(true, DEFAULT_CONFIG), config: bad, enabled: true, summary: 'x' }))));
    expect(pub).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });

    const banner = structuredClone(DEFAULT_CONFIG) as any;
    banner.states.pro_expired.layout = 'banner';
    banner.states.pro_expired.style = { variants: [{ id: 'b', weight: 100, ...LOOK_PRESETS.paywall_style.appearance }] };
    const w = await json(await lcPreview(req(`${LC}/preview`, tools({ config: banner, version: '1.1.3' }))));
    expect(w.body.data.draft).toMatchObject({ valid: true });
    expect(w.body.data.draft.warnings).toEqual([expect.objectContaining({ path: 'states.pro_expired.style.variants.0.button' })]);
  });

  it('publishing a look goes through the same audited flow', async () => {
    const res = await json(await lcPublish(req(`${LC}/publish`, tools({ baseVersion: configVersion(true, DEFAULT_CONFIG), config: withLook(), enabled: true, summary: 'Pro ending: A/B paywall style' }))));
    expect(res.status).toBe(200);
    expect(res.body.data.change.diff.map((d: any) => d.path)).toEqual(['states.pro_expiring.style']);
    expect(db.rows('experiment_audit_log')).toEqual([expect.objectContaining({ experiment_key: 'config:pro_lifecycle_prompts' })]);
  });
});
