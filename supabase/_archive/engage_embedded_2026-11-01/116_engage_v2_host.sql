-- Apply AFTER the reviewed Engage core migration for this app/environment.
-- No secrets or deployment identity are inferred here. Runtime never auto-migrates.
begin;
create table engage.fitcircle_push_bindings (
  app_id text not null check(app_id='fitcircle'), environment text not null,
  install_id uuid not null, user_id uuid not null, token_id uuid not null,
  primary key(app_id,environment,install_id), unique(app_id,environment,token_id),
  foreign key(app_id,environment) references engage.deployment(app_id,environment),
  foreign key(user_id) references public.profiles(id) on delete cascade,
  foreign key(token_id) references public.push_tokens(id) on delete cascade
);
alter table engage.fitcircle_push_bindings enable row level security;
revoke all on engage.fitcircle_push_bindings from public;
commit;
