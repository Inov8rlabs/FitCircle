-- Enable necessary extensions (Supabase-compatible)
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- For gen_random_uuid()

-- Create custom types
CREATE TYPE challenge_status AS ENUM ('draft', 'upcoming', 'active', 'completed', 'cancelled');
CREATE TYPE challenge_type AS ENUM ('weight_loss', 'step_count', 'workout_minutes', 'custom');
CREATE TYPE challenge_visibility AS ENUM ('public', 'private', 'invite_only');
CREATE TYPE team_role AS ENUM ('captain', 'member');
CREATE TYPE notification_type AS ENUM ('challenge_invite', 'team_invite', 'check_in_reminder', 'achievement', 'comment', 'reaction', 'leaderboard_update', 'system');
CREATE TYPE notification_channel AS ENUM ('push', 'email', 'sms', 'in_app');
CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded');
CREATE TYPE subscription_status AS ENUM ('trialing', 'active', 'cancelled', 'past_due', 'unpaid', 'incomplete');
CREATE TYPE achievement_type AS ENUM ('milestone', 'streak', 'ranking', 'participation', 'special');
CREATE TYPE reaction_type AS ENUM ('like', 'love', 'celebrate', 'fire', 'muscle', 'trophy');

-- Create profiles table (extends Supabase auth.users)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    avatar_url TEXT,
    bio TEXT,
    date_of_birth DATE,
    height_cm INTEGER CHECK (height_cm > 0 AND height_cm < 300),
    weight_kg DECIMAL(5,2) CHECK (weight_kg > 0 AND weight_kg < 1000),
    timezone TEXT DEFAULT 'UTC',
    country_code CHAR(2),
    phone_number TEXT,
    phone_verified BOOLEAN DEFAULT false,
    onboarding_completed BOOLEAN DEFAULT false,
    fitness_level TEXT CHECK (fitness_level IN ('beginner', 'intermediate', 'advanced', 'expert')),
    goals JSONB DEFAULT '[]'::jsonb,
    preferences JSONB DEFAULT '{}'::jsonb,
    health_data_sync JSONB DEFAULT '{}'::jsonb,
    stripe_customer_id TEXT UNIQUE,
    subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'premium', 'enterprise')),
    subscription_status subscription_status,
    subscription_expires_at TIMESTAMPTZ,
    total_points INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    challenges_completed INTEGER DEFAULT 0,
    challenges_won INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN DEFAULT true,
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create challenges table
CREATE TABLE challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    type challenge_type NOT NULL,
    status challenge_status DEFAULT 'draft',
    visibility challenge_visibility DEFAULT 'public',
    rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    scoring_system JSONB NOT NULL DEFAULT '{}'::jsonb,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    registration_deadline TIMESTAMPTZ NOT NULL,
    entry_fee DECIMAL(10,2) DEFAULT 0,
    prize_pool DECIMAL(10,2) DEFAULT 0,
    prize_distribution JSONB DEFAULT '[]'::jsonb,
    min_participants INTEGER DEFAULT 2,
    max_participants INTEGER,
    min_team_size INTEGER DEFAULT 1,
    max_team_size INTEGER DEFAULT 1,
    allow_late_join BOOLEAN DEFAULT false,
    late_join_penalty DECIMAL(5,2) DEFAULT 0,
    cover_image_url TEXT,
    badge_image_url TEXT,
    tags TEXT[] DEFAULT '{}',
    location JSONB, -- Store as {lat: number, lng: number}
    location_name TEXT,
    is_featured BOOLEAN DEFAULT false,
    sponsor_info JSONB,
    custom_fields JSONB DEFAULT '{}'::jsonb,
    participant_count INTEGER DEFAULT 0,
    team_count INTEGER DEFAULT 0,
    total_check_ins INTEGER DEFAULT 0,
    avg_progress DECIMAL(5,2) DEFAULT 0,
    completion_rate DECIMAL(5,2) DEFAULT 0,
    engagement_score DECIMAL(5,2) DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_dates CHECK (end_date > start_date),
    CONSTRAINT valid_registration CHECK (registration_deadline <= start_date),
    CONSTRAINT valid_participants CHECK (max_participants IS NULL OR max_participants >= min_participants),
    CONSTRAINT valid_team_size CHECK (max_team_size IS NULL OR max_team_size >= min_team_size)
);

-- Create teams table
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    motto TEXT,
    avatar_url TEXT,
    is_public BOOLEAN DEFAULT true,
    max_members INTEGER DEFAULT 10,
    member_count INTEGER DEFAULT 0,
    total_points INTEGER DEFAULT 0,
    rank INTEGER,
    invite_code TEXT UNIQUE DEFAULT substring(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    settings JSONB DEFAULT '{}'::jsonb,
    stats JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(challenge_id, name)
);

-- Create team_members table
CREATE TABLE team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role team_role DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    points_contributed INTEGER DEFAULT 0,
    check_ins_count INTEGER DEFAULT 0,
    last_check_in_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    removed_at TIMESTAMPTZ,
    removed_by UUID REFERENCES profiles(id),
    removal_reason TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(team_id, user_id)
);

-- Create challenge_participants table
CREATE TABLE challenge_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('pending', 'active', 'completed', 'dropped', 'disqualified')),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    dropped_at TIMESTAMPTZ,
    disqualified_at TIMESTAMPTZ,
    disqualification_reason TEXT,
    starting_weight_kg DECIMAL(5,2),
    current_weight_kg DECIMAL(5,2),
    goal_weight_kg DECIMAL(5,2),
    starting_value DECIMAL(10,2),
    current_value DECIMAL(10,2),
    goal_value DECIMAL(10,2),
    progress_percentage DECIMAL(5,2) DEFAULT 0,
    total_points INTEGER DEFAULT 0,
    rank INTEGER,
    check_ins_count INTEGER DEFAULT 0,
    streak_days INTEGER DEFAULT 0,
    missed_check_ins INTEGER DEFAULT 0,
    last_check_in_at TIMESTAMPTZ,
    achievements JSONB DEFAULT '[]'::jsonb,
    stats JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(challenge_id, user_id)
);

-- Create check_ins table
CREATE TABLE check_ins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES challenge_participants(id) ON DELETE CASCADE,
    team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
    check_in_date DATE NOT NULL,
    weight_kg DECIMAL(5,2),
    body_fat_percentage DECIMAL(4,2) CHECK (body_fat_percentage >= 0 AND body_fat_percentage <= 100),
    muscle_mass_kg DECIMAL(5,2),
    water_percentage DECIMAL(4,2) CHECK (water_percentage >= 0 AND water_percentage <= 100),
    steps INTEGER CHECK (steps >= 0),
    active_minutes INTEGER CHECK (active_minutes >= 0),
    calories_burned INTEGER CHECK (calories_burned >= 0),
    distance_km DECIMAL(6,2) CHECK (distance_km >= 0),
    floors_climbed INTEGER CHECK (floors_climbed >= 0),
    sleep_hours DECIMAL(4,2) CHECK (sleep_hours >= 0 AND sleep_hours <= 24),
    water_intake_ml INTEGER CHECK (water_intake_ml >= 0),
    mood_score INTEGER CHECK (mood_score >= 1 AND mood_score <= 10),
    energy_level INTEGER CHECK (energy_level >= 1 AND energy_level <= 10),
    notes TEXT,
    photo_urls TEXT[] DEFAULT '{}',
    measurements JSONB DEFAULT '{}'::jsonb,
    workouts JSONB DEFAULT '[]'::jsonb,
    nutrition JSONB DEFAULT '{}'::jsonb,
    custom_metrics JSONB DEFAULT '{}'::jsonb,
    points_earned INTEGER DEFAULT 0,
    verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'flagged', 'rejected')),
    verified_by UUID REFERENCES profiles(id),
    verified_at TIMESTAMPTZ,
    verification_notes TEXT,
    is_valid BOOLEAN DEFAULT true,
    source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'apple_health', 'google_fit', 'fitbit', 'garmin', 'api')),
    device_data JSONB,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, challenge_id, check_in_date)
);

-- Create leaderboard table (materialized for performance)
CREATE TABLE leaderboard (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL, -- Can be user_id or team_id
    entity_type TEXT NOT NULL CHECK (entity_type IN ('individual', 'team')),
    rank INTEGER NOT NULL,
    previous_rank INTEGER,
    points INTEGER NOT NULL DEFAULT 0,
    progress_percentage DECIMAL(5,2) DEFAULT 0,
    weight_lost_kg DECIMAL(5,2),
    weight_lost_percentage DECIMAL(5,2),
    total_steps INTEGER DEFAULT 0,
    total_minutes INTEGER DEFAULT 0,
    check_ins_count INTEGER DEFAULT 0,
    streak_days INTEGER DEFAULT 0,
    last_check_in_at TIMESTAMPTZ,
    trend TEXT CHECK (trend IN ('up', 'down', 'stable')),
    stats JSONB DEFAULT '{}'::jsonb,
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(challenge_id, entity_id, entity_type)
);

-- Create notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type notification_type NOT NULL,
    channel notification_channel DEFAULT 'in_app',
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    action_url TEXT,
    action_data JSONB,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    sender_id UUID REFERENCES profiles(id),
    related_challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,
    related_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    related_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    is_archived BOOLEAN DEFAULT false,
    archived_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create comments table
CREATE TABLE comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('check_in', 'challenge', 'team', 'achievement')),
    entity_id UUID NOT NULL,
    content TEXT NOT NULL,
    mentions UUID[] DEFAULT '{}',
    is_edited BOOLEAN DEFAULT false,
    edited_at TIMESTAMPTZ,
    is_deleted BOOLEAN DEFAULT false,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES profiles(id),
    reactions_count INTEGER DEFAULT 0,
    replies_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create reactions table
CREATE TABLE reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('check_in', 'comment', 'achievement')),
    entity_id UUID NOT NULL,
    type reaction_type NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, entity_type, entity_id, type)
);

-- Create payments table
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    challenge_id UUID REFERENCES challenges(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL,
    currency CHAR(3) DEFAULT 'USD',
    status payment_status NOT NULL DEFAULT 'pending',
    type TEXT NOT NULL CHECK (type IN ('entry_fee', 'subscription', 'donation', 'prize', 'refund')),
    stripe_payment_intent_id TEXT UNIQUE,
    stripe_charge_id TEXT,
    stripe_refund_id TEXT,
    payment_method TEXT,
    payment_method_details JSONB,
    description TEXT,
    receipt_url TEXT,
    failure_reason TEXT,
    refunded_amount DECIMAL(10,2) DEFAULT 0,
    fee_amount DECIMAL(10,2) DEFAULT 0,
    net_amount DECIMAL(10,2),
    tax_amount DECIMAL(10,2) DEFAULT 0,
    processed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create achievements table
CREATE TABLE achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,
    type achievement_type NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    icon_url TEXT,
    badge_url TEXT,
    points INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    progress DECIMAL(5,2) DEFAULT 100,
    criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    shared BOOLEAN DEFAULT false,
    shared_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_profiles_username ON profiles(username);
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_stripe_customer ON profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX idx_profiles_active ON profiles(is_active, last_active_at DESC) WHERE is_active = true;

CREATE INDEX idx_challenges_status ON challenges(status);
CREATE INDEX idx_challenges_dates ON challenges(start_date, end_date);
CREATE INDEX idx_challenges_visibility ON challenges(visibility) WHERE status = 'active';
CREATE INDEX idx_challenges_featured ON challenges(is_featured) WHERE is_featured = true;
CREATE INDEX idx_challenges_creator ON challenges(creator_id);
CREATE INDEX idx_challenges_search ON challenges USING gin(name gin_trgm_ops);
CREATE INDEX idx_challenges_tags ON challenges USING gin(tags);
-- Location index: Use GIN for JSONB if needed
CREATE INDEX idx_challenges_location ON challenges USING gin(location) WHERE location IS NOT NULL;

CREATE INDEX idx_teams_challenge ON teams(challenge_id);
CREATE INDEX idx_teams_invite_code ON teams(invite_code);
CREATE INDEX idx_teams_rank ON teams(challenge_id, rank) WHERE rank IS NOT NULL;

CREATE INDEX idx_team_members_team ON team_members(team_id);
CREATE INDEX idx_team_members_user ON team_members(user_id);
CREATE INDEX idx_team_members_active ON team_members(team_id, is_active) WHERE is_active = true;

CREATE INDEX idx_participants_challenge ON challenge_participants(challenge_id);
CREATE INDEX idx_participants_user ON challenge_participants(user_id);
CREATE INDEX idx_participants_team ON challenge_participants(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX idx_participants_status ON challenge_participants(challenge_id, status);
CREATE INDEX idx_participants_rank ON challenge_participants(challenge_id, rank) WHERE status = 'active';

CREATE INDEX idx_checkins_user ON check_ins(user_id);
CREATE INDEX idx_checkins_challenge ON check_ins(challenge_id);
CREATE INDEX idx_checkins_date ON check_ins(check_in_date DESC);
CREATE INDEX idx_checkins_participant ON check_ins(participant_id);
CREATE INDEX idx_checkins_team ON check_ins(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX idx_checkins_verification ON check_ins(verification_status) WHERE verification_status != 'verified';

CREATE INDEX idx_leaderboard_challenge ON leaderboard(challenge_id);
CREATE INDEX idx_leaderboard_rank ON leaderboard(challenge_id, entity_type, rank);
CREATE INDEX idx_leaderboard_entity ON leaderboard(entity_id, entity_type);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

CREATE INDEX idx_comments_entity ON comments(entity_type, entity_id);
CREATE INDEX idx_comments_user ON comments(user_id);
CREATE INDEX idx_comments_parent ON comments(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_comments_created ON comments(created_at DESC);

CREATE INDEX idx_reactions_entity ON reactions(entity_type, entity_id);
CREATE INDEX idx_reactions_user ON reactions(user_id);

CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_challenge ON payments(challenge_id) WHERE challenge_id IS NOT NULL;
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_stripe ON payments(stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX idx_achievements_user ON achievements(user_id);
CREATE INDEX idx_achievements_challenge ON achievements(challenge_id) WHERE challenge_id IS NOT NULL;
CREATE INDEX idx_achievements_type ON achievements(type);

-- Create update trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update trigger to all tables
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_challenges_updated_at BEFORE UPDATE ON challenges FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_team_members_updated_at BEFORE UPDATE ON team_members FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_participants_updated_at BEFORE UPDATE ON challenge_participants FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_checkins_updated_at BEFORE UPDATE ON check_ins FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_leaderboard_updated_at BEFORE UPDATE ON leaderboard FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_achievements_updated_at BEFORE UPDATE ON achievements FOR EACH ROW EXECUTE FUNCTION update_updated_at();