-- 2026-11-01: standalone replacement for archived embedded migrations 116–119.
-- First run the connector's offline outbox migration for fitcircle/environment.
-- This file never creates an Engage campaign, subject or delivery database.
begin;
do $$ begin
  if to_regclass('engage.deployment') is not null then raise exception 'Embedded Engage exists: use the reviewed export/freeze migration runbook, never silently convert'; end if;
  if not exists(select 1 from engage_connector.identity where app_id='fitcircle') then raise exception 'FitCircle connector identity missing'; end if;
end $$;
create table engage_connector.fitcircle_profiles(user_id uuid primary key,fingerprint text not null);
create table engage_connector.fitcircle_bindings(install_id uuid primary key,user_id uuid not null,token_id uuid not null,active boolean not null default true);
create index fitcircle_bindings_user on engage_connector.fitcircle_bindings(user_id);
create sequence engage_connector.fitcircle_signal_revision;
create table engage_connector.fitcircle_signals(user_id uuid primary key,revision bigint not null default nextval('engage_connector.fitcircle_signal_revision'),deleted boolean not null default false,created_at timestamptz not null default now(),attempts integer not null default 0,next_attempt_at timestamptz not null default now());
create index fitcircle_signals_due on engage_connector.fitcircle_signals(next_attempt_at,revision);
create table engage_connector.fitcircle_control(singleton boolean primary key default true check(singleton),bridge_required boolean not null default false);
insert into engage_connector.fitcircle_control default values;
-- AFTER triggers capture every writer, including older preference endpoints.
-- Only a dirty identity/tombstone is recorded; no token or personal JSON payload.
create function engage_connector.fitcircle_signal() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare account uuid;
begin
  if tg_table_name in ('profiles','users') then account:=case when tg_op='DELETE' then old.id else new.id end;
  else account:=case when tg_op='DELETE' then old.user_id else new.user_id end; end if;
  insert into engage_connector.fitcircle_signals(user_id,deleted) values(account,(tg_table_name in ('profiles','users') and tg_op='DELETE') or (tg_table_name='users' and to_jsonb(new)->>'deleted_at' is not null))
  on conflict(user_id) do update set revision=nextval('engage_connector.fitcircle_signal_revision'),deleted=engage_connector.fitcircle_signals.deleted or excluded.deleted,attempts=0,next_attempt_at=now();
  if tg_op='DELETE' then return old; end if;return new;
end $$;
revoke all on function engage_connector.fitcircle_signal() from public;
create trigger engage_connector_profile_insert after insert or delete on public.profiles for each row execute function engage_connector.fitcircle_signal();
create trigger engage_connector_profile_update after update of preferences,display_name,timezone on public.profiles for each row when(old.preferences is distinct from new.preferences or old.display_name is distinct from new.display_name or old.timezone is distinct from new.timezone) execute function engage_connector.fitcircle_signal();
create trigger engage_connector_auth_insert after insert or delete on auth.users for each row execute function engage_connector.fitcircle_signal();
create trigger engage_connector_auth_update after update of email,email_confirmed_at,deleted_at,banned_until on auth.users for each row when(old.email is distinct from new.email or old.email_confirmed_at is distinct from new.email_confirmed_at or old.deleted_at is distinct from new.deleted_at or old.banned_until is distinct from new.banned_until) execute function engage_connector.fitcircle_signal();
create trigger engage_connector_preference_update after insert or update or delete on public.notification_preferences for each row execute function engage_connector.fitcircle_signal();
-- Fail old native campaign claimers after the operator completes the worker drain.
alter table public.campaign_deliveries add column engage_bridge_protocol integer;
create function engage_connector.fitcircle_campaign_protocol() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if (select bridge_required from engage_connector.fitcircle_control where singleton) and new.engage_bridge_protocol is distinct from 1 then
    raise exception using errcode='P0103',message='Native campaign worker must use the standalone Engage bridge';
  end if;return new;
end $$;
revoke all on function engage_connector.fitcircle_campaign_protocol() from public;
create trigger engage_guard_campaign_delivery before insert on public.campaign_deliveries for each row execute function engage_connector.fitcircle_campaign_protocol();
create function engage_connector.fitcircle_guard_preferences() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare k text;
begin
  if current_setting('engage_connector.explicit_consent',true) = 'yes' then return new; end if;
  foreach k in array array['marketingEmails','marketingPush'] loop
    if old.preferences->k = 'false'::jsonb then
      new.preferences := coalesce(new.preferences,'{}'::jsonb)||jsonb_build_object(k,false);
    end if;
  end loop;
  if old.preferences->'notifications'='false'::jsonb then
    new.preferences := coalesce(new.preferences,'{}'::jsonb)||jsonb_build_object('notifications',false);
    return new;
  end if;
  foreach k in array array['push','email'] loop
    if old.preferences->'notifications'->k = 'false'::jsonb then
      new.preferences := coalesce(new.preferences,'{}'::jsonb)||jsonb_build_object('notifications',
        coalesce(new.preferences->'notifications','{}'::jsonb)||jsonb_build_object(k,false));
    end if;
  end loop;
  return new;
end $$;
revoke all on function engage_connector.fitcircle_guard_preferences() from public;
create trigger engage_guard_preferences before update of preferences on public.profiles
for each row execute function engage_connector.fitcircle_guard_preferences();

create function engage_connector.fitcircle_guard_guest_invite() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' then
    if new.inviter_id<>old.inviter_id or new.contact_hash<>old.contact_hash or new.channel<>old.channel or new.sent_at<>old.sent_at then
      raise exception 'Invite identity and occurrence are immutable';
    end if;
    if new.channel<>'email' or new.email is null or new.nudge_count<=old.nudge_count then return new; end if;
  else
    -- A stable duplicate is still handled by the unique constraint, without charging another slot.
    perform pg_advisory_xact_lock(hashtextextended('fitcircle:guest-inviter:'||new.inviter_id::text,0));
    if exists(select 1 from public.referral_invites where inviter_id=new.inviter_id and contact_hash=new.contact_hash) then return new; end if;
    if (select count(*) from public.referral_invites where inviter_id=new.inviter_id and status='invited')>=200
      or (new.channel='email' and (select count(*) from public.referral_invites where inviter_id=new.inviter_id and channel='email' and sent_at>=statement_timestamp()-interval '24 hours')>=25) then
      raise exception using errcode='P0101',message='Invite quota exceeded';
    end if;
    new.sent_at := statement_timestamp();
  end if;
  if new.channel='email' then
    -- Same lock as opt-out insertion; a committed withdrawal wins before authorization.
    -- No network I/O occurs in this transaction. Already-authorized handoffs can finish.
    perform pg_advisory_xact_lock(hashtextextended('fitcircle:guest-contact:'||new.contact_hash,0));
    if exists(select 1 from public.referral_email_optouts where email_hash=new.contact_hash) then
      raise exception using errcode='P0102',message='Invite recipient opted out';
    end if;
  end if;
  return new;
end $$;
revoke all on function engage_connector.fitcircle_guard_guest_invite() from public;
create trigger engage_guard_guest_invite before insert or update of inviter_id,contact_hash,channel,sent_at,email,nudge_count on public.referral_invites
for each row execute function engage_connector.fitcircle_guard_guest_invite();

create function engage_connector.fitcircle_lock_guest_optout() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('fitcircle:guest-contact:'||new.email_hash,0));
  return new;
end $$;
revoke all on function engage_connector.fitcircle_lock_guest_optout() from public;
create trigger engage_lock_guest_optout before insert on public.referral_email_optouts
for each row execute function engage_connector.fitcircle_lock_guest_optout();


revoke all on all tables in schema engage_connector from public;
revoke all on all sequences in schema engage_connector from public;
do $$ declare exposed text; begin
  foreach exposed in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=exposed) then
      execute format('revoke all on schema engage_connector from %I',exposed);
      execute format('revoke all on all tables in schema engage_connector from %I',exposed);
      execute format('revoke all on all sequences in schema engage_connector from %I',exposed);
      execute format('revoke all on all functions in schema engage_connector from %I',exposed);
    end if;
  end loop;
end $$;
commit;
