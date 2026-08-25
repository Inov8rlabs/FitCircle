-- Stored procedures for complex operations

-- Function to increment participant count
CREATE OR REPLACE FUNCTION increment_participant_count(challenge_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE challenges
    SET participant_count = participant_count + 1,
        updated_at = NOW()
    WHERE id = challenge_id;
END;
$$ LANGUAGE plpgsql;

-- Function to decrement participant count
CREATE OR REPLACE FUNCTION decrement_participant_count(challenge_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE challenges
    SET participant_count = GREATEST(participant_count - 1, 0),
        updated_at = NOW()
    WHERE id = challenge_id;
END;
$$ LANGUAGE plpgsql;

-- Function to increment team member count
CREATE OR REPLACE FUNCTION increment_team_member_count(team_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE teams
    SET member_count = member_count + 1,
        updated_at = NOW()
    WHERE id = team_id;
END;
$$ LANGUAGE plpgsql;

-- Function to decrement team member count
CREATE OR REPLACE FUNCTION decrement_team_member_count(team_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE teams
    SET member_count = GREATEST(member_count - 1, 0),
        updated_at = NOW()
    WHERE id = team_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update participant stats after check-in
CREATE OR REPLACE FUNCTION update_participant_stats(
    participant_id UUID,
    check_in_date DATE
)
RETURNS void AS $$
DECLARE
    v_user_id UUID;
    v_challenge_id UUID;
    v_streak INTEGER;
    v_last_check_in DATE;
    v_total_check_ins INTEGER;
    v_current_weight DECIMAL(5,2);
    v_starting_weight DECIMAL(5,2);
    v_goal_weight DECIMAL(5,2);
    v_progress DECIMAL(5,2);
BEGIN
    -- Get participant details
    SELECT user_id, challenge_id, last_check_in_at::DATE, streak_days, check_ins_count,
           starting_weight_kg, goal_weight_kg
    INTO v_user_id, v_challenge_id, v_last_check_in, v_streak, v_total_check_ins,
         v_starting_weight, v_goal_weight
    FROM challenge_participants
    WHERE id = participant_id;

    -- Calculate new streak
    IF v_last_check_in IS NULL OR check_in_date - v_last_check_in = 1 THEN
        v_streak := COALESCE(v_streak, 0) + 1;
    ELSIF check_in_date - v_last_check_in > 1 THEN
        v_streak := 1;
    END IF;

    -- Get latest weight
    SELECT weight_kg INTO v_current_weight
    FROM check_ins
    WHERE participant_id = participant_id
    ORDER BY check_in_date DESC
    LIMIT 1;

    -- Calculate progress percentage for weight loss challenges
    IF v_starting_weight IS NOT NULL AND v_goal_weight IS NOT NULL AND v_current_weight IS NOT NULL THEN
        IF v_starting_weight > v_goal_weight THEN
            -- Weight loss
            v_progress := ((v_starting_weight - v_current_weight) / (v_starting_weight - v_goal_weight)) * 100;
        ELSE
            -- Weight gain
            v_progress := ((v_current_weight - v_starting_weight) / (v_goal_weight - v_starting_weight)) * 100;
        END IF;
        v_progress := LEAST(GREATEST(v_progress, 0), 100);
    END IF;

    -- Update participant stats
    UPDATE challenge_participants
    SET check_ins_count = check_ins_count + 1,
        streak_days = v_streak,
        last_check_in_at = check_in_date,
        current_weight_kg = v_current_weight,
        progress_percentage = COALESCE(v_progress, progress_percentage),
        updated_at = NOW()
    WHERE id = participant_id;

    -- Update challenge total check-ins
    UPDATE challenges
    SET total_check_ins = total_check_ins + 1,
        updated_at = NOW()
    WHERE id = v_challenge_id;

    -- Update user profile streak
    UPDATE profiles
    SET current_streak = v_streak,
        longest_streak = GREATEST(longest_streak, v_streak),
        last_active_at = NOW(),
        updated_at = NOW()
    WHERE id = v_user_id;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate and update leaderboard
CREATE OR REPLACE FUNCTION update_leaderboard(challenge_id UUID)
RETURNS void AS $$
BEGIN
    -- Delete existing leaderboard entries for this challenge
    DELETE FROM leaderboard WHERE challenge_id = challenge_id;

    -- Insert individual leaderboard
    INSERT INTO leaderboard (
        challenge_id, entity_id, entity_type, rank, points,
        progress_percentage, check_ins_count, streak_days,
        last_check_in_at, calculated_at
    )
    SELECT
        cp.challenge_id,
        cp.user_id,
        'individual',
        RANK() OVER (ORDER BY cp.total_points DESC, cp.progress_percentage DESC),
        cp.total_points,
        cp.progress_percentage,
        cp.check_ins_count,
        cp.streak_days,
        cp.last_check_in_at,
        NOW()
    FROM challenge_participants cp
    WHERE cp.challenge_id = challenge_id
      AND cp.status = 'active';

    -- Insert team leaderboard
    INSERT INTO leaderboard (
        challenge_id, entity_id, entity_type, rank, points,
        check_ins_count, calculated_at
    )
    SELECT
        t.challenge_id,
        t.id,
        'team',
        RANK() OVER (ORDER BY t.total_points DESC),
        t.total_points,
        SUM(tm.check_ins_count),
        NOW()
    FROM teams t
    LEFT JOIN team_members tm ON tm.team_id = t.id
    WHERE t.challenge_id = challenge_id
    GROUP BY t.id;

    -- Update team ranks
    UPDATE teams t
    SET rank = l.rank
    FROM leaderboard l
    WHERE l.entity_id = t.id
      AND l.entity_type = 'team'
      AND l.challenge_id = challenge_id;

    -- Update participant ranks
    UPDATE challenge_participants cp
    SET rank = l.rank
    FROM leaderboard l
    WHERE l.entity_id = cp.user_id
      AND l.entity_type = 'individual'
      AND l.challenge_id = challenge_id;
END;
$$ LANGUAGE plpgsql;

-- Function to process daily challenge status updates
CREATE OR REPLACE FUNCTION process_challenge_status_updates()
RETURNS void AS $$
BEGIN
    -- Update challenges from 'upcoming' to 'active'
    UPDATE challenges
    SET status = 'active',
        updated_at = NOW()
    WHERE status = 'upcoming'
      AND start_date <= NOW();

    -- Update challenges from 'active' to 'completed'
    UPDATE challenges
    SET status = 'completed',
        updated_at = NOW()
    WHERE status = 'active'
      AND end_date < NOW();

    -- Calculate completion rates for completed challenges
    UPDATE challenges c
    SET completion_rate = (
        SELECT COUNT(*) FILTER (WHERE cp.status = 'completed') * 100.0 / NULLIF(COUNT(*), 0)
        FROM challenge_participants cp
        WHERE cp.challenge_id = c.id
    ),
    avg_progress = (
        SELECT AVG(cp.progress_percentage)
        FROM challenge_participants cp
        WHERE cp.challenge_id = c.id
    ),
    updated_at = NOW()
    WHERE c.status = 'completed'
      AND c.completion_rate IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate team points
CREATE OR REPLACE FUNCTION calculate_team_points(team_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_total_points INTEGER;
BEGIN
    SELECT SUM(tm.points_contributed)
    INTO v_total_points
    FROM team_members tm
    WHERE tm.team_id = team_id
      AND tm.is_active = true;

    RETURN COALESCE(v_total_points, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to award achievement
CREATE OR REPLACE FUNCTION award_achievement(
    p_user_id UUID,
    p_challenge_id UUID,
    p_type achievement_type,
    p_name TEXT,
    p_description TEXT,
    p_points INTEGER DEFAULT 0
)
RETURNS UUID AS $$
DECLARE
    v_achievement_id UUID;
BEGIN
    -- Check if achievement already exists
    SELECT id INTO v_achievement_id
    FROM achievements
    WHERE user_id = p_user_id
      AND challenge_id = p_challenge_id
      AND type = p_type
      AND name = p_name;

    IF v_achievement_id IS NULL THEN
        -- Create new achievement
        INSERT INTO achievements (
            user_id, challenge_id, type, name, description,
            points, unlocked_at
        ) VALUES (
            p_user_id, p_challenge_id, p_type, p_name, p_description,
            p_points, NOW()
        )
        RETURNING id INTO v_achievement_id;

        -- Update user points
        UPDATE profiles
        SET total_points = total_points + p_points,
            updated_at = NOW()
        WHERE id = p_user_id;

        -- Create notification
        INSERT INTO notifications (
            user_id, type, channel, title, body,
            related_challenge_id, priority
        ) VALUES (
            p_user_id, 'achievement', 'in_app',
            'Achievement Unlocked!',
            'You earned: ' || p_name,
            p_challenge_id, 'high'
        );
    END IF;

    RETURN v_achievement_id;
END;
$$ LANGUAGE plpgsql;

-- Function to process streak achievements
CREATE OR REPLACE FUNCTION process_streak_achievements()
RETURNS void AS $$
DECLARE
    r RECORD;
BEGIN
    -- Award 7-day streak achievement
    FOR r IN
        SELECT DISTINCT cp.user_id, cp.challenge_id
        FROM challenge_participants cp
        WHERE cp.streak_days = 7
          AND NOT EXISTS (
              SELECT 1 FROM achievements a
              WHERE a.user_id = cp.user_id
                AND a.challenge_id = cp.challenge_id
                AND a.name = '7-Day Streak'
          )
    LOOP
        PERFORM award_achievement(
            r.user_id, r.challenge_id, 'streak'::achievement_type,
            '7-Day Streak', 'Completed check-ins for 7 consecutive days', 50
        );
    END LOOP;

    -- Award 30-day streak achievement
    FOR r IN
        SELECT DISTINCT cp.user_id, cp.challenge_id
        FROM challenge_participants cp
        WHERE cp.streak_days = 30
          AND NOT EXISTS (
              SELECT 1 FROM achievements a
              WHERE a.user_id = cp.user_id
                AND a.challenge_id = cp.challenge_id
                AND a.name = '30-Day Streak'
          )
    LOOP
        PERFORM award_achievement(
            r.user_id, r.challenge_id, 'streak'::achievement_type,
            '30-Day Streak', 'Completed check-ins for 30 consecutive days', 200
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create scheduled job (cron) for daily processing
-- This would be set up in Supabase dashboard or via pg_cron extension
-- Example:
-- SELECT cron.schedule('process-challenges', '0 0 * * *', 'SELECT process_challenge_status_updates()');
-- SELECT cron.schedule('process-achievements', '0 1 * * *', 'SELECT process_streak_achievements()');
-- SELECT cron.schedule('update-leaderboards', '*/15 * * * *', 'SELECT update_leaderboard(id) FROM challenges WHERE status = ''active''');