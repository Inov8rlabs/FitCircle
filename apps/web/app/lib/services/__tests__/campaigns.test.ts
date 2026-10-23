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
  PushService: {
    sendPush: async (userId: string, n: any) => {
      directPushes.push({ userId, n });
      return 1;
    },
  },
}));
const mails = vi.hoisted(() => [] as any[]);
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: async (m: any) => (mails.push(m), { data: { id: 'x' }, error: null }) };
  },
}));

import { CampaignError } from '../../campaigns/http';
import { imageInfo } from '../../campaigns/image-size';
import { computePhase, computeStatus, rowToAdmin, adminToInput } from '../../campaigns/model';
import { renderPlaceholders } from '../../campaigns/placeholders';
import { appStoreIssues, appStoreSchedule, campaignInputSchema, publishIssues } from '../../campaigns/schema';
import { campaignUnsubscribeToken, verifyCampaignUnsubscribeToken } from '../../campaigns/unsubscribe';
import { buildCampaignView } from '../../campaigns/view';
import { CampaignDeliveryService, recipientTimezone } from '../campaign-delivery-service';
import { CampaignService, featuredCampaign, viewerToday, visibleFor } from '../campaign-service';

import { advent, baseRow, freshStart, holdTheLine } from './campaign-fixtures';
import { ReferralFakeDb, getReferralDb, setReferralDb } from './referral-fake-db';

const uid = (x: string) => `${x.repeat(8)}-${x.repeat(4)}-4${x.repeat(3)}-8${x.repeat(3)}-${x.repeat(12)}`;
const [ME, B, D, E, F] = ['a', 'b', 'd', 'e', 'f'].map(uid);
const CIRCLE = uid('c');
let db: ReferralFakeDb;

function claim(userId: string, date: string, method = 'manual_entry') {
  db.rows('streak_claims').push({ id: `${userId}-${date}-${Math.random()}`, user_id: userId, claim_date: date, claim_method: method });
}
function meal(userId: string, date: string, calories: number | null = 400, deleted = false) {
  db.rows('food_log_entries').push({ id: Math.random().toString(), user_id: userId, entry_date: date, calories, deleted_at: deleted ? '2026-12-01T00:00:00Z' : null });
}
const me = (over: Record<string, any> = {}) => ({ ...db.profile(ME)!, ...over });

beforeEach(() => {
  db = new ReferralFakeDb();
  setReferralDb(db);
  pushes.length = 0;
  directPushes.length = 0;
  mails.length = 0;
  db.addProfile({ id: ME, display_name: 'Ani Rao', timezone: 'America/Los_Angeles', preferences: {}, is_admin: false });
  for (const [id, name] of [[B, 'Ben'], [D, 'Dee'], [E, 'Eli'], [F, 'Fay']] as const) db.addProfile({ id, display_name: name, timezone: 'America/Los_Angeles', preferences: {} });
  db.rows('fitcircles').push({ id: CIRCLE, name: 'Movers', status: 'active' });
  for (const id of [ME, B, D, E]) db.rows('fitcircle_members').push({ fitcircle_id: CIRCLE, user_id: id, status: 'active' });
  db.rows('fitcircle_members').push({ fitcircle_id: CIRCLE, user_id: F, status: 'left' });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
describe('phase + status', () => {
  const c = advent();
  it('computes viewer phases with the 2-day ended grace', () => {
    expect(computePhase(c, '2026-11-16')).toBeNull();
    expect(computePhase(c, '2026-11-17')).toBe('teaser');
    expect(computePhase(c, '2026-12-01')).toBe('live');
    expect(computePhase(c, '2026-12-24')).toBe('live');
    expect(computePhase(c, '2026-12-26')).toBe('ended');
    expect(computePhase(c, '2026-12-27')).toBeNull();
  });
  it('computes admin status', () => {
    expect(computeStatus({ ...c, published: false }, '2026-12-05')).toBe('draft');
    expect(computeStatus(c, '2026-11-01')).toBe('scheduled');
    expect(computeStatus(c, '2026-11-20')).toBe('live');
    expect(computeStatus(c, '2026-12-25')).toBe('ended');
    expect(computeStatus({ ...c, archived_at: '2026-12-01' }, '2026-12-05')).toBe('archived');
  });
});

// ---------------------------------------------------------------------------
describe('buildCampaignView', () => {
  it('teaser: every door locked with no content, days until start', () => {
    const v = buildCampaignView(advent(), { today: '2026-11-20', phase: 'teaser' });
    expect(v).toMatchObject({ phase: 'teaser', dayNumber: null, daysUntilStart: 11, daysLeft: null, totalDays: 24, ctaLabel: 'Open the calendar' });
    expect(v.calendar!.doors).toHaveLength(24);
    expect(v.calendar!.doors.every((d) => d.state === 'locked' && d.title === undefined && d.emoji === undefined)).toBe(true);
    expect(v.art).toEqual({ inAppHero: null, appStoreCard: null, appStoreDetails: null, emailHeader: null });
  });

  it('live: door states, no peeking ahead, streak, friends opened first', () => {
    const opened = new Set(['2026-12-01', '2026-12-02', '2026-12-05', '2026-12-06']);
    const v = buildCampaignView(advent(), {
      today: '2026-12-07',
      phase: 'live',
      openedDates: opened,
      participant: { joined: true, reminders: true },
      friends: [
        { userId: B, name: 'Ben', avatarUrl: null, openedToday: false },
        { userId: D, name: 'Dee', avatarUrl: 'https://x/d.png', openedToday: true },
      ],
    });
    expect(v).toMatchObject({ dayNumber: 7, daysLeft: 18, daysUntilStart: null, participant: { joined: true, reminders: true } });
    const states = v.calendar!.doors.slice(0, 8).map((d) => d.state);
    expect(states).toEqual(['opened', 'opened', 'missed', 'missed', 'opened', 'opened', 'today', 'locked']);
    expect(v.calendar!.doors[6]).toMatchObject({ day: 7, date: '2026-12-07', emoji: '😴', title: 'Wind down' });
    expect(v.calendar!.doors[2]).toMatchObject({ state: 'missed', title: 'Unclench' }); // missed still shows content
    expect(v.calendar!.doors[7]).toEqual({ day: 8, date: '2026-12-08', state: 'locked' }); // no peeking
    expect(v.calendar).toMatchObject({ openedCount: 4, todayOpened: false, streak: 2 });
    expect(v.calendar!.friends).toMatchObject({ openedToday: 1, total: 2 });
    expect(v.calendar!.friends.members.map((m) => m.userId)).toEqual([D, B]);
  });

  it('live: opening today extends the streak through today', () => {
    const v = buildCampaignView(advent(), { today: '2026-12-07', phase: 'live', openedDates: new Set(['2026-12-05', '2026-12-06', '2026-12-07']) });
    expect(v.calendar).toMatchObject({ todayOpened: true, streak: 3, openedCount: 3 });
    expect(v.calendar!.doors[6].state).toBe('opened');
  });

  it('ended: all content revealed, nothing "today", friends not counted', () => {
    const v = buildCampaignView(advent(), {
      today: '2026-12-25',
      phase: 'ended',
      openedDates: new Set(['2026-12-24']),
      friends: [{ userId: B, name: 'Ben', avatarUrl: null, openedToday: true }],
    });
    expect(v.dayNumber).toBeNull();
    expect(v.calendar!.doors.every((d) => d.state !== 'locked' && d.state !== 'today' && d.title)).toBe(true);
    expect(v.calendar).toMatchObject({ todayOpened: false, streak: 1, friends: { openedToday: 0, total: 1 } });
  });

  it('seasonal_circle has no calendar and a template CTA label', () => {
    const v = buildCampaignView(holdTheLine(), { today: '2026-11-20', phase: 'live' });
    expect(v).toMatchObject({ calendar: null, ctaLabel: 'Start a circle', dayNumber: 6, daysLeft: 26, circle: { name: 'Hold the Line Crew' } });
  });
});

// ---------------------------------------------------------------------------
describe('CampaignService viewer endpoints', () => {
  beforeEach(() => {
    db.rows('campaigns').push(holdTheLine(), advent(), freshStart());
  });

  it('orders live before teaser, priority desc, and picks homeSlug', async () => {
    const res = await CampaignService.listForViewer(me({ is_admin: true, preferences: { campaignPreview: { asOf: '2026-12-07' } } }), 'UTC');
    expect(res.campaigns.map((c) => [c.slug, c.phase])).toEqual([
      ['advent_2026', 'live'],
      ['hold_the_line', 'live'],
    ]);
    expect(res.homeSlug).toBe('advent_2026');
    const late = await CampaignService.listForViewer(me({ is_admin: true, preferences: { campaignPreview: { asOf: '2026-12-16' } } }), 'UTC');
    expect(late.campaigns.map((c) => [c.slug, c.phase])).toEqual([
      ['advent_2026', 'live'],
      ['new_year_reset', 'teaser'],
      ['hold_the_line', 'ended'],
    ]);
  });

  it('opens doors from claims and calorie-bearing meals only; friends from active circles', async () => {
    claim(ME, '2026-12-01');
    meal(ME, '2026-12-02');
    claim(ME, '2026-12-03', 'freeze'); // a freeze is not showing up
    meal(ME, '2026-12-04', null); // no calories
    meal(ME, '2026-12-05', 300, true); // deleted
    claim(ME, '2026-12-06');
    claim(D, '2026-12-07');
    meal(E, '2026-12-07');
    claim(F, '2026-12-07'); // left the circle
    const view = await CampaignService.getForViewer(me({ is_admin: true, preferences: { campaignPreview: { asOf: '2026-12-07' } } }), null, 'advent_2026');
    expect(view.calendar!.doors.slice(0, 7).map((d) => d.state)).toEqual(['opened', 'opened', 'missed', 'missed', 'missed', 'opened', 'today']);
    expect(view.calendar).toMatchObject({ openedCount: 3, streak: 1, todayOpened: false });
    expect(view.calendar!.friends.total).toBe(3);
    expect(view.calendar!.friends.openedToday).toBe(2);
    expect(view.calendar!.friends.members.map((m) => m.name)).toEqual(['Dee', 'Eli', 'Ben']);
  });

  it('featuredCampaign (home feed hint) matches listForViewer’s first campaign on every day of the season', async () => {
    const rows = db.rows('campaigns') as any[];
    for (const asOf of ['2026-11-01', '2026-11-20', '2026-12-01', '2026-12-07', '2026-12-16', '2026-12-28', '2027-01-05', '2027-02-01']) {
      const viewer = me({ is_admin: true, preferences: { campaignPreview: { asOf } } });
      const list = await CampaignService.listForViewer(viewer, 'UTC');
      const hint = featuredCampaign(rows, ME, viewerToday(viewer as any, 'UTC'));
      expect(hint, asOf).toEqual(list.campaigns[0] ? { slug: list.campaigns[0].slug, phase: list.campaigns[0].phase } : null);
    }
  });

  it('ignores asOf for non-admins and uses the client timezone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T06:00:00Z')); // Nov 30 in LA, Dec 1 in UTC
    const res = await CampaignService.listForViewer(me({ preferences: { campaignPreview: { asOf: '2027-01-05' } } }), 'America/Los_Angeles');
    expect(res.campaigns.find((c) => c.slug === 'advent_2026')).toMatchObject({ phase: 'teaser', today: '2026-11-30', daysUntilStart: 1 });
    const utc = await CampaignService.listForViewer(me(), 'UTC');
    expect(utc.campaigns[0]).toMatchObject({ slug: 'advent_2026', phase: 'live', dayNumber: 1 });
  });

  it('drafts are hidden unless the viewer previews them; archived never shows', async () => {
    const draft = baseRow({ slug: 'spring_fling', template: 'spotlight', published: false, featured_from: '2027-03-01', starts_at: '2027-03-10', ends_at: '2027-03-20', cta: { action: 'invite' } });
    db.rows('campaigns').push(draft, baseRow({ slug: 'old_one', archived_at: '2026-10-01', preview_user_ids: [ME] }));
    const viewer = me({ is_admin: true, preferences: { campaignPreview: { asOf: '2026-12-07' } } });
    expect((await CampaignService.listForViewer(viewer, null)).campaigns.map((c) => c.slug)).not.toContain('spring_fling');
    await expect(CampaignService.getForViewer(viewer, null, 'spring_fling')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    draft.preview_user_ids = [ME];
    const res = await CampaignService.listForViewer(viewer, null);
    expect(res.campaigns.find((c) => c.slug === 'spring_fling')).toMatchObject({ isPreview: true, phase: 'teaser' });
    expect(res.campaigns.map((c) => c.slug)).not.toContain('old_one');
  });

  it('participation: reminders imply joined; leaving clears reminders', async () => {
    const viewer = me({ is_admin: true, preferences: { campaignPreview: { asOf: '2026-12-07' } } });
    let v = await CampaignService.setParticipation(viewer, null, 'advent_2026', { reminders: true });
    expect(v.participant).toEqual({ joined: true, reminders: true });
    expect(db.rows('campaign_participants')).toHaveLength(1);
    v = await CampaignService.setParticipation(viewer, null, 'advent_2026', { reminders: false });
    expect(v.participant).toEqual({ joined: true, reminders: false });
    expect(db.rows('campaign_participants')[0].reminders).toBe(false);
    v = await CampaignService.setParticipation(viewer, null, 'advent_2026', { joined: false });
    expect(v.participant).toEqual({ joined: false, reminders: false });
    expect(db.rows('campaign_participants')).toHaveLength(0);
    v = await CampaignService.getForViewer(viewer, null, 'advent_2026');
    expect(v.participant.joined).toBe(false);
  });

  it('seasonal: legacy shape from campaigns with a legacy key', async () => {
    const out = await CampaignService.seasonalFor(me({ is_admin: true, preferences: { campaignPreview: { asOf: '2026-12-10' } } }), null);
    expect(out.current).toMatchObject({ key: 'hold_the_line', title: 'Hold the Line', startsAt: '2026-11-15', endsAt: '2026-12-15', featuredFrom: '2026-10-20', accent: '#38bdf8', circle: { name: 'Hold the Line Crew', type: 'custom' } });
    expect(Object.keys(out.current!).sort()).toEqual(['accent', 'circle', 'description', 'emoji', 'endsAt', 'featuredFrom', 'key', 'startsAt', 'tagline', 'title']);
    expect(out.upcoming).toMatchObject({ key: 'new_year_reset', featuredFrom: '2026-12-16' });
  });
});

// ---------------------------------------------------------------------------
describe('validation', () => {
  const valid = () => adminToInput(rowToAdmin(advent(), '2026-11-01'));

  it('accepts the seed campaigns', () => {
    for (const row of [holdTheLine(), advent(), freshStart()]) {
      const input = adminToInput(rowToAdmin({ ...row, app_store: { name: 'Advent Circle', shortDescription: 'A small healthy win behind every door.', longDescription: 'Open one door a day from Dec 1 to 24: a quick healthy challenge you and your circle do together.', badge: 'SPECIAL_EVENT' } }, '2026-11-01'));
      expect(campaignInputSchema.safeParse(input).success).toBe(true);
    }
  });

  it('enforces copy, push and App Store limits', () => {
    const bad = (patch: Record<string, any>) => campaignInputSchema.safeParse({ ...valid(), ...patch }).success;
    expect(bad({ title: 'x'.repeat(41) })).toBe(false);
    expect(bad({ title: 'x'.repeat(40) })).toBe(true);
    expect(bad({ emoji: '🎁🎁🎁🎁🎁🎁🎁🎁' })).toBe(true); // 8 code points
    expect(bad({ emoji: '🎁🎁🎁🎁🎁🎁🎁🎁🎁' })).toBe(false);
    expect(bad({ appStore: { name: 'x'.repeat(31) } })).toBe(false);
    expect(bad({ appStore: { shortDescription: 'x'.repeat(51) } })).toBe(false);
    expect(bad({ appStore: { longDescription: 'x'.repeat(121) } })).toBe(false);
    expect(bad({ appStore: { badge: 'NOPE' } })).toBe(false);
    expect(bad({ slug: 'Bad Slug' })).toBe(false);
    expect(bad({ accent: 'red' })).toBe(false);
    expect(bad({ startsAt: '2026-12-25' })).toBe(false); // after endsAt
    expect(bad({ cta: { action: 'open_url', url: null } })).toBe(false);
    expect(bad({ notifications: [{ key: 'x', kind: 'custom', localHour: 8, title: 't', body: 'b', audience: 'all', enabled: true }] })).toBe(false);
    expect(bad({ notifications: [{ key: 'x', kind: 'launch', localHour: 24, title: 't', body: 'b', audience: 'all', enabled: true }] })).toBe(false);
    expect(bad({ notifications: [{ key: 'x', kind: 'launch', localHour: 8, title: 'x'.repeat(61), body: 'b', audience: 'all', enabled: true }] })).toBe(false);
  });

  it('publish checklist and App Store rules', () => {
    const a = rowToAdmin(advent({ calendar: { doors: advent().calendar!.doors.slice(0, 20) } }), '2026-11-01');
    expect(publishIssues(a)).toEqual(expect.arrayContaining([expect.stringContaining('missing doors 21, 22, 23, 24'), expect.stringContaining('hero art')]));
    expect(publishIssues(rowToAdmin(advent(), '2026-11-01'), { acceptFallbackArt: true })).toEqual([]);
    expect(publishIssues(rowToAdmin(holdTheLine({ circle_template: null }), '2026-11-01'), { acceptFallbackArt: true })).toEqual(['A circle template is required for seasonal circles']);

    const long = rowToAdmin(baseRow({ starts_at: '2026-11-01', ends_at: '2026-12-15', featured_from: '2026-10-01', app_store: { name: 'n', shortDescription: 's', longDescription: 'l', badge: 'CHALLENGE' } }), '2026-10-01');
    expect(appStoreIssues(long)).toEqual([expect.stringContaining('at most 31 days')]);
    expect(appStoreIssues(rowToAdmin(holdTheLine({ app_store: { name: 'n', shortDescription: 's', longDescription: 'l', badge: 'CHALLENGE' } }), '2026-10-01'))).toEqual([]);
    // promotion starts ≤ 14 days before the start
    expect(appStoreSchedule({ featuredFrom: '2026-10-20', startsAt: '2026-11-15', endsAt: '2026-12-15' }).publishStart).toBe('2026-11-01T08:00:00.000Z');
    expect(appStoreSchedule({ featuredFrom: '2026-11-25', startsAt: '2026-12-01', endsAt: '2026-12-24' }).publishStart).toBe('2026-11-25T08:00:00.000Z');
  });

  it('renders placeholders and image headers', () => {
    expect(renderPlaceholders('Door {{day}} is open {{door_emoji}}', { day: 7, door_emoji: '😴' })).toBe('Door 7 is open 😴');
    expect(renderPlaceholders('Hi {{first_name}}, {{unknown}} {{days_left}} left', { first_name: 'Ani', days_left: 3 })).toBe('Hi Ani, 3 left');
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(png.buffer).setUint32(16, 1920);
    new DataView(png.buffer).setUint32(20, 1080);
    expect(imageInfo(png)).toEqual({ type: 'png', width: 1920, height: 1080 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x07, 0x80, 0x04, 0x38, 0x03]);
    expect(imageInfo(jpeg)).toEqual({ type: 'jpeg', width: 1080, height: 1920 });
    expect(imageInfo(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('admin service', () => {
  it('create → patch with version → conflict on stale version', async () => {
    const input = { ...adminToInput(rowToAdmin(holdTheLine(), '2026-10-01')), slug: 'winter_push' };
    const created = await CampaignService.create(input, ME);
    expect(created).toMatchObject({ slug: 'winter_push', status: 'draft', version: 1, published: false });
    const patched = await CampaignService.patch(created.id, { version: 1, title: 'Winter Push', appStore: { name: 'Winter Push', eventId: 'hacked' } }, ME);
    expect(patched).toMatchObject({ title: 'Winter Push', version: 2 });
    expect(patched.appStore.eventId).toBeUndefined(); // server-managed keys can't be set by PATCH
    await expect(CampaignService.patch(created.id, { version: 1, title: 'Stale' }, ME)).rejects.toMatchObject({ status: 409, code: 'VERSION_CONFLICT' });
    await expect(CampaignService.create(input, ME)).rejects.toMatchObject({ status: 409, code: 'SLUG_TAKEN' });
    await expect(CampaignService.patch(created.id, { version: 2, title: 'x'.repeat(41) }, ME)).rejects.toMatchObject({ name: 'ZodError' });
  });

  it('publish validates completeness; art upload checks exact App Store sizes', async () => {
    const row = advent({ published: false });
    db.rows('campaigns').push(row);
    await expect(CampaignService.publish(row.id, ME)).rejects.toMatchObject({ status: 422, code: 'INCOMPLETE' });
    const png = (w: number, h: number) => {
      const b = new Uint8Array(32);
      b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      new DataView(b.buffer).setUint32(16, w);
      new DataView(b.buffer).setUint32(20, h);
      return b;
    };
    await expect(CampaignService.uploadArt(row.id, 'appStoreCard', png(1000, 500), true, ME)).rejects.toMatchObject({ code: 'WRONG_DIMENSIONS' });
    await expect(CampaignService.uploadArt(row.id, 'inAppHero', new Uint8Array([1, 2, 3, 4]), true, ME)).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
    const withArt = await CampaignService.uploadArt(row.id, 'inAppHero', png(1200, 675), true, ME);
    expect(withArt.art.inAppHero).toMatchObject({ width: 1200, height: 675, generated: true });
    expect(withArt.art.inAppHero!.url).toMatch(new RegExp(`campaign-art/${row.id}/inAppHero-\\d+\\.png$`));
    const pub = await CampaignService.publish(row.id, ME);
    expect(pub.published).toBe(true);
  });

  it('preview toggles preview_user_ids and the admin asOf', async () => {
    const row = advent({ published: false });
    db.rows('campaigns').push(row);
    const out = await CampaignService.setPreview(row.id, ME, { onMyDevices: true, asOf: '2026-12-07' });
    expect(out).toMatchObject({ onMyDevices: true, asOf: '2026-12-07' });
    expect(row.preview_user_ids).toEqual([ME]);
    expect(db.profile(ME)!.preferences.campaignPreview.asOf).toBe('2026-12-07');
    await CampaignService.setPreview(row.id, ME, { onMyDevices: false, asOf: null });
    expect(row.preview_user_ids).toEqual([]);
    expect(db.profile(ME)!.preferences.campaignPreview).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('delivery cron', () => {
  // 2026-12-07 16:00Z = 08:00 in Los Angeles, 16:00 in London.
  const NOW = new Date('2026-12-07T16:00:00Z');
  beforeEach(() => {
    db.rows('campaigns').push(advent(), holdTheLine());
    for (const id of [ME, B, D, E, F]) db.rows('push_tokens').push({ user_id: id, is_active: true });
    db.profile(E)!.timezone = 'Europe/London';
    db.profile(F)!.timezone = 'UTC'; // column default → treated as Los Angeles
    for (const [user, reminders] of [[ME, true], [B, true], [D, false], [E, true]] as const) {
      db.rows('campaign_participants').push({ campaign_id: db.rows('campaigns')[0].id, user_id: user, reminders });
    }
  });

  it('targets local hour, audience reminders, skips opened, dedupes', async () => {
    claim(B, '2026-12-07'); // B already opened today's door
    const s1 = await CampaignDeliveryService.runCron(NOW);
    const daily = pushes.filter((p) => p.data.campaignKey === 'daily');
    expect(daily.map((p) => p.userId)).toEqual([ME]); // D: no reminders; E: 16:00 in London; B: opened
    expect(daily[0]).toMatchObject({ type: 'campaign', data: { title: 'Door 7 is open 😴', body: 'Wind down: check in today to open it.', campaignSlug: 'advent_2026' } });
    expect(s1.push.skippedOpened).toBe(1);
    expect(db.rows('campaign_deliveries').map((r) => r.delivery_key)).toEqual(['push:daily:2026-12-07']);

    pushes.length = 0;
    await CampaignDeliveryService.runCron(NOW); // same hour again
    expect(pushes).toHaveLength(0);
  });

  it('launch goes to every token holder on starts_at at their local hour', async () => {
    const launchNow = new Date('2026-12-01T16:00:00Z');
    await CampaignDeliveryService.runCron(launchNow);
    const launch = pushes.filter((p) => p.data.campaignKey === 'launch' && p.data.campaignSlug === 'advent_2026');
    expect(launch.map((p) => p.userId).sort()).toEqual([ME, B, D, F].sort()); // E is at 16:00 in London
    expect(recipientTimezone('UTC')).toBe('America/Los_Angeles');
    pushes.length = 0;
    await CampaignDeliveryService.runCron(new Date('2026-12-01T08:00:00Z')); // 08:00 London
    expect(pushes.filter((p) => p.data.campaignKey === 'launch').map((p) => p.userId)).toEqual([E]);
  });

  it('emails respect consent, dedupe and carry unsubscribe headers', async () => {
    process.env.RESEND_API_KEY = 'test';
    const row = db.rows('campaigns')[0];
    row.emails = [{ key: 'kickoff', kind: 'launch', localHour: 7, subject: '{{title}} is open', preheader: 'Door 1 awaits', heading: 'Hi {{first_name}}', body: 'Para one.\n\nPara two.', ctaLabel: 'Open', audience: 'participants', enabled: true }];
    db.profile(B)!.preferences = { marketingEmails: false };
    const s = await CampaignDeliveryService.runCron(new Date('2026-12-01T16:00:00Z'));
    // Participants past 07:00 local on Dec 1 (LA 08:00, London 16:00); B opted out.
    expect(mails.map((m) => m.to).sort()).toEqual([ME, D, E].map((u) => db.profile(u)!.email).sort());
    expect(s.email.skippedConsent).toBe(1);
    const m = mails[0];
    expect(m.subject).toBe('Advent Circle is open');
    expect(m.from).toBe('FitCircle <team@fitcircle.ai>');
    expect(m.headers['List-Unsubscribe']).toMatch(/^<https:\/\/www\.fitcircle\.ai\/api\/campaigns\/unsubscribe\?t=/);
    expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(m.html).toContain('https://www.fitcircle.ai/c/advent_2026');
    mails.length = 0;
    await CampaignDeliveryService.runCron(new Date('2026-12-01T17:00:00Z'));
    expect(mails).toHaveLength(0);
    delete process.env.RESEND_API_KEY;
  });

  it('unsubscribe tokens verify and opt the user out', async () => {
    const t = campaignUnsubscribeToken(ME);
    expect(verifyCampaignUnsubscribeToken(t)).toBe(ME);
    expect(verifyCampaignUnsubscribeToken(`${B}.${t.split('.')[1]}`)).toBeNull();
    expect(verifyCampaignUnsubscribeToken('garbage')).toBeNull();
    expect(await CampaignDeliveryService.optOut(ME)).toBe(true);
    expect(db.profile(ME)!.preferences.marketingEmails).toBe(false);
  });

  it('test push goes straight to the caller with the campaign route', async () => {
    const row = db.rows('campaigns')[0];
    const out = await CampaignDeliveryService.sendTestPush(row.id, me({ preferences: { campaignPreview: { asOf: '2026-12-07' } } }), 'daily');
    expect(out).toMatchObject({ sent: true, title: 'Door 7 is open 😴' });
    expect(directPushes[0].n.data).toEqual({ type: 'campaign', category: 'challenge', screen: 'campaign', campaignSlug: 'advent_2026' });
    await expect(CampaignDeliveryService.sendTestPush(row.id, me(), 'nope')).rejects.toBeInstanceOf(CampaignError);
  });
});

describe('visibleFor', () => {
  it('keeps out-of-window published campaigns hidden', () => {
    expect(visibleFor([advent()], ME, '2026-11-01')).toEqual([]);
  });
});
