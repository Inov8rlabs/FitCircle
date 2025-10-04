-- Function to calculate user progress in a challenge
CREATE OR REPLACE FUNCTION calculate_user_progress(
    p_user_id UUID,
    p_challenge_id UUID
)
RETURNS TABLE (
    progress_percentage DECIMAL(5,2),
    weight_lost_kg DECIMAL(5,2),
    weight_lost_percentage DECIMAL(5,2),
    total_steps INTEGER,
    total_minutes INTEGER,
    streak_days INTEGER,
    points INTEGER
) AS $$
DECLARE
    v_challenge_type challenge_type;
    v_start_value DECIMAL(10,2);
    v_current_value DECIMAL(10,2);
    v_goal_value DECIMAL(10,2);
    v_progress DECIMAL(5,2) := 0;
    v_weight_lost DECIMAL(5,2) := 0;
    v_weight_lost_pct DECIMAL(5,2) := 0;
    v_steps INTEGER := 0;
    v_minutes INTEGER := 0;
    v_streak INTEGER := 0;
    v_points INTEGER := 0;
BEGIN
    -- Get challenge type
    SELECT type INTO v_challenge_type
    FROM challenges
    WHERE id = p_challenge_id;

    -- Get participant data
    SELECT
        starting_value,
        current_value,
        goal_value,
        streak_days,
        total_points
    INTO
        v_start_value,
        v_current_value,
        v_goal_value,
        v_streak,
        v_points
    FROM challenge_participants
    WHERE user_id = p_user_id AND challenge_id = p_challenge_id;

    -- Calculate progress based on challenge type
    CASE v_challenge_type
        WHEN 'weight_loss' THEN
            -- Get weight data
            SELECT
                COALESCE(cp.starting_weight_kg, 0),
                COALESCE((
                    SELECT weight_kg FROM check_ins
                    WHERE user_id = p_user_id
                    AND challenge_id = p_challenge_id
                    AND weight_kg IS NOT NULL
                    ORDER BY check_in_date DESC
                    LIMIT 1
                ), cp.starting_weight_kg)
            INTO v_start_value, v_current_value
            FROM challenge_participants cp
            WHERE cp.user_id = p_user_id AND cp.challenge_id = p_challenge_id;

            v_weight_lost := v_start_value - v_current_value;
            v_weight_lost_pct := CASE
                WHEN v_start_value > 0 THEN (v_weight_lost / v_start_value) * 100
                ELSE 0
            END;

            -- Calculate progress towards goal
            IF v_goal_value IS NOT NULL AND v_start_value > v_goal_value THEN
                v_progress := LEAST(100, ((v_start_value - v_current_value) / (v_start_value - v_goal_value)) * 100);
            END IF;

        WHEN 'step_count' THEN
            -- Sum total steps
            SELECT COALESCE(SUM(steps), 0)
            INTO v_steps
            FROM check_ins
            WHERE user_id = p_user_id
            AND challenge_id = p_challenge_id
            AND steps IS NOT NULL;

            v_current_value := v_steps;

            -- Calculate progress towards goal
            IF v_goal_value > 0 THEN
                v_progress := LEAST(100, (v_current_value / v_goal_value) * 100);
            END IF;

        WHEN 'workout_minutes' THEN
            -- Sum total active minutes
            SELECT COALESCE(SUM(active_minutes), 0)
            INTO v_minutes
            FROM check_ins
            WHERE user_id = p_user_id
            AND challenge_id = p_challenge_id
            AND active_minutes IS NOT NULL;

            v_current_value := v_minutes;

            -- Calculate progress towards goal
            IF v_goal_value > 0 THEN
                v_progress := LEAST(100, (v_current_value / v_goal_value) * 100);
            END IF;

        ELSE
            -- Custom challenge type - use generic progress
            IF v_goal_value > 0 AND v_start_value IS NOT NULL THEN
                v_progress := LEAST(100, ABS((v_current_value - v_start_value) / (v_goal_value - v_start_value)) * 100);
            END IF;
    END CASE;

    RETURN QUERY SELECT
        COALESCE(v_progress, 0),
        COALESCE(v_weight_lost, 0),
        COALESCE(v_weight_lost_pct, 0),
        COALESCE(v_steps, 0),
        COALESCE(v_minutes, 0),
        COALESCE(v_streak, 0),
        COALESCE(v_points, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate team statistics
CREATE OR REPLACE FUNCTION calculate_team_stats(p_team_id UUID)
RETURNS TABLE (
    total_points INTEGER,
    member_count INTEGER,
    avg_progress DECIMAL(5,2),
    total_weight_lost DECIMAL(5,2),
    total_steps INTEGER,
    total_minutes INTEGER,
    avg_streak DECIMAL(5,2)
) AS $$
BEGIN
    RETURN QUERY
    WITH team_data AS (
        SELECT
            tm.user_id,
            cp.total_points,
            cp.progress_percentage,
            cp.starting_weight_kg,
            cp.current_weight_kg,
            cp.streak_days
        FROM team_members tm
        JOIN challenge_participants cp ON cp.user_id = tm.user_id
        WHERE tm.team_id = p_team_id
        AND tm.is_active = true
        AND cp.status = 'active'
    ),
    check_in_data AS (
        SELECT
            SUM(ci.steps) as total_steps,
            SUM(ci.active_minutes) as total_minutes
        FROM check_ins ci
        JOIN team_members tm ON tm.user_id = ci.user_id
        WHERE tm.team_id = p_team_id
        AND tm.is_active = true
    )
    SELECT
        COALESCE(SUM(td.total_points), 0)::INTEGER,
        COALESCE(COUNT(DISTINCT td.user_id), 0)::INTEGER,
        COALESCE(AVG(td.progress_percentage), 0)::DECIMAL(5,2),
        COALESCE(SUM(td.starting_weight_kg - td.current_weight_kg), 0)::DECIMAL(5,2),
        COALESCE(cd.total_steps, 0)::INTEGER,
        COALESCE(cd.total_minutes, 0)::INTEGER,
        COALESCE(AVG(td.streak_days), 0)::DECIMAL(5,2)
    FROM team_data td
    CROSS JOIN check_in_data cd;
END;
$$ LANGUAGE plpgsql;

-- Function to update leaderboard rankings
CREATE OR REPLACE FUNCTION update_leaderboard_rankings(p_challenge_id UUID)
RETURNS VOID AS $$
BEGIN
    -- Delete existing leaderboard entries for this challenge
    DELETE FROM leaderboard WHERE challenge_id = p_challenge_id;

    -- Insert individual rankings
    INSERT INTO leaderboard (
        challenge_id,
        entity_id,
        entity_type,
        rank,
        points,
        progress_percentage,
        weight_lost_kg,
        weight_lost_percentage,
        total_steps,
        total_minutes,
        check_ins_count,
        streak_days,
        last_check_in_at,
        trend,
        stats
    )
    SELECT
        cp.challenge_id,
        cp.user_id,
        'individual',
        ROW_NUMBER() OVER (ORDER BY cp.total_points DESC, cp.progress_percentage DESC),
        cp.total_points,
        cp.progress_percentage,
        CASE WHEN c.type = 'weight_loss'
            THEN cp.starting_weight_kg - cp.current_weight_kg
            ELSE NULL
        END,
        CASE WHEN c.type = 'weight_loss' AND cp.starting_weight_kg > 0
            THEN ((cp.starting_weight_kg - cp.current_weight_kg) / cp.starting_weight_kg) * 100
            ELSE NULL
        END,
        (SELECT COALESCE(SUM(steps), 0) FROM check_ins WHERE participant_id = cp.id),
        (SELECT COALESCE(SUM(active_minutes), 0) FROM check_ins WHERE participant_id = cp.id),
        cp.check_ins_count,
        cp.streak_days,
        cp.last_check_in_at,
        CASE
            WHEN cp.total_points > COALESCE(l_prev.points, 0) THEN 'up'
            WHEN cp.total_points < COALESCE(l_prev.points, 0) THEN 'down'
            ELSE 'stable'
        END,
        jsonb_build_object(
            'avg_daily_steps', (SELECT AVG(steps) FROM check_ins WHERE participant_id = cp.id AND steps IS NOT NULL),
            'avg_daily_minutes', (SELECT AVG(active_minutes) FROM check_ins WHERE participant_id = cp.id AND active_minutes IS NOT NULL),
            'best_streak', cp.longest_streak,
            'completion_rate', CASE WHEN cp.check_ins_count > 0 THEN (cp.check_ins_count::DECIMAL / GREATEST(1, DATE_PART('day', NOW() - cp.joined_at))) * 100 ELSE 0 END
        )
    FROM challenge_participants cp
    JOIN challenges c ON c.id = cp.challenge_id
    LEFT JOIN leaderboard l_prev ON l_prev.entity_id = cp.user_id
        AND l_prev.entity_type = 'individual'
        AND l_prev.challenge_id = cp.challenge_id
    WHERE cp.challenge_id = p_challenge_id
    AND cp.status = 'active';

    -- Insert team rankings if applicable
    INSERT INTO leaderboard (
        challenge_id,
        entity_id,
        entity_type,
        rank,
        points,
        progress_percentage,
        weight_lost_kg,
        total_steps,
        total_minutes,
        check_ins_count,
        streak_days,
        trend,
        stats
    )
    SELECT
        t.challenge_id,
        t.id,
        'team',
        ROW_NUMBER() OVER (ORDER BY t.total_points DESC),
        t.total_points,
        (SELECT AVG(cp.progress_percentage)
         FROM challenge_participants cp
         JOIN team_members tm ON tm.user_id = cp.user_id
         WHERE tm.team_id = t.id AND tm.is_active = true),
        (SELECT SUM(cp.starting_weight_kg - cp.current_weight_kg)
         FROM challenge_participants cp
         JOIN team_members tm ON tm.user_id = cp.user_id
         WHERE tm.team_id = t.id AND tm.is_active = true),
        (SELECT COALESCE(SUM(ci.steps), 0)
         FROM check_ins ci
         JOIN team_members tm ON tm.user_id = ci.user_id
         WHERE tm.team_id = t.id AND tm.is_active = true),
        (SELECT COALESCE(SUM(ci.active_minutes), 0)
         FROM check_ins ci
         JOIN team_members tm ON tm.user_id = ci.user_id
         WHERE tm.team_id = t.id AND tm.is_active = true),
        (SELECT SUM(cp.check_ins_count)
         FROM challenge_participants cp
         JOIN team_members tm ON tm.user_id = cp.user_id
         WHERE tm.team_id = t.id AND tm.is_active = true),
        (SELECT AVG(cp.streak_days)
         FROM challenge_participants cp
         JOIN team_members tm ON tm.user_id = cp.user_id
         WHERE tm.team_id = t.id AND tm.is_active = true),
        CASE
            WHEN t.total_points > COALESCE(l_prev.points, 0) THEN 'up'
            WHEN t.total_points < COALESCE(l_prev.points, 0) THEN 'down'
            ELSE 'stable'
        END,
        jsonb_build_object(
            'member_count', t.member_count,
            'avg_points_per_member', CASE WHEN t.member_count > 0 THEN t.total_points / t.member_count ELSE 0 END
        )
    FROM teams t
    LEFT JOIN leaderboard l_prev ON l_prev.entity_id = t.id
        AND l_prev.entity_type = 'team'
        AND l_prev.challenge_id = t.challenge_id
    WHERE t.challenge_id = p_challenge_id
    AND t.member_count > 0;

    -- Update ranks in participants and teams tables
    UPDATE challenge_participants cp
    SET rank = l.rank
    FROM leaderboard l
    WHERE l.entity_id = cp.user_id
    AND l.entity_type = 'individual'
    AND l.challenge_id = p_challenge_id
    AND cp.challenge_id = p_challenge_id;

    UPDATE teams t
    SET rank = l.rank
    FROM leaderboard l
    WHERE l.entity_id = t.id
    AND l.entity_type = 'team'
    AND l.challenge_id = p_challenge_id
    AND t.challenge_id = p_challenge_id;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate streak
CREATE OR REPLACE FUNCTION calculate_streak(
    p_user_id UUID,
    p_challenge_id UUID
)
RETURNS INTEGER AS $$
DECLARE
    v_streak INTEGER := 0;
    v_last_date DATE;
    v_current_date DATE;
    v_challenge_start DATE;
BEGIN
    -- Get challenge start date
    SELECT DATE(start_date) INTO v_challenge_start
    FROM challenges
    WHERE id = p_challenge_id;

    -- Calculate streak from most recent check-in backwards
    FOR v_current_date IN
        SELECT DISTINCT check_in_date
        FROM check_ins
        WHERE user_id = p_user_id
        AND challenge_id = p_challenge_id
        AND is_valid = true
        ORDER BY check_in_date DESC
    LOOP
        IF v_last_date IS NULL THEN
            -- First iteration
            v_last_date := v_current_date;
            v_streak := 1;
        ELSIF v_last_date - v_current_date = 1 THEN
            -- Consecutive day
            v_streak := v_streak + 1;
            v_last_date := v_current_date;
        ELSE
            -- Streak broken
            EXIT;
        END IF;
    END LOOP;

    -- Only count streak if last check-in was today or yesterday
    IF v_last_date IS NOT NULL AND (CURRENT_DATE - v_last_date) > 1 THEN
        v_streak := 0;
    END IF;

    RETURN v_streak;
END;
$$ LANGUAGE plpgsql;

-- Function to award points for check-in
CREATE OR REPLACE FUNCTION award_check_in_points(
    p_check_in_id UUID
)
RETURNS INTEGER AS $$
DECLARE
    v_points INTEGER := 0;
    v_base_points INTEGER := 10;
    v_streak_bonus INTEGER;
    v_photo_bonus INTEGER := 0;
    v_complete_bonus INTEGER := 0;
    v_user_id UUID;
    v_challenge_id UUID;
    v_streak INTEGER;
    v_check_in RECORD;
BEGIN
    -- Get check-in details
    SELECT * INTO v_check_in
    FROM check_ins
    WHERE id = p_check_in_id;

    v_user_id := v_check_in.user_id;
    v_challenge_id := v_check_in.challenge_id;

    -- Base points for check-in
    v_points := v_base_points;

    -- Streak bonus (2 points per day of streak, max 20)
    v_streak := calculate_streak(v_user_id, v_challenge_id);
    v_streak_bonus := LEAST(v_streak * 2, 20);
    v_points := v_points + v_streak_bonus;

    -- Photo bonus (5 points)
    IF array_length(v_check_in.photo_urls, 1) > 0 THEN
        v_photo_bonus := 5;
        v_points := v_points + v_photo_bonus;
    END IF;

    -- Complete data bonus (5 points if all key metrics provided)
    IF v_check_in.weight_kg IS NOT NULL
        AND v_check_in.steps IS NOT NULL
        AND v_check_in.active_minutes IS NOT NULL THEN
        v_complete_bonus := 5;
        v_points := v_points + v_complete_bonus;
    END IF;

    -- Update check-in with points
    UPDATE check_ins
    SET points_earned = v_points
    WHERE id = p_check_in_id;

    -- Update participant total points
    UPDATE challenge_participants
    SET
        total_points = total_points + v_points,
        streak_days = v_streak,
        check_ins_count = check_ins_count + 1,
        last_check_in_at = NOW()
    WHERE user_id = v_user_id AND challenge_id = v_challenge_id;

    -- Update team points if applicable
    UPDATE teams t
    SET total_points = total_points + v_points
    FROM team_members tm
    WHERE tm.team_id = t.id
    AND tm.user_id = v_user_id
    AND t.challenge_id = v_challenge_id
    AND tm.is_active = true;

    -- Update team member contribution
    UPDATE team_members tm
    SET
        points_contributed = points_contributed + v_points,
        check_ins_count = check_ins_count + 1,
        last_check_in_at = NOW()
    FROM teams t
    WHERE tm.team_id = t.id
    AND tm.user_id = v_user_id
    AND t.challenge_id = v_challenge_id
    AND tm.is_active = true;

    RETURN v_points;
END;
$$ LANGUAGE plpgsql;

-- Function to check and award achievements
CREATE OR REPLACE FUNCTION check_achievements(
    p_user_id UUID,
    p_challenge_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_participant RECORD;
    v_check_ins_count INTEGER;
    v_total_weight_lost DECIMAL(5,2);
    v_achievement_name TEXT;
    v_achievement_desc TEXT;
BEGIN
    -- Get participant data
    SELECT * INTO v_participant
    FROM challenge_participants
    WHERE user_id = p_user_id AND challenge_id = p_challenge_id;

    -- Streak achievements
    IF v_participant.streak_days >= 7 AND NOT EXISTS (
        SELECT 1 FROM achievements
        WHERE user_id = p_user_id
        AND challenge_id = p_challenge_id
        AND name = 'Week Warrior'
    ) THEN
        INSERT INTO achievements (
            user_id, challenge_id, type, name, description,
            points, criteria
        ) VALUES (
            p_user_id, p_challenge_id, 'streak', 'Week Warrior',
            '7-day check-in streak', 50,
            jsonb_build_object('streak_days', 7)
        );
    END IF;

    IF v_participant.streak_days >= 30 AND NOT EXISTS (
        SELECT 1 FROM achievements
        WHERE user_id = p_user_id
        AND challenge_id = p_challenge_id
        AND name = 'Monthly Master'
    ) THEN
        INSERT INTO achievements (
            user_id, challenge_id, type, name, description,
            points, criteria
        ) VALUES (
            p_user_id, p_challenge_id, 'streak', 'Monthly Master',
            '30-day check-in streak', 200,
            jsonb_build_object('streak_days', 30)
        );
    END IF;

    -- Weight loss milestones (for weight loss challenges)
    IF EXISTS (SELECT 1 FROM challenges WHERE id = p_challenge_id AND type = 'weight_loss') THEN
        v_total_weight_lost := v_participant.starting_weight_kg - v_participant.current_weight_kg;

        IF v_total_weight_lost >= 5 AND NOT EXISTS (
            SELECT 1 FROM achievements
            WHERE user_id = p_user_id
            AND challenge_id = p_challenge_id
            AND name = '5kg Milestone'
        ) THEN
            INSERT INTO achievements (
                user_id, challenge_id, type, name, description,
                points, criteria
            ) VALUES (
                p_user_id, p_challenge_id, 'milestone', '5kg Milestone',
                'Lost 5 kilograms', 100,
                jsonb_build_object('weight_lost_kg', 5)
            );
        END IF;

        IF v_total_weight_lost >= 10 AND NOT EXISTS (
            SELECT 1 FROM achievements
            WHERE user_id = p_user_id
            AND challenge_id = p_challenge_id
            AND name = '10kg Milestone'
        ) THEN
            INSERT INTO achievements (
                user_id, challenge_id, type, name, description,
                points, criteria
            ) VALUES (
                p_user_id, p_challenge_id, 'milestone', '10kg Milestone',
                'Lost 10 kilograms', 250,
                jsonb_build_object('weight_lost_kg', 10)
            );
        END IF;
    END IF;

    -- Participation achievements
    IF v_participant.check_ins_count >= 10 AND NOT EXISTS (
        SELECT 1 FROM achievements
        WHERE user_id = p_user_id
        AND challenge_id = p_challenge_id
        AND name = 'Committed Participant'
    ) THEN
        INSERT INTO achievements (
            user_id, challenge_id, type, name, description,
            points, criteria
        ) VALUES (
            p_user_id, p_challenge_id, 'participation', 'Committed Participant',
            '10 check-ins completed', 75,
            jsonb_build_object('check_ins', 10)
        );
    END IF;

    -- Ranking achievements
    IF v_participant.rank = 1 AND NOT EXISTS (
        SELECT 1 FROM achievements
        WHERE user_id = p_user_id
        AND challenge_id = p_challenge_id
        AND name = 'Leader of the Pack'
    ) THEN
        INSERT INTO achievements (
            user_id, challenge_id, type, name, description,
            points, criteria
        ) VALUES (
            p_user_id, p_challenge_id, 'ranking', 'Leader of the Pack',
            'Reached #1 on the leaderboard', 300,
            jsonb_build_object('rank', 1)
        );
    END IF;

    -- Update user's total points with achievement points
    UPDATE challenge_participants
    SET total_points = total_points + COALESCE((
        SELECT SUM(points)
        FROM achievements
        WHERE user_id = p_user_id
        AND challenge_id = p_challenge_id
        AND created_at > NOW() - INTERVAL '1 minute'
    ), 0)
    WHERE user_id = p_user_id AND challenge_id = p_challenge_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for after check-in insert
CREATE OR REPLACE FUNCTION after_check_in_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_points INTEGER;
BEGIN
    -- Award points
    v_points := award_check_in_points(NEW.id);

    -- Update current weight if provided
    IF NEW.weight_kg IS NOT NULL THEN
        UPDATE challenge_participants
        SET current_weight_kg = NEW.weight_kg
        WHERE user_id = NEW.user_id AND challenge_id = NEW.challenge_id;
    END IF;

    -- Check for new achievements
    PERFORM check_achievements(NEW.user_id, NEW.challenge_id);

    -- Update leaderboard
    PERFORM update_leaderboard_rankings(NEW.challenge_id);

    -- Create notification for team members
    IF NEW.team_id IS NOT NULL THEN
        INSERT INTO notifications (user_id, type, title, body, related_user_id, related_challenge_id, related_team_id)
        SELECT
            tm.user_id,
            'check_in_reminder',
            'Team member checked in!',
            p.display_name || ' just completed their check-in',
            NEW.user_id,
            NEW.challenge_id,
            NEW.team_id
        FROM team_members tm
        JOIN profiles p ON p.id = NEW.user_id
        WHERE tm.team_id = NEW.team_id
        AND tm.user_id != NEW.user_id
        AND tm.is_active = true;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for check-in inserts
CREATE TRIGGER trigger_after_check_in_insert
AFTER INSERT ON check_ins
FOR EACH ROW
EXECUTE FUNCTION after_check_in_insert();

-- Function to handle team member changes
CREATE OR REPLACE FUNCTION update_team_member_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.is_active = true AND OLD.is_active = false) THEN
        UPDATE teams
        SET member_count = member_count + 1
        WHERE id = NEW.team_id;
    ELSIF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.is_active = false AND OLD.is_active = true) THEN
        UPDATE teams
        SET member_count = GREATEST(0, member_count - 1)
        WHERE id = COALESCE(NEW.team_id, OLD.team_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for team member count updates
CREATE TRIGGER trigger_update_team_member_count
AFTER INSERT OR UPDATE OR DELETE ON team_members
FOR EACH ROW
EXECUTE FUNCTION update_team_member_count();

-- Function to handle participant count updates
CREATE OR REPLACE FUNCTION update_participant_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE challenges
        SET participant_count = participant_count + 1
        WHERE id = NEW.challenge_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE challenges
        SET participant_count = GREATEST(0, participant_count - 1)
        WHERE id = OLD.challenge_id;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status = 'active' AND OLD.status != 'active' THEN
            UPDATE challenges
            SET participant_count = participant_count + 1
            WHERE id = NEW.challenge_id;
        ELSIF NEW.status != 'active' AND OLD.status = 'active' THEN
            UPDATE challenges
            SET participant_count = GREATEST(0, participant_count - 1)
            WHERE id = NEW.challenge_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for participant count updates
CREATE TRIGGER trigger_update_participant_count
AFTER INSERT OR UPDATE OR DELETE ON challenge_participants
FOR EACH ROW
EXECUTE FUNCTION update_participant_count();

-- Function to clean up expired challenges
CREATE OR REPLACE FUNCTION cleanup_expired_challenges()
RETURNS VOID AS $$
BEGIN
    -- Mark challenges as completed
    UPDATE challenges
    SET status = 'completed'
    WHERE status = 'active'
    AND end_date < NOW();

    -- Mark participants as completed
    UPDATE challenge_participants
    SET
        status = 'completed',
        completed_at = NOW()
    WHERE challenge_id IN (
        SELECT id FROM challenges
        WHERE status = 'completed'
        AND end_date < NOW()
    )
    AND status = 'active';

    -- Send completion notifications
    INSERT INTO notifications (user_id, type, title, body, related_challenge_id)
    SELECT
        cp.user_id,
        'achievement',
        'Challenge Completed!',
        'Congratulations on completing ' || c.name || '! Check your final results.',
        c.id
    FROM challenge_participants cp
    JOIN challenges c ON c.id = cp.challenge_id
    WHERE c.status = 'completed'
    AND c.end_date > NOW() - INTERVAL '1 hour'
    AND c.end_date < NOW();
END;
$$ LANGUAGE plpgsql;

-- Create a scheduled job to run cleanup (requires pg_cron extension)
-- This would be set up in Supabase dashboard or via edge function