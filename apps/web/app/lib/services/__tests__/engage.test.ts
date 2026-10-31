import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase-admin', () => ({ createAdminSupabase: () => getReferralDb().client() }));
const pushes = vi.hoisted(() => [] as Array<{ userId: string; type: string; data: any }>);
vi.mock('../notification-orchestrator', () => ({
  NotificationOrchestrator: {
    send: async (userId: string, type: string, data: any) => {
      pushes.push({ userId, type, data });
      return { sent: true };
    },
  },
}));
const directPushes = vi.hoisted(() => [] as Array<{ userId: string; n: any }>);
vi.mock('../push-service', () => ({
  PushService: { sendPush: async (userId: string, n: any) => (directPushes.push({ userId, n }), 1) },
}));
const mails = vi.hoisted(() => [] as any[]);
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: async (m: any) => (mails.push(m), { data: { id: 'x' }, error: null }) };
  },
}));

import { CONTROL, assignVariant, stableBucket } from '../../engage/assignment';
import { compareVersions, countryOfTimezone, matchesCondition, snapshotFor } from '../../engage/attributes';
import { assetImageInfo } from '../../engage/image';
import { rowToMessage } from '../../engage/model';
import { platformAllowed, resolvePlatform } from '../../engage/platform';
import { mergeOverride, personalise } from '../../engage/render';
import { launchCheck, parseMessageInput } from '../../engage/schema';
import { lift, twoProportionPValue } from '../../engage/stats';
import { CampaignService } from '../campaign-service';
import { EngageAssetService } from '../engage-asset-service';
import { EngageDeliveryService, actionToPush } from '../engage-delivery-service';
import { EngageMessageService } from '../engage-message-service';
import { EngageSegmentService } from '../engage-segment-service';
import { EngageSendService } from '../engage-send-service';
import { EngageStatsService } from '../engage-stats-service';

import { advent, holdTheLine } from './campaign-fixtures';
import { assetRow, cardContent, messageRow, png, webp } from './engage-fixtures';
import { ReferralFakeDb, getReferralDb, setReferralDb } from './referral-fake-db';

const uid = (x: string) => `${x.repeat(8)}-${x.repeat(4)}-4${x.repeat(3)}-8${x.repeat(3)}-${x.repeat(12)}`;
const [ME, B, D, E] = ['a', 'b', 'd', 'e'].map(uid);
const CIRCLE = uid('c');
const NOW = new Date('2026-12-07T16:00:00Z');
let db: ReferralFakeDb;
const me = (over: Record<string, any> = {}) => ({ ...db.profile(ME)!, ...over });

beforeEach(() => {
  db = new ReferralFakeDb();
  setReferralDb(db);
  pushes.length = 0;
  directPushes.length = 0;
  mails.length = 0;
  db.addProfile({ id: ME, display_name: 'Ani Rao', timezone: 'America/Los_Angeles', preferences: {}, created_at: '2026-11-07T00:00:00Z', is_admin: true });
  db.addProfile({ id: B, display_name: 'Ben', timezone: 'Europe/London', preferences: {}, created_at: '2026-01-01T00:00:00Z', subscription_tier: 'premium' });
  db.addProfile({ id: D, display_name: 'Dee', timezone: 'America/Los_Angeles', preferences: { marketingEmails: false }, created_at: '2026-12-06T00:00:00Z' });
  db.addProfile({ id: E, display_name: 'Eli', timezone: 'UTC', preferences: {}, created_at: '2026-06-01T00:00:00Z' });
  db.rows('engagement_streaks').push({ user_id: ME, current_streak: 12, last_engagement_date: '2026-12-06' });
  db.rows('fitcircles').push({ id: CIRCLE, name: 'Morning Movers', status: 'active' });
  db.rows('fitcircle_members').push({ fitcircle_id: CIRCLE, user_id: ME, status: 'active' });
  db.rows('push_tokens').push(
    { user_id: ME, platform: 'ios', is_active: true, last_used_at: '2026-12-07T10:00:00Z' },
    { user_id: ME, platform: 'android', is_active: true, last_used_at: '2026-12-01T10:00:00Z' },
    { user_id: B, platform: 'android', is_active: true, last_used_at: '2026-12-05T10:00:00Z' },
    { user_id: E, platform: 'web', is_active: true, last_used_at: '2026-12-05T10:00:00Z' }
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.RESEND_API_KEY;
});

// ---------------------------------------------------------------- pure helpers
describe('assignment, rendering, platform', () => {
  it('assigns variants deterministically with a control holdout', () => {
    const variants = [{ id: 'A', weight: 40 }, { id: 'B', weight: 40 }];
    const counts: Record<string, number> = { A: 0, B: 0, control: 0 };
    for (let i = 0; i < 2000; i++) {
      const u = `user-${i}`;
      const v = assignVariant(u, 'msg-1', variants, 20);
      expect(assignVariant(u, 'msg-1', variants, 20)).toBe(v); // stable
      counts[v]++;
    }
    expect(counts.control / 2000).toBeGreaterThan(0.15);
    expect(counts.control / 2000).toBeLessThan(0.25);
    expect(Math.abs(counts.A - counts.B) / 2000).toBeLessThan(0.06);
    const bucket = stableBucket('u1', 'm1');
    expect(assignVariant('u1', 'm1', variants, 0)).toBe(bucket < 40 ? 'A' : 'B');
    if (bucket < 50) expect(assignVariant('u1', 'm1', variants, bucket + 1)).toBe(CONTROL);
    expect(assignVariant('u1', 'm1', variants, Math.min(bucket, 50))).not.toBe(bucket <= 50 ? CONTROL : '');
  });

  it('personalises with defaults and merges platform overrides', () => {
    expect(personalise('Hi {{first_name | default: "friend"}}!', {})).toBe('Hi friend!');
    expect(personalise("Hi {{ first_name|default:'pal' }}, {{streak}} days", { first_name: 'Ani', streak: 5 })).toBe('Hi Ani, 5 days');
    expect(personalise('{{circle_name}} rocks', {})).toBe('rocks');
    const merged = mergeOverride(
      { content: cardContent({ theme: { background: '#000000', text: '#ffffff' } }) as any, platformOverrides: { android: { title: 'Get it on Google Play', theme: { background: '#111111' } } } },
      'android'
    );
    expect(merged).toMatchObject({ title: 'Get it on Google Play', theme: { background: '#111111', text: '#ffffff' } });
    expect(mergeOverride({ content: cardContent() as any, platformOverrides: { android: { title: 'x' } } }, 'ios').title).toContain('Hi');
  });

  it('resolves the caller platform', () => {
    const req = (h: Record<string, string>) => ({ headers: new Headers(h) });
    expect(resolvePlatform(req({ 'x-platform': 'android', authorization: 'Bearer t' }))).toBe('android');
    expect(resolvePlatform(req({}))).toBe('web'); // cookie session
    expect(resolvePlatform(req({ authorization: 'Bearer t', 'user-agent': 'FitCircle/53 CFNetwork/1.0 Darwin/25' }))).toBe('ios');
    expect(resolvePlatform(req({ authorization: 'Bearer t', 'user-agent': 'okhttp/4.12' }))).toBe('android');
    expect(resolvePlatform(req({ authorization: 'Bearer t' }))).toBeNull();
    expect(platformAllowed([], null)).toBe(true);
    expect(platformAllowed(['ios'], null)).toBe(false);
    expect(platformAllowed(['ios', 'web'], 'web')).toBe(true);
  });

  it('maps actions to push routing', () => {
    expect(actionToPush({ type: 'deeplink', value: 'food_log' })).toMatchObject({ screen: 'food_log' });
    expect(actionToPush({ type: 'deeplink', value: 'nope' }).screen).toBe('dashboard');
    expect(actionToPush({ type: 'campaign', value: 'advent_2026' })).toMatchObject({ screen: 'campaign', campaignSlug: 'advent_2026' });
    expect(actionToPush({ type: 'invite' }).screen).toBe('invite_hub');
  });

  it('two-proportion z-test and lift', () => {
    expect(twoProportionPValue(60, 500, 40, 500)!).toBeCloseTo(0.035, 2);
    expect(twoProportionPValue(0, 10, 0, 10)).toBeNull();
    expect(twoProportionPValue(1, 0, 1, 10)).toBeNull();
    expect(lift(0.12, 0.08)).toBeCloseTo(0.5);
    expect(lift(0.1, 0)).toBeNull();
  });

  it('parses WebP and GIF headers', () => {
    expect(assetImageInfo(webp(960, 540))).toMatchObject({ type: 'webp', width: 960, height: 540 });
    const gif = new Uint8Array([...'GIF89a'].map((c) => c.charCodeAt(0)).concat([0x40, 0x01, 0xf0, 0x00, 0, 0, 0, 0]));
    expect(assetImageInfo(gif)).toMatchObject({ type: 'gif', width: 320, height: 240 });
  });
});

// ---------------------------------------------------------------- attributes
describe('attribute engine', () => {
  it('builds a snapshot from real tables', async () => {
    db.rows('referrals').push({ inviter_id: ME, status: 'qualified' }, { inviter_id: ME, status: 'pending' });
    const camp = advent();
    db.rows('campaigns').push(camp);
    db.rows('campaign_participants').push({ campaign_id: camp.id, user_id: ME, reminders: true });
    const snap = await snapshotFor(me() as any, { platform: 'ios', appVersion: '1.0.4', now: NOW });
    expect(snap).toMatchObject({
      platform: 'ios',
      tokenPlatforms: expect.arrayContaining(['ios', 'android']),
      days_since_signup: 30,
      is_pro: false,
      current_streak: 12,
      last_active_days: 1,
      active_circle_count: 1,
      has_active_circle: true,
      referral_qualified_count: 1,
      campaign_joined: ['advent_2026'],
      country: 'US',
      timezone: 'America/Los_Angeles',
      app_version: '1.0.4',
      email_opt_in: true,
      push_enabled: true,
    });
    expect(snap.random_bucket).toBeGreaterThanOrEqual(0);
    const ben = await snapshotFor(db.profile(B) as any, { now: NOW });
    expect(ben).toMatchObject({ platform: 'android', is_pro: true, current_streak: 0, has_active_circle: false, country: 'GB' });
    const dee = await snapshotFor(db.profile(D) as any, { now: NOW });
    expect(dee).toMatchObject({ email_opt_in: false, push_enabled: false, platform: null });
  });

  it('evaluates every operator', async () => {
    const snap = await snapshotFor(me() as any, { appVersion: '1.0.10', now: NOW });
    const m = (key: any, op: any, value?: any) => matchesCondition(snap, { key, op, value });
    expect(m('current_streak', 'gte', 10)).toBe(true);
    expect(m('current_streak', 'lt', 10)).toBe(false);
    expect(m('is_pro', 'eq', false)).toBe(true);
    expect(m('is_pro', 'eq', 'false')).toBe(true);
    expect(m('platform', 'in', ['ios', 'web'])).toBe(true);
    expect(m('platform', 'not_in', ['ios'])).toBe(false);
    expect(m('app_version', 'gt', '1.0.9')).toBe(true); // semver, not string compare
    expect(m('campaign_joined', 'not_exists')).toBe(true);
    expect(m('campaign_joined', 'neq', 'advent_2026')).toBe(true);
    expect(m('country', 'exists')).toBe(true);
    expect(m('last_active_days', 'lte', 3)).toBe(true);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(countryOfTimezone('Asia/Kolkata')).toBe('IN');
  });

  it('estimates reach with a per-platform breakdown', async () => {
    const all = await EngageSegmentService.estimate([]);
    expect(all).toMatchObject({ count: 4, approximate: false, total: 4, byPlatform: { ios: 1, android: 2, web: 2 } });
    const pushable = await EngageSegmentService.estimate([{ key: 'push_enabled', op: 'eq', value: true }], { platforms: ['android'] });
    expect(pushable).toMatchObject({ count: 2, byPlatform: { android: 2, ios: 0, web: 0 } });
  });
});

// ---------------------------------------------------------------- validation
describe('message validation', () => {
  const base = (over: Record<string, any> = {}) => ({
    name: 'Test',
    channel: 'content_card',
    placement: 'home_feed',
    layout: 'card',
    variants: [{ id: 'A', name: 'A', weight: 100, content: cardContent() }],
    startsAt: '2026-12-01T00:00:00Z',
    ...over,
  });

  it('enforces char limits and structure on save', () => {
    expect(() => parseMessageInput(base())).not.toThrow();
    expect(() => parseMessageInput(base({ variants: [{ id: 'A', weight: 100, content: cardContent({ title: 'x'.repeat(61) }) }] }))).toThrow();
    expect(() => parseMessageInput(base({ variants: [{ id: 'A', weight: 100, content: cardContent({ badge: 'x'.repeat(21) }) }] }))).toThrow();
    expect(() =>
      parseMessageInput(base({ variants: [{ id: 'A', weight: 100, content: cardContent(), platformOverrides: { ios: { body: 'x'.repeat(241) } } }] }))
    ).toThrow();
    expect(() => parseMessageInput(base({ variants: [{ id: 'A', weight: 50, content: cardContent() }, { id: 'A', weight: 50, content: cardContent() }] }))).toThrow();
    expect(() => parseMessageInput(base({ channel: 'push', variants: [{ id: 'A', weight: 100, content: { title: 't', body: 'x'.repeat(141), action: { type: 'invite' } } }] }))).toThrow();
  });

  it('launch checklist: weights, layout/placement, platform capability rules', () => {
    const msg = (over: Record<string, any>) => ({ ...rowToMessage(messageRow()), ...over });
    expect(launchCheck(msg({})).errors).toEqual([]);
    expect(launchCheck(msg({ controlWeight: 10 })).errors).toEqual([expect.stringContaining('add up to 100 (now 110)')]);
    expect(launchCheck(msg({ placement: 'post_checkin', layout: 'card' })).errors).toEqual([expect.stringContaining('banner')]);
    expect(launchCheck(msg({ layout: 'image_only' })).errors).toEqual(expect.arrayContaining([expect.stringContaining('needs an image')]));
    expect(launchCheck(msg({ channel: 'in_app', placement: null, layout: 'modal', trigger: null })).errors).toEqual(['In-app messages need a trigger']);
    const push = { channel: 'push', placement: null, layout: null, sendMode: 'immediate', variants: [{ id: 'A', weight: 100, content: { title: 't', body: 'b', action: { type: 'deeplink', value: 'food_log' } } }] };
    expect(launchCheck(msg({ ...push, platforms: ['web'] })).errors).toEqual([expect.stringContaining('web push is not supported')]);
    const mixed = launchCheck(msg({ ...push, platforms: ['ios', 'web'] }));
    expect(mixed.errors).toEqual([]);
    expect(mixed.warnings).toEqual([expect.stringContaining('web users are excluded')]);
    expect(launchCheck(msg({ ...push, sendMode: 'local_time', sendAt: '2026-12-10T00:00:00Z' })).errors).toEqual(['Pick the local send hour']);
    expect(launchCheck(msg({ variants: [{ id: 'A', weight: 100, content: cardContent({ buttons: [{ label: 'Go', action: { type: 'url', value: 'http://x' }, style: 'primary' }] }) }] })).errors).toEqual([
      expect.stringContaining('https URL'),
    ]);
  });
});

// ---------------------------------------------------------------- assets
describe('asset library', () => {
  it('uploads content-addressed files with immutable caching and dedupes by sha256', async () => {
    const file = png(1440, 810);
    const sha = createHash('sha256').update(file).digest('hex');
    const first = await EngageAssetService.upload({ file, fileName: 'hero.png', variants: [{ bytes: webp(480, 270) }, { bytes: webp(960, 540) }], meta: { sha256: sha, dominantColor: '#123456', tags: ['Winter'] } }, ME);
    expect(first.deduped).toBe(false);
    expect(first.asset).toMatchObject({ sha256: sha, width: 1440, height: 810, mime: 'image/png', dominantColor: '#123456', tags: ['winter'] });
    expect(first.asset.url).toMatch(new RegExp(`engage-assets/a/${sha}\\.png$`));
    expect(first.asset.variants.map((v) => v.width)).toEqual([480, 960]);
    expect(Object.keys(db.storage).sort()).toEqual([`engage-assets/a/${sha}.png`, `engage-assets/a/${sha}@480.webp`, `engage-assets/a/${sha}@960.webp`]);
    expect((db.storage[`engage-assets/a/${sha}.png`].opts as any).cacheControl).toBe('31536000');

    const again = await EngageAssetService.upload({ file, fileName: 'copy.png' }, ME);
    expect(again).toMatchObject({ deduped: true, asset: { id: first.asset.id } });
    expect(db.rows('engage_assets')).toHaveLength(1);

    await expect(EngageAssetService.upload({ file: png(200, 200) }, ME)).rejects.toMatchObject({ code: 'TOO_SMALL' });
    await expect(EngageAssetService.upload({ file: png(800, 600, 1), meta: { sha256: 'f'.repeat(64) } }, ME)).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
    await expect(EngageAssetService.upload({ file: png(800, 600, 2), variants: [{ bytes: webp(1440, 900) }] }, ME)).rejects.toMatchObject({ code: 'VARIANT_UPSCALED' });
  });

  it('tracks usage and blocks archiving an asset a live message uses', async () => {
    const asset = assetRow();
    db.rows('engage_assets').push(asset);
    const live = messageRow({ name: 'Winter card', variants: [{ id: 'A', name: 'A', weight: 100, content: cardContent({ image: { assetId: asset.id } }) }] });
    db.rows('engage_messages').push(live);
    const list = await EngageAssetService.list({ q: 'winter' });
    expect(list.assets[0]).toMatchObject({ id: asset.id, usageCount: 1 });
    await expect(EngageAssetService.archive(asset.id)).rejects.toMatchObject({ status: 409, code: 'ASSET_IN_USE', data: { usage: [{ messageId: live.id, status: 'live' }] } });
    live.published = false; // back to draft
    await expect(EngageAssetService.archive(asset.id)).resolves.toMatchObject({ id: asset.id });
  });
});

// ---------------------------------------------------------------- delivery
describe('GET /api/mobile/engage', () => {
  it('filters by platform, segment, dismissals and caps; sorts and limits placements', async () => {
    const seg = { id: uid('5'), name: 'Streakers', description: '', filters: [{ key: 'current_streak', op: 'gte', value: 7 }], archived_at: null };
    db.rows('engage_segments').push(seg);
    const asset = assetRow();
    db.rows('engage_assets').push(asset);
    const androidOnly = messageRow({ name: 'android', platforms: ['android'] });
    const segmented = messageRow({ name: 'segment', segment_id: seg.id, priority: 5, variants: [{ id: 'A', name: 'A', weight: 100, content: cardContent({ image: { assetId: asset.id } }) }] });
    const lazy = messageRow({ name: 'lazy', audience_filters: [{ key: 'current_streak', op: 'lt', value: 3 }] });
    const dismissed = messageRow({ name: 'dismissed' });
    const capped = messageRow({ name: 'capped', max_impressions_per_user: 2 });
    const low = messageRow({ name: 'low', priority: -5 });
    const mid = messageRow({ name: 'mid', priority: 1 });
    const extra = messageRow({ name: 'extra', priority: 0 });
    const draft = messageRow({ name: 'draft', published: false });
    const paused = messageRow({ name: 'paused', paused_at: '2026-12-01T00:00:00Z' });
    const ended = messageRow({ name: 'ended', ends_at: '2026-12-01T00:00:00Z' });
    db.rows('engage_messages').push(androidOnly, segmented, lazy, dismissed, capped, low, mid, extra, draft, paused, ended);
    db.rows('engage_dismissals').push({ message_id: dismissed.id, user_id: ME, at: '2026-12-01T00:00:00Z' });
    db.rows('engage_events').push(
      { user_id: ME, message_id: capped.id, type: 'impression', at: '2026-12-01T00:00:00Z' },
      { user_id: ME, message_id: capped.id, type: 'impression', at: '2026-12-02T00:00:00Z' }
    );
    const res = await EngageDeliveryService.getEngage(me(), { platform: 'ios', timezone: 'America/Los_Angeles', now: NOW });
    const feed = res.cards.home_feed!;
    expect(feed.map((c) => c.messageId)).toEqual([segmented.id, mid.id, extra.id]); // max 3, priority desc
    expect(feed[0].content).toMatchObject({ title: 'Hi Ani', body: 'Your streak is 12 days', image: { id: asset.id, dominantColor: '#334455', variants: expect.any(Array) } });
    expect(res.prefetch.map((a) => a.id)).toEqual([asset.id]);
    expect(res.caps).toEqual({ inAppPer24h: 2, inAppPerSession: 1 });

    const android = await EngageDeliveryService.getEngage(me(), { platform: 'android', now: NOW });
    expect(android.cards.home_feed!.map((c) => c.messageId)).toContain(androidOnly.id);
  });

  it('logs control exposure once and never shows control users the message', async () => {
    const held = messageRow({ control_weight: 50, variants: [{ id: 'A', name: 'A', weight: 50, content: cardContent() }] });
    // Find a user id that lands in control for this message.
    const isControl = assignVariant(ME, held.id, [{ id: 'A', weight: 50 }], 50) === CONTROL;
    db.rows('engage_messages').push(held);
    const res = await EngageDeliveryService.getEngage(me(), { platform: 'ios', now: NOW });
    await EngageDeliveryService.getEngage(me(), { platform: 'ios', now: NOW });
    const exposures = db.rows('engage_exposures').filter((x) => x.message_id === held.id);
    expect(exposures).toHaveLength(1);
    expect(exposures[0].variant_id).toBe(isControl ? 'control' : 'A');
    expect((res.cards.home_feed ?? []).some((c) => c.messageId === held.id)).toBe(!isControl);
  });

  it('home_hero: campaign experience vs content card by priority', async () => {
    db.rows('campaigns').push(advent()); // priority 20, live on Dec 7
    const heroLow = messageRow({ placement: 'home_hero', layout: 'hero', priority: 10, variants: [{ id: 'A', name: 'A', weight: 100, content: cardContent({ image: null }) }] });
    db.rows('engage_messages').push(heroLow);
    let res = await EngageDeliveryService.getEngage(me(), { platform: 'ios', timezone: 'America/Los_Angeles', now: NOW });
    expect(res.heroCampaignSlug).toBe('advent_2026');
    expect(res.cards.home_hero).toBeUndefined();
    heroLow.priority = 30;
    res = await EngageDeliveryService.getEngage(me(), { platform: 'ios', timezone: 'America/Los_Angeles', now: NOW });
    expect(res.heroCampaignSlug).toBeNull();
    expect(res.cards.home_hero!.map((c) => c.messageId)).toEqual([heroLow.id]);
  });

  it('campaign platforms gate the hero and /api/mobile/campaigns', async () => {
    db.rows('campaigns').push(advent({ platforms: ['android'] }), holdTheLine());
    const ios = await CampaignService.listForViewer(me({ is_admin: false }), 'America/Los_Angeles', 'ios');
    expect(ios.campaigns.map((c) => c.slug)).toEqual(['hold_the_line']);
    const android = await CampaignService.listForViewer(me({ is_admin: false }), 'America/Los_Angeles', 'android');
    expect(android.homeSlug).toBe('advent_2026');
    expect((await CampaignService.listForViewer(me({ is_admin: false }), 'America/Los_Angeles')).campaigns).toHaveLength(2); // legacy callers: no filter
    expect((await EngageDeliveryService.getEngage(me(), { platform: 'ios', timezone: 'America/Los_Angeles', now: NOW })).heroCampaignSlug).toBe('hold_the_line');
  });

  it('in-app: trigger, min hours, global 24h cap, preview drafts and overrides', async () => {
    const trigger = { event: 'check_in_completed', delaySeconds: 2 };
    const iam = messageRow({ channel: 'in_app', placement: null, layout: 'modal', trigger: trigger as any, priority: 3, variants: [{ id: 'A', name: 'A', weight: 100, content: cardContent(), platformOverrides: { ios: { title: 'iPhone title' } } }] });
    const recent = messageRow({ channel: 'in_app', placement: null, layout: 'slideup', trigger: trigger as any, min_hours_between: 48 });
    const draft = messageRow({ channel: 'in_app', placement: null, layout: 'fullscreen', trigger: trigger as any, published: false, preview_user_ids: [ME], platforms: ['android'] });
    db.rows('engage_messages').push(iam, recent, draft);
    db.rows('engage_events').push({ user_id: ME, message_id: recent.id, type: 'impression', at: '2026-12-06T16:00:00Z' }); // 24h ago < 48h
    let res = await EngageDeliveryService.getEngage(me(), { platform: 'ios', now: NOW });
    expect(res.inApp.map((m) => m.messageId)).toEqual([iam.id, draft.id]);
    expect(res.inApp[0]).toMatchObject({ layout: 'modal', trigger, minHoursBetween: 24, impressionsSoFar: 0, respectGlobalCap: true, content: { title: 'iPhone title' } });

    // Two in-app impressions in the last 24 h → capped (preview still shows).
    db.rows('engage_events').push({ user_id: ME, message_id: recent.id, type: 'impression', at: '2026-12-07T10:00:00Z' });
    res = await EngageDeliveryService.getEngage(me(), { platform: 'ios', now: NOW });
    expect(res.inApp.map((m) => m.messageId)).toEqual([draft.id]);
  });
});

describe('POST /api/mobile/engage/events', () => {
  it('dedupes impressions per 30 min, makes card dismissals permanent, drops junk', async () => {
    const card = messageRow();
    db.rows('engage_messages').push(card);
    const t = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
    const out = await EngageDeliveryService.ingestEvents(
      ME,
      'ios',
      {
        events: [
          { type: 'impression', messageId: card.id, variantId: 'A', at: t(50) },
          { type: 'impression', messageId: card.id, variantId: 'A', at: t(40) }, // within 30 min → dropped
          { type: 'impression', messageId: card.id, variantId: 'A', at: t(10) },
          { type: 'click', messageId: card.id, variantId: 'A', buttonIndex: 0, at: t(9) },
          { type: 'dismiss', messageId: card.id, variantId: 'A', at: t(8) },
          { type: 'app_event', name: 'check_in_completed', props: { streak: 13 }, at: t(5) },
          { type: 'click', messageId: uid('9'), at: t(5) }, // unknown message
          { type: 'app_event', name: 'meal_logged', at: new Date(NOW.getTime() - 9 * 86_400_000).toISOString() }, // too old
        ],
      },
      NOW
    );
    expect(out).toEqual({ accepted: 5, dropped: 3 });
    expect(db.rows('engage_events').filter((e) => e.type === 'impression')).toHaveLength(2);
    expect(db.rows('engage_events').find((e) => e.type === 'click')).toMatchObject({ platform: 'ios', props: { buttonIndex: 0 } });
    expect(db.rows('engage_dismissals')).toEqual([expect.objectContaining({ message_id: card.id, user_id: ME })]);
    // Dismissed card no longer delivered.
    expect((await EngageDeliveryService.getEngage(me(), { platform: 'ios', now: NOW })).cards.home_feed).toBeUndefined();
    await expect(EngageDeliveryService.ingestEvents(ME, 'ios', { events: Array.from({ length: 51 }, () => ({ type: 'app_event', name: 'app_open', at: t(1) })) })).rejects.toMatchObject({ name: 'ZodError' });
  });
});

// ---------------------------------------------------------------- push / email cron
describe('engage cron', () => {
  const pushContent = { title: 'Hey {{first_name}}', body: 'Log lunch', action: { type: 'deeplink', value: 'food_log' } };

  it('sends one push per user to every eligible platform, dedupes, excludes web, marks complete', async () => {
    const msg = messageRow({ channel: 'push', placement: null, layout: null, send_mode: 'immediate', variants: [{ id: 'A', name: 'A', weight: 100, content: pushContent }] });
    db.rows('engage_messages').push(msg);
    const s = await EngageSendService.runCron(NOW);
    expect(s.push.sent).toBe(2); // ME (ios+android) + B (android); E only has web
    const mine = pushes.find((p) => p.userId === ME)!;
    expect(mine).toMatchObject({ type: 'engage', data: { title: 'Hey Ani', screen: 'food_log', engageMessageId: msg.id, variantId: 'A', actionType: 'deeplink' } });
    expect(mine.data.platforms.sort()).toEqual(['android', 'ios']);
    expect(db.rows('engage_deliveries').filter((d) => d.user_id === ME).map((d) => d.platform).sort()).toEqual(['android', 'ios']);
    expect(msg.send_completed_at).toBe(NOW.toISOString());

    // A new device later, completed message → nothing; reopen and re-run → only the new platform goes out.
    msg.send_completed_at = null;
    db.rows('push_tokens').push({ user_id: B, platform: 'ios', is_active: true, last_used_at: NOW.toISOString() });
    pushes.length = 0;
    await EngageSendService.runCron(NOW);
    expect(pushes).toEqual([expect.objectContaining({ userId: B, data: expect.objectContaining({ platforms: ['ios'] }) })]);
  });

  it('respects platforms, local_time hours and the control holdout', async () => {
    const androidOnly = messageRow({ channel: 'push', placement: null, layout: null, send_mode: 'immediate', platforms: ['android'], variants: [{ id: 'A', name: 'A', weight: 100, content: pushContent }] });
    db.rows('engage_messages').push(androidOnly);
    await EngageSendService.runCron(NOW);
    expect(pushes.map((p) => [p.userId, p.data.platforms])).toEqual(
      expect.arrayContaining([[ME, ['android']], [B, ['android']]])
    );
    pushes.length = 0;

    // 16:00Z = 08:00 LA, 16:00 London. local_hour 9 → nobody in LA yet; London (B) is past 9.
    const local = messageRow({ channel: 'push', placement: null, layout: null, send_mode: 'local_time', send_at: '2026-12-07T00:00:00Z', local_hour: 9, variants: [{ id: 'A', name: 'A', weight: 100, content: pushContent }] });
    db.rows('engage_messages').push(local);
    const s = await EngageSendService.runCron(NOW);
    expect(pushes.filter((p) => p.data.engageMessageId === local.id).map((p) => p.userId)).toEqual([B]);
    expect(s.completed).not.toContain(local.id); // the date isn't over everywhere

    pushes.length = 0;
    const control = messageRow({ channel: 'push', placement: null, layout: null, send_mode: 'immediate', control_weight: 50, variants: [{ id: 'A', name: 'A', weight: 50, content: pushContent }] });
    db.rows('engage_messages').push(control);
    await EngageSendService.runCron(NOW);
    const sentTo = pushes.filter((p) => p.data.engageMessageId === control.id).map((p) => p.userId);
    for (const u of [ME, B]) {
      const v = assignVariant(u, control.id, [{ id: 'A', weight: 50 }], 50);
      expect(sentTo.includes(u)).toBe(v !== CONTROL);
      expect(db.rows('engage_exposures').find((x) => x.message_id === control.id && x.user_id === u)?.variant_id).toBe(v);
    }
  });

  it('emails opted-in users with the campaign shell and unsubscribe headers', async () => {
    process.env.RESEND_API_KEY = 'test';
    const msg = messageRow({
      channel: 'email', placement: null, layout: null, send_mode: 'scheduled', send_at: '2026-12-07T15:00:00Z',
      variants: [{ id: 'A', name: 'A', weight: 100, content: { subject: 'Hi {{first_name | default: "there"}}', preheader: 'p', heading: 'Big news', body: 'One.\n\nTwo.', ctaLabel: 'Open', action: { type: 'campaign', value: 'advent_2026' } } }],
    });
    db.rows('engage_messages').push(msg);
    await EngageSendService.runCron(NOW);
    expect(mails.map((m) => m.to).sort()).toEqual([ME, B, E].map((u) => db.profile(u)!.email).sort()); // D opted out
    expect(mails.find((m) => m.to === db.profile(ME)!.email)).toMatchObject({ subject: 'Hi Ani', from: 'FitCircle <team@fitcircle.ai>' });
    expect(mails[0].html).toContain('https://www.fitcircle.ai/c/advent_2026');
    expect(mails[0].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    mails.length = 0;
    msg.send_completed_at = null;
    await EngageSendService.runCron(NOW);
    expect(mails).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- admin service
describe('message admin', () => {
  const input = () => ({
    name: 'Winter push',
    channel: 'content_card',
    placement: 'home_feed',
    layout: 'card',
    variants: [{ id: 'A', name: 'A', weight: 50, content: cardContent() }, { id: 'B', name: 'B', weight: 40, content: cardContent({ title: 'B title' }) }],
    controlWeight: 10,
    startsAt: '2026-12-01T00:00:00Z',
  });

  it('create → patch (version) → launch → pause/resume → duplicate → archive', async () => {
    const m = await EngageMessageService.create(input(), ME);
    expect(m).toMatchObject({ status: 'draft', version: 1, controlWeight: 10 });
    const p = await EngageMessageService.patch(m.id, { version: 1, name: 'Renamed' }, ME);
    expect(p).toMatchObject({ name: 'Renamed', version: 2 });
    await expect(EngageMessageService.patch(m.id, { version: 1, name: 'stale' }, ME)).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    const launched = await EngageMessageService.launch(m.id, ME);
    expect(launched.status).toBe('live');
    expect((await EngageMessageService.pause(m.id, ME)).status).toBe('paused');
    expect((await EngageMessageService.resume(m.id, ME)).status).toBe('live');
    const copy = await EngageMessageService.duplicate(m.id, ME);
    expect(copy).toMatchObject({ name: 'Renamed (copy)', status: 'draft', version: 1 });
    expect((await EngageMessageService.archive(m.id, ME)).status).toBe('archived');
    expect((await EngageMessageService.list()).map((x) => x.id)).toEqual([copy.id]);
  });

  it('launch refuses incomplete messages with issues', async () => {
    const m = await EngageMessageService.create({ ...input(), controlWeight: 0 }, ME);
    await expect(EngageMessageService.launch(m.id, ME)).rejects.toMatchObject({ status: 422, code: 'INCOMPLETE', data: { issues: [expect.stringContaining('add up to 100')] } });
  });

  it('preview renders every variant for a platform; test push goes only to me', async () => {
    const m = await EngageMessageService.create({ ...input(), variants: [{ id: 'A', name: 'A', weight: 90, content: cardContent(), platformOverrides: { web: { title: 'Web {{first_name}}' } } }] }, ME);
    const pv = await EngageMessageService.preview(m.id, me(), { onMyDevices: true, platform: 'web' });
    expect(pv.onMyDevices).toBe(true);
    expect(pv.message.previewUserIds).toEqual([ME]);
    expect(pv.rendered[0].content).toMatchObject({ title: 'Web Ani' });
    const push = await EngageMessageService.create({ name: 'p', channel: 'push', sendMode: 'immediate', startsAt: '2026-12-01T00:00:00Z', variants: [{ id: 'A', weight: 100, content: { title: 'T {{streak}}', body: 'B', action: { type: 'campaign', value: 'advent_2026' } } }] }, ME);
    const out = await EngageMessageService.test(push.id, me(), { platform: 'android' });
    expect(out).toMatchObject({ channel: 'push', sent: true, title: 'T 12', screen: 'campaign' });
    expect(directPushes[0]).toMatchObject({ userId: ME, n: { platforms: ['android'], data: { type: 'engage', engageMessageId: push.id, variantId: 'A', campaignSlug: 'advent_2026' } } });
  });
});

// ---------------------------------------------------------------- analytics
describe('stats', () => {
  it('per-variant + control metrics, conversions within the window, lift, platforms, daily', async () => {
    const msg = messageRow({
      control_weight: 20,
      variants: [{ id: 'A', name: 'A', weight: 80, content: cardContent() }],
      conversion: { event: 'circle_joined', windowHours: 24, basis: 'click' },
      starts_at: '2026-12-01T00:00:00Z',
    });
    db.rows('engage_messages').push(msg);
    const users = Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`);
    const at = (h: number) => new Date(Date.parse('2026-12-03T00:00:00Z') + h * 3600_000).toISOString();
    users.forEach((u, i) => {
      const variant = i < 6 ? 'A' : 'control';
      const platform = i % 2 ? 'android' : 'ios';
      db.rows('engage_exposures').push({ message_id: msg.id, user_id: u, variant_id: variant, platform, first_at: at(0) });
      if (variant === 'A') {
        db.rows('engage_events').push({ user_id: u, message_id: msg.id, variant_id: 'A', type: 'impression', platform, at: at(1) });
        db.rows('engage_events').push({ user_id: u, message_id: msg.id, variant_id: 'A', type: 'impression', platform, at: at(3) });
        if (i < 4) db.rows('engage_events').push({ user_id: u, message_id: msg.id, variant_id: 'A', type: 'click', platform, at: at(2) });
      }
    });
    // Conversions: users 0,1,2 within 24h of their click; user 3 converts too late; control user 6 converts after exposure.
    for (const [u, h] of [[users[0], 5], [users[1], 10], [users[2], 20], [users[3], 30], [users[6], 4]] as const) {
      db.rows('engage_events').push({ user_id: u, message_id: null, type: 'app_event', name: 'circle_joined', platform: 'ios', at: at(h) });
    }
    const s = await EngageStatsService.stats(msg.id, { from: '2026-12-01', to: '2026-12-07' });
    const a = s.variants.find((v) => v.variantId === 'A')!;
    const c = s.variants.find((v) => v.variantId === 'control')!;
    expect(a).toMatchObject({ exposedUsers: 6, impressions: 12, uniqueImpressions: 6, uniqueClicks: 4, conversions: 3, conversionRate: 0.5 });
    expect(a.ctr).toBeCloseTo(4 / 6);
    expect(c).toMatchObject({ exposedUsers: 4, conversions: 1, conversionRate: 0.25 });
    expect(a.liftVsControl).toBeCloseTo(1);
    expect(a.pValue).toBeCloseTo(twoProportionPValue(3, 6, 1, 4)!);
    const iosA = s.byPlatform.find((v) => v.variantId === 'A' && v.platform === 'ios')!;
    expect(iosA.exposedUsers).toBe(3);
    expect(s.daily.find((d) => d.date === '2026-12-03')).toMatchObject({ impressions: 12, clicks: 4, conversions: 3 });
    expect(s.funnel).toEqual({ exposed: 6, impressions: 6, clicks: 4, conversions: 3 });
    const androidOnly = await EngageStatsService.stats(msg.id, { from: '2026-12-01', to: '2026-12-07', platform: 'android' });
    expect(androidOnly.variants.find((v) => v.variantId === 'A')!.exposedUsers).toBe(3);

    const ov = await EngageStatsService.overview(NOW);
    expect(ov.liveByChannel.content_card).toBe(1);
    expect(ov.last7Days).toMatchObject({ impressions: 12, clicks: 4, conversions: 3 });
    expect(ov.totals).toMatchObject({ impressions: 12, clicks: 4, conversions: 3, pushSent: 0, emailSent: 0 });
    expect(ov.daily).toHaveLength(14);
    expect(ov.daily[13].date).toBe('2026-12-07');
    expect(ov.daily.find((d) => d.date === '2026-12-03')).toEqual({ date: '2026-12-03', impressions: 12, clicks: 4, conversions: 3 });
    expect(ov.topMessages[0]).toMatchObject({ messageId: msg.id, id: msg.id, impressions: 12, clicks: 4, conversions: 3 });
    expect(ov.topMessages[0].ctr).toBeCloseTo(4 / 6);

    // List summaries: one grouped pass over many messages.
    const quiet = messageRow({ name: 'quiet' });
    const push = messageRow({ channel: 'push', placement: null, layout: null, send_mode: 'immediate', conversion: { event: 'circle_joined', windowHours: 48, basis: 'impression' } });
    db.rows('engage_messages').push(quiet, push);
    db.rows('engage_deliveries').push(
      { message_id: push.id, user_id: users[0], variant_id: 'A', channel: 'push', platform: 'ios', sent_at: '2026-12-03T00:00:00.000Z' },
      { message_id: push.id, user_id: users[1], variant_id: 'A', channel: 'push', platform: 'ios', sent_at: '2026-12-03T00:00:00.000Z' },
      { message_id: push.id, user_id: users[7], variant_id: 'control', channel: 'push', platform: 'ios', sent_at: '2026-12-03T00:00:00.000Z' }
    );
    const sums = await EngageStatsService.summaries([msg, quiet, push], NOW);
    expect(sums.get(msg.id)).toMatchObject({ days: 7, daily: [0, 0, 12, 0, 0, 0, 0], uniqueImpressions: 6, uniqueClicks: 4, conversions: 3, conversionRate: 0.5 });
    expect(sums.get(quiet.id)).toMatchObject({ daily: [0, 0, 0, 0, 0, 0, 0], impressions: 0, ctr: null, conversions: 0, conversionRate: null });
    expect(sums.get(push.id)).toMatchObject({ sent: 2, daily: [0, 0, 2, 0, 0, 0, 0], conversions: 2, conversionRate: 1 });
  });
});
