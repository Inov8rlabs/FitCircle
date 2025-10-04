-- Seed data for FitCircle development and testing
-- This creates sample users, challenges, teams, and activity

-- Note: These users should be created in Supabase Auth first
-- The IDs below are placeholders and should match actual auth.users records

-- Sample profiles (assuming these users exist in auth.users)
INSERT INTO profiles (
    id, username, display_name, email, avatar_url, bio,
    height_cm, weight_kg, timezone, country_code, fitness_level,
    goals, onboarding_completed, subscription_tier
) VALUES
    ('11111111-1111-1111-1111-111111111111', 'john_doe', 'John Doe', 'john@example.com',
     'https://api.dicebear.com/7.x/avataaars/svg?seed=john', 'Fitness enthusiast and marathon runner',
     180, 85.5, 'America/New_York', 'US', 'advanced',
     '["weight_loss", "muscle_gain", "endurance"]'::jsonb, true, 'premium'),

    ('22222222-2222-2222-2222-222222222222', 'jane_smith', 'Jane Smith', 'jane@example.com',
     'https://api.dicebear.com/7.x/avataaars/svg?seed=jane', 'Yoga instructor and wellness coach',
     165, 62.0, 'America/Los_Angeles', 'US', 'expert',
     '["flexibility", "strength", "mindfulness"]'::jsonb, true, 'premium'),

    ('33333333-3333-3333-3333-333333333333', 'mike_wilson', 'Mike Wilson', 'mike@example.com',
     'https://api.dicebear.com/7.x/avataaars/svg?seed=mike', 'Getting back into shape!',
     175, 95.0, 'America/Chicago', 'US', 'beginner',
     '["weight_loss", "general_fitness"]'::jsonb, true, 'free'),

    ('44444444-4444-4444-4444-444444444444', 'sarah_jones', 'Sarah Jones', 'sarah@example.com',
     'https://api.dicebear.com/7.x/avataaars/svg?seed=sarah', 'CrossFit athlete',
     170, 68.0, 'Europe/London', 'GB', 'advanced',
     '["strength", "performance", "competition"]'::jsonb, true, 'premium'),

    ('55555555-5555-5555-5555-555555555555', 'alex_chen', 'Alex Chen', 'alex@example.com',
     'https://api.dicebear.com/7.x/avataaars/svg?seed=alex', 'Tech worker trying to stay active',
     172, 78.0, 'America/Seattle', 'US', 'intermediate',
     '["weight_loss", "stress_reduction"]'::jsonb, true, 'free');

-- Sample challenges
INSERT INTO challenges (
    id, creator_id, name, description, type, status, visibility,
    rules, scoring_system, start_date, end_date, registration_deadline,
    entry_fee, min_participants, max_participants, min_team_size, max_team_size,
    allow_late_join, tags, is_featured
) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '11111111-1111-1111-1111-111111111111',
     'Summer Shred Challenge',
     'Get ready for summer with this 30-day weight loss challenge! Focus on healthy habits, consistent check-ins, and supportive community.',
     'weight_loss', 'active', 'public',
     '{
       "check_in_frequency": "daily",
       "required_metrics": ["weight", "photos"],
       "min_weight_loss": 0,
       "max_weight_loss": 10,
       "rules": [
         "Daily weigh-ins required",
         "Weekly progress photos",
         "No crash dieting",
         "Support your teammates"
       ]
     }'::jsonb,
     '{
       "check_in": 10,
       "streak_bonus": 2,
       "photo_bonus": 5,
       "milestone_5kg": 100,
       "milestone_10kg": 250,
       "team_bonus_multiplier": 1.2
     }'::jsonb,
     NOW() - INTERVAL '5 days',
     NOW() + INTERVAL '25 days',
     NOW() - INTERVAL '7 days',
     10.00, 5, 100, 1, 5, true,
     ARRAY['weight-loss', 'summer', 'transformation', 'community'],
     true),

    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
     '22222222-2222-2222-2222-222222222222',
     '10K Steps Daily',
     'Walk your way to better health! Commit to 10,000 steps every day for the next 4 weeks.',
     'step_count', 'active', 'public',
     '{
       "daily_goal": 10000,
       "weekly_goal": 70000,
       "rules": [
         "Minimum 10,000 steps per day",
         "Steps must be synced from fitness tracker",
         "Manual entries require photo proof"
       ]
     }'::jsonb,
     '{
       "daily_goal_met": 15,
       "weekly_goal_met": 50,
       "perfect_week": 100,
       "streak_bonus": 3
     }'::jsonb,
     NOW() - INTERVAL '3 days',
     NOW() + INTERVAL '25 days',
     NOW() - INTERVAL '5 days',
     0.00, 2, NULL, 1, 1, true,
     ARRAY['steps', 'walking', 'cardio', 'daily-goal'],
     false),

    ('cccccccc-cccc-cccc-cccc-cccccccccccc',
     '44444444-4444-4444-4444-444444444444',
     'CrossFit Open Prep',
     'Prepare for the CrossFit Open with daily WODs and nutrition tracking',
     'workout_minutes', 'upcoming', 'private',
     '{
       "min_minutes_per_day": 45,
       "workout_types": ["strength", "metcon", "skill"],
       "rules": [
         "Log all workouts with details",
         "Track nutrition macros",
         "Post workout videos weekly"
       ]
     }'::jsonb,
     '{
       "workout_completed": 20,
       "nutrition_logged": 10,
       "video_posted": 25,
       "pr_achieved": 50
     }'::jsonb,
     NOW() + INTERVAL '7 days',
     NOW() + INTERVAL '37 days',
     NOW() + INTERVAL '5 days',
     25.00, 10, 50, 1, 3, false,
     ARRAY['crossfit', 'competition', 'strength', 'conditioning'],
     true);

-- Sample teams for active challenges
INSERT INTO teams (
    id, challenge_id, name, motto, avatar_url,
    is_public, max_members
) VALUES
    ('11111111-aaaa-aaaa-aaaa-111111111111',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'The Transformers',
     'Transform your body, transform your life!',
     'https://api.dicebear.com/7.x/shapes/svg?seed=transformers',
     true, 5),

    ('22222222-aaaa-aaaa-aaaa-222222222222',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'Sweat Squad',
     'Sweat together, succeed together',
     'https://api.dicebear.com/7.x/shapes/svg?seed=sweat',
     true, 5),

    ('33333333-bbbb-bbbb-bbbb-333333333333',
     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
     'Step Masters',
     'Every step counts!',
     'https://api.dicebear.com/7.x/shapes/svg?seed=steps',
     true, 10);

-- Sample team members
INSERT INTO team_members (
    team_id, user_id, role, joined_at
) VALUES
    ('11111111-aaaa-aaaa-aaaa-111111111111', '11111111-1111-1111-1111-111111111111', 'captain', NOW() - INTERVAL '5 days'),
    ('11111111-aaaa-aaaa-aaaa-111111111111', '33333333-3333-3333-3333-333333333333', 'member', NOW() - INTERVAL '4 days'),
    ('22222222-aaaa-aaaa-aaaa-222222222222', '22222222-2222-2222-2222-222222222222', 'captain', NOW() - INTERVAL '5 days'),
    ('22222222-aaaa-aaaa-aaaa-222222222222', '44444444-4444-4444-4444-444444444444', 'member', NOW() - INTERVAL '3 days'),
    ('33333333-bbbb-bbbb-bbbb-333333333333', '55555555-5555-5555-5555-555555555555', 'captain', NOW() - INTERVAL '3 days');

-- Sample challenge participants
INSERT INTO challenge_participants (
    challenge_id, user_id, team_id, status, joined_at,
    starting_weight_kg, current_weight_kg, goal_weight_kg,
    total_points, check_ins_count, streak_days
) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
     '11111111-aaaa-aaaa-aaaa-111111111111', 'active', NOW() - INTERVAL '5 days',
     85.5, 84.2, 80.0, 150, 5, 5),

    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222',
     '22222222-aaaa-aaaa-aaaa-222222222222', 'active', NOW() - INTERVAL '5 days',
     62.0, 61.5, 58.0, 140, 5, 5),

    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333',
     '11111111-aaaa-aaaa-aaaa-111111111111', 'active', NOW() - INTERVAL '4 days',
     95.0, 93.8, 85.0, 120, 4, 4),

    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444',
     '22222222-aaaa-aaaa-aaaa-222222222222', 'active', NOW() - INTERVAL '3 days',
     68.0, 67.5, 63.0, 90, 3, 3),

    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55555555-5555-5555-5555-555555555555',
     '33333333-bbbb-bbbb-bbbb-333333333333', 'active', NOW() - INTERVAL '3 days',
     78.0, 78.0, 75.0, 75, 3, 3);

-- Sample check-ins
INSERT INTO check_ins (
    user_id, challenge_id, participant_id, team_id, check_in_date,
    weight_kg, steps, active_minutes, mood_score, energy_level,
    notes, points_earned
)
SELECT
    cp.user_id,
    cp.challenge_id,
    cp.id,
    cp.team_id,
    CURRENT_DATE - (s.day_offset || ' days')::interval,
    cp.starting_weight_kg - (0.2 * s.day_offset * random()),
    8000 + floor(random() * 7000)::integer,
    30 + floor(random() * 60)::integer,
    5 + floor(random() * 5)::integer,
    5 + floor(random() * 5)::integer,
    CASE floor(random() * 4)::integer
        WHEN 0 THEN 'Feeling great today!'
        WHEN 1 THEN 'Good workout, pushed hard'
        WHEN 2 THEN 'Steady progress'
        ELSE 'Keeping consistent'
    END,
    15 + floor(random() * 10)::integer
FROM challenge_participants cp
CROSS JOIN generate_series(0, cp.check_ins_count - 1) AS s(day_offset)
WHERE cp.status = 'active';

-- Sample achievements
INSERT INTO achievements (
    user_id, challenge_id, type, name, description,
    points, level, criteria
)
SELECT
    cp.user_id,
    cp.challenge_id,
    'streak',
    'Consistency Champion',
    'Maintained a ' || cp.streak_days || '-day streak!',
    50,
    1,
    jsonb_build_object('streak_days', cp.streak_days)
FROM challenge_participants cp
WHERE cp.streak_days >= 3;

-- Sample comments on check-ins
INSERT INTO comments (
    user_id, entity_type, entity_id, content
)
SELECT
    CASE floor(random() * 2)::integer
        WHEN 0 THEN '11111111-1111-1111-1111-111111111111'::uuid
        ELSE '22222222-2222-2222-2222-222222222222'::uuid
    END,
    'check_in',
    ci.id,
    CASE floor(random() * 5)::integer
        WHEN 0 THEN 'Great job! Keep it up!'
        WHEN 1 THEN 'You''re crushing it!'
        WHEN 2 THEN 'Inspiring progress!'
        WHEN 3 THEN 'Love the consistency!'
        ELSE 'Way to go team!'
    END
FROM check_ins ci
TABLESAMPLE SYSTEM (30);

-- Sample reactions on check-ins
INSERT INTO reactions (
    user_id, entity_type, entity_id, type
)
SELECT DISTINCT ON (ci.id, u.id)
    u.id,
    'check_in',
    ci.id,
    CASE floor(random() * 6)::integer
        WHEN 0 THEN 'like'
        WHEN 1 THEN 'love'
        WHEN 2 THEN 'celebrate'
        WHEN 3 THEN 'fire'
        WHEN 4 THEN 'muscle'
        ELSE 'trophy'
    END::reaction_type
FROM check_ins ci
CROSS JOIN profiles u
TABLESAMPLE SYSTEM (20)
WHERE random() < 0.3;

-- Update leaderboard
SELECT update_leaderboard_rankings('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT update_leaderboard_rankings('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- Sample notifications
INSERT INTO notifications (
    user_id, type, channel, title, body,
    related_challenge_id, priority
)
SELECT
    cp.user_id,
    'check_in_reminder',
    'in_app',
    'Time for your daily check-in!',
    'Don''t forget to log your progress for ' || c.name,
    c.id,
    'normal'
FROM challenge_participants cp
JOIN challenges c ON c.id = cp.challenge_id
WHERE cp.last_check_in_at < NOW() - INTERVAL '1 day'
AND c.status = 'active';

-- Update challenge statistics
UPDATE challenges c
SET
    avg_progress = (
        SELECT AVG(progress_percentage)
        FROM challenge_participants
        WHERE challenge_id = c.id
    ),
    completion_rate = (
        SELECT COUNT(*) FILTER (WHERE check_ins_count > 0) * 100.0 / NULLIF(COUNT(*), 0)
        FROM challenge_participants
        WHERE challenge_id = c.id
    ),
    engagement_score = (
        SELECT AVG(check_ins_count) * 10
        FROM challenge_participants
        WHERE challenge_id = c.id
    )
WHERE c.status = 'active';

-- Update team statistics
UPDATE teams t
SET
    total_points = (
        SELECT COALESCE(SUM(points_contributed), 0)
        FROM team_members
        WHERE team_id = t.id AND is_active = true
    ),
    member_count = (
        SELECT COUNT(*)
        FROM team_members
        WHERE team_id = t.id AND is_active = true
    );

-- Create some sample payments
INSERT INTO payments (
    user_id, challenge_id, amount, currency, status, type,
    payment_method, description, processed_at
) VALUES
    ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     10.00, 'USD', 'succeeded', 'entry_fee',
     'card', 'Entry fee for Summer Shred Challenge', NOW() - INTERVAL '5 days'),

    ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     10.00, 'USD', 'succeeded', 'entry_fee',
     'card', 'Entry fee for Summer Shred Challenge', NOW() - INTERVAL '5 days'),

    ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     10.00, 'USD', 'succeeded', 'entry_fee',
     'card', 'Entry fee for Summer Shred Challenge', NOW() - INTERVAL '4 days'),

    ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     10.00, 'USD', 'succeeded', 'entry_fee',
     'card', 'Entry fee for Summer Shred Challenge', NOW() - INTERVAL '3 days');

-- Update profiles with activity timestamps
UPDATE profiles
SET
    last_active_at = NOW() - (random() * INTERVAL '12 hours'),
    challenges_completed = floor(random() * 5)::integer,
    challenges_won = floor(random() * 2)::integer,
    total_points = floor(random() * 1000)::integer,
    current_streak = floor(random() * 10)::integer,
    longest_streak = floor(random() * 30)::integer;