-- Apply after 101 referral invites and 117 Engage consent cutover.
-- Guest invitations remain separate from authenticated-account consent.
begin;
do $$ begin
  if not exists(select 1 from engage.deployment where app_id='fitcircle') then raise exception 'Wrong Engage app'; end if;
end $$;

create function engage.fitcircle_guard_guest_invite() returns trigger
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
revoke all on function engage.fitcircle_guard_guest_invite() from public;
create trigger engage_guard_guest_invite before insert or update of inviter_id,contact_hash,channel,sent_at,email,nudge_count on public.referral_invites
for each row execute function engage.fitcircle_guard_guest_invite();

create function engage.fitcircle_lock_guest_optout() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('fitcircle:guest-contact:'||new.email_hash,0));
  return new;
end $$;
revoke all on function engage.fitcircle_lock_guest_optout() from public;
create trigger engage_lock_guest_optout before insert on public.referral_email_optouts
for each row execute function engage.fitcircle_lock_guest_optout();
commit;
