/** /api/admin/remote-config/** — auth, validation (400 + paths), CRUD, audit, preview, changes, estimate (TRIAL_FIRST_SPEC §6.5). */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetRemoteConfigCache, RemoteConfigService } from '@/lib/remote-config/service';
import { createAdminSupabase } from '@/lib/supabase-admin';

import { FakeSupabase } from '../../../../../__tests__/helpers/fake-supabase';
import { PUT as PUT_DEFAULT } from '../[key]/default/route';
import { POST as ESTIMATE } from '../[key]/estimate/route';
import { POST as CREATE_RULE } from '../[key]/rules/route';
import { GET as CHANGES } from '../changes/route';
import { POST as PREVIEW } from '../preview/route';
import { GET as LIST } from '../route';
import { DELETE as DELETE_RULE, PATCH as PATCH_RULE } from '../rules/[id]/route';

vi.mock('@/lib/supabase-admin', () => ({ createAdminSupabase: vi.fn() }));
let authedUser: Record<string, any> | null = null;
vi.mock('@/lib/middleware/mobile-auth', () => ({
  requireMobileAuth: vi.fn(async () => {
    if (!authedUser) throw new Error('Unauthorized');
    return { ...authedUser };
  }),
}));

const SECRET = 'admin-secret';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

let db: FakeSupabase;
beforeEach(() => {
  vi.stubEnv('ADMIN_API_SECRET', SECRET);
  db = new FakeSupabase({
    remote_config_rules: {},
    remote_config_defaults: { uniqueKey: ['config_key'] },
    remote_config_changes: {},
    profiles: {
      uniqueKey: ['id'],
      rows: [
        { id: ADMIN, email: 'ani@inov8rlabs.com', is_admin: true, created_at: '2026-01-01T00:00:00Z' },
        { id: USER, email: 'u@example.com', is_admin: false, created_at: '2026-11-01T00:00:00Z' },
        { id: OTHER, email: 'o@example.com', is_admin: false, created_at: '2026-06-01T00:00:00Z' },
      ],
    },
    user_attribution: { rows: [{ user_id: USER, channel: 'apple_ads', country: 'US', platform: 'ios' }] },
    experiment_assignments: {},
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db as any);
  authedUser = null;
  resetRemoteConfigCache();
});
afterEach(() => vi.unstubAllEnvs());

const secret = { authorization: `Bearer ${SECRET}`, 'x-admin-actor': 'ani@inov8rlabs.com' };
const req = (path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`https://api.test${path}`, {
    method: opts.method ?? 'GET',
    headers: { ...(opts.headers ?? secret), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
const keyParams = (key: string) => ({ params: Promise.resolve({ key }) });
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const KEY = 'free_food_ai_analyses_total';

describe('auth', () => {
  it('no auth → 401; non-admin → 403; admin session and secret → 200', async () => {
    expect((await LIST(req('/api/admin/remote-config', { headers: {} }))).status).toBe(401);
    authedUser = { id: USER, is_admin: false };
    expect((await LIST(req('/api/admin/remote-config', { headers: { authorization: 'Bearer user' } }))).status).toBe(403);
    authedUser = { id: ADMIN, is_admin: true, email: 'ani@inov8rlabs.com' };
    expect((await LIST(req('/api/admin/remote-config', { headers: { authorization: 'Bearer user' } }))).status).toBe(200);
    expect((await LIST(req('/api/admin/remote-config'))).status).toBe(200);
  });

  it('secret writes must name the actor', async () => {
    const res = await PUT_DEFAULT(req(`/api/admin/remote-config/${KEY}/default`, { method: 'PUT', body: { value: 7 }, headers: { authorization: `Bearer ${SECRET}` } }), keyParams(KEY));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('missing_actor');
  });
});

describe('GET list', () => {
  it('returns every registry key with bounds, code default, admin default and rules', async () => {
    const { status, body } = await json(await LIST(req('/api/admin/remote-config')));
    expect(status).toBe(200);
    expect(body.data.keys).toEqual([
      expect.objectContaining({ key: 'free_food_ai_analyses_total', type: 'int', min: 0, max: 1000, codeDefault: 5, default: null, rules: [], unit: expect.any(String), description: expect.any(String) }),
      expect.objectContaining({ key: 'free_fitzy_messages_per_day', type: 'int', min: 0, max: 200, codeDefault: 0, default: null, rules: [] }),
      expect.objectContaining({ key: 'trial_days', type: 'int', min: 1, max: 31, codeDefault: 7, default: null, rules: [] }),
      expect.objectContaining({ key: 'integrity_enforce_android', type: 'enum', options: ['block', 'log', 'off'], min: null, max: null, codeDefault: 'block', default: null, rules: [] }),
      expect.objectContaining({ key: 'integrity_device_error_fail_open', type: 'enum', options: ['true', 'false'], codeDefault: 'true', default: null, rules: [] }),
      expect.objectContaining({ key: 'integrity_bypass_user_ids', type: 'string_list', maxItems: 200, min: null, max: null, codeDefault: [], default: null, rules: [] }),
      expect.objectContaining({
        key: 'integrity_reviewer_emails',
        type: 'string_list',
        maxItems: 200,
        codeDefault: ['fitcircle.user@gmail.com', '@cloudtestlabaccounts.com'],
        default: null,
        rules: [],
      }),
    ]);
  });
});

describe('defaults', () => {
  it('set → audited; null resets to the code default; out of bounds → 400 with path', async () => {
    let r = await json(await PUT_DEFAULT(req(`/api/admin/remote-config/${KEY}/default`, { method: 'PUT', body: { value: 8 } }), keyParams(KEY)));
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ key: KEY, default: { value: 8, updatedBy: 'ani@inov8rlabs.com' }, codeDefault: 5 });
    expect(await RemoteConfigService.value(KEY, { userId: USER })).toBe(8);

    r = await json(await PUT_DEFAULT(req(`/api/admin/remote-config/${KEY}/default`, { method: 'PUT', body: { value: 1001 } }), keyParams(KEY)));
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { issues: [{ path: 'value', message: expect.stringContaining('between 0 and 1000') }] } });

    r = await json(await PUT_DEFAULT(req(`/api/admin/remote-config/${KEY}/default`, { method: 'PUT', body: {} }), keyParams(KEY)));
    expect(r.status).toBe(400);

    r = await json(await PUT_DEFAULT(req(`/api/admin/remote-config/${KEY}/default`, { method: 'PUT', body: { value: null } }), keyParams(KEY)));
    expect(r.body.data).toMatchObject({ default: null, codeDefault: 5 });
    expect(await RemoteConfigService.value(KEY, { userId: USER })).toBe(5);

    const audit = db.getRows('remote_config_changes');
    expect(audit.map((a) => [a.target, a.action, a.actor])).toEqual([
      ['default', 'create', 'ani@inov8rlabs.com'],
      ['default', 'delete', 'ani@inov8rlabs.com'],
    ]);
    expect(audit[0]).toMatchObject({ before: null, after: expect.objectContaining({ value: 8 }) });
  });

  it('unknown key → 404', async () => {
    expect((await PUT_DEFAULT(req('/api/admin/remote-config/nope/default', { method: 'PUT', body: { value: 1 } }), keyParams('nope'))).status).toBe(404);
  });
});

describe('rules', () => {
  const body = { name: 'Apple Ads US', enabled: true, priority: 10, audience: { channels: ['apple_ads'], countries: ['us'] }, value: 10 };

  it('create → 201 + audit; PATCH → audit with before/after; DELETE → audit; the value resolves per user', async () => {
    const created = await json(await CREATE_RULE(req(`/api/admin/remote-config/${KEY}/rules`, { method: 'POST', body }), keyParams(KEY)));
    expect(created.status).toBe(201);
    const rule = created.body.data;
    expect(rule).toMatchObject({ key: KEY, name: 'Apple Ads US', enabled: true, priority: 10, audience: { channels: ['apple_ads'], countries: ['US'] }, value: 10, valid: true, createdBy: 'ani@inov8rlabs.com' });
    expect(await RemoteConfigService.value(KEY, { userId: USER, country: 'US' })).toBe(10);
    expect(await RemoteConfigService.value(KEY, { userId: OTHER, country: 'US' })).toBe(5); // no attribution → channel unknown

    const patched = await json(await PATCH_RULE(req(`/api/admin/remote-config/rules/${rule.id}`, { method: 'PATCH', body: { value: 12, enabled: false } }), idParams(rule.id)));
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ value: 12, enabled: false, updatedBy: 'ani@inov8rlabs.com' });
    expect(await RemoteConfigService.value(KEY, { userId: USER, country: 'US' })).toBe(5); // disabled

    const del = await json(await DELETE_RULE(req(`/api/admin/remote-config/rules/${rule.id}`, { method: 'DELETE' }), idParams(rule.id)));
    expect(del.body.data).toEqual({ deleted: true, id: rule.id });
    expect(db.getRows('remote_config_rules')).toHaveLength(0);

    const audit = db.getRows('remote_config_changes');
    expect(audit.map((a) => [a.target, a.action, a.rule_id])).toEqual([
      ['rule', 'create', rule.id],
      ['rule', 'update', rule.id],
      ['rule', 'delete', rule.id],
    ]);
    expect(audit[1].before).toMatchObject({ value: 10, enabled: true });
    expect(audit[1].after).toMatchObject({ value: 12, enabled: false });

    const changes = await json(await CHANGES(req(`/api/admin/remote-config/changes?key=${KEY}`)));
    expect(changes.body.data.changes).toHaveLength(3);
    expect(changes.body.data.changes[0]).toMatchObject({ key: KEY, target: 'rule', actor: 'ani@inov8rlabs.com' });
  });

  it('validation errors come back as 400 with field paths', async () => {
    const bad = await json(
      await CREATE_RULE(req(`/api/admin/remote-config/${KEY}/rules`, { method: 'POST', body: { ...body, audience: { countries: ['USA'], platforms: ['windows'], bogus: 1 } } }), keyParams(KEY))
    );
    expect(bad.status).toBe(400);
    const paths = bad.body.error.details.issues.map((i: any) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['audience.countries.0', 'audience.platforms.0']));

    const badValue = await json(await CREATE_RULE(req(`/api/admin/remote-config/free_fitzy_messages_per_day/rules`, { method: 'POST', body: { ...body, value: 500 } }), keyParams('free_fitzy_messages_per_day')));
    expect(badValue.status).toBe(400);
    expect(badValue.body.error.details.issues).toEqual([{ path: 'value', message: 'Expected an integer between 0 and 200' }]);

    const noName = await json(await CREATE_RULE(req(`/api/admin/remote-config/${KEY}/rules`, { method: 'POST', body: { value: 3 } }), keyParams(KEY)));
    expect(noName.status).toBe(400);
    expect(noName.body.error.details.issues.map((i: any) => i.path)).toContain('name');

    expect((await PATCH_RULE(req('/api/admin/remote-config/rules/00000000-0000-4000-8000-000000000999', { method: 'PATCH', body: { value: 1 } }), idParams('00000000-0000-4000-8000-000000000999'))).status).toBe(404);
    expect(db.getRows('remote_config_changes')).toHaveLength(0);
  });
});

describe('preview + estimate', () => {
  it('preview shows value + source per key and the context used', async () => {
    await CREATE_RULE(req(`/api/admin/remote-config/${KEY}/rules`, { method: 'POST', body: { name: 'iOS', enabled: true, priority: 1, audience: { platforms: ['ios'] }, value: 9 } }), keyParams(KEY));
    await PUT_DEFAULT(req('/api/admin/remote-config/free_fitzy_messages_per_day/default', { method: 'PUT', body: { value: 2 } }), keyParams('free_fitzy_messages_per_day'));
    const { status, body } = await json(await PREVIEW(req('/api/admin/remote-config/preview', { method: 'POST', body: { userId: USER } })));
    expect(status).toBe(200);
    expect(body.data.values).toEqual({
      free_food_ai_analyses_total: { value: 9, source: 'rule', ruleId: expect.any(String), ruleName: 'iOS' },
      free_fitzy_messages_per_day: { value: 2, source: 'default' },
      trial_days: { value: 7, source: 'code' },
      integrity_enforce_android: { value: 'block', source: 'code' },
      integrity_device_error_fail_open: { value: 'true', source: 'code' },
      integrity_bypass_user_ids: { value: [], source: 'code' },
      integrity_reviewer_emails: { value: ['fitcircle.user@gmail.com', '@cloudtestlabaccounts.com'], source: 'code' },
    });
    expect(body.data.context).toMatchObject({ platform: 'ios', country: 'US', channel: 'apple_ads', signupAt: '2026-11-01T00:00:00Z' });
    expect((await PREVIEW(req('/api/admin/remote-config/preview', { method: 'POST', body: { userId: 'x' } }))).status).toBe(400);
  });

  it('estimate counts matching users (approximate; app version ignored)', async () => {
    const { body } = await json(await ESTIMATE(req(`/api/admin/remote-config/${KEY}/estimate`, { method: 'POST', body: { audience: { channels: ['apple_ads'], appVersionGte: '1.2.0' } } }), keyParams(KEY)));
    expect(body.data).toEqual({ count: 1, total: 3, approximate: true, ignored: ['appVersionGte'] });
    const signup = await json(await ESTIMATE(req(`/api/admin/remote-config/${KEY}/estimate`, { method: 'POST', body: { audience: { signupAfter: '2026-05-01' } } }), keyParams(KEY)));
    expect(signup.body.data.count).toBe(2);
  });
});
