import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { createDatabase, type SendPayload } from '@inov8r/engage-server';
import { afterEach, describe, expect, it } from 'vitest';
import { createFitCircleHost, type FitCircleEngageHost } from '../host';
import { importFitCircleHistory } from '../history';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});
async function fixture(
  environment: 'test' | 'staging' = 'test',
  testUserIds: string[] = [],
  webPush?: { public_key: string; encryption_key: string },
) {
  const url = new URL(
    process.env.ENGAGE_TEST_DATABASE_URL ??
      'postgres://engage@127.0.0.1:55432/engage_dev',
  );
  const admin = new Pool({ connectionString: url.toString(), max: 1 });
  const name = `engage_host_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`create database "${name}"`);
  url.pathname = `/${name}`;
  const db = createDatabase(url.toString(), {
    app_id: 'fitcircle',
    environment,
  });
  cleanup.push(async () => {
    await db.pool.end();
    for (let i = 0; i < 100; i++) {
      if (
        !(
          await admin.query('select 1 from pg_stat_activity where datname=$1', [
            name,
          ])
        ).rowCount
      )
        break;
      await delay(10);
    }
    await admin.query(`drop database "${name}"`);
    await admin.end();
  });
  await db.migrate();
  await db.pool
    .query(`create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table public.profiles(id uuid primary key,email text,display_name text,created_at timestamptz default now(),timezone text default 'UTC',preferences jsonb default '{}');
    create table public.notification_preferences(user_id uuid primary key references profiles(id),journey_enabled boolean default true,momentum_enabled boolean default true,circle_enabled boolean default true,challenge_enabled boolean default true,social_enabled boolean default true,celebration_enabled boolean default true,coach_enabled boolean default true,quiet_hours_start time default '22:00',quiet_hours_end time default '07:00',quiet_hours_timezone text default 'UTC',updated_at timestamptz default now());
    create table public.push_tokens(id uuid primary key,user_id uuid references profiles(id),token text unique,platform text,is_active boolean default true);`);
  await db.pool.query(
    await readFile(
      new URL(
        '../../../../../../supabase/_archive/engage_embedded_2026-11-01/116_engage_v2_host.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  await db.pool.query("do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$");
  await db.pool.query(await readFile(new URL('../../../../../../supabase/_archive/engage_embedded_2026-11-01/117_engage_consent_cutover.sql',import.meta.url),'utf8'));
  const delivered: SendPayload[] = [];
  let host: FitCircleEngageHost;
  let clock = new Date('2026-11-01T12:00:00Z');
  host = createFitCircleHost({
    pool: db.pool,
    environment,
    test_user_ids: testUserIds,
    web_push: webPush,
    enabled: true,
    sends_enabled: true,
    legacy_bridge_enabled: true,
    clock: () => new Date(clock),
    auth: {
      user: async () => null,
      admin: async () => null,
      cron: async () => false,
    },
    providers: {
      push: {
        tenant: db.tenant,
        send: async (payload) => {
          if (!(await host.resolveInstallation(payload)))
            return { status: 'failed_permanent', reason: 'binding_invalid' };
          delivered.push(payload);
          return { status: 'accepted', provider_id: randomUUID() };
        },
      },
    },
  });
  const actor = {
    actor: 'test-admin',
    tenant: db.tenant,
    role: 'admin' as const,
  };
  async function user(id = randomUUID()) {
    const install = randomUUID(),
      token = randomUUID();
    await db.pool.query(
      `insert into profiles(id,email,display_name,preferences) values($1,$2,'Host Person','{"marketingPush":true,"marketingEmails":true}')`,
      [id, `${id}@example.test`],
    );
    await db.pool.query(
      'insert into push_tokens(id,user_id,token,platform) values($1,$2,$3,$4)',
      [token, id, `token-${token}`, 'ios'],
    );
    await db.pool.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id, `${id}@example.test`]);
    await host.bindInstallation(id, install, token);
    const identity = { user_id: id, tenant: db.tenant };
    const session = {
      install_id: install,
      platform: 'ios',
      app_version: '1.2.0',
      push_permission: 'granted',
      layouts: ['standard', 'card'],
      actions: ['open_screen', 'dismiss'],
      placements: ['home_feed'],
    };
    await host.runtime.registerSession(identity, session);
    return { id, install, token, identity, session };
  }
  async function launch(surface = 'push') {
    const created = await host.campaigns.create(actor, {
      key: `campaign_${randomUUID().slice(0, 8)}`,
      name: 'FitCircle host test',
      kind: 'one_off',
      audience: { platforms: ['ios'], max_audience: 100 },
      messages: [
        {
          id: randomUUID(),
          surface,
          layout: surface === 'push' ? 'standard' : 'card',
          variants: [
            {
              id: 'default',
              content: {
                title: 'Hello {{first_name|default: "friend"}}',
                primary: {
                  label: 'Open',
                  action: { type: 'open_screen', screen: 'dashboard' },
                },
              },
            },
          ],
        },
      ],
    });
    const report = await host.campaigns.dryRun(actor, created.id);
    return host.campaigns.launch(actor, created.id, {
      revision: created.revision,
      dry_run_id: report.id,
      confirm_audience: report.audience_users,
    });
  }
  return { host, db, actor, user, launch, delivered, advance: (ms:number) => {clock=new Date(clock.getTime()+ms);} };
}

describe('FitCircle actual host boundary', () => {
  it('provisions verified host facts, sends to one binding and isolates a second deployment with identical person IDs', async () => {
    const a = await fixture(),
      b = await fixture('staging'),
      u = await a.user(),
      v = await b.user(u.id);
    const ca = await a.launch(),
      cb = await b.launch();
    await Promise.all([a.host.dispatcher.run(), b.host.dispatcher.run()]);
    expect(a.delivered).toHaveLength(1);
    expect(b.delivered).toHaveLength(1);
    expect(a.delivered[0]).toMatchObject({
      app_id: 'fitcircle',
      environment: 'test',
      install_id: u.install,
      token_ref: u.token,
    });
    expect(a.delivered[0]!.content.title).toBe('Hello Host');
    expect(b.delivered[0]!.install_id).toBe(v.install);
    expect(await a.host.resolveInstallation(b.delivered[0]!)).toBeNull();
    await expect(
      a.host.campaigns.get(
        { ...a.actor, tenant: { app_id: 'second_app', environment: 'test' } },
        ca.id,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(a.host.campaigns.get(a.actor, cb.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('checks current host master/category settings after launch, before provider handoff', async () => {
    const f = await fixture(),
      u = await f.user();
    await f.launch();
    await f.db.pool.query(
      `update profiles set preferences=preferences||'{"notifications":{"push":false}}'::jsonb where id=$1`,
      [u.id],
    );
    await f.host.dispatcher.run();
    expect(f.delivered).toHaveLength(0);
    expect(
      (await f.db.query('select reason from engage.sends')).rows[0].reason,
    ).toBe('host_push_disabled');
  });
  it('cannot bind a foreign token or take an active installation; account changes require explicit unbind', async () => {
    const f = await fixture(),
      a = await f.user(),
      b = await f.user();
    await expect(
      f.host.bindInstallation(a.id, a.install, b.token),
    ).rejects.toThrow('not owned');
    await expect(
      f.host.bindInstallation(b.id, a.install, b.token),
    ).rejects.toThrow('unbound');
    await f.host.runtime.unbindSession(a.identity, a.install);
    // This account already has its own binding; rotating that binding to the old installation requires removing it first.
    await f.db.query(
      'delete from engage.fitcircle_push_bindings where user_id=$1',
      [b.id],
    );
    await f.host.bindInstallation(b.id, a.install, b.token);
    await f.host.runtime.registerSession(b.identity, {
      ...b.session,
      install_id: a.install,
    });
    expect(
      (
        await f.db.query(
          'select user_id from engage.devices where install_id=$1',
          [a.install],
        )
      ).rows[0].user_id,
    ).toBe(b.id);
    await expect(f.host.sync.fetch(a.identity, a.install)).rejects.toThrow();
  });
  it('atomically writes purpose consent to the host, keeps broader opt-outs and purges bindings on deletion', async () => {
    const f = await fixture(),
      u = await f.user();
    await f.host.runtime.setConsent(u.identity, 'marketing_email', false, {
      source: 'host-settings',
      text_version: 'v1',
    });
    expect(
      (
        await f.db.pool.query('select preferences from profiles where id=$1', [
          u.id,
        ])
      ).rows[0].preferences.marketingEmails,
    ).toBe(false);
    await f.host.syncSubject(u.id);
    expect(
      (
        await f.db.query('select consent from engage.subjects where id=$1', [
          u.id,
        ])
      ).rows[0].consent.marketing_email,
    ).toBe('denied');
    await expect(
      f.host.runtime.setConsent(u.identity, 'foreign_permission', true, {
        source: 'test',
        text_version: 'v1',
      }),
    ).rejects.toThrow();
    expect(
      (
        await f.db.query('select consent from engage.subjects where id=$1', [
          u.id,
        ])
      ).rows[0].consent.foreign_permission,
    ).toBeUndefined();
    await f.host.deleteSubject(u.id);
    expect(
      (
        await f.db.query(
          'select count(*)::int n from engage.fitcircle_push_bindings',
        )
      ).rows[0].n,
    ).toBe(0);
    await expect(f.host.syncSubject(u.id)).rejects.toMatchObject({
      code: 'SUBJECT_DELETED',
    });
  });
  it('allows acknowledged previews only for server-allowlisted QA accounts and supports recipient withdrawal', async () => {
    const id = randomUUID(),
      f = await fixture('test', [id]),
      qa = await f.user(id),
      normal = await f.user();
    const enrollment = await f.host.previews.enroll(f.actor, {
      label: 'QA device',
    });
    await expect(
      f.host.previews.claim(normal.identity, {
        install_id: normal.install,
        code: enrollment.code,
        acknowledge: true,
      }),
    ).rejects.toMatchObject({ code: 'TEST_ACCOUNT_REQUIRED' });
    await f.host.previews.claim(qa.identity, {
      install_id: qa.install,
      code: enrollment.code,
      acknowledge: true,
    });
    const c = await f.host.campaigns.create(f.actor, {
      key: 'qa_preview',
      name: 'QA preview',
      kind: 'one_off',
      audience: { platforms: ['ios'], max_audience: 100 },
      messages: [
        {
          id: randomUUID(),
          surface: 'placement',
          placement_id: 'home_feed',
          layout: 'card',
          variants: [
            {
              id: 'default',
              content: { title: 'Test for {{first_name|default: "friend"}}' },
            },
          ],
        },
      ],
    });
    await f.host.previews.create(f.actor, c.id, {
      request_id: randomUUID(),
      revision: c.revision,
      message_id: c.draft.messages[0]!.id,
      variant_id: 'default',
      install_id: qa.install,
    });
    expect(
      (await f.host.sync.fetch(qa.identity, qa.install)).placements
        .home_feed?.[0],
    ).toMatchObject({ preview: true, content: { title: 'Test for Host' } });
    expect(
      (await f.host.sync.fetch(normal.identity, normal.install)).placements,
    ).toEqual({});
    await f.host.previews.withdraw(qa.identity, qa.install);
    expect(
      (await f.host.sync.fetch(qa.identity, qa.install)).placements,
    ).toEqual({});
  });
  it('keeps a browser subscription separate from native tokens and revokes it when the host account is deleted', async () => {
    const key = createECDH('prime256v1');
    key.generateKeys();
    const config = {
      public_key: key.getPublicKey().toString('base64url'),
      encryption_key: randomBytes(32).toString('hex'),
    };
    const f = await fixture('test', [], config),
      u = await f.user(),
      other = await f.user();
    const install = randomUUID();
    await f.host.runtime.registerSession(u.identity, {
      ...u.session,
      platform: 'web',
      install_id: install,
      push_permission: 'not_determined',
    });
    const input = {
      install_id: install,
      public_key: config.public_key,
      acknowledge: true,
      subscription: {
        endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
        keys: {
          p256dh: key.getPublicKey().toString('base64url'),
          auth: randomBytes(16).toString('base64url'),
        },
      },
    };
    const binding = await f.host.webPush.register(u.identity, input);
    await expect(
      f.host.webPush.register(other.identity, input),
    ).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' });
    const row = (
      await f.db.query(
        'select token_ref,session from engage.devices where install_id=$1',
        [install],
      )
    ).rows[0];
    const payload = {
      ...f.db.tenant,
      channel: 'web_push',
      platform: 'web',
      user_id: u.id,
      install_id: install,
      token_ref: row.token_ref,
    } as SendPayload;
    expect(await f.host.resolveInstallation(payload)).toBeNull();
    expect(await f.host.webPush.resolveInstallation(payload)).toMatchObject({
      install_id: install,
      binding_id: binding.binding_id,
    });
    await f.host.runtime.registerSession(u.identity, row.session);
    expect(await f.host.webPush.resolveInstallation(payload)).not.toBeNull();
    await f.host.deleteSubject(u.id);
    expect(await f.host.webPush.resolveInstallation(payload)).toBeNull();
    expect(
      (
        await f.db.query(
          'select count(*)::int n from engage.web_push_subscriptions',
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it('deactivates exactly the host token rejected by the provider and does not restore it on session refresh', async () => {
    const f = await fixture(),
      u = await f.user(),
      other = await f.user();
    f.host.runtime.config.providers.push = {
      send: async (payload) =>
        payload.user_id === u.id
          ? {
              status: 'failed_permanent',
              reason: 'unregistered',
              invalidate_token: true,
            }
          : { status: 'accepted', provider_id: randomUUID() },
    };
    await f.launch();
    await f.host.dispatcher.run();
    expect(
      (
        await f.db.pool.query(
          'select is_active from public.push_tokens where id=$1',
          [u.token],
        )
      ).rows[0].is_active,
    ).toBe(false);
    expect(
      (
        await f.db.pool.query(
          'select is_active from public.push_tokens where id=$1',
          [other.token],
        )
      ).rows[0].is_active,
    ).toBe(true);
    await f.host.runtime.registerSession(u.identity, u.session);
    expect(
      (
        await f.db.query(
          'select token_ref from engage.devices where install_id=$1',
          [u.install],
        )
      ).rows[0].token_ref,
    ).toBeNull();
  });
});


describe('FitCircle consent cutover', () => {
  it('preserves concurrent withdrawal against a stale whole-profile legacy writer', async () => {
    const f = await fixture();const u = await f.user();
    const stale = (await f.db.pool.query('select preferences from profiles where id=$1',[u.id])).rows[0].preferences;
    const held = await f.db.pool.connect();
    try {
      await held.query('begin');
      await held.query("select public.engage_patch_preferences($1,'{\"marketingEmails\":false,\"notifications\":{\"push\":false}}')",[u.id]);
      const late = f.db.pool.query('update profiles set preferences=$2 where id=$1',[u.id,JSON.stringify({...stale,display:{theme:'dark'},notifications:{push:true}})]);
      await delay(30);await held.query('commit');await late;
      const prefs = (await f.db.pool.query('select preferences from profiles where id=$1',[u.id])).rows[0].preferences;
      expect(prefs.marketingEmails).toBe(false);expect(prefs.notifications.push).toBe(false);
      expect(prefs.display.theme).toBe('dark');
    } finally {await held.query('rollback');held.release();}
  });
  it('merges independent patches atomically and only explicitly restores withdrawn permission', async () => {
    const f = await fixture();const u = await f.user();
    await Promise.all([
      f.db.pool.query("select public.engage_patch_preferences($1,'{\"marketingEmails\":false}')",[u.id]),
      f.db.pool.query("select public.engage_patch_preferences($1,'{\"display\":{\"theme\":\"dark\"}}')",[u.id]),
    ]);
    await f.host.syncSubject(u.id);
    expect((await f.db.query('select consent from engage.subjects where id=$1',[u.id])).rows[0].consent.marketing_email).toBe('denied');
    await f.db.pool.query("select public.engage_patch_preferences($1,'{\"marketingEmails\":true}')",[u.id]);
    expect((await f.db.query('select consent from engage.subjects where id=$1',[u.id])).rows[0].consent.marketing_email).toBe('allowed');
    expect((await f.db.pool.query('select preferences from profiles where id=$1',[u.id])).rows[0].preferences.display.theme).toBe('dark');
    await f.host.runtime.setConsent(u.identity,'marketing_email',false,{source:'settings',text_version:'v1'});
    await f.host.runtime.setConsent(u.identity,'marketing_email',true,{source:'settings',text_version:'v1'});
    expect((await f.db.pool.query('select preferences from profiles where id=$1',[u.id])).rows[0].preferences.marketingEmails).toBe(true);
  });
  it('updates category authority and engine consent together; rejects invalid patches', async () => {
    const f = await fixture();const u = await f.user();
    for (const allowed of [false,true]) {
      await f.db.pool.query('select public.engage_patch_notification_preferences($1,$2)',[u.id,JSON.stringify({coach_enabled:allowed})]);
      expect((await f.db.query('select consent from engage.subjects where id=$1',[u.id])).rows[0].consent.coach).toBe(allowed ? 'allowed':'denied');
    }
    await expect(f.db.pool.query("select public.engage_patch_notification_preferences($1,'{\"quiet_hours_start\":\"99:99\"}')",[u.id])).rejects.toThrow('Invalid quiet hours');
    await expect(f.db.pool.query("select public.engage_patch_preferences($1,'{\"admin\":true}')",[u.id])).rejects.toThrow('Invalid preference key');
    expect((await f.db.pool.query("select has_function_privilege('public','public.engage_patch_preferences(uuid,jsonb)','execute') allowed")).rows[0].allowed).toBe(false);
  });
  it('honors legacy boolean master denial and clears unverified email destinations', async () => {
    const f = await fixture();const u = await f.user();
    await f.db.pool.query("update profiles set preferences=preferences||'{\"notifications\":false}'::jsonb where id=$1",[u.id]);
    await f.db.pool.query("update profiles set preferences=preferences||'{\"notifications\":{\"push\":true}}'::jsonb where id=$1",[u.id]);
    await f.host.syncSubject(u.id);
    expect((await f.db.query('select consent from engage.subjects where id=$1',[u.id])).rows[0].consent.marketing_push).toBe('denied');
    await f.db.pool.query('update auth.users set email_confirmed_at=null where id=$1',[u.id]);
    await f.host.syncSubject(u.id);
    expect((await f.db.query('select email from engage.subjects where id=$1',[u.id])).rows[0].email).toBeNull();
    await f.db.pool.query("select public.engage_patch_preferences($1,'{\"notifications\":{\"push\":true}}')",[u.id]);
    const prefs = (await f.db.pool.query('select preferences from profiles where id=$1',[u.id])).rows[0].preferences;
    expect(prefs.notifications).toEqual({push:true,email:false});
  });
});

it('imports the recorded cap window once across source pages and concurrent legacy delivery, without reviving tombstones',async()=>{
  const f=await fixture(),u=await f.user(),removed=await f.user();
  await f.host.deleteSubject(removed.id);
  await f.db.pool.query(`create table public.notification_log(id uuid primary key,user_id uuid,sent_at timestamptz,notification_type text,data jsonb,suppressed boolean);
    create table public.campaign_deliveries(id uuid primary key,user_id uuid,sent_at timestamptz,campaign_id uuid,delivery_key text,channel text);
    create table public.referral_rewards(id uuid primary key,user_id uuid,emailed_at timestamptz);`);
  const now=f.host.runtime.now(),campaign=randomUUID(),reward=randomUUID();
  await f.db.pool.query(`insert into public.notification_log values($1,$2,$3,'campaign','{"dedupeKey":"stable-old"}',false),($4,$2,$3,'campaign','{}',true),($5,$6,$3,'campaign','{}',false)`,[randomUUID(),u.id,now,randomUUID(),randomUUID(),removed.id]);
  await f.db.pool.query("insert into public.campaign_deliveries values($1,$2,$3,$4,'email:launch','email'),($5,$2,$3,$4,'push:launch','push')",[randomUUID(),u.id,now,campaign,randomUUID()]);
  await f.db.pool.query('insert into public.referral_rewards values($1,$2,$3)',[reward,u.id,now]);
  expect(await importFitCircleHistory(f.host,{through:now,apply:false,batchSize:1})).toMatchObject({seen:4,imported:0,sources:{push_log:2,campaign_email:1,reward_email:1}});
  expect((await f.db.query('select count(*)::int n from engage.host_notifications')).rows[0].n).toBe(0);
  const reports=await Promise.all([importFitCircleHistory(f.host,{through:now,apply:true,batchSize:1}),importFitCircleHistory(f.host,{through:now,apply:true,batchSize:2})]);
  expect(reports.reduce((n,r)=>n+r.imported,0)).toBe(3);
  expect(reports.every(r=>r.deleted_or_missing===1)).toBe(true);
  const result=await f.host.hostNotifications.sendTargets(u.identity,{key:'push:stable-old',channel:'push',category:'marketing'},[{id:'test',platform:'ios',send:async()=>{throw new Error('must not resend imported occurrence');}}]);
  expect(result.result).toMatchObject({status:'duplicate',previous:'unknown'});
  expect((await f.db.query('select deleted_at from engage.subjects where id=$1',[removed.id])).rows[0].deleted_at).toBeTruthy();
});

it('serializes guest invite quotas and withdrawal against concurrent invite/reminder authorization',async()=>{
 const f=await fixture(); const u=await f.user();
 await f.db.pool.query(`create table public.referral_invites(id uuid primary key default gen_random_uuid(),inviter_id uuid not null,channel text not null,contact_hash text not null,email text,status text default 'invited',sent_at timestamptz default now(),nudge_count int default 0,unique(inviter_id,contact_hash));create table public.referral_email_optouts(email_hash text primary key);`);
 await f.db.pool.query("insert into public.referral_invites(inviter_id,channel,contact_hash,email) select $1,'email','seed-'||g,'synthetic@example.test' from generate_series(1,24) g",[u.id]);
 await f.db.pool.query(await readFile(new URL('../../../../../../supabase/_archive/engage_embedded_2026-11-01/118_engage_guest_invite_guards.sql',import.meta.url),'utf8'));
 const first=await f.db.pool.connect(),second=await f.db.pool.connect();
 try{
  await first.query('begin');await second.query('begin');
  await first.query("insert into public.referral_invites(inviter_id,channel,contact_hash,email) values($1,'email','slot-25','synthetic@example.test')",[u.id]);
  const competing=second.query("insert into public.referral_invites(inviter_id,channel,contact_hash,email) values($1,'email','slot-26','synthetic@example.test')",[u.id]).then(()=>null,error=>error.code);
  await delay(30);await first.query('commit');expect(await competing).toBe('P0101');await second.query('rollback');
  expect((await f.db.pool.query('select count(*)::int n from public.referral_invites')).rows[0].n).toBe(25);
  // Another inviter is unaffected by the first inviter's quota but must respect the contact withdrawal.
  const another=randomUUID();
  await first.query('begin');await first.query("insert into public.referral_email_optouts values('withdrawn')");
  const withdrawing=second.query("insert into public.referral_invites(inviter_id,channel,contact_hash,email) values($1,'email','withdrawn','synthetic@example.test')",[another]).then(()=>null,error=>error.code);
  await delay(30);await first.query('commit');expect(await withdrawing).toBe('P0102');
  await first.query("insert into public.referral_invites(inviter_id,channel,contact_hash,email) values($1,'email','later-withdrawal','synthetic@example.test')",[another]);
  await first.query("insert into public.referral_email_optouts values('later-withdrawal')");
  await expect(second.query("update public.referral_invites set nudge_count=nudge_count+1 where contact_hash='later-withdrawal'")).rejects.toMatchObject({code:'P0102'});
  // Plaintext cleanup remains possible after withdrawal.
  await second.query("update public.referral_invites set email=null,nudge_count=2 where contact_hash='later-withdrawal'");
  expect((await second.query("select email from public.referral_invites where contact_hash='later-withdrawal'")).rows[0].email).toBeNull();
 }finally{await first.query('rollback');await second.query('rollback');first.release();second.release();}
});

it('keeps native campaigns running and fences one campaign during a staged Engage handover',async()=>{
  const f=await fixture(),u=await f.user(),source=randomUUID(),other=randomUUID();
  await f.db.pool.query(`create table public.campaigns(id uuid primary key);
    create table public.campaign_deliveries(campaign_id uuid references public.campaigns(id),user_id uuid,delivery_key text,channel text,primary key(campaign_id,user_id,delivery_key));`);
  await f.db.pool.query('insert into public.campaigns values($1),($2)',[source,other]);
  const c=await f.host.campaigns.create(f.actor,{key:'coexisting_campaign',name:'Moved campaign',kind:'one_off',audience:{platforms:['ios'],max_audience:100},messages:[{id:randomUUID(),surface:'push',layout:'standard',variants:[{id:'default',content:{title:'Hello'}}]}]});
  await expect(f.host.campaignOwnership.link(f.actor,{source_key:source,campaign_id:c.id})).rejects.toMatchObject({code:'SOURCE_CAMPAIGN_NOT_FOUND'});
  await f.db.pool.query(await readFile(new URL('../../../../../../supabase/_archive/engage_embedded_2026-11-01/119_engage_campaign_coexistence.sql',import.meta.url),'utf8'));
  await f.host.campaignOwnership.link(f.actor,{source_key:source,campaign_id:c.id});
  const native=await f.host.hostNotifications.sendTargets(u.identity,{key:'native-original',campaign_key:source,channel:'push',category:'marketing'},[{id:u.token,platform:'ios',send:async()=>({status:'accepted',provider_id:'native-synthetic'})}]);
  expect(native.accepted).toBe(1);
  // A native claim and ownership change use the same database fence.
  const tx=await f.db.pool.connect();let changed=false;
  let pause:Promise<unknown> | undefined;
  try {
  await tx.query('begin');
  await tx.query("insert into public.campaign_deliveries values($1,$2,'old-claim','push')",[source,u.id]);
  pause=f.host.campaignOwnership.change(f.actor,c.id,{revision:1,owner:'paused'}).then(r=>{changed=true;return r;});
  await delay(30);expect(changed).toBe(false);
  await tx.query('commit');
  } finally {await tx.query('rollback');tx.release();await pause;}
  await expect(f.db.pool.query("insert into public.campaign_deliveries values($1,$2,'paused-claim','email')",[source,u.id])).rejects.toMatchObject({code:'P0103'});
  await f.host.campaignOwnership.change(f.actor,c.id,{revision:2,owner:'engage'});
  await expect(f.db.pool.query("insert into public.campaign_deliveries values($1,$2,'stale-native-claim','push')",[source,u.id])).rejects.toMatchObject({code:'P0103'});
  // A different native campaign is unaffected, even while the linked one moves.
  await f.db.pool.query("insert into public.campaign_deliveries values($1,$2,'unrelated','email')",[other,u.id]);
  const report=await f.host.campaigns.dryRun(f.actor,c.id);
  await f.host.campaigns.launch(f.actor,c.id,{revision:c.revision,dry_run_id:report.id,confirm_audience:report.audience_users});
  await f.host.dispatcher.run();
  // FitCircle's one-marketing-push-per-day cap still applies across senders.
  expect(f.delivered).toHaveLength(0);
  expect((await f.db.query('select reason from engage.sends where campaign_id=$1',[c.id])).rows[0].reason).toBe('marketing_daily_cap');
  f.advance(20 * 3_600_000);
  await f.host.dispatcher.run();
  expect(f.delivered).toHaveLength(1);
  expect(await f.host.metrics.health(f.actor)).toMatchObject({sends_enabled:true,host_sends_enabled:true});
});
