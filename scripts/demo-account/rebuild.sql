-- Rebuild the App Review demo account (fitcircle.user@gmail.com) with a clean,
-- coherent 12-day history ending TODAY (Pacific time, where App Review works).
-- Touches ONLY the demo user's rows and the demo circle. Re-runnable.
do $$
declare
  uid    uuid := '47476150-a984-4431-a89a-7cc8085adfe6';
  circle uuid := 'dc69b1b5-9fb6-4f50-8f5f-0f1776af82be';
  tz     text := 'America/Los_Angeles';
  t      date := (now() at time zone 'America/Los_Angeles')::date;
  span   int  := 12;              -- days of history, all claimed: streak = 12
  breakfasts text[] := array['Greek yogurt with berries and granola','Oatmeal with banana and walnuts','Scrambled eggs on whole-grain toast','Spinach and mushroom omelette','Overnight oats with chia and mango','Avocado toast with a poached egg','Protein smoothie with peanut butter'];
  b_macros   int[]  := array[380,22,48,10,  410,14,62,13,  390,24,30,19,  340,26,9,22,  420,18,58,13,  430,17,36,24,  360,30,34,11];
  lunches    text[] := array['Grilled chicken salad with quinoa','Turkey and avocado wrap','Lentil soup with sourdough','Tuna poke bowl with brown rice','Chicken burrito bowl','Tofu stir-fry with vegetables','Mediterranean chickpea bowl'];
  l_macros   int[]  := array[540,42,45,18,  520,34,48,20,  470,24,68,10,  560,38,62,16,  610,40,66,19,  480,28,44,21,  530,22,64,20];
  dinners    text[] := array['Salmon, roasted vegetables and brown rice','Chicken stir-fry with jasmine rice','Whole-wheat pasta with turkey bolognese','Shrimp tacos with cabbage slaw','Beef and broccoli with rice','Baked cod, sweet potato and green beans','Vegetable curry with basmati rice'];
  d_macros   int[]  := array[620,38,55,24,  640,44,68,18,  660,40,78,19,  580,36,58,21,  650,42,60,25,  540,41,52,14,  600,20,84,19];
  snacks     text[] := array['Apple with almond butter','Cottage cheese with pineapple','Hummus with carrot sticks','Protein bar','Handful of mixed nuts'];
  s_macros   int[]  := array[210,5,25,11,  180,16,18,4,  190,6,20,10,  220,20,23,7,  200,6,8,17];
  steps_by_day int[] := array[1840,9412,11276,7930,10544,8621,12308,6954,9875,10190,8342,11020]; -- index 1 = today (morning so far)
  weights numeric[]  := array[74.2,74.3,74.3,74.5,74.4,74.6,74.7,74.7,74.9,75.0,75.1,75.2];     -- index 1 = today
  off int; dd date; i int; bid uuid; cid uuid; eid uuid; shift_days int;
  ex record;
begin
  if not exists (select 1 from profiles where id = uid and email = 'fitcircle.user@gmail.com') then
    raise exception 'demo profile not found — refusing to run';
  end if;

  -- 1. Clear the demo user's activity rows.
  delete from engagement_activities where user_id = uid;
  delete from streak_claims         where user_id = uid;
  delete from plate_scores          where user_id = uid;   -- cached scores; recomputed on view
  delete from exercise_logs         where user_id = uid;
  delete from daily_tracking        where user_id = uid;
  delete from food_log_entries      where user_id = uid;

  -- 2. One day at a time, oldest first.
  for off in reverse (span - 1)..0 loop
    dd := t - off;
    i  := (span - 1 - off);          -- 0 for the oldest day

    -- Breakfast (every day, including today).
    bid := gen_random_uuid();
    insert into food_log_entries (id, user_id, entry_type, logged_at, entry_date, meal_type, title, nutrition_data, is_private, visibility, source, input_method, nutrition_source, calories, protein_g, carbs_g, fat_g, created_at, updated_at)
    values (bid, uid, 'food', (dd + time '07:40' + make_interval(mins => (i * 7) % 35)) at time zone tz, dd, 'breakfast',
            breakfasts[1 + i % 7],
            jsonb_build_object('calories', b_macros[1 + 4*(i%7)], 'protein_g', b_macros[2 + 4*(i%7)], 'carbs_g', b_macros[3 + 4*(i%7)], 'fat_g', b_macros[4 + 4*(i%7)]),
            false, 'circle', 'manual', 'manual', 'user',
            b_macros[1 + 4*(i%7)], b_macros[2 + 4*(i%7)], b_macros[3 + 4*(i%7)], b_macros[4 + 4*(i%7)],
            (dd + time '07:42' + make_interval(mins => (i * 7) % 35)) at time zone tz, now());
    insert into food_log_entries (user_id, entry_type, logged_at, entry_date, water_ml, nutrition_data, is_private, visibility, source, created_at, updated_at)
    values (uid, 'water', (dd + time '07:15') at time zone tz, dd, 500, '{}'::jsonb, false, 'circle', 'manual', (dd + time '07:15') at time zone tz, now());

    if off > 0 then   -- earlier days are complete days
      insert into food_log_entries (user_id, entry_type, logged_at, entry_date, meal_type, title, nutrition_data, is_private, visibility, source, input_method, nutrition_source, calories, protein_g, carbs_g, fat_g, created_at, updated_at)
      values
       (uid, 'food', (dd + time '12:20' + make_interval(mins => (i * 11) % 40)) at time zone tz, dd, 'lunch', lunches[1 + (i + 2) % 7],
        jsonb_build_object('calories', l_macros[1 + 4*((i+2)%7)], 'protein_g', l_macros[2 + 4*((i+2)%7)], 'carbs_g', l_macros[3 + 4*((i+2)%7)], 'fat_g', l_macros[4 + 4*((i+2)%7)]),
        false, 'circle', 'manual', 'manual', 'user', l_macros[1 + 4*((i+2)%7)], l_macros[2 + 4*((i+2)%7)], l_macros[3 + 4*((i+2)%7)], l_macros[4 + 4*((i+2)%7)],
        (dd + time '12:22' + make_interval(mins => (i * 11) % 40)) at time zone tz, now()),
       (uid, 'food', (dd + time '15:30' + make_interval(mins => (i * 13) % 30)) at time zone tz, dd, 'snack', snacks[1 + i % 5],
        jsonb_build_object('calories', s_macros[1 + 4*(i%5)], 'protein_g', s_macros[2 + 4*(i%5)], 'carbs_g', s_macros[3 + 4*(i%5)], 'fat_g', s_macros[4 + 4*(i%5)]),
        false, 'circle', 'manual', 'manual', 'user', s_macros[1 + 4*(i%5)], s_macros[2 + 4*(i%5)], s_macros[3 + 4*(i%5)], s_macros[4 + 4*(i%5)],
        (dd + time '15:31' + make_interval(mins => (i * 13) % 30)) at time zone tz, now()),
       (uid, 'food', (dd + time '18:50' + make_interval(mins => (i * 9) % 45)) at time zone tz, dd, 'dinner', dinners[1 + (i + 4) % 7],
        jsonb_build_object('calories', d_macros[1 + 4*((i+4)%7)], 'protein_g', d_macros[2 + 4*((i+4)%7)], 'carbs_g', d_macros[3 + 4*((i+4)%7)], 'fat_g', d_macros[4 + 4*((i+4)%7)]),
        false, 'circle', 'manual', 'manual', 'user', d_macros[1 + 4*((i+4)%7)], d_macros[2 + 4*((i+4)%7)], d_macros[3 + 4*((i+4)%7)], d_macros[4 + 4*((i+4)%7)],
        (dd + time '18:52' + make_interval(mins => (i * 9) % 45)) at time zone tz, now());
      insert into food_log_entries (user_id, entry_type, logged_at, entry_date, water_ml, nutrition_data, is_private, visibility, source, created_at, updated_at)
      values
       (uid, 'water', (dd + time '10:30') at time zone tz, dd, 500, '{}'::jsonb, false, 'circle', 'manual', (dd + time '10:30') at time zone tz, now()),
       (uid, 'water', (dd + time '13:45') at time zone tz, dd, 500, '{}'::jsonb, false, 'circle', 'manual', (dd + time '13:45') at time zone tz, now()),
       (uid, 'water', (dd + time '16:40') at time zone tz, dd, 500, '{}'::jsonb, false, 'circle', 'manual', (dd + time '16:40') at time zone tz, now()),
       (uid, 'water', (dd + time '20:10') at time zone tz, dd, 350 + 50 * (i % 4), '{}'::jsonb, false, 'circle', 'manual', (dd + time '20:10') at time zone tz, now());
    end if;

    -- Steps, weight, mood for the day.
    insert into daily_tracking (user_id, tracking_date, steps, steps_source, weight_kg, mood_score, energy_level, streak_day, is_public, created_at, updated_at)
    values (uid, dd, steps_by_day[off + 1], 'manual', weights[off + 1], 7 + (i % 3), 6 + (i % 4), i + 1, true,
            (dd + time '07:20') at time zone tz, now());

    -- Streak claim for the day, earned by the breakfast log.
    cid := gen_random_uuid();
    insert into streak_claims (id, user_id, claim_date, claimed_at, claim_method, timezone, health_data_synced, metadata, created_at)
    values (cid, uid, dd, (dd + time '07:42' + make_interval(mins => (i * 7) % 35)) at time zone tz, 'manual_entry', tz, true,
            jsonb_build_object('source', 'food_log', 'reference_id', bid,
              'health_data', jsonb_build_object('has_food_log', true, 'has_beverage_log', true, 'has_exercise_log', false, 'has_steps', true, 'has_weight', true, 'has_mood', true, 'has_energy', true)),
            (dd + time '07:42' + make_interval(mins => (i * 7) % 35)) at time zone tz);
    insert into engagement_activities (user_id, activity_date, activity_type, reference_id, metadata, created_at)
    values (uid, dd, 'circle_checkin', cid, '{}'::jsonb, (dd + time '07:42' + make_interval(mins => (i * 7) % 35)) at time zone tz);
  end loop;

  -- 3. Workouts: a believable week and a half, none today yet.
  for ex in
    select * from (values
      (1,  'running',          'cardio',   34, 338, 5200::numeric, time '06:45', 7, 'outdoor'),
      (2,  'strengthTraining', 'strength', 48, 310, null,          time '17:40', 8, 'gym'),
      (4,  'cycling',          'cardio',   52, 455, 18400,         time '07:05', 6, 'outdoor'),
      (5,  'walking',          'cardio',   41, 172, 3600,          time '12:35', 4, 'outdoor'),
      (6,  'strengthTraining', 'strength', 45, 295, null,          time '17:50', 8, 'gym'),
      (8,  'running',          'cardio',   29, 292, 4500,          time '06:50', 7, 'outdoor'),
      (9,  'hiit',             'cardio',   25, 268, null,          time '18:15', 9, 'home'),
      (11, 'walking',          'cardio',   38, 160, 3300,          time '12:40', 3, 'outdoor')
    ) as w(day_off, etype, cat, mins, kcal, dist, at_time, effort, loc)
  loop
    dd  := t - ex.day_off;
    eid := gen_random_uuid();
    insert into exercise_logs (id, user_id, exercise_type, category, duration_minutes, calories_burned, calories_estimated, exercise_date, started_at, source, distance_meters, effort_level, location_type, workout_companion, is_indoor, is_public, is_deleted, counts_as_checkin, created_at, updated_at)
    values (eid, uid, ex.etype, ex.cat, ex.mins, ex.kcal, true, dd, (dd + ex.at_time) at time zone tz, 'manual', ex.dist, ex.effort, ex.loc, 'solo',
            ex.loc in ('gym', 'home'), true, false, true, (dd + ex.at_time + make_interval(mins => ex.mins + 3)) at time zone tz, now());
    insert into engagement_activities (user_id, activity_date, activity_type, reference_id, metadata, created_at)
    values (uid, dd, 'exercise_log', eid, '{}'::jsonb, (dd + ex.at_time + make_interval(mins => ex.mins + 3)) at time zone tz);
    update streak_claims
       set metadata = jsonb_set(metadata, '{health_data,has_exercise_log}', 'true'::jsonb)
     where user_id = uid and claim_date = dd;
  end loop;

  -- 4. Streak summary rows, consistent with the 12 claims above.
  update engagement_streaks
     set current_streak = span, longest_streak = span, total_claims = span,
         last_claim_date = t, last_engagement_date = t,
         paused = false, pause_start_date = null, pause_end_date = null,
         shields_available = 1, shields_used = 0,
         grace_day_used_this_week = false,
         grace_day_week_start = date_trunc('week', t::timestamp)::date
   where user_id = uid;
  -- One shield, earned at the 7-day mark of this run.
  update streak_shields set available_count = 0 where user_id = uid and shield_type <> 'milestone_shield';
  update streak_shields
     set available_count = 1,
         metadata = jsonb_build_object(
           'paid_boundaries', jsonb_build_array('7:' || (t - (span - 7))::text),
           'celebrated_milestone_days', jsonb_build_array((t - (span - 3))::text, (t - (span - 7))::text),
           'last_award_at', to_char(((t - (span - 7)) + time '07:45') at time zone tz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".000Z"'))
   where user_id = uid and shield_type = 'milestone_shield';

  -- 5. Profile: matches the latest weigh-in and the streak.
  update profiles
     set weight_kg = weights[1], current_streak = span, longest_streak = span,
         timezone = tz, last_active_at = now()
   where id = uid;

  -- 6. Demo circle: keep it running and keep the chat recent.
  update fitcircles
     set end_date = greatest(end_date, (t + 60)::timestamptz), name = 'Step-Up Circle'
   where id = circle;
  update circle_messages set deleted_at = now()
   where fitcircle_id = circle and deleted_at is null and body = 'api probe (ignore)';
  select (t - 1) - max((created_at at time zone tz)::date) into shift_days
    from circle_messages where fitcircle_id = circle and deleted_at is null;
  if shift_days is not null and shift_days > 0 then
    update circle_messages
       set created_at = created_at + make_interval(days => shift_days)
     where fitcircle_id = circle;
  end if;
  update circle_chat_state set last_read_at = now() where user_id = uid;

  raise notice 'demo account rebuilt for % (chat shifted % days)', t, coalesce(shift_days, 0);
end $$;

select jsonb_build_object(
  'today_pt', (now() at time zone 'America/Los_Angeles')::date,
  'food', (select jsonb_build_object('n', count(*), 'min', min(entry_date), 'max', max(entry_date), 'future', count(*) filter (where logged_at > now())) from food_log_entries where user_id = '47476150-a984-4431-a89a-7cc8085adfe6'),
  'today_food', (select jsonb_agg(jsonb_build_object('t', to_char(logged_at at time zone 'America/Los_Angeles', 'HH24:MI'), 'x', coalesce(title, 'water ' || water_ml)) order by logged_at) from food_log_entries where user_id = '47476150-a984-4431-a89a-7cc8085adfe6' and entry_date = (now() at time zone 'America/Los_Angeles')::date),
  'tracking', (select jsonb_build_object('n', count(*), 'min', min(tracking_date), 'max', max(tracking_date), 'w_min', min(weight_kg), 'w_max', max(weight_kg)) from daily_tracking where user_id = '47476150-a984-4431-a89a-7cc8085adfe6'),
  'exercise', (select jsonb_build_object('n', count(*), 'min', min(exercise_date), 'max', max(exercise_date)) from exercise_logs where user_id = '47476150-a984-4431-a89a-7cc8085adfe6'),
  'claims', (select jsonb_build_object('n', count(*), 'min', min(claim_date), 'max', max(claim_date)) from streak_claims where user_id = '47476150-a984-4431-a89a-7cc8085adfe6'),
  'streak', (select jsonb_build_object('cur', current_streak, 'long', longest_streak, 'last', last_claim_date, 'shields', shields_available) from engagement_streaks where user_id = '47476150-a984-4431-a89a-7cc8085adfe6'),
  'chat', (select jsonb_build_object('n', count(*) filter (where deleted_at is null), 'max', max(created_at) filter (where deleted_at is null)) from circle_messages where fitcircle_id = 'dc69b1b5-9fb6-4f50-8f5f-0f1776af82be'),
  'circle', (select jsonb_build_object('name', name, 'end', end_date) from fitcircles where id = 'dc69b1b5-9fb6-4f50-8f5f-0f1776af82be')
) as v;
