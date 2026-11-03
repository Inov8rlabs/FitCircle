-- Apply after Engage core 008. Default: every native campaign remains owned by
-- FitCircle. The guard changes behavior only for explicitly linked campaigns.
begin;
do $$ begin
  if (select app_id from engage.deployment where singleton) is distinct from 'fitcircle' then
    raise exception 'FitCircle campaign coexistence requires the FitCircle deployment';
  end if;
end $$;
create function engage.guard_fitcircle_campaign_delivery() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare deployment_environment text;
begin
  select environment into strict deployment_environment from engage.deployment where singleton and app_id='fitcircle';
  perform pg_advisory_xact_lock_shared(hashtextextended('fitcircle:'||deployment_environment||':delivery-policy',0));
  if exists(select 1 from engage.campaign_ownership where app_id='fitcircle' and environment=deployment_environment and source_key=new.campaign_id::text and owner<>'host') then
    raise exception using errcode='P0103',message='Native campaign delivery is paused or owned by Engage';
  end if;
  return new;
end $$;
revoke all on function engage.guard_fitcircle_campaign_delivery() from public;
create trigger engage_guard_campaign_delivery before insert on public.campaign_deliveries
  for each row execute function engage.guard_fitcircle_campaign_delivery();
commit;
