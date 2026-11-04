/**
 * Server-driven rating prompt routes (docs/RATING_PROMPT.md):
 *   GET  /api/mobile/rating-prompt, POST /api/mobile/rating-prompt/requested
 *   Admin: state, publish (validation, compare-and-set, audit), changes,
 *   audience, requests.
 * In-memory Supabase; config falls back to code defaults without a row.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: () => h.db }));
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: async (request: Request) => {
    const auth = request.headers.get('authorization') ?? '';
    const id = auth.startsWith('Bearer user:') ? auth.slice('Bearer user:'.length) : null;
    const profile = id ? h.db.getRows('profiles').find((p: any) => p.id === id) : null;
    if (!profile) throw new Error('Unauthorized');
    return { ...profile };
  },
}));

import { DEFAULT_CONFIG, configVersion } from '@/lib/rating-prompt/config';
import { ratingConfigCache } from '@/lib/services/rating-prompt-service';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { GET as adminAudience } from '../../../admin/rating-prompt/audience/route';
import { GET as adminChanges } from '../../../admin/rating-prompt/changes/route';
import { POST as adminPublish } from '../../../admin/rating-prompt/publish/route';
import { GET as adminRequests } from '../../../admin/rating-prompt/requests/route';
import { GET as adminState } from '../../../admin/rating-prompt/route';
import { POST as reportPost } from '../requested/route';
import { GET } from '../route';

const USER = '11111111-2222-4333-8444-555555555555';
const NEWBIE = '22222222-2222-4333-8444-555555555555';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_EMAIL = 'ani@inov8rlabs.com';
let db: FakeSupabase;

const mobile = (path: string, opts: { as?: string; version?: string; platform?: string; body?: unknown } = {}) =>
  new NextRequest(`https://www.fitcircle.ai${path}`, {
    method: opts.body !== undefined ? 'POST' : 'GET',
    headers: {
      ...(opts.as ? { authorization: `Bearer user:${opts.as}` } : {}),
      'x-app-platform': opts.platform ?? 'ios',
      ...(opts.version !== '' ? { 'x-app-version': opts.version ?? '1.1.3' } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
const admin = (path: string, body?: unknown, actor: string | null = ADMIN_EMAIL) =>
  new NextRequest(`https://www.fitcircle.ai${path}`, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: {
      authorization: 'Bearer shh',
      ...(actor ? { 'x-admin-actor': actor } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const json = async (res: Response) => ({ status: res.status, cache: res.headers.get('cache-control'), body: await res.json() });
const decision = async (as = USER, opts: { version?: string; platform?: string } = {}) => (await json(await GET(mobile('/api/mobile/rating-prompt', { as, ...opts })))).body.data;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T18:00:00Z'));
  db = new FakeSupabase({ feature_flags: { uniqueKey: ['name'] }, profiles: { uniqueKey: ['id'] } });
  h.db = db;
  ratingConfigCache.clear();
  process.env.ADMIN_API_SECRET = 'shh';
  db.seed('profiles', [
    { id: USER, email: 'jane@gmail.com', display_name: 'Jane', is_admin: false, timezone: 'UTC', created_at: '2026-10-01T00:00:00Z', metadata: { milestones: { x: 1 } } },
    { id: NEWBIE, email: 'new@gmail.com', display_name: 'New', is_admin: false, timezone: 'UTC', created_at: '2026-11-04T08:00:00Z', metadata: {} },
    { id: ADMIN, email: ADMIN_EMAIL, display_name: 'Ani', is_admin: true, timezone: 'UTC', created_at: '2026-01-01T00:00:00Z', metadata: {} },
  ]);
  db.seed('food_log_entries', [
    { id: 'f1', user_id: USER, entry_type: 'food', entry_date: '2026-11-01', deleted_at: null },
    { id: 'f2', user_id: USER, entry_type: 'food', entry_date: '2026-11-01', deleted_at: null },
    { id: 'f3', user_id: USER, entry_type: 'food', entry_date: '2026-11-03', deleted_at: null },
    { id: 'f4', user_id: USER, entry_type: 'water', entry_date: '2026-10-30', deleted_at: null },
  ]);
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.ADMIN_API_SECRET;
  delete process.env.RATING_PROMPT_ENABLED;
});

describe('GET /api/mobile/rating-prompt', () => {
  it('needs auth', async () => {
    expect((await GET(mobile('/api/mobile/rating-prompt'))).status).toBe(401);
  });

  it('no row: code defaults, server-computed eligibility, no-store', async () => {
    const res = await json(await GET(mobile('/api/mobile/rating-prompt', { as: USER })));
    expect(res.status).toBe(200);
    expect(res.cache).toBe('no-store');
    expect(res.body.data).toMatchObject({ eligible: true, reason: null, promptCount: 0, maxPrompts: 3, configVersion: configVersion(true, DEFAULT_CONFIG) });
    // 2 earlier food days + today → meal_saved is on.
    expect(res.body.data.triggers.map((t: any) => t.key)).toEqual(['challenge_day_completed', 'meal_saved', 'streak_reached']);
  });

  it('meal_saved stays off until enough distinct meal days', async () => {
    db.getRows('food_log_entries').splice(2); // only 2026-11-01 left
    expect((await decision()).triggers.map((t: any) => t.key)).not.toContain('meal_saved');
  });

  it('a brand-new account and internal accounts are not eligible', async () => {
    expect(await decision(NEWBIE)).toMatchObject({ eligible: false, reason: 'too_soon_after_signup', triggers: [] });
    expect(await decision(ADMIN)).toMatchObject({ eligible: false, reason: 'internal_account' });
  });

  it('shipped clients (≤ 1.1.1, or no version) are never eligible', async () => {
    expect(await decision(USER, { version: '1.1.1' })).toMatchObject({ eligible: false, reason: 'app_version' });
    expect(await decision(USER, { version: '' })).toMatchObject({ eligible: false, reason: 'app_version' });
    expect(await decision(USER, { platform: 'web' })).toMatchObject({ eligible: false, reason: 'unsupported_platform' });
  });

  it('env kill switch', async () => {
    process.env.RATING_PROMPT_ENABLED = 'false';
    expect(await decision()).toMatchObject({ eligible: false, reason: 'kill_switch' });
  });

  it('a published row drives it; an invalid row falls back to defaults', async () => {
    db.seed('feature_flags', [{ name: 'rating_prompt', is_enabled: true, metadata: { ...DEFAULT_CONFIG, triggers: { challenge_day_completed: { enabled: true } } }, updated_at: '2026-11-04T00:00:00Z' }]);
    expect((await decision()).triggers).toEqual([{ key: 'challenge_day_completed' }]);
    db.getRows('feature_flags')[0].metadata = { version: 1, nope: true };
    ratingConfigCache.clear();
    expect((await decision()).triggers).toHaveLength(3);
    db.getRows('feature_flags')[0].is_enabled = false;
    ratingConfigCache.clear();
    expect(await decision()).toMatchObject({ eligible: false, reason: 'disabled' });
  });

  it('a DB failure answers not eligible (never prompt on doubt)', async () => {
    const real = db.from.bind(db);
    db.from = ((table: string) => {
      if (table === 'food_log_entries') throw new Error('boom');
      return real(table);
    }) as any;
    const res = await json(await GET(mobile('/api/mobile/rating-prompt', { as: USER })));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ eligible: false, reason: 'unavailable', triggers: [] });
  });
});

describe('POST /api/mobile/rating-prompt/requested', () => {
  const report = (body: unknown, as = USER) => reportPost(mobile('/api/mobile/rating-prompt/requested', { as, body }));

  it('records the ledger, keeps other metadata, starts the cooldown', async () => {
    const res = await json(await report({ trigger: 'meal_saved' }));
    expect(res.body.data).toEqual({ recorded: true, promptCount: 1, lastPromptAt: '2026-11-04T18:00:00.000Z' });
    const meta = db.getRows('profiles').find((p) => p.id === USER)!.metadata;
    expect(meta.milestones).toEqual({ x: 1 });
    expect(meta.rating_prompt).toMatchObject({ prompt_count: 1, last_trigger: 'meal_saved', last_platform: 'ios', last_app_version: '1.1.3' });
    expect(await decision()).toMatchObject({ eligible: false, reason: 'cooldown', cooldownUntil: '2027-03-04T18:00:00.000Z' });
  });

  it('a retry within 60 s is not counted twice; later ones are', async () => {
    await report({ trigger: 'meal_saved' });
    expect((await json(await report({ trigger: 'meal_saved' }))).body.data).toMatchObject({ recorded: false, promptCount: 1 });
    vi.setSystemTime(new Date('2026-11-04T18:05:00Z'));
    expect((await json(await report({ trigger: 'streak_reached' }))).body.data).toMatchObject({ recorded: true, promptCount: 2 });
  });

  it('validates and needs auth', async () => {
    expect((await report({})).status).toBe(400);
    expect((await report({ trigger: 'Bad Key' })).status).toBe(400);
    expect((await reportPost(mobile('/api/mobile/rating-prompt/requested', { body: { trigger: 'meal_saved' } }))).status).toBe(401);
  });
});

describe('admin', () => {
  const publishBody = (over: Record<string, unknown> = {}) => ({
    baseVersion: configVersion(true, DEFAULT_CONFIG),
    config: { ...DEFAULT_CONFIG, cooldownDays: 90 },
    enabled: true,
    summary: 'Shorter cooldown',
    ...over,
  });

  it('state: defaults without a row', async () => {
    const res = await json(await adminState(admin('/api/admin/rating-prompt')));
    expect(res.body.data).toMatchObject({ source: 'defaults', enabled: true, config: DEFAULT_CONFIG, killSwitch: { envEnabled: true } });
    expect(res.body.data.triggers.map((t: any) => t.key)).toEqual(['meal_saved', 'streak_reached', 'challenge_day_completed']);
  });

  it('non-admins are refused', async () => {
    const res = await adminState(new NextRequest('https://www.fitcircle.ai/api/admin/rating-prompt', { headers: { authorization: `Bearer user:${USER}` } }));
    expect(res.status).toBe(403);
  });

  it('publish: inserts the row, audits, serves it to apps; stale drafts get 409', async () => {
    const res = await json(await adminPublish(admin('/api/admin/rating-prompt/publish', publishBody())));
    expect(res.status).toBe(200);
    expect(res.body.data.change).toMatchObject({ actorEmail: ADMIN_EMAIL, summary: 'Shorter cooldown', diff: [{ path: 'cooldownDays', before: 120, after: 90 }] });
    expect(db.getRows('feature_flags')[0]).toMatchObject({ name: 'rating_prompt', is_enabled: true });
    expect((await json(await adminState(admin('/api/admin/rating-prompt')))).body.data).toMatchObject({ source: 'database', version: res.body.data.version });

    const stale = await json(await adminPublish(admin('/api/admin/rating-prompt/publish', publishBody({ summary: 'again' }))));
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STALE_DRAFT');

    vi.setSystemTime(new Date('2026-11-04T18:10:00Z'));
    const off = await json(await adminPublish(admin('/api/admin/rating-prompt/publish', publishBody({ baseVersion: res.body.data.version, enabled: false, summary: 'Kill it' }))));
    expect(off.status).toBe(200);
    expect(await decision()).toMatchObject({ eligible: false, reason: 'disabled' });

    const changes = await json(await adminChanges(admin('/api/admin/rating-prompt/changes')));
    expect(changes.body.data.changes.map((c: any) => c.summary)).toEqual(['Kill it', 'Shorter cooldown']);
  });

  it('publish: invalid drafts and missing actor are rejected', async () => {
    const bad = await json(await adminPublish(admin('/api/admin/rating-prompt/publish', publishBody({ config: { ...DEFAULT_CONFIG, cooldownDays: -1 } }))));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    expect((await adminPublish(admin('/api/admin/rating-prompt/publish', publishBody(), null))).status).toBe(400);
  });

  it('audience counts eligible users and why the rest are not', async () => {
    const res = await json(await adminAudience(admin('/api/admin/rating-prompt/audience')));
    expect(res.body.data).toMatchObject({ eligible: 1, total: 3, byReason: { too_soon_after_signup: 1, internal_account: 1 }, byTrigger: { meal_saved: 1, streak_reached: 1, challenge_day_completed: 1 }, truncated: false });
  });

  it('recent requests, newest first', async () => {
    await reportPost(mobile('/api/mobile/rating-prompt/requested', { as: USER, body: { trigger: 'meal_saved' } }));
    const res = await json(await adminRequests(admin('/api/admin/rating-prompt/requests')));
    expect(res.body.data.requests).toEqual([
      { userId: USER, displayName: 'Jane', at: '2026-11-04T18:00:00.000Z', trigger: 'meal_saved', platform: 'ios', appVersion: '1.1.3', promptCount: 1 },
    ]);
  });
});
