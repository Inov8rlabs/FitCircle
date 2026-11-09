/**
 * promo_style@1 on the real home feed route (docs/PROMO_BUTTON_STYLE_SPEC.md):
 *  - shipped-client compat: 1.1.0–1.1.2 requests (iOS + Android, with/without icon_keys) return EXACTLY the
 *    pre-style payload (fixtures/promo-style-legacy-baseline.json, generated from origin/main 950b9fe with
 *    promo-style-scenario.ts) even with lifecycle + system promo looks published;
 *  - capability gating via `features=` and X-Client-Features;
 *  - published looks (Pro lifecycle state, system promo), A/B creative ids, fallbacks, kill switch;
 *  - Pro lifecycle defaults unchanged.
 * In-memory Supabase; nothing touches a real DB.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ tasks: [] as Array<() => unknown> }));

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
vi.mock('@/lib/middleware/mobile-auto-refresh', () => ({ addAutoRefreshHeaders: async (_req: unknown, res: unknown) => res }));
vi.mock('@/lib/utils/after-response', () => ({ runAfterResponse: (task: () => unknown) => void h.tasks.push(task) }));
vi.mock('@/lib/services/campaign-service', () => ({
  CampaignService: { fetchActiveRows: async () => [] },
  featuredCampaign: () => ({ slug: 'hold_the_line', phase: 'live' }),
  viewerToday: () => '2026-11-08',
}));
vi.mock('@/lib/services/feature-flag-service', () => ({
  FeatureFlagService: { evaluate: (flag: { name: string } | undefined) => ({ enabled: !!flag }) },
}));
vi.mock('@/lib/services/entitlement-service', () => ({
  normalizeTier: (raw: string | null | undefined) => (raw === 'premium' || raw === 'enterprise' ? 'premium' : 'free'),
}));
vi.mock('@/lib/services/vitals-service', () => ({
  VitalsService: { getHydrationToday: async () => ({ todayMl: 0, goalMl: 2000, date: '2026-11-08' }) },
}));

import { HomeFeedFakeDb, setHomeFeedDb } from '@/lib/home-feed/__tests__/fake-db';
import { DEFAULT_CONFIG, configVersion, validateConfig, type ProLifecycleConfig } from '@/lib/pro-lifecycle';
import { LOOK_PRESETS, PRESETS, type StyleSetting } from '@/lib/promos';
import { promoPropsSchema } from '@/lib/promos/creative';
import { HomeFeedService } from '@/lib/services/home-feed-service';

import { GET } from '../route';

import { ANDROID, EXPIRED, EXPIRING, FREE, IOS, NEWBIE, NOW, V110, feedRequest, legacyCases, seed, stableBody } from './promo-style-scenario';

const BASELINE: Record<string, any> = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'promo-style-legacy-baseline.json'), 'utf8'));
const STYLE_KEYS = ['style', 'surface', 'eyebrowColor', 'accent'];

let db: HomeFeedFakeDb;

const AB: StyleSetting = {
  variants: [
    { id: 'a', weight: 50, ...LOOK_PRESETS.today.appearance },
    { id: 'b', weight: 50, ...LOOK_PRESETS.paywall_style.appearance },
  ],
} as StyleSetting;

function publishLifecycle(mutate: (c: ProLifecycleConfig) => void) {
  const cfg = structuredClone(DEFAULT_CONFIG);
  mutate(cfg);
  db.rows('feature_flags').push({ name: 'pro_lifecycle_prompts', is_enabled: true, metadata: cfg, updated_at: '2026-11-01T00:00:00Z' });
  HomeFeedService.clearCaches();
}
function publishStyles(metadata: unknown) {
  db.rows('feature_flags').push({ name: 'promo_styles', is_enabled: true, metadata, updated_at: '2026-11-01T00:00:00Z' });
  HomeFeedService.clearCaches();
}
/** Every looks setting at once: lifecycle A/B + single paywall look, system promos styled. */
function publishEverything() {
  publishLifecycle((c) => {
    c.states.pro_expiring.style = AB;
    c.states.pro_expired.style = { variants: [{ id: 'b', weight: 100, ...LOOK_PRESETS.brand_purple.appearance }] } as StyleSetting;
  });
  publishStyles({
    version: 1,
    promos: {
      first_meal: { variants: [{ id: 'b', weight: 100, ...LOOK_PRESETS.paywall_style.appearance }] },
      log_meal_now: { variants: [{ id: 'b', weight: 100, surface: 'dark', button: { preset: 'white' } }] },
    },
  });
}

const styled = (user: string, f = IOS, via: 'query' | 'header' = 'query', version = '1.1.3') =>
  feedRequest(user, f, via === 'query' ? { query: { ...V110(f), features: 'promo_style@1' }, version } : { headers: { 'x-client-features': 'icon_keys,promo_style@1' }, version });
const promoCard = async (r: Request) => (await (await GET(r as any)).json()).cards.find((c: any) => c.id.startsWith('promo:'));
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  }
  return out;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = new HomeFeedFakeDb();
  setHomeFeedDb(db);
  HomeFeedService.clearCaches();
  h.tasks.length = 0;
  process.env.PROMOS_ENABLED = 'true';
  delete process.env.PRO_ENDING_PROMPTS_ENABLED;
  delete process.env.PROMO_STYLES_ENABLED;
  seed(db);
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.PROMOS_ENABLED;
  delete process.env.PROMO_STYLES_ENABLED;
});

describe('shipped-client compat (1.1.0–1.1.2): the payload is byte-for-byte the pre-style one', () => {
  it('with nothing published', async () => {
    for (const c of legacyCases()) {
      const body = stableBody(await (await GET(feedRequest(c.as, c.f, { headers: c.headers }))).json());
      expect(JSON.stringify(body), c.name).toBe(JSON.stringify(BASELINE[c.name]));
    }
  });

  it('with lifecycle + system promo looks published (incl. an A/B test)', async () => {
    publishEverything();
    for (const c of legacyCases()) {
      const body = stableBody(await (await GET(feedRequest(c.as, c.f, { headers: c.headers }))).json());
      expect(JSON.stringify(body), c.name).toBe(JSON.stringify(BASELINE[c.name]));
      for (const card of body.cards.filter((x: any) => x.type === 'promo')) for (const k of STYLE_KEYS) expect(keysDeep(card.props).has(k), `${c.name} ${k}`).toBe(false);
    }
  });

  it('an unknown or future feature version alone changes nothing; promo_style@0 is ignored', async () => {
    publishEverything();
    for (const features of ['icon_keys', 'promo_style@0', 'reactions_v2,something_else@4']) {
      const body = stableBody(await (await GET(feedRequest(EXPIRING, IOS, { query: { ...V110(IOS), features } }))).json());
      expect(JSON.stringify(body), features).toBe(JSON.stringify(BASELINE['expiring-ios']));
    }
  });
});

describe('promo_style@1 clients (1.1.3+)', () => {
  it('declared via features= or X-Client-Features: nothing published → today’s look made explicit (white pill, gradient surface), same creative id', async () => {
    for (const via of ['query', 'header'] as const) {
      for (const f of [IOS, ANDROID]) {
        const card = await promoCard(styled(EXPIRING, f, via));
        const legacy = BASELINE[`expiring-${f === IOS ? 'ios' : 'android'}`].cards.find((c: any) => c.id === 'promo:pro_expiring');
        expect(card.props.primary.style).toEqual(PRESETS.white.style);
        expect(card.props.surface).toBe('gradient');
        expect(card.props.eyebrowColor).toBeUndefined();
        expect(card.props.creativeId).toBe(legacy.props.creativeId);
        expect(card.props.theme).toEqual(legacy.props.theme); // theme unchanged, no accent
        // (icon_keys clients get emoji: null — that's the icon-compat layer, not the schema.)
        expect(promoPropsSchema.safeParse({ ...card.props, emoji: card.props.emoji ?? undefined }).success).toBe(true);
      }
    }
  });

  it('a published lifecycle look reaches the card (dark surface + brand purple, Pro ended)', async () => {
    publishEverything();
    const card = await promoCard(styled(EXPIRED));
    expect(card.props).toMatchObject({ surface: 'dark', primary: { style: PRESETS.brand_purple.style, action: { params: { placement: 'pro_expired_card' } } } });
    expect(card.props.creativeId).not.toMatch(/_s[a-z0-9]+$/); // single variant: no test, no suffix
    expect(promoPropsSchema.safeParse(card.props).success).toBe(true);
  });

  it('A/B: the creative id carries the variant (`_sa` / `_sb`) and matches the look drawn', async () => {
    publishEverything();
    const card = await promoCard(styled(EXPIRING));
    const m = /_s([ab])$/.exec(card.props.creativeId);
    expect(m).not.toBeNull();
    expect(card.props.primary.style).toEqual(m![1] === 'a' ? PRESETS.white.style : PRESETS.paywall.style);
    expect(card.props.surface).toBe(m![1] === 'a' ? 'gradient' : 'dark');
  });

  it('system promo looks from the promo_styles row: first_meal (hero) and log_meal_now (banner: surface only)', async () => {
    publishEverything();
    const first = await promoCard(styled(NEWBIE));
    expect(first.props).toMatchObject({ promoId: 'first_meal', surface: 'dark', eyebrowColor: '#A78BFA', primary: { style: PRESETS.paywall.style } });
    const banner = await promoCard(styled(FREE));
    expect(banner.props).toMatchObject({ promoId: 'log_meal_now', layout: 'banner', surface: 'dark' });
    expect(banner.props.primary.style).toBeUndefined();
  });

  it('an invalid stored promo_styles blob → default look (feed intact)', async () => {
    publishStyles({ version: 1, promos: { first_meal: { variants: [{ id: 'b', weight: 100, surface: 'gradient', button: { preset: 'paywall' } }] } } });
    const card = await promoCard(styled(NEWBIE));
    expect(card.props.primary.style).toEqual(PRESETS.white.style);
    expect(card.props.surface).toBe('gradient');
  });

  it('PROMO_STYLES_ENABLED=false → every promo back to the default look (lifecycle included)', async () => {
    publishEverything();
    process.env.PROMO_STYLES_ENABLED = 'false';
    for (const user of [EXPIRED, NEWBIE]) {
      const card = await promoCard(styled(user));
      expect(card.props.primary.style).toEqual(PRESETS.white.style);
      expect(card.props.surface).toBe('gradient');
      expect(card.props.creativeId).not.toMatch(/_s[a-z0-9]+$/);
    }
  });

  it('a 1.1.3 build that forgot to declare the feature still gets the legacy payload', async () => {
    publishEverything();
    const body = stableBody(await (await GET(feedRequest(EXPIRING, IOS, { version: '1.1.3' }))).json());
    const card = body.cards.find((c: any) => c.id === 'promo:pro_expiring');
    expect(JSON.stringify(card)).toBe(JSON.stringify(BASELINE['expiring-ios'].cards.find((c: any) => c.id === 'promo:pro_expiring')));
  });
});

describe('Pro lifecycle defaults unchanged', () => {
  it('DEFAULT_CONFIG has no style, validates, and keeps its content version (pl1-562e61950e849e46 since the 7-day trial copy; was pl1-ee6710073d47a7a6 on main 950b9fe)', () => {
    for (const s of Object.values(DEFAULT_CONFIG.states)) expect(s.style).toBeUndefined();
    expect(validateConfig(DEFAULT_CONFIG).issues).toEqual([]);
    expect(configVersion(true, DEFAULT_CONFIG)).toBe('pl1-562e61950e849e46');
  });

  it('a stored pre-style config (no style keys) still parses; a blocked look is rejected with its path', () => {
    expect(validateConfig(structuredClone(DEFAULT_CONFIG)).config).not.toBeNull();
    const bad = structuredClone(DEFAULT_CONFIG);
    bad.states.pro_expiring.style = { variants: [{ id: 'b', weight: 100, surface: 'gradient', button: { preset: 'paywall' } }] } as StyleSetting;
    const v = validateConfig(bad);
    expect(v.config).toBeNull();
    expect(v.issues[0]).toMatchObject({ path: 'states.pro_expiring.style.variants.0.button' });
    expect(v.issues[0].message).toMatch(/blends into the card/);
  });
});
