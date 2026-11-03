-- Apply after Engage core + 116. Inactive until the host bridge is enabled.
-- Protect withdrawals during rolling deployments, including old whole-JSON writers.
begin;
do $$ begin
  if not exists(select 1 from engage.deployment where app_id='fitcircle') then raise exception 'Wrong Engage app'; end if;
end $$;
create function engage.fitcircle_guard_preferences() returns trigger
language plpgsql security invoker set search_path=pg_catalog as $$
declare k text;
begin
  if current_setting('engage.explicit_consent',true) = 'yes' then return new; end if;
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
revoke all on function engage.fitcircle_guard_preferences() from public;
create trigger engage_guard_preferences before update of preferences on public.profiles
for each row execute function engage.fitcircle_guard_preferences();

-- Verified server routes pass only the fields explicitly changed by the account.
-- No read/merge/write outside the transaction; subject->profile matches delivery.
create function public.engage_patch_preferences(p_user uuid,p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare current_p jsonb; merged jsonb; k text; v jsonb; twin text;
begin
  if jsonb_typeof(p_patch) <> 'object' or octet_length(p_patch::text)>16384 then raise exception 'Invalid preference patch'; end if;
  perform 1 from engage.subjects where app_id='fitcircle' and id=p_user and deleted_at is null for update;
  select coalesce(preferences,'{}'::jsonb) into current_p from public.profiles where id=p_user for update;
  if not found then raise exception 'Account missing'; end if;
  merged := current_p;
  for k,v in select key,value from jsonb_each(p_patch) loop
    if k not in ('notifications','privacy','display','security','marketingEmails','marketingPush') then raise exception 'Invalid preference key'; end if;
    if k in ('marketingEmails','marketingPush') then
      if jsonb_typeof(v)<>'boolean' then raise exception 'Invalid preference'; end if;
      merged := merged||jsonb_build_object(k,v);
    else
      if jsonb_typeof(v)<>'object' then raise exception 'Invalid preference section'; end if;
      merged := merged||jsonb_build_object(k,(case when jsonb_typeof(current_p->k)='object' then current_p->k when k='notifications' and current_p->k='false'::jsonb then '{"push":false,"email":false}'::jsonb else '{}'::jsonb end)||v);
    end if;
  end loop;
  -- Maintain old aliases only when they already exist, without replacing other keys.
  for k,twin in values ('profile_visibility','profileVisibility'),('show_weight','showWeight'),('show_progress','showProgress'),('allow_team_invites','allowTeamInvites'),('allow_challenge_invites','allowChallengeInvites') loop
    if p_patch->'privacy' ? k and current_p->'privacy' ? twin then
      merged := jsonb_set(merged,array['privacy',twin],p_patch->'privacy'->k);
    end if;
  end loop;
  if p_patch->'display' ? 'units' then
    if current_p ? 'unitSystem' then merged := jsonb_set(merged,'{unitSystem}',p_patch->'display'->'units'); end if;
    if jsonb_typeof(current_p->'units')='object' then
      merged := jsonb_set(merged,'{units}',current_p->'units'||jsonb_build_object('weight',case when p_patch->'display'->>'units'='imperial' then 'lbs' else 'kg' end,'height',case when p_patch->'display'->>'units'='imperial' then 'inches' else 'cm' end));
    end if;
  end if;
  perform set_config('engage.explicit_consent','yes',true);
  update public.profiles set preferences=merged where id=p_user;
  perform set_config('engage.explicit_consent','',true);
  foreach k in array array['marketingEmails','marketingPush'] loop
    if p_patch ? k then
      update engage.subjects set consent=consent||jsonb_build_object(case when k='marketingEmails' then 'marketing_email' else 'marketing_push' end,case when p_patch->k='true'::jsonb then 'allowed' else 'denied' end),policy_revision=policy_revision+1 where app_id='fitcircle' and id=p_user and deleted_at is null;
    end if;
  end loop;
  return merged;
end $$;
revoke all on function public.engage_patch_preferences(uuid,jsonb) from public;

create function public.engage_patch_notification_preferences(p_user uuid,p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare k text; v jsonb; result jsonb; permission text;
begin
  if jsonb_typeof(p_patch)<>'object' or octet_length(p_patch::text)>4096 then raise exception 'Invalid preference patch'; end if;
  perform 1 from engage.subjects where app_id='fitcircle' and id=p_user and deleted_at is null for update;
  perform 1 from public.profiles where id=p_user for update;
  if not found then raise exception 'Account missing'; end if;
  insert into public.notification_preferences(user_id) values(p_user) on conflict(user_id) do nothing;
  for k,v in select key,value from jsonb_each(p_patch) loop
    if k in ('journey_enabled','momentum_enabled','circle_enabled','challenge_enabled','social_enabled','celebration_enabled','coach_enabled') then
      if jsonb_typeof(v)<>'boolean' then raise exception 'Invalid category preference'; end if;
      execute format('update public.notification_preferences set %I=$1,updated_at=now() where user_id=$2',k) using (v#>>'{}')::boolean,p_user;
      permission := replace(k,'_enabled','');
      update engage.subjects set consent=consent||jsonb_build_object(permission,case when v='true'::jsonb then 'allowed' else 'denied' end),policy_revision=policy_revision+1 where app_id='fitcircle' and id=p_user and deleted_at is null;
    elsif k in ('quiet_hours_start','quiet_hours_end') then
      if v<>'null'::jsonb and (v#>>'{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Invalid quiet hours'; end if;
      execute format('update public.notification_preferences set %I=$1,updated_at=now() where user_id=$2',k) using (v#>>'{}')::time,p_user;
    elsif k='quiet_hours_timezone' then
      if not exists(select 1 from pg_timezone_names where name=v#>>'{}') then raise exception 'Invalid timezone'; end if;
      update public.notification_preferences set quiet_hours_timezone=v#>>'{}',updated_at=now() where user_id=p_user;
    else raise exception 'Invalid preference key'; end if;
  end loop;
  select to_jsonb(n) into result from public.notification_preferences n where user_id=p_user;
  return result;
end $$;
revoke all on function public.engage_patch_notification_preferences(uuid,jsonb) from public;
-- Supabase roles exist in deployed hosts; local qualification creates them explicitly.
grant execute on function public.engage_patch_preferences(uuid,jsonb) to service_role;
grant execute on function public.engage_patch_notification_preferences(uuid,jsonb) to service_role;
grant usage on schema engage to service_role;
grant select,update on engage.subjects to service_role;
commit;
