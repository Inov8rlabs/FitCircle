-- Migration: Journey Admin System
-- Description: Creates tables for automated user journey engagement system
-- Note: No stored procedures, triggers, or foreign key constraints - all logic in app layer

-- ============================================================================
-- USER DEVICES TABLE (for FCM push notification tokens)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) DEFAULT 'fitcircle',
    user_id UUID NOT NULL,
    device_token TEXT NOT NULL,
    platform VARCHAR(20) NOT NULL, -- 'ios', 'android', 'web'
    device_name VARCHAR(255),
    app_version VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_devices_token ON user_devices(device_token);
CREATE INDEX IF NOT EXISTS idx_user_devices_user ON user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_active ON user_devices(user_id, is_active) WHERE is_active = true;

-- ============================================================================
-- JOURNEY DEFINITIONS TABLE
-- Stores the journey configurations (state machines)
-- ============================================================================

CREATE TABLE IF NOT EXISTS journey_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) DEFAULT 'fitcircle',
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    description TEXT,
    definition JSONB NOT NULL, -- Full journey config with steps, triggers, transitions
    is_active BOOLEAN DEFAULT false,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_journey_definitions_name ON journey_definitions(name);
CREATE INDEX IF NOT EXISTS idx_journey_definitions_active ON journey_definitions(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_journey_definitions_tenant ON journey_definitions(tenant_id);

-- ============================================================================
-- JOURNEY STATE TABLE
-- Tracks each user's progress through a journey
-- ============================================================================

CREATE TABLE IF NOT EXISTS journey_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) DEFAULT 'fitcircle',
    user_id UUID NOT NULL,
    journey_name VARCHAR(100) NOT NULL,
    journey_definition_id UUID,
    current_step_id VARCHAR(100) NOT NULL,
    state_data JSONB DEFAULT '{}'::jsonb, -- Journey-specific state
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'completed', 'exited', 'paused'
    started_at TIMESTAMPTZ DEFAULT NOW(),
    last_transition_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    exited_reason TEXT
);

-- Note: Uniqueness of active journeys enforced in app layer
CREATE INDEX IF NOT EXISTS idx_journey_state_user ON journey_state(user_id);
CREATE INDEX IF NOT EXISTS idx_journey_state_journey ON journey_state(journey_name);
CREATE INDEX IF NOT EXISTS idx_journey_state_status ON journey_state(status);
CREATE INDEX IF NOT EXISTS idx_journey_state_active ON journey_state(journey_name, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_journey_state_user_active ON journey_state(user_id, status) WHERE status = 'active';

-- ============================================================================
-- JOURNEY HISTORY TABLE
-- Audit log of all journey transitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS journey_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) DEFAULT 'fitcircle',
    user_id UUID NOT NULL,
    journey_state_id UUID,
    journey_name VARCHAR(100) NOT NULL,
    from_step_id VARCHAR(100),
    to_step_id VARCHAR(100) NOT NULL,
    transition_reason VARCHAR(20) NOT NULL, -- 'event', 'timeout', 'manual', 'condition'
    trigger_event VARCHAR(100), -- Event that caused the transition
    event_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journey_history_user ON journey_history(user_id);
CREATE INDEX IF NOT EXISTS idx_journey_history_journey ON journey_history(journey_name);
CREATE INDEX IF NOT EXISTS idx_journey_history_state ON journey_history(journey_state_id);
CREATE INDEX IF NOT EXISTS idx_journey_history_created ON journey_history(created_at DESC);

-- ============================================================================
-- SCHEDULED JOURNEY JOBS TABLE
-- For delayed notifications and timeout transitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS scheduled_journey_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) DEFAULT 'fitcircle',
    user_id UUID NOT NULL,
    journey_state_id UUID,
    job_type VARCHAR(50) NOT NULL, -- 'send_notification', 'check_transition', 'timeout_trigger'
    scheduled_for TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed', 'cancelled'
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_error TEXT,
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_pending ON scheduled_journey_jobs(scheduled_for, status)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_user ON scheduled_journey_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_state ON scheduled_journey_jobs(journey_state_id);

-- ============================================================================
-- NOTIFICATION TEMPLATES TABLE
-- Templates for journey notifications
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) DEFAULT 'fitcircle',
    template_key VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    channel VARCHAR(20) DEFAULT 'push', -- 'push', 'email', 'both'

    -- Push notification content
    push_title TEXT,
    push_body TEXT,
    push_data JSONB DEFAULT '{}'::jsonb, -- Additional push payload data

    -- Email content
    email_subject TEXT,
    email_html TEXT,
    email_text TEXT,

    -- Template variables definition
    variables JSONB DEFAULT '[]'::jsonb, -- Array of {name, description, example}

    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_templates_key ON notification_templates(template_key);
CREATE INDEX IF NOT EXISTS idx_notification_templates_active ON notification_templates(is_active) WHERE is_active = true;

-- ============================================================================
-- USER EVENTS TABLE
-- Tracks events that can trigger journey transitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) DEFAULT 'fitcircle',
    user_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB DEFAULT '{}'::jsonb,
    source VARCHAR(50) DEFAULT 'system', -- 'mobile', 'web', 'api', 'system'
    processed BOOLEAN DEFAULT false, -- Whether journey engine has processed this
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_events_user ON user_events(user_id);
CREATE INDEX IF NOT EXISTS idx_user_events_type ON user_events(event_type);
CREATE INDEX IF NOT EXISTS idx_user_events_unprocessed ON user_events(created_at) WHERE processed = false;
CREATE INDEX IF NOT EXISTS idx_user_events_created ON user_events(created_at DESC);

-- ============================================================================
-- JOURNEY NOTIFICATION LOG TABLE
-- Tracks notifications sent as part of journeys
-- ============================================================================

CREATE TABLE IF NOT EXISTS journey_notification_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) DEFAULT 'fitcircle',
    user_id UUID NOT NULL,
    journey_state_id UUID,
    journey_name VARCHAR(100),
    journey_step_id VARCHAR(100),
    template_key VARCHAR(100),
    channel VARCHAR(20) NOT NULL, -- 'push', 'email'

    -- Rendered content
    rendered_title TEXT,
    rendered_body TEXT,
    rendered_subject TEXT,

    -- Delivery status
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'opened', 'failed'
    external_id VARCHAR(255), -- FCM message ID or Resend email ID
    error_message TEXT,

    -- Timestamps
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journey_notif_log_user ON journey_notification_log(user_id);
CREATE INDEX IF NOT EXISTS idx_journey_notif_log_journey ON journey_notification_log(journey_name);
CREATE INDEX IF NOT EXISTS idx_journey_notif_log_status ON journey_notification_log(status);
CREATE INDEX IF NOT EXISTS idx_journey_notif_log_created ON journey_notification_log(created_at DESC);

-- ============================================================================
-- JOURNEY ANALYTICS AGGREGATES TABLE
-- Pre-computed analytics for dashboard
-- ============================================================================

CREATE TABLE IF NOT EXISTS journey_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(50) DEFAULT 'fitcircle',
    journey_name VARCHAR(100) NOT NULL,
    date DATE NOT NULL,

    -- User counts
    users_entered INTEGER DEFAULT 0,
    users_completed INTEGER DEFAULT 0,
    users_exited INTEGER DEFAULT 0,
    users_active INTEGER DEFAULT 0,

    -- Notification stats
    notifications_sent INTEGER DEFAULT 0,
    notifications_delivered INTEGER DEFAULT 0,
    notifications_opened INTEGER DEFAULT 0,
    notifications_failed INTEGER DEFAULT 0,

    -- Step-level stats (JSONB for flexibility)
    step_stats JSONB DEFAULT '{}'::jsonb,

    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_journey_analytics_unique ON journey_analytics(journey_name, date);
CREATE INDEX IF NOT EXISTS idx_journey_analytics_journey ON journey_analytics(journey_name);
CREATE INDEX IF NOT EXISTS idx_journey_analytics_date ON journey_analytics(date DESC);

-- ============================================================================
-- ADMIN ACTIVITY LOG
-- Tracks admin actions for audit
-- ============================================================================

CREATE TABLE IF NOT EXISTS journey_admin_activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50), -- 'journey', 'template', 'user_journey'
    resource_id UUID,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_created ON journey_admin_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_activity_admin ON journey_admin_activity_log(admin_user_id);

-- ============================================================================
-- ROW LEVEL SECURITY (simple policies, no functions)
-- ============================================================================

ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_journey_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_notification_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_admin_activity_log ENABLE ROW LEVEL SECURITY;

-- User devices: Users can manage their own devices
CREATE POLICY user_devices_select ON user_devices FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_devices_insert ON user_devices FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_devices_update ON user_devices FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY user_devices_delete ON user_devices FOR DELETE USING (auth.uid() = user_id);

-- Journey definitions: Anyone can read active journeys
CREATE POLICY journey_definitions_select ON journey_definitions FOR SELECT USING (true);

-- Journey state: Users can see their own journey states
CREATE POLICY journey_state_select ON journey_state FOR SELECT USING (auth.uid() = user_id);

-- Journey history: Users can see their own history
CREATE POLICY journey_history_select ON journey_history FOR SELECT USING (auth.uid() = user_id);

-- User events: Users can see and create their own events
CREATE POLICY user_events_select ON user_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_events_insert ON user_events FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Notification templates: Anyone can read active templates
CREATE POLICY notification_templates_select ON notification_templates FOR SELECT USING (is_active = true);

-- Journey notification log: Users can see their own notifications
CREATE POLICY journey_notification_log_select ON journey_notification_log FOR SELECT USING (auth.uid() = user_id);

-- Note: Admin operations use service role key which bypasses RLS

-- ============================================================================
-- SEED DATA: Default notification templates
-- ============================================================================

INSERT INTO notification_templates (template_key, name, description, channel, push_title, push_body, email_subject, email_html, variables)
VALUES
    -- Onboarding templates
    ('onboarding_welcome', 'Onboarding Welcome', 'Welcome message for new users', 'both',
     'Welcome to FitCircle!',
     'Hey {{user.name}}, ready to crush your fitness goals? Let''s get started!',
     'Welcome to FitCircle, {{user.name}}!',
     '<h1>Welcome to FitCircle!</h1><p>Hey {{user.name}},</p><p>We''re excited to have you join our fitness community. Your journey to a healthier you starts now!</p><p>Here''s what you can do:</p><ul><li>Log your daily activities</li><li>Join challenges with friends</li><li>Track your progress</li></ul><p>Let''s crush it!</p><p>- The FitCircle Team</p>',
     '[{"name": "user.name", "description": "User display name", "example": "John"}]'::jsonb),

    ('onboarding_first_activity_reminder', 'First Activity Reminder', 'Reminder to log first activity after 24 hours', 'push',
     'Ready to log your first activity?',
     '{{user.name}}, take the first step today. Even a 10-minute walk counts!',
     NULL, NULL,
     '[{"name": "user.name", "description": "User display name", "example": "John"}]'::jsonb),

    ('onboarding_first_activity_congrats', 'First Activity Congrats', 'Congratulations on logging first activity', 'push',
     'You did it!',
     'Awesome job, {{user.name}}! Your first activity is in the books. Keep the momentum going!',
     NULL, NULL,
     '[{"name": "user.name", "description": "User display name", "example": "John"}]'::jsonb),

    ('onboarding_final_nudge', 'Final Onboarding Nudge', 'Last push to get users to log first activity', 'both',
     'We believe in you!',
     '{{user.name}}, your FitCircle journey awaits. Start with just one activity today!',
     'Your fitness journey is waiting, {{user.name}}',
     '<h1>Your fitness journey awaits!</h1><p>Hey {{user.name}},</p><p>We noticed you haven''t logged your first activity yet. No pressure - even a short walk counts!</p><p>Every journey begins with a single step. Take yours today.</p><p>- The FitCircle Team</p>',
     '[{"name": "user.name", "description": "User display name", "example": "John"}]'::jsonb),

    -- Daily engagement templates
    ('daily_morning_reminder', 'Daily Morning Reminder', 'Morning check-in reminder', 'push',
     'Good morning!',
     'Ready to crush today, {{user.name}}? Log your morning check-in!',
     NULL, NULL,
     '[{"name": "user.name", "description": "User display name", "example": "John"}]'::jsonb),

    ('daily_afternoon_nudge', 'Daily Afternoon Nudge', 'Afternoon reminder if no check-in', 'push',
     'Don''t forget to check in!',
     '{{user.name}}, your streak is counting on you. Take a moment to log today''s progress.',
     NULL, NULL,
     '[{"name": "user.name", "description": "User display name", "example": "John"}]'::jsonb),

    ('daily_checkin_success', 'Daily Check-in Success', 'Confirmation after completing check-in', 'push',
     'Check-in complete!',
     'Great job, {{user.name}}! {{streak_count}} day streak and counting. Keep it up!',
     NULL, NULL,
     '[{"name": "user.name", "description": "User display name", "example": "John"}, {"name": "streak_count", "description": "Current streak count", "example": "7"}]'::jsonb),

    -- Win-back templates
    ('winback_we_miss_you', 'Win-Back: We Miss You', 'Re-engagement for inactive users', 'both',
     'We miss you!',
     '{{user.name}}, it''s been a while. Your FitCircle friends are waiting for you!',
     'We miss you, {{user.name}}!',
     '<h1>We miss you!</h1><p>Hey {{user.name}},</p><p>It''s been {{days_inactive}} days since we''ve seen you. Your fitness goals are still waiting - come back and let''s crush them together!</p><p>- The FitCircle Team</p>',
     '[{"name": "user.name", "description": "User display name", "example": "John"}, {"name": "days_inactive", "description": "Days since last activity", "example": "7"}]'::jsonb),

    ('winback_incentive', 'Win-Back: Incentive Offer', 'Special offer for returning users', 'email',
     NULL, NULL,
     'A special offer just for you, {{user.name}}',
     '<h1>We want you back!</h1><p>Hey {{user.name}},</p><p>We''ve got something special for you. Come back to FitCircle and get:</p><ul><li>Your streak restored</li><li>Bonus points to start fresh</li><li>A supportive community ready to cheer you on</li></ul><p>Your health journey doesn''t end - it just takes breaks sometimes. Ready to continue?</p><p>- The FitCircle Team</p>',
     '[{"name": "user.name", "description": "User display name", "example": "John"}]'::jsonb),

    ('winback_welcome_back', 'Win-Back: Welcome Back', 'Welcome message when user returns', 'push',
     'Welcome back!',
     '{{user.name}}, so great to see you again! Let''s pick up where you left off.',
     NULL, NULL,
     '[{"name": "user.name", "description": "User display name", "example": "John"}]'::jsonb),

    -- Challenge templates
    ('challenge_started', 'Challenge Started', 'Notification when user joins a challenge', 'push',
     'Challenge accepted!',
     '{{user.name}}, you''re in! {{challenge.name}} starts now. Let''s go!',
     NULL, NULL,
     '[{"name": "user.name", "description": "User display name", "example": "John"}, {"name": "challenge.name", "description": "Challenge name", "example": "7-Day Step Challenge"}]'::jsonb),

    ('challenge_daily_progress', 'Challenge Daily Progress', 'Daily update on challenge progress', 'push',
     'Challenge update',
     '{{user.name}}, you''re #{{rank}} in {{challenge.name}}! {{days_remaining}} days left to climb.',
     NULL, NULL,
     '[{"name": "user.name", "description": "User display name", "example": "John"}, {"name": "challenge.name", "description": "Challenge name", "example": "7-Day Step Challenge"}, {"name": "rank", "description": "Current rank", "example": "3"}, {"name": "days_remaining", "description": "Days remaining", "example": "5"}]'::jsonb)

ON CONFLICT (template_key) DO NOTHING;

-- ============================================================================
-- SEED DATA: Default journey definitions
-- ============================================================================

INSERT INTO journey_definitions (name, display_name, description, definition, is_active)
VALUES
    ('onboarding', 'New User Onboarding', 'Guide new users through their first week with personalized welcome messages and activity prompts',
     '{
        "name": "onboarding",
        "startTrigger": {"event": "user.registered"},
        "steps": [
            {
                "id": "welcome",
                "action": {
                    "type": "send_notification",
                    "notification": {
                        "channels": ["push", "email"],
                        "template": "onboarding_welcome"
                    }
                },
                "transitions": [{"to": "wait_for_first_activity", "trigger": {"immediate": true}}]
            },
            {
                "id": "wait_for_first_activity",
                "action": {"type": "wait"},
                "transitions": [
                    {"to": "first_activity_congrats", "trigger": {"event": "activity.logged"}},
                    {"to": "first_activity_reminder", "trigger": {"timeout": {"value": 24, "unit": "hours"}}}
                ]
            },
            {
                "id": "first_activity_reminder",
                "action": {
                    "type": "send_notification",
                    "notification": {
                        "channels": ["push"],
                        "template": "onboarding_first_activity_reminder"
                    }
                },
                "transitions": [{"to": "wait_after_reminder", "trigger": {"immediate": true}}]
            },
            {
                "id": "wait_after_reminder",
                "action": {"type": "wait"},
                "transitions": [
                    {"to": "first_activity_congrats", "trigger": {"event": "activity.logged"}},
                    {"to": "final_nudge", "trigger": {"timeout": {"value": 48, "unit": "hours"}}}
                ]
            },
            {
                "id": "final_nudge",
                "action": {
                    "type": "send_notification",
                    "notification": {
                        "channels": ["push", "email"],
                        "template": "onboarding_final_nudge"
                    }
                },
                "transitions": [{"to": "EXIT", "trigger": {"immediate": true}}]
            },
            {
                "id": "first_activity_congrats",
                "action": {
                    "type": "send_notification",
                    "notification": {
                        "channels": ["push"],
                        "template": "onboarding_first_activity_congrats"
                    }
                },
                "transitions": [{"to": "EXIT", "trigger": {"immediate": true}}]
            }
        ]
    }'::jsonb, true),

    ('daily_engagement', 'Daily Engagement', 'Keep users engaged with daily check-in reminders and progress updates',
     '{
        "name": "daily_engagement",
        "startTrigger": {"event": "journey.onboarding.completed"},
        "steps": [
            {
                "id": "morning_reminder",
                "action": {
                    "type": "send_notification",
                    "notification": {
                        "channels": ["push"],
                        "template": "daily_morning_reminder"
                    }
                },
                "transitions": [{"to": "wait_for_checkin", "trigger": {"immediate": true}}]
            },
            {
                "id": "wait_for_checkin",
                "action": {"type": "wait"},
                "transitions": [
                    {"to": "checkin_complete", "trigger": {"event": "checkin.completed"}},
                    {"to": "afternoon_nudge", "trigger": {"timeout": {"value": 6, "unit": "hours"}}}
                ]
            },
            {
                "id": "afternoon_nudge",
                "action": {
                    "type": "send_notification",
                    "notification": {
                        "channels": ["push"],
                        "template": "daily_afternoon_nudge"
                    }
                },
                "transitions": [
                    {"to": "checkin_complete", "trigger": {"event": "checkin.completed"}},
                    {"to": "EXIT", "trigger": {"timeout": {"value": 18, "unit": "hours"}}}
                ]
            },
            {
                "id": "checkin_complete",
                "action": {
                    "type": "send_notification",
                    "notification": {
                        "channels": ["push"],
                        "template": "daily_checkin_success"
                    }
                },
                "transitions": [{"to": "EXIT", "trigger": {"immediate": true}}]
            }
        ]
    }'::jsonb, false),

    ('win_back', 'Win-Back Campaign', 'Re-engage users who have been inactive for 7+ days',
     '{
        "name": "win_back",
        "startTrigger": {"event": "user.inactive", "conditions": [{"field": "days_inactive", "operator": "gte", "value": 7}]},
        "steps": [
            {
                "id": "we_miss_you",
                "action": {
                    "type": "send_notification",
                    "notification": {
                        "channels": ["push", "email"],
                        "template": "winback_we_miss_you"
                    }
                },
                "transitions": [{"to": "wait_for_return", "trigger": {"immediate": true}}]
            },
            {
                "id": "wait_for_return",
                "action": {"type": "wait"},
                "transitions": [
                    {"to": "welcome_back", "trigger": {"event": "app.opened"}},
                    {"to": "incentive_offer", "trigger": {"timeout": {"value": 3, "unit": "days"}}}
                ]
            },
            {
                "id": "incentive_offer",
                "action": {
                    "type": "send_notification",
                    "notification": {
                        "channels": ["email"],
                        "template": "winback_incentive"
                    }
                },
                "transitions": [
                    {"to": "welcome_back", "trigger": {"event": "app.opened"}},
                    {"to": "EXIT", "trigger": {"timeout": {"value": 7, "unit": "days"}}}
                ]
            },
            {
                "id": "welcome_back",
                "action": {
                    "type": "send_notification",
                    "notification": {
                        "channels": ["push"],
                        "template": "winback_welcome_back"
                    }
                },
                "transitions": [{"to": "EXIT", "trigger": {"immediate": true}}]
            }
        ]
    }'::jsonb, false)

ON CONFLICT (name) DO NOTHING;
