-- 114_icon_keys_emoji_cleanup.sql
--
-- APPLY ALONE (`npx -y supabase@latest db query --linked -f supabase/migrations/114_icon_keys_emoji_cleanup.sql`
-- then insert '114' into supabase_migrations.schema_migrations). Never `db push --include-all`:
-- 104 is still unapplied on purpose.
--
-- FitCircle 1.2.0 W4 (docs/RELEASE_1.1.0_PLAN.md, docs/DESIGN_LANGUAGE.md §1, §6): icon keys
-- next to the legacy emoji, and emoji-free push copy. Data + ADDITIVE columns only:
--   * no column is dropped or renamed, and every emoji value shipped apps (<= 1.1.x) render is
--     kept: campaigns.emoji, marks[].emoji, doors[].emoji, challenge_templates.icon_name;
--   * icon keys come from design/icons.json (the emoji -> key map below is generated from it;
--     apps/web/app/lib/design/__tests__/icons.test.ts checks every key in this file);
--   * idempotent: every statement only touches rows that still need it, so re-running is a no-op;
--   * no functions, procedures or triggers (CLAUDE.md).
--
-- The API works with or without this migration: readers derive a key from the emoji when the
-- stored one is missing (lib/design/icons.ts resolveIconKey). Apply it before Admin Tools starts
-- sending a campaign `icon` (that is the first writer of campaigns.icon).

begin;

-- emoji (U+FE0F removed) -> icon key, generated from design/icons.json. Dropped at commit.
create temp table emoji_icon (emoji text primary key, icon text not null) on commit drop;
insert into emoji_icon (emoji, icon) values
    ('📸', 'camera'),
    ('📷', 'camera'),
    ('💪', 'strength'),
    ('🦵', 'strength'),
    ('🧱', 'strength'),
    ('🏋', 'strength_training'),
    ('🏆', 'trophy'),
    ('🔥', 'flame'),
    ('🎯', 'target'),
    ('💯', 'target'),
    ('📊', 'chart_bar'),
    ('📈', 'trend'),
    ('👥', 'community'),
    ('🤝', 'community'),
    ('👯', 'community'),
    ('💬', 'chat'),
    ('🙌', 'chat'),
    ('📬', 'chat'),
    ('⚡', 'bolt'),
    ('🚀', 'bolt'),
    ('⏱', 'stopwatch'),
    ('⏰', 'alarm'),
    ('⏳', 'hourglass'),
    ('⌛', 'hourglass'),
    ('🔔', 'bell'),
    ('🏃', 'run'),
    ('🚶', 'walk'),
    ('👟', 'steps'),
    ('🪜', 'stairs'),
    ('🏢', 'stairs'),
    ('🚴', 'cycle'),
    ('🚲', 'cycle'),
    ('🏊', 'swim'),
    ('🧘', 'mindful'),
    ('🧘‍♀', 'mindful'),
    ('🧘‍♂', 'mindful'),
    ('🌬', 'breathe'),
    ('🧠', 'mind'),
    ('😴', 'sleep'),
    ('🔄', 'repeat'),
    ('💧', 'water'),
    ('🧊', 'water'),
    ('☕', 'beverage'),
    ('🍵', 'beverage'),
    ('🍽', 'meal'),
    ('🍴', 'meal'),
    ('🍳', 'meal'),
    ('🥚', 'meal'),
    ('🥜', 'meal'),
    ('🦃', 'meal'),
    ('🥦', 'produce'),
    ('🍎', 'produce'),
    ('🫐', 'produce'),
    ('🥗', 'produce'),
    ('🍲', 'cook'),
    ('🧺', 'basket'),
    ('📵', 'no_phone'),
    ('📝', 'note'),
    ('📖', 'book'),
    ('🎶', 'music'),
    ('🎵', 'music'),
    ('💃', 'music'),
    ('🎮', 'game'),
    ('🐫', 'map'),
    ('🗺', 'map'),
    ('🗓', 'calendar'),
    ('📅', 'calendar'),
    ('🔢', 'calendar'),
    ('✅', 'check'),
    ('✔', 'check'),
    ('🚩', 'flag'),
    ('🏁', 'milestone'),
    ('🎉', 'celebration'),
    ('🥳', 'celebration'),
    ('🎊', 'celebration'),
    ('👋', 'wave'),
    ('❤', 'heart'),
    ('💜', 'heart'),
    ('🧡', 'heart'),
    ('🫀', 'heart'),
    ('🫶', 'heart'),
    ('🙏', 'heart'),
    ('🤗', 'heart'),
    ('🛡', 'shield'),
    ('👑', 'crown'),
    ('🎖', 'medal'),
    ('🏅', 'medal'),
    ('⭐', 'star'),
    ('🌟', 'star'),
    ('💎', 'gem'),
    ('⛰', 'mountain'),
    ('🗻', 'mountain'),
    ('🏔', 'mountain'),
    ('✨', 'sparkles'),
    ('❄', 'snowflake'),
    ('🎁', 'gift'),
    ('🎅', 'gift'),
    ('☀', 'sun'),
    ('🌅', 'sunrise'),
    ('🌙', 'moon'),
    ('🍃', 'leaf'),
    ('🌱', 'leaf'),
    ('🌿', 'leaf'),
    ('🌳', 'tree'),
    ('🎄', 'tree');

-- ---------------------------------------------------------------------------
-- 1. campaigns: icon keys alongside the emoji
-- ---------------------------------------------------------------------------

alter table public.campaigns
  add column if not exists icon text
  check (icon is null or icon ~ '^[a-z][a-z0-9_]*$');

comment on column public.campaigns.icon is
  'Icon key (design/icons.json) shown by 1.2.0+ apps; emoji stays for <= 1.1.x. Null = derive from emoji / glyph.';

-- 1a. Campaign-level key: from the emoji, else from the art glyph, else the registry fallback.
with glyph_icon(glyph, icon) as (
  values
    ('snowflake', 'snowflake'),
    ('gift', 'gift'),
    ('year', 'calendar'),
    ('sun', 'sun'),
    ('moon', 'moon'),
    ('flame', 'flame'),
    ('leaf', 'leaf'),
    ('heart', 'heart'),
    ('star', 'star'),
    ('bolt', 'bolt')
)
update public.campaigns c
set icon = coalesce(
      (select e.icon from emoji_icon e where e.emoji = replace(c.emoji, E'\uFE0F', '')),
      (select e.icon from emoji_icon e where e.emoji = left(replace(c.emoji, E'\uFE0F', ''), 1)),
      (select g.icon from glyph_icon g where g.glyph = c.glyph),
      'sparkles'
    ),
    version = c.version + 1,
    updated_at = now()
where c.icon is null;

-- 1b. marks[]: add "icon" to every mark that has none (keeps "emoji").
update public.campaigns c
set marks = (
      select coalesce(jsonb_agg(
               case when m ? 'icon' then m
                    else m || jsonb_build_object('icon', coalesce(
                      (select e.icon from emoji_icon e where e.emoji = replace(m->>'emoji', E'\uFE0F', '')),
                      (select e.icon from emoji_icon e where e.emoji = left(replace(m->>'emoji', E'\uFE0F', ''), 1)),
                      'calendar'))
               end order by ord), '[]'::jsonb)
      from jsonb_array_elements(c.marks) with ordinality as x(m, ord)
    ),
    version = c.version + 1,
    updated_at = now()
where jsonb_typeof(c.marks) = 'array'
  and exists (select 1 from jsonb_array_elements(c.marks) m where not m ? 'icon');

-- 1c. calendar.doors[]: add "icon" to every door that has none (Advent's 24 doors; keeps "emoji").
update public.campaigns c
set calendar = jsonb_set(c.calendar, '{doors}', (
      select coalesce(jsonb_agg(
               case when d ? 'icon' then d
                    else d || jsonb_build_object('icon', coalesce(
                      (select e.icon from emoji_icon e where e.emoji = replace(d->>'emoji', E'\uFE0F', '')),
                      (select e.icon from emoji_icon e where e.emoji = left(replace(d->>'emoji', E'\uFE0F', ''), 1)),
                      'sparkles'))
               end order by ord), '[]'::jsonb)
      from jsonb_array_elements(c.calendar->'doors') with ordinality as x(d, ord)
    )),
    version = c.version + 1,
    updated_at = now()
where jsonb_typeof(c.calendar->'doors') = 'array'
  and exists (select 1 from jsonb_array_elements(c.calendar->'doors') d where not d ? 'icon');

-- 1d. Push titles without emoji (push goes to every app version). The three seeded launch
--     titles (Hold the Line, Advent, Fresh Start) plus Advent's daily "{{door_emoji}}" title.
--     Only exact matches change, so an admin-edited title is left alone. Hold the Line (Nov 15)
--     and Advent (Dec 1) are the next sends. The delivery code also strips emoji from every
--     rendered campaign push (CampaignDeliveryService.renderPush), so this is belt and braces.
with old_title(old, new) as (
  values
    ('Hold the Line starts today ❄️', 'Hold the Line starts today'),
    ('The Advent Circle is open 🎁', 'The Advent Circle is open'),
    ('Door {{day}} is open {{door_emoji}}', 'Door {{day}} is open'),
    ('Fresh Start 2027 begins 🌅', 'Fresh Start 2027 begins')
)
update public.campaigns c
set notifications = (
      select jsonb_agg(
               case when n->>'title' in (select old from old_title)
                    then jsonb_set(n, '{title}', to_jsonb((select t.new from old_title t where t.old = n->>'title')))
                    else n
               end order by ord)
      from jsonb_array_elements(c.notifications) with ordinality as x(n, ord)
    ),
    version = c.version + 1,
    updated_at = now()
where jsonb_typeof(c.notifications) = 'array'
  and exists (
    select 1 from jsonb_array_elements(c.notifications) n
    where n->>'title' in (select old from old_title)
  );

-- ---------------------------------------------------------------------------
-- 2. challenge_templates: icon_key next to icon_name (icon_name keeps the emoji)
-- ---------------------------------------------------------------------------

alter table public.challenge_templates
  add column if not exists icon_key text
  check (icon_key is null or icon_key ~ '^[a-z][a-z0-9_]*$');

comment on column public.challenge_templates.icon_key is
  'Icon key (design/icons.json) for 1.2.0+ apps; icon_name keeps the emoji for <= 1.1.x.';

-- 2a. The 37 seeded templates, by name (043 seed).
with template_icon(name, icon) as (
  values
    ('50 Squats', 'strength'),
    ('20 Push-ups', 'strength'),
    ('30 Sit-ups', 'flame'),
    ('10-Minute Walk', 'walk'),
    ('15-Minute Jog or Bike', 'run'),
    ('10-Minute Stretch', 'mindful'),
    ('5-Minute Plank', 'strength'),
    ('20 Burpees', 'heart'),
    ('Drink 8 Glasses of Water', 'water'),
    ('10-Minute Meditation', 'mindful'),
    ('Dance to 3 Songs', 'music'),
    ('Take the Stairs All Day', 'stairs'),
    ('50 Jumping Jacks', 'star'),
    ('15-Minute Yoga Flow', 'mindful'),
    ('Play an Active Game', 'game'),
    ('50K Steps', 'walk'),
    ('200 Push-ups by Sunday', 'strength'),
    ('Weekday Warriors', 'calendar'),
    ('150 Active Minutes', 'stopwatch'),
    ('Walk/Run 30km', 'run'),
    ('Early Bird', 'sunrise'),
    ('No Excuses', 'target'),
    ('700 Squats', 'strength'),
    ('Stretch Every Day', 'mindful'),
    ('Marathon Month', 'run'),
    ('The 1000 Club', 'strength'),
    ('Daily Mover', 'flame'),
    ('300K Steps', 'walk'),
    ('30-Day Plank Progression', 'strength'),
    ('Hydration Month', 'water'),
    ('Circle Step Challenge', 'community'),
    ('Climb Everest', 'mountain'),
    ('Run the Silk Road', 'map'),
    ('Perfect Week', 'star'),
    ('First Step', 'flag'),
    ('Three-Day Spark', 'bolt'),
    ('Five Alive', 'flame')
)
update public.challenge_templates t
set icon_key = ti.icon
from template_icon ti
where t.name = ti.name
  and t.icon_key is null;

-- 2b. Any other row: derive from its emoji (fallback 'trophy').
update public.challenge_templates t
set icon_key = coalesce(
      (select e.icon from emoji_icon e where e.emoji = replace(t.icon_name, E'\uFE0F', '')),
      (select e.icon from emoji_icon e where e.emoji = left(replace(t.icon_name, E'\uFE0F', ''), 1)),
      'trophy')
where t.icon_key is null;

-- ---------------------------------------------------------------------------
-- 3. user_achievements: '🎉' -> 'milestone'
--    Checked 2026-10-28: no shipped client (FitCircle-iOS, Fitcircle-Android, their 1.2.0
--    worktrees, the web app) reads achievement_icon; only the onboarding-complete inserts
--    write it, and they now write 'milestone'.
-- ---------------------------------------------------------------------------

update public.user_achievements
set achievement_icon = 'milestone'
where achievement_icon = '🎉';

commit;

-- ---------------------------------------------------------------------------
-- 4. OPTIONAL — OWNER DECIDES. Not applied unless uncommented.
--    Strips trailing emoji from SYSTEM circle posts (kind = 'system_event') so old posts
--    match the new emoji-free copy. NEVER touches user rows (user_text / user_photo).
--    Side effects: bumps updated_at on every matched row (trg_circle_messages_updated_at)
--    and emits a Realtime UPDATE per row (REPLICA IDENTITY FULL), so open chats re-render
--    those posts. Run off-peak. Count first:
--
--      select count(*) from public.circle_messages
--      where kind = 'system_event' and body ~ '[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B50\u2705\u2728\uFE0F]\s*$';
--
-- update public.circle_messages
-- set body = regexp_replace(
--       body,
--       '\s*[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B50\u2B55\u2705\u2728\u231A\u231B\u23E9-\u23FA\uFE0F\u200D]+\s*$',
--       '')
-- where kind = 'system_event'
--   and body ~ '[\U0001F000-\U0001FAFF\u2600-\u27BF\u2B50\u2705\u2728\uFE0F]\s*$';
-- ---------------------------------------------------------------------------
