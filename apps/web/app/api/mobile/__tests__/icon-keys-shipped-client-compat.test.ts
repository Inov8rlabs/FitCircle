/**
 * Icon keys with backward compatibility (RELEASE_1.1.0_PLAN W4).
 *
 * Clients that don't send `X-Client-Features: icon_keys` (every shipped app, and
 * early 1.1.0 test builds, whatever X-App-Version says) must see the emoji fields
 * EXACTLY as before; the only change is an added `icon` / `icon_key`, which their
 * decoders ignore (iOS Codable ignores unknown keys; Android kotlinx uses
 * ignoreUnknownKeys). Icon-key clients get the same objects with the emoji
 * fields null and a registered icon key.
 *
 * Covers: challenge templates (code route + DB route, pre- and post-migration
 * rows), campaigns list (doors, marks, steps, campaign emoji), seasonal
 * (campaign-backed and built-in fallback), promo@1 props, OG share-card badge.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => getReferralDb().client() }));
let viewer: Record<string, any> = {};
vi.mock('@/lib/campaigns/admin-auth', () => ({ requireUser: vi.fn(async () => ({ ...viewer })) }));
vi.mock('@/lib/middleware/mobile-auth', () => ({ requireMobileAuth: vi.fn(async () => ({ ...viewer })) }));
const templateRows = vi.hoisted(() => [] as any[]);
vi.mock('@/lib/services/template-service', async (orig) => {
  const mod: any = await orig();
  return {
    ...mod,
    TemplateService: { listTemplates: vi.fn(async () => templateRows.map(mod.withIconKey)) },
  };
});

import { isIconKey } from '@/lib/design/icons';
import { applyIconCompat } from '@/lib/design/icon-compat';
import { parseClientActions } from '@/lib/promos/actions';
import { buildPromoProps } from '@/lib/promos/creative';
import { firstMeal } from '@/lib/promos/system-promos';
import { SEASONS } from '@/lib/seasonal/seasons';
import { CampaignService } from '@/lib/services/campaign-service';

import { advent, holdTheLine } from '../../../lib/services/__tests__/campaign-fixtures';
import { ReferralFakeDb, getReferralDb, setReferralDb } from '../../../lib/services/__tests__/referral-fake-db';
import { GET as GET_OG } from '../../og/share-card/route';
import { GET as GET_CIRCLE_TEMPLATES } from '../../fitcircles/[id]/challenges/templates/route';
import { GET as GET_CAMPAIGNS } from '../campaigns/route';
import { GET as GET_DB_TEMPLATES } from '../challenges/templates/route';
import { GET as GET_SEASONAL } from '../seasonal/route';

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
// Version alone never opts in: even a 1.2.0 without the capability header gets emoji.
const OLD = [undefined, '1.0.9', '1.1.0', '1.2.0'];
const NEW = 'icon_keys';
const req = (path: string, version?: string) =>
  new NextRequest(`http://localhost${path}`, {
    headers:
      version === NEW
        ? { 'X-App-Version': '1.1.0', 'X-App-Platform': 'ios', 'X-Client-Features': 'icon_keys' }
        : version
          ? { 'X-App-Version': version, 'X-App-Platform': 'ios' }
          : {},
  });
const EMOJI = /\p{Extended_Pictographic}/u;

let db: ReferralFakeDb;
beforeEach(() => {
  db = new ReferralFakeDb();
  setReferralDb(db);
  // Admin preview date pins "today" so Advent is live with doors 1–7 revealed.
  db.addProfile({ id: ME, display_name: 'Ani', timezone: 'America/Los_Angeles', preferences: { campaignPreview: { asOf: '2026-12-07' } }, is_admin: true });
  viewer = db.profile(ME)!;
  db.rows('campaigns').push(advent(), holdTheLine());
  templateRows.length = 0;
});

describe('challenge templates (code): GET /api/fitcircles/[id]/challenges/templates', () => {
  it.each(OLD)('shipped client %s: `icon` is still the emoji, `icon_key` added', async (v) => {
    const body = await (await GET_CIRCLE_TEMPLATES(req('/api/fitcircles/x/challenges/templates', v))).json();
    const t = body.data.templates.find((x: any) => x.id === 'pushup-push');
    expect(t.icon).toBe('💪');
    expect(t.icon_key).toBe('strength');
    for (const x of body.data.templates) expect(x.icon).toMatch(EMOJI);
  });

  it('icon-key client: `icon` is the key', async () => {
    const body = await (await GET_CIRCLE_TEMPLATES(req('/api/fitcircles/x/challenges/templates', NEW))).json();
    for (const x of body.data.templates) {
      expect(isIconKey(x.icon)).toBe(true);
      expect(x.icon).toBe(x.icon_key);
    }
  });
});

describe('challenge templates (DB): GET /api/mobile/challenges/templates', () => {
  beforeEach(() => {
    templateRows.push(
      { id: 't1', name: '50 Squats', icon_name: '🦵' }, // before migration 114: no icon_key column
      { id: 't2', name: 'Climb Everest', icon_name: '🏔️', icon_key: 'mountain' } // after 114
    );
  });

  it.each(OLD)('shipped client %s: icon_name unchanged, icon_key added', async (v) => {
    const body = await (await GET_DB_TEMPLATES(req('/api/mobile/challenges/templates', v))).json();
    expect(body.data.map((t: any) => [t.icon_name, t.icon_key])).toEqual([['🦵', 'strength'], ['🏔️', 'mountain']]);
  });

  it('icon-key client: icon_name null, icon_key kept', async () => {
    const body = await (await GET_DB_TEMPLATES(req('/api/mobile/challenges/templates', NEW))).json();
    expect(body.data.map((t: any) => [t.icon_name, t.icon_key])).toEqual([[null, 'strength'], [null, 'mountain']]);
  });
});

describe('campaigns: GET /api/mobile/campaigns', () => {
  const advent = (body: any) => body.data.campaigns.find((c: any) => c.slug === 'advent_2026');

  it.each(OLD)('shipped client %s: every emoji field as before', async (v) => {
    const a = advent(await (await GET_CAMPAIGNS(req('/api/mobile/campaigns', v))).json());
    expect(a.emoji).toBe('🎁');
    expect(a.icon).toBe('gift');
    const revealed = a.calendar.doors.filter((d: any) => d.state !== 'locked');
    expect(revealed.length).toBeGreaterThan(0);
    for (const d of revealed) {
      expect(d.emoji).toMatch(EMOJI);
      expect(isIconKey(d.icon)).toBe(true);
    }
    for (const d of a.calendar.doors.filter((d: any) => d.state === 'locked')) expect(d).not.toHaveProperty('emoji');
    for (const m of a.marks) expect(m.emoji).toMatch(EMOJI);
    for (const s of a.howItWorks) expect(s.emoji).toMatch(EMOJI);
  });

  it('icon-key client: emoji null everywhere an icon key is present', async () => {
    const body = await (await GET_CAMPAIGNS(req('/api/mobile/campaigns', NEW))).json();
    for (const c of body.data.campaigns) {
      expect(c.emoji).toBeNull();
      expect(isIconKey(c.icon)).toBe(true);
      for (const m of c.marks) expect([m.emoji, isIconKey(m.icon)]).toEqual([null, true]);
      for (const s of c.howItWorks) expect([s.emoji, isIconKey(s.icon)]).toEqual([null, true]);
      for (const d of c.calendar?.doors ?? []) if (d.state !== 'locked') expect([d.emoji, isIconKey(d.icon)]).toEqual([null, true]);
    }
    expect(JSON.stringify(body)).not.toMatch(EMOJI);
  });
});

describe('seasonal: GET /api/mobile/seasonal', () => {
  it.each(OLD)('shipped client %s: season emoji unchanged (campaign-backed)', async (v) => {
    const body = await (await GET_SEASONAL(req('/api/mobile/seasonal', v))).json();
    expect(body.data.current).toMatchObject({ key: 'hold_the_line', emoji: '❄️', icon: 'snowflake' });
  });

  it('icon-key client: emoji null (campaign-backed and built-in fallback)', async () => {
    let body = await (await GET_SEASONAL(req('/api/mobile/seasonal', NEW))).json();
    expect(body.data.current).toMatchObject({ emoji: null, icon: 'snowflake' });
    const spy = vi.spyOn(CampaignService, 'seasonalFor').mockRejectedValueOnce(new Error('db down'));
    body = await (await GET_SEASONAL(req('/api/mobile/seasonal', NEW))).json();
    expect(body.data.current).toMatchObject({ key: 'hold_the_line', emoji: null, icon: 'snowflake' });
    spy.mockRestore();
    expect(SEASONS.map((s) => s.emoji)).toEqual(['❄️', '🌅', '🌙']); // built-in values for old clients unchanged
  });
});

describe('promo@1 props', () => {
  const props = buildPromoProps('first_meal', firstMeal.creatives({} as any)[0], parseClientActions('open_screen@1'))!;
  it('shipped clients keep the emoji; icon-key clients get the key only', () => {
    expect(props).toMatchObject({ emoji: '📸', icon: 'camera' });
    expect(applyIconCompat(props, false)).toBe(props);
    expect(applyIconCompat(props, true)).toMatchObject({ emoji: null, icon: 'camera' });
  });
});

describe('OG share card', () => {
  const og = async (type: string, data: Record<string, unknown>) =>
    (await GET_OG(new NextRequest(`http://localhost/api/og/share-card?type=${type}&data=${Buffer.from(JSON.stringify(data)).toString('base64')}`))).text();

  it('renders SVG badges, never emoji, for old (emoji) and new (icon key) card data', async () => {
    for (const html of [
      await og('streak_milestone', { streak_days: 7, badge: '🔥' }),
      await og('milestone', { milestoneName: 'Centurion', badgeEmoji: '👑' }),
      await og('milestone', { milestoneName: 'Centurion', icon: 'crown' }),
      await og('challenge_complete', { challengeName: 'Steps' }),
      await og('circle_boost', { circleName: 'Crew' }),
      await og('milestone', { badgeEmoji: '<script>' }),
    ]) {
      expect(html).toContain('<div class="badge"><svg');
      expect(html).not.toMatch(EMOJI);
      expect(html).not.toContain('<script>');
    }
  });
});
