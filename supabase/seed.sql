-- ============================================================================
-- seed.sql — reference data for a freshly created environment
-- ============================================================================
-- Applied automatically by `supabase db reset` (local) after the migrations in
-- supabase/migrations/ run. Safe to re-run: every statement is ON CONFLICT
-- DO NOTHING.
--
-- This is REFERENCE data only — the rows an environment needs to behave
-- correctly. It deliberately contains NO user data. Two things are excluded on
-- purpose:
--   * `foods` (~1.9M rows) — a bulk import, not seed material. Load it
--     separately when a full-text/nutrition environment is needed.
--   * `daily_challenges` — generated per-date by the challenge cron; a fresh
--     environment produces its own.
--
-- Composed from the archived migrations that originally seeded these tables
-- (031, 043, 071, 075, 076) rather than dumped from production, so it stays
-- reviewable and can never carry a production identifier into a dev database.
-- Table names are schema-qualified: the baseline is a pg_dump, which resets
-- search_path to '' for the session, and the seed runs on that same connection.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- feature_gates — server-driven gating. required_tier defaults to 'free', so
-- every feature is ungated until a row is deliberately flipped to 'premium'.
-- ----------------------------------------------------------------------------
insert into public.feature_gates (feature_key) values
  ('body_comp_logging'),('body_comp_photo_scan'),('body_comp_trends'),
  ('body_comp_coach'),('body_comp_segmental'),
  ('food_ai_unlimited'),('fitzy_unlimited'),('history_extended'),
  ('circles_unlimited'),('ads_removed'),('data_export'),
  ('share_themes_custom'),('streak_shields_bonus')
on conflict (feature_key) do nothing;

-- ----------------------------------------------------------------------------
-- feature_flags — master switches, seeded OFF.
-- ----------------------------------------------------------------------------
insert into public.feature_flags (name, description, is_enabled, rollout_percentage, allowed_tiers)
values
  ('food_logging',
   'Food, water, and supplement logging with photo uploads',
   false, 0, array['premium','enterprise']),
  ('subscriptions',
   'Master switch for the FitCircle Pro subscription surface (paywalls, upgrade CTAs, web checkout) on iOS/Android/Web. OFF = feature invisible everywhere.',
   false, 0, '{}')
on conflict (name) do nothing;

-- ----------------------------------------------------------------------------
-- challenge_templates — the built-in challenge catalogue (from 043).
-- Guarded rather than ON CONFLICT: the table's only unique key is a generated
-- uuid primary key, so there is nothing to conflict on. The anonymous block is
-- a seed guard, not business logic living in the database.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.challenge_templates) then
    INSERT INTO public.challenge_templates (name, description, category, challenge_category, goal_amount, unit, duration_days, logging_prompt, difficulty, icon_name, sort_order) VALUES

    -- ============================================================================
    -- DAILY MICROS (15 templates, duration_days=1)
    -- ============================================================================
    ('50 Squats', 'Drop and squat! Complete 50 squats today — break them up however you like.', 'daily_micro', 'strength', 50, 'reps', 1, 'How many squats did you do?', 'easy', '🦵', 1),
    ('20 Push-ups', 'Classic push-up challenge. Knock out 20 today in as many sets as you need.', 'daily_micro', 'strength', 20, 'reps', 1, 'How many push-ups did you do?', 'easy', '💪', 2),
    ('30 Sit-ups', 'Core work made simple. Get 30 sit-ups done before the day ends.', 'daily_micro', 'strength', 30, 'reps', 1, 'How many sit-ups did you do?', 'easy', '🔥', 3),
    ('10-Minute Walk', 'Just 10 minutes on your feet. Walk around the block, the office, or the park.', 'daily_micro', 'cardio', 10, 'minutes', 1, 'How many minutes did you walk?', 'easy', '🚶', 4),
    ('15-Minute Jog or Bike', 'Get your heart rate up for 15 minutes — jog, bike, or any cardio you enjoy.', 'daily_micro', 'cardio', 15, 'minutes', 1, 'How many minutes of cardio?', 'easy', '🏃', 5),
    ('10-Minute Stretch', 'Loosen up with a 10-minute stretching session. Your body will thank you.', 'daily_micro', 'flexibility', 10, 'minutes', 1, 'How many minutes did you stretch?', 'easy', '🧘', 6),
    ('5-Minute Plank', 'Hold strong. Accumulate 5 minutes of plank time today — break it into sets.', 'daily_micro', 'strength', 5, 'minutes', 1, 'How many minutes of plank?', 'medium', '💪', 7),
    ('20 Burpees', 'The ultimate full-body move. Complete 20 burpees today.', 'daily_micro', 'cardio', 20, 'reps', 1, 'How many burpees did you do?', 'medium', '🫀', 8),
    ('Drink 8 Glasses of Water', 'Stay hydrated! Track each glass of water throughout the day.', 'daily_micro', 'wellness', 8, 'glasses', 1, 'How many glasses of water?', 'easy', '💧', 9),
    ('10-Minute Meditation', 'Find your calm. Sit quietly for 10 minutes of mindful breathing.', 'daily_micro', 'wellness', 10, 'minutes', 1, 'How many minutes did you meditate?', 'easy', '🧘‍♂️', 10),
    ('Dance to 3 Songs', 'Put on your favorite tracks and dance like nobody is watching.', 'daily_micro', 'cardio', 3, 'songs', 1, 'How many songs did you dance to?', 'easy', '💃', 11),
    ('Take the Stairs All Day', 'Skip the elevator. Take the stairs every chance you get today.', 'daily_micro', 'cardio', 1, 'days', 1, 'Did you take the stairs all day?', 'easy', '🏢', 12),
    ('50 Jumping Jacks', 'Quick cardio burst. Complete 50 jumping jacks today.', 'daily_micro', 'cardio', 50, 'reps', 1, 'How many jumping jacks?', 'easy', '⭐', 13),
    ('15-Minute Yoga Flow', 'Flow through 15 minutes of yoga poses. Great for body and mind.', 'daily_micro', 'flexibility', 15, 'minutes', 1, 'How many minutes of yoga?', 'easy', '🧘', 14),
    ('Play an Active Game', 'Get moving with an active game — basketball, tag, frisbee, anything fun.', 'daily_micro', 'cardio', 1, 'games', 1, 'How many active games did you play?', 'easy', '🎮', 15),

    -- ============================================================================
    -- WEEKLY (9 templates, duration_days=7)
    -- ============================================================================
    ('50K Steps', 'Walk your way to 50,000 steps this week. Every step counts.', 'weekly', 'cardio', 50000, 'steps', 7, 'How many steps today?', 'medium', '🚶', 16),
    ('200 Push-ups by Sunday', 'Spread them out or blitz them — hit 200 push-ups by end of week.', 'weekly', 'strength', 200, 'reps', 7, 'How many push-ups did you do?', 'medium', '💪', 17),
    ('Weekday Warriors', 'Complete 5 workouts Monday through Friday. Any workout counts.', 'weekly', 'mixed', 5, 'workouts', 7, 'How many workouts today?', 'medium', '🗓️', 18),
    ('150 Active Minutes', 'Hit 150 minutes of intentional movement this week. WHO-recommended.', 'weekly', 'mixed', 150, 'minutes', 7, 'How many active minutes today?', 'medium', '⏱️', 19),
    ('Walk/Run 30km', 'Cover 30 kilometers on foot this week — walk, jog, or run.', 'weekly', 'cardio', 30, 'km', 7, 'How many km did you cover?', 'hard', '🏃', 20),
    ('Early Bird', 'Exercise before 8 AM on 5 days this week. Rise and grind.', 'weekly', 'mixed', 5, 'days', 7, 'Did you exercise before 8 AM?', 'hard', '🌅', 21),
    ('No Excuses', 'Work out every single day this week. Seven days, seven workouts.', 'weekly', 'mixed', 7, 'workouts', 7, 'How many workouts today?', 'hard', '💯', 22),
    ('700 Squats', '100 squats a day for 7 days. Your legs will be on fire.', 'weekly', 'strength', 700, 'reps', 7, 'How many squats did you do?', 'hard', '🦵', 23),
    ('Stretch Every Day', 'Stretch for 10+ minutes every day this week. Consistency is key.', 'weekly', 'flexibility', 7, 'days', 7, 'How many minutes did you stretch?', 'medium', '🧘', 24),

    -- ============================================================================
    -- MONTHLY (6 templates, duration_days=30)
    -- ============================================================================
    ('Marathon Month', 'Run or walk 42.2km over 30 days. One marathon, your pace.', 'monthly', 'cardio', 42.2, 'km', 30, 'How many km did you cover?', 'hard', '🏃', 25),
    ('The 1000 Club', '1000 push-ups + 1000 squats + 1000 sit-ups in 30 days. Legend status.', 'monthly', 'strength', 3000, 'reps', 30, 'How many reps today?', 'extreme', '💪', 26),
    ('Daily Mover', 'Exercise every single day for a month. 30 days, 30 workouts.', 'monthly', 'mixed', 30, 'workouts', 30, 'How many workouts today?', 'hard', '🔥', 27),
    ('300K Steps', 'Walk 300,000 steps in a month. Roughly 10K per day.', 'monthly', 'cardio', 300000, 'steps', 30, 'How many steps today?', 'hard', '🚶', 28),
    ('30-Day Plank Progression', 'Plank every day for 30 days. Start easy, build up.', 'monthly', 'strength', 30, 'days', 30, 'How many minutes of plank today?', 'medium', '💪', 29),
    ('Hydration Month', 'Drink 2 liters of water every day for 30 days. 60L total.', 'monthly', 'wellness', 60, 'liters', 30, 'How many liters did you drink?', 'easy', '💧', 30),

    -- ============================================================================
    -- COLLABORATIVE / EPIC (4 templates)
    -- ============================================================================
    ('Circle Step Challenge', 'Combine your circle''s steps to hit 250K together. Teamwork makes the dream work.', 'collaborative', 'cardio', 250000, 'steps', 7, 'How many steps today?', 'medium', '👥', 31),
    ('Climb Everest', 'Your circle climbs 29,032 feet of elevation together. Stairs, hills, treadmill incline — all count.', 'collaborative', 'cardio', 29032, 'ft', 30, 'How many feet of elevation?', 'extreme', '🏔️', 32),
    ('Run the Silk Road', 'Your circle collectively runs 4,000 miles over 90 days. Epic journey, shared effort.', 'epic', 'cardio', 4000, 'miles', 90, 'How many miles did you cover?', 'extreme', '🐫', 33),
    ('Perfect Week', '100% check-in rate from every circle member for 7 days. All in or nothing.', 'collaborative', 'mixed', 7, 'days', 7, 'Did everyone check in today?', 'medium', '⭐', 34),

    -- ============================================================================
    -- ONBOARDING (3 templates)
    -- ============================================================================
    ('First Step', 'Complete your very first workout. Just one. That''s all it takes to start.', 'onboarding', 'mixed', 1, 'workouts', 1, 'Did you complete a workout?', 'easy', '🌱', 35),
    ('Three-Day Spark', 'Work out 3 times in 3 days. Build the spark that lights the fire.', 'onboarding', 'mixed', 3, 'workouts', 3, 'How many workouts today?', 'easy', '⚡', 36),
    ('Five Alive', 'Complete 5 workouts in your first week. You''re officially in the game.', 'onboarding', 'mixed', 5, 'workouts', 7, 'How many workouts today?', 'easy', '🔥', 37);
  end if;
end $$;
