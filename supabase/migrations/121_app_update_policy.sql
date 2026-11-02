-- 121: server-driven app update policy (GET /api/mobile/app-update).
--
-- One feature_flags row, no new table:
--   is_enabled = global kill switch (false → every client is told "none").
--   metadata   = per-platform policy:
--     latest_version         the build live in the store
--     recommended_version    clients below it get the soft "Update" sheet (dismissible,
--                            once per latest_version, re-shown after reprompt_after_days,
--                            at most max_prompts_per_version times)
--     min_supported_version  clients below it get the blocking update screen (null = none)
--     enabled                per-platform kill switch
--     release_notes          { title, subtitle, highlights: [{ icon (design/icons.json key), title, body }] }
--                            describe latest_version; also shown in the "You're on the latest" moment
--   rollout_percentage / allowed_* are NOT used by this flag.
--
-- After each store release, bump latest_version (and release_notes), e.g.:
--   update feature_flags
--      set metadata = jsonb_set(metadata, '{ios,latest_version}', '"1.1.1"'), updated_at = now()
--    where name = 'app_update_policy';
-- Never set min_supported_version above a build that is fully rolled out on that store.

insert into public.feature_flags (name, description, is_enabled, rollout_percentage, metadata)
values (
  'app_update_policy',
  'Mobile app update prompts (GET /api/mobile/app-update). is_enabled = kill switch; metadata = { ios, android } policy.',
  true,
  0,
  '{
    "ios": {
      "enabled": true,
      "latest_version": "1.1.0",
      "recommended_version": "1.1.0",
      "min_supported_version": null,
      "reprompt_after_days": 3,
      "max_prompts_per_version": 3,
      "release_notes": {
        "title": "A fresh new FitCircle",
        "subtitle": "The update is free and takes a minute.",
        "highlights": [
          { "icon": "sparkles", "title": "A cleaner, faster Home", "body": "Everything for today in one place." },
          { "icon": "chat", "title": "Fitzy, your AI coach", "body": "Daily focus and a plan for your week." },
          { "icon": "water", "title": "Hydration tracking", "body": "Log water in one tap, even offline." }
        ]
      }
    },
    "android": {
      "enabled": true,
      "latest_version": "1.1.0",
      "recommended_version": "1.1.0",
      "min_supported_version": null,
      "reprompt_after_days": 3,
      "max_prompts_per_version": 3,
      "release_notes": {
        "title": "A fresh new FitCircle",
        "subtitle": "The update is free and takes a minute.",
        "highlights": [
          { "icon": "sparkles", "title": "A cleaner, faster Home", "body": "Everything for today in one place." },
          { "icon": "chat", "title": "Fitzy, your AI coach", "body": "Daily focus and a plan for your week." },
          { "icon": "water", "title": "Hydration tracking", "body": "Log water in one tap, even offline." }
        ]
      }
    }
  }'::jsonb
)
on conflict (name) do nothing;
