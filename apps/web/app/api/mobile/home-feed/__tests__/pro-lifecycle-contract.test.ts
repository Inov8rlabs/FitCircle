/**
 * Pro lifecycle card on the real home feed route (docs/PRO_LIFECYCLE_PROMPTS.md):
 * placement + guardrails (G7/G8), the evergreen Pro upsells stepping aside,
 * kill switches, snooze via the events API, and a shipped-client compat check:
 * the card as iOS 1.1.0 (PromoCard.swift + PromoActionRunner.swift) and
 * Android 1.1.0 (PromoModels.kt PromoDecoder / PromoActionDecoder) decode it.
 * In-memory Supabase; nothing touches a real DB.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NextRequest } from 'next/server';
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
import { violations } from '@/lib/home-feed/guardrails';
import { DEFAULT_CONFIG } from '@/lib/pro-lifecycle';
import { promoPropsSchema } from '@/lib/promos/creative';
import { HomeFeedService } from '@/lib/services/home-feed-service';

import { POST as postEvents } from '../events/route';
import { GET } from '../route';

const EXPIRING = '55555555-5555-4555-8555-555555555555';
const EXPIRED = '66666666-6666-4666-8666-666666666666';
// Sun Nov 8 2026, 10:00 CST.
const NOW = new Date('2026-11-08T16:00:00Z');
const H = 3_600_000;
const D = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

type Fixture = { path: string; query: Record<string, string>; headers: Record<string, string> };
const IOS: Fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'ios-1.0.8.request.json'), 'utf8'));
const ANDROID: Fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'android-1.0.8.request.json'), 'utf8'));
/** What iOS / Android 1.1.0 send (HomeFeedClient / HomeFeedRepository): 1.0.8 cards + promo@1 + circle_chat@1, actions, layouts. */
const V110 = (f: Fixture) => ({
  cards: `${f.query.cards},promo@1,circle_chat@1`,
  actions: 'open_screen@1,paywall@1,invite@1,start_circle@1,enable_notifications@1,open_url@1,dismiss@1',
  promoLayouts: 'hero,banner,compact',
});

function req(as: string, f: Fixture = IOS, query: Record<string, string> = V110(f), version = '1.1.0') {
  const url = new URL(`https://www.fitcircle.ai${f.path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers = new Headers({ ...f.headers, authorization: `Bearer user:${as}`, 'x-client-timezone': 'America/Chicago', 'x-app-version': version });
  return new NextRequest(url, { headers });
}
const ids = (body: any): string[] => body.cards.map((c: any) => c.id);
const visible = (body: any): string[] => ids(body).filter((id) => id !== 'offline_banner');
const flushAfter = async () => {
  for (const t of h.tasks.splice(0)) await t();
};

let db: HomeFeedFakeDb;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = new HomeFeedFakeDb();
  setHomeFeedDb(db);
  HomeFeedService.clearCaches();
  h.tasks.length = 0;
  process.env.PROMOS_ENABLED = 'true';
  delete process.env.PRO_ENDING_PROMPTS_ENABLED;
  db.rows('feature_flags').push({ name: 'referrals', is_enabled: true }, { name: 'subscriptions', is_enabled: true });
  db.rows('feature_gates').push({ feature_key: 'food_ai_unlimited', required_tier: 'premium' });
  db.rows('profiles').push(
    {
      id: EXPIRING,
      email: 'asael@gmail.com',
      display_name: 'Asael Vargas',
      timezone: 'America/Chicago',
      created_at: '2026-10-20T00:00:00Z',
      subscription_tier: 'premium',
      subscription_status: 'active',
      subscription_platform: 'promotional',
      subscription_product_id: 'referral',
      subscription_expires_at: at(27 * H),
      preferences: {},
      fitzy_opened_at: null,
    },
    {
      id: EXPIRED,
      email: 'kalpana@gmail.com',
      display_name: 'Kalpana C',
      timezone: 'America/Toronto',
      created_at: '2026-10-20T00:00:00Z',
      subscription_tier: 'free',
      subscription_status: 'cancelled',
      subscription_platform: 'promotional',
      subscription_product_id: 'referral',
      subscription_expires_at: at(-5 * H),
      preferences: {},
      fitzy_opened_at: null,
    }
  );
  db.rows('complimentary_grants').push(
    { id: 'g1', user_id: EXPIRING, granted_by: 'referral-program', created_at: at(-7 * D + 27 * H), expires_at: at(27 * H), revoked_at: null },
    { id: 'g2', user_id: EXPIRED, granted_by: 'referral-program', created_at: at(-7 * D - 5 * H), expires_at: at(-5 * H), revoked_at: null }
  );
  for (const [i, user] of [EXPIRING, EXPIRED].entries()) {
    db.rows('food_log_entries').push(
      ...[0, 1, 2, 3, 4].map((k) => ({ id: `m${i}${k}`, user_id: user, entry_type: 'food', entry_date: '2026-11-05', meal_type: 'lunch', logged_at: at(-3 * D + k * H), created_at: at(-3 * D + k * H), title: 'Salad', nutrition_source: 'llm_vision', deleted_at: null }))
    );
  }
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.PROMOS_ENABLED;
  delete process.env.PRO_ENDING_PROMPTS_ENABLED;
});

describe('GET /api/mobile/home-feed — Pro lifecycle card', () => {
  it('Pro ending: hero right under the header, real usage, paywall pro_expiring_card; guardrails hold', async () => {
    const body = await (await GET(req(EXPIRING))).json();
    expect(visible(body).slice(0, 2)).toEqual(['header', 'promo:pro_expiring']);
    const card = body.cards.find((c: any) => c.id === 'promo:pro_expiring');
    expect(card).toMatchObject({ type: 'promo', version: 1 });
    expect(card.props).toMatchObject({
      promoId: 'pro_expiring',
      layout: 'hero',
      icon: 'hourglass',
      title: 'Your free Pro week ends tomorrow',
      body: 'So far with Pro: 5 meals analyzed by AI. Keep the momentum going.',
      countdown: { endsAt: '2026-11-09T13:00:00', label: 'Pro ends in' },
      primary: { label: 'Start 7-day free trial', action: { type: 'paywall', params: { placement: 'pro_expiring_card' } } },
    });
    expect(promoPropsSchema.safeParse(card.props).success).toBe(true);
    expect(violations(body.cards.filter((c: any) => c.type !== 'offline_banner'), { promoV1: true })).toEqual([]);
  });

  it('Pro ended: wins G7/G8 over the campaign, and the evergreen upsells (pro_value, pro_upsell) step aside', async () => {
    const body = await (await GET(req(EXPIRED))).json();
    expect(visible(body)[1]).toBe('promo:pro_expired');
    expect(ids(body)).not.toContain('promo:pro_value');
    expect(ids(body)).not.toContain('pro_upsell');
    const promoCategory = body.cards.filter((c: any) => ['promo', 'campaign', 'referral', 'pro_upsell'].includes(c.type) && c.id !== 'promo:first_meal');
    expect(promoCategory.length).toBeLessThanOrEqual(2);
    // The campaign card is still there, just lower (G8: one promo in the first 4).
    expect(visible(body).slice(0, 4).filter((id) => /^(promo:|campaign|referral|pro_upsell)/.test(id))).toEqual(['promo:pro_expired']);
    const card = body.cards.find((c: any) => c.id === 'promo:pro_expired');
    expect(card.props).toMatchObject({ title: 'Your free Pro week ended', icon: 'crown', primary: { label: 'Get Pro: 7 days free', action: { params: { placement: 'pro_expired_card' } } } });
    expect(card.props.countdown).toBeUndefined();
    expect(violations(body.cards.filter((c: any) => c.type !== 'offline_banner'), { promoV1: true })).toEqual([]);
  });

  it('Android 1.1.0 gets the same card', async () => {
    const body = await (await GET(req(EXPIRING, ANDROID))).json();
    expect(visible(body)[1]).toBe('promo:pro_expiring');
  });

  it('shipped 1.0.8/1.0.9 builds (no promo@1) never see it and cost no lifecycle reads', async () => {
    const body = await (await GET(req(EXPIRED, IOS, IOS.query, '1.0.9'))).json();
    expect(ids(body).some((id) => id.startsWith('promo:'))).toBe(false);
    expect(db.queries.complimentary_grants ?? 0).toBe(0);
  });

  it('kill switches: env, the admin master switch, a disabled state', async () => {
    process.env.PRO_ENDING_PROMPTS_ENABLED = 'false';
    expect(ids(await (await GET(req(EXPIRING))).json())).not.toContain('promo:pro_expiring');
    expect(db.queries.complimentary_grants ?? 0).toBe(0);
    delete process.env.PRO_ENDING_PROMPTS_ENABLED;

    db.rows('feature_flags').push({ name: 'pro_lifecycle_prompts', is_enabled: false, metadata: DEFAULT_CONFIG, updated_at: '2026-11-01T00:00:00Z' });
    HomeFeedService.clearCaches();
    expect(ids(await (await GET(req(EXPIRING))).json())).not.toContain('promo:pro_expiring');

    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.states.pro_expiring.enabled = false;
    Object.assign(db.rows('feature_flags').at(-1)!, { is_enabled: true, metadata: cfg });
    HomeFeedService.clearCaches();
    expect(ids(await (await GET(req(EXPIRING))).json())).not.toContain('promo:pro_expiring');
    expect(ids(await (await GET(req(EXPIRED))).json())).toContain('promo:pro_expired');
  });

  it('admin-published copy + layout reach the card (an invalid stored blob falls back to defaults)', async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.states.pro_expired.layout = 'banner';
    cfg.states.pro_expired.copy.title = '{{first_name}}, your {{period}} ended';
    db.rows('feature_flags').push({ name: 'pro_lifecycle_prompts', is_enabled: true, metadata: cfg, updated_at: '2026-11-01T00:00:00Z' });
    const card = (await (await GET(req(EXPIRED))).json()).cards.find((c: any) => c.id === 'promo:pro_expired');
    expect(card.props).toMatchObject({ layout: 'banner', title: 'Kalpana, your free Pro week ended' });

    db.rows('feature_flags').at(-1)!.metadata = { version: 1, states: {} };
    HomeFeedService.clearCaches();
    const fallback = (await (await GET(req(EXPIRED))).json()).cards.find((c: any) => c.id === 'promo:pro_expired');
    expect(fallback.props).toMatchObject({ layout: 'hero', title: 'Your free Pro week ended' });
  });

  it('dismiss = snooze for snoozeDays (3), across devices', async () => {
    await postEvents(
      new NextRequest('https://www.fitcircle.ai/api/mobile/home-feed/events', {
        method: 'POST',
        headers: { authorization: `Bearer user:${EXPIRED}`, 'content-type': 'application/json', 'x-client-timezone': 'America/Toronto' },
        body: JSON.stringify({ decision_id: '9b2f7f0e-6a0f-4d1e-9f53-3f1bb0a7c111', events: [{ card_id: 'promo:pro_expired', card_type: 'promo', position: 1, event: 'dismiss', promo_id: 'pro_expired' }] }),
      })
    );
    await flushAfter();
    expect(db.rows('promo_user_state')).toEqual([expect.objectContaining({ user_id: EXPIRED, promo_key: 'pro_expired' })]);
    expect(ids(await (await GET(req(EXPIRED, ANDROID))).json())).not.toContain('promo:pro_expired');
    vi.setSystemTime(new Date(NOW.getTime() + 2 * D));
    expect(ids(await (await GET(req(EXPIRED))).json())).not.toContain('promo:pro_expired');
    vi.setSystemTime(new Date(NOW.getTime() + 3 * D + H));
    expect(ids(await (await GET(req(EXPIRED))).json())).toContain('promo:pro_expired');
    // …and gone once daysAfter (7) has passed since Pro ended.
    vi.setSystemTime(new Date(NOW.getTime() + 7 * D));
    expect(ids(await (await GET(req(EXPIRED))).json())).not.toContain('promo:pro_expired');
  });

  it('lifecycle reads failing degrade softly: no card, feed intact', async () => {
    db.failing.add('complimentary_grants');
    const body = await (await GET(req(EXPIRING))).json();
    expect(ids(body).some((id) => id.startsWith('promo:pro_'))).toBe(false);
    expect(visible(body)[0]).toBe('header');
  });
});

// ---------------------------------------------------------------------------
// Shipped-client decode (1.1.0). Faithful ports of the decoders' rules.
// ---------------------------------------------------------------------------

/** iOS 1.1.0 PromoCardProps.init(from:) + PromoActionRunner.command(for:). Returns what the view draws, or the throw reason. */
function iosDecode(props: any): { ok: true; drawn: Record<string, unknown> } | { ok: false; reason: string } {
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  if (!text(props.promoId)) return { ok: false, reason: 'missing promoId' };
  if (!['hero', 'banner', 'compact'].includes(props.layout)) return { ok: false, reason: `layout ${props.layout}` };
  if (!text(props.title)) return { ok: false, reason: 'missing title' };
  if (!props.primary || !text(props.primary.label) || typeof props.primary.action?.type !== 'string') return { ok: false, reason: 'missing primary' };
  const hex = (s: unknown) => typeof s === 'string' && /^#[0-9A-Fa-f]{6}$/.test(s);
  const colors = (props.theme?.background?.colors ?? []).filter(hex);
  // PromoActionRunner: paywall needs a token placement.
  const a = props.primary.action;
  const runnable = a.type === 'paywall' ? /^[a-z][a-z0-9_]{0,39}$/.test(String(a.params?.placement ?? '')) : true;
  // PromoCountdown.endDate: "yyyy-MM-dd'T'HH:mm:ss" or "…HH:mm" in the viewer's zone.
  const countdownOk = !props.countdown || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(props.countdown.endsAt);
  return { ok: true, drawn: { layout: props.layout, gradient: colors.length >= 2, icon: text(props.icon), emoji: text(props.emoji), runnable, countdownOk, secondary: props.layout === 'hero' ? !!props.secondary : false } };
}

/** Android 1.1.0 PromoDecoder.decodeResult + PromoActionDecoder.decode. */
function androidDecode(props: any, cardId: string): { ok: true; drawn: Record<string, unknown> } | { ok: false; reason: string } {
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  if (!['hero', 'banner', 'compact'].includes(String(props.layout ?? '').trim().toLowerCase())) return { ok: false, reason: 'UNKNOWN_LAYOUT' };
  if (!text(props.title, 120)) return { ok: false, reason: 'NO_TITLE' };
  const a = props.primary?.action;
  const type = typeof a?.type === 'string' ? a.type.split('@')[0].toLowerCase() : null;
  if (!text(props.primary?.label, 40) || type !== 'paywall') return { ok: false, reason: 'NO_PRIMARY' };
  const placement = String(a.params?.placement ?? '').toLowerCase();
  const source = /^[a-z0-9_]{1,40}$/.test(placement) ? placement : 'promo';
  if (!(text(props.promoId, 200) ?? cardId.replace(/^promo:/, ''))) return { ok: false, reason: 'NO_PROPS' };
  const endsAt = props.countdown?.endsAt;
  const countdownOk = !props.countdown || (typeof endsAt === 'string' && !Number.isNaN(Date.parse(endsAt)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(endsAt));
  return { ok: true, drawn: { paywallSource: `promo:${source}`, icon: text(props.icon, 40), countdownOk, eyebrow: text(props.eyebrow, 60) } };
}

describe('shipped-client compat: iOS / Android 1.1.0 decode and run the card', () => {
  it('both states, both platforms: decodes, draws the icon/gradient, the paywall action runs with the right source', async () => {
    for (const user of [EXPIRING, EXPIRED]) {
      for (const f of [IOS, ANDROID]) {
        const body = await (await GET(req(user, f))).json();
        const card = body.cards.find((c: any) => c.id.startsWith('promo:pro_'));
        expect(card, `${user} ${f.headers['X-App-Platform']}`).toBeTruthy();
        const ios = iosDecode(card.props);
        expect(ios).toMatchObject({ ok: true, drawn: { gradient: true, runnable: true, countdownOk: true } });
        const android = androidDecode(card.props, card.id);
        expect(android).toMatchObject({ ok: true, drawn: { paywallSource: `promo:${card.props.promoId}_card`, countdownOk: true } });
        // Pre-icon_keys builds still get the legacy glyph; icon key is a registry key both apps ship.
        expect(['hourglass', 'crown']).toContain(card.props.icon);
        expect(card.props.emoji).toBeTruthy();
      }
    }
  });
});
