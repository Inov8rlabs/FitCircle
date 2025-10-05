# FitCircle MVP Product Requirements Document

**Version:** 1.0
**Last Updated:** 2025-10-04
**Author:** FitCircle Product Team
**Status:** Draft

---

## Executive Summary

FitCircle is reimagining social weight loss competitions by prioritizing privacy while maintaining motivation through progress-based competition. Unlike existing fitness apps that share specific metrics, FitCircle only shares **progress percentages** towards personal goals, creating a supportive environment where users compete based on effort and consistency rather than absolute numbers.

**Key Innovation:** Privacy-first fitness circles where members see each other's progress (65% to goal) but never the underlying metrics (lost 10 lbs).

---

## Section 1: Product Vision

### 1.1 Problem Statement

Current fitness competition apps face three critical problems:

1. **Privacy Concerns:** Users hesitate to join competitions because they must share sensitive data (weight, measurements)
2. **Unfair Comparisons:** People with different starting points compete on absolute metrics (total weight lost)
3. **Complex Setup:** Creating and managing group challenges requires extensive configuration and administration

Research shows 80% of fitness apps share user data with third parties, creating trust issues. Users want accountability without sacrificing privacy.

### 1.2 User Value Proposition

**For** health-conscious individuals aged 25-45
**Who** want accountability and motivation to reach their fitness goals
**FitCircle** is a social fitness platform
**That** enables private, progress-based competitions with friends
**Unlike** Strava, MyFitnessPal, or Weight Watchers
**Our product** keeps your actual metrics private while sharing only your progress percentage

### 1.3 Success Criteria

**MVP Success Metrics (3-month targets):**
- 1,000+ active FitCircles created
- 70% of circles have 3+ members
- 60% circle completion rate (members active until end date)
- 80% weekly check-in consistency
- 50% of users create or join multiple circles
- NPS score > 40

### 1.4 Non-Goals for MVP

We are explicitly NOT building:
- Complex team structures or team vs team competitions
- Monetary prizes or payment processing
- AI coaching or personalized recommendations
- Integration with fitness trackers/wearables
- Video check-ins or photo verification
- Public discovery/browse features for circles
- Mobile native apps (web-first approach)

---

## Section 2: User Stories & Flows

### 2.1 Create a FitCircle

**User Story:** As a circle creator, I want to set up a private fitness challenge quickly, so that I can start competing with friends immediately.

**Step-by-Step Flow:**

1. **Initiation**
   - User clicks "Create FitCircle" button
   - Modal opens with creation wizard

2. **Basic Information**
   - Enter circle name (required, 3-50 chars)
   - Add description (optional, max 200 chars)
   - Select duration via date pickers:
     - Start date (min: tomorrow, max: 90 days out)
     - End date (min: 7 days from start, max: 365 days)
   - System auto-calculates: "X-day challenge"

3. **Privacy Settings**
   - Default: Invite-only (cannot be changed in MVP)
   - Future: Public/Private options

4. **Creation Confirmation**
   - Review summary
   - Click "Create & Get Invite Link"
   - Circle created with status: "upcoming"

5. **Immediate Invite Flow**
   - Success screen shows:
     - Unique invite link (auto-copied)
     - Share buttons (WhatsApp, Email, SMS)
     - "Invite Friends" CTA

**Validation Rules:**
- Name: Required, 3-50 characters, alphanumeric + spaces
- Description: Optional, max 200 characters
- Dates: Start > today, End > Start + 6 days
- Creator auto-joins as first member

**Success State:**
- Circle created in database
- Creator redirected to circle dashboard
- Invite link copied to clipboard
- Toast: "FitCircle created! Share the link to invite friends"

**Error States:**
- Invalid dates: "End date must be at least 7 days after start"
- Network error: "Unable to create circle. Please try again"

### 2.2 Invite Friends

**User Story:** As a circle creator, I want multiple ways to invite friends, so that everyone can easily join regardless of their tech comfort level.

**Invite Methods:**

**A. Share Link Method**
1. Click "Invite Friends" button
2. Modal shows:
   - Invite link: `fitcircle.app/join/ABC123XYZ`
   - Copy button (with confirmation)
   - Share buttons for:
     - WhatsApp: Opens with pre-filled message
     - Email: Opens mail client with template
     - SMS: Opens messages with link
   - QR code (for in-person sharing)

**B. Email Invite Method**
1. Click "Invite by Email"
2. Enter email addresses (comma-separated)
3. System sends branded email with:
   - Inviter's name and circle name
   - Challenge duration and start date
   - One-click join button
   - Privacy assurance message

**Invite Link Structure:**
- Format: `fitcircle.app/join/{INVITE_CODE}`
- Invite codes: 9 alphanumeric characters
- Never expire (valid until circle ends)
- Same code for all invites to a circle

**Pre-filled Message Templates:**

WhatsApp/SMS:
```
Hey! I'm starting a {X}-day fitness challenge on {date}.
Join my FitCircle - we track progress % only, your actual data stays private!
{link}
```

Email:
```
Subject: Join my FitCircle challenge!

Hi there,

I'm starting a {duration}-day fitness challenge called "{circle_name}" beginning {start_date}.

What makes FitCircle different:
✓ Your actual weight/metrics stay private
✓ We only share progress % toward goals
✓ Daily check-ins and encouragement
✓ No judgment, just support!

Click here to join: {link}

Let's do this together!
{sender_name}
```

### 2.3 Join a FitCircle

**User Story:** As an invitee, I want to quickly join a circle and set my goal, so that I can start participating immediately.

**New User Flow:**

1. **Landing Page** (fitcircle.app/join/ABC123XYZ)
   - Shows circle name and description
   - "23 people have already joined!"
   - Privacy badge: "Your data stays private"
   - Two CTAs: "Sign Up to Join" / "Already have account? Log in"

2. **Quick Registration**
   - Email (pre-filled if came from email invite)
   - Password
   - Display name
   - Agree to terms
   - Submit → Auto-login

3. **Goal Setting** (Immediately after signup)
   - "Set your personal goal for {Circle Name}"
   - Goal type selector:
     - Weight Loss (lbs to lose)
     - Step Count (daily average)
     - Workout Frequency (sessions/week)
     - Custom (define your own)
   - Enter target values
   - Privacy reminder: "Only your progress % will be shared"
   - "Join Circle" button

4. **Success State**
   - Added to circle members
   - Redirect to circle dashboard
   - Welcome message from system
   - Tutorial: "Make your first check-in"

**Existing User Flow:**

1. Click invite link
2. Login if needed
3. Circle preview page
4. Set goal (same as step 3 above)
5. Join confirmation

**Email Matching Logic:**
- If invite was sent to email, auto-verify on signup
- If link was shared, no email verification needed
- Prevents duplicate joins (one user per circle)

**Acceptance Criteria:**
- Goal must be set to complete joining
- Cannot join after circle start date
- Cannot join if circle is full (future: max participants)
- Automatic welcome notification to creator

### 2.4 Set Personal Goals

**User Story:** As a member, I want to set a private goal that's meaningful to me, so that I can track progress in my own way.

**Goal Types & Input Fields:**

**A. Weight Loss**
- Current weight (lbs/kg)
- Target weight (lbs/kg)
- Progress = (Current - Start) / (Target - Start) × 100

**B. Step Count**
- Current daily average (auto-calculated from last 7 days if available)
- Target daily average
- Progress = Actual Daily Avg / Target Daily Avg × 100

**C. Workout Frequency**
- Current sessions/week
- Target sessions/week
- Progress = Actual Sessions / Target Sessions × 100

**D. Custom Goal**
- Goal description (e.g., "Run a 5K")
- Starting value (optional)
- Target value
- Unit of measurement
- Progress = Current / Target × 100

**Goal Setting Rules:**

- **When:** Must set immediately when joining circle
- **Editing:** Can edit until circle starts, locked after
- **Visibility:**
  - Private: Actual values never shown to others
  - Shared: Only progress % visible to circle members
- **Validation:**
  - Weight loss: Max 2 lbs/week (safety)
  - Steps: Max 50,000/day (realistic)
  - Workouts: Max 14/week (2 per day)
  - Custom: User-defined reasonable ranges

**Progress Calculation Examples:**

Weight Loss:
```
Start: 200 lbs, Target: 180 lbs, Current: 190 lbs
Total to lose: 20 lbs
Lost so far: 10 lbs
Progress: (10/20) × 100 = 50%
```

Daily Steps:
```
Target: 10,000 steps/day for 30 days = 300,000 total
Achieved so far: 180,000 steps
Progress: (180,000/300,000) × 100 = 60%
```

### 2.5 Daily Engagement

**User Story:** As a member, I want a quick daily check-in process and to see how others are doing, so that I stay motivated.

**Check-In Flow:**

1. **Daily Reminder** (8 AM local time)
   - Push notification: "Time for your FitCircle check-in!"
   - Email if no check-in by 8 PM

2. **Check-In Form** (< 30 seconds)
   - Current value for chosen metric
   - Mood slider (1-10, optional)
   - Energy slider (1-10, optional)
   - Quick note (optional, 100 chars)
   - "Check In" button

3. **Instant Feedback**
   - Progress ring animation
   - New percentage displayed
   - Streak counter update
   - Position change on leaderboard

**Leaderboard View:**

Each member shows:
- Avatar/initials
- Display name
- Progress percentage (large, colorful)
- Check-in streak (flame icon + days)
- Last active (green dot if today)
- High-five button

What's NOT shown:
- Actual weight/measurements
- Specific goal details
- Daily values entered

**Encouragement System:**

- **High-Fives:** Send up to 10/day
- **Reactions:** Quick emoji responses
- **Automated Celebrations:**
  - "Sarah reached 25% of her goal! 🎉"
  - "Mike has a 7-day streak! 🔥"
  - "3 people checked in today!"

### 2.6 Circle Completion

**User Story:** As a member, I want to see final results and celebrate achievements when the challenge ends.

**End Date Triggers:**

1. **24 Hours Before:**
   - Notification: "Last day to check in!"
   - Email with current standings

2. **At Completion (midnight of end date):**
   - Circle status → "completed"
   - Final leaderboard locked
   - Results page generated

3. **Results Page Shows:**
   - Winner announcement (highest progress %)
   - Final leaderboard
   - Individual achievements:
     - Total progress made
     - Check-in consistency %
     - Longest streak
   - Circle statistics:
     - Average progress: X%
     - Total check-ins: Y
     - Most consistent: Name
   - Share results (optional)

**Post-Completion Actions:**

- **Create Rematch:** Same members, new dates
- **Start New Circle:** With modifications
- **Export Progress:** Download personal data (CSV)
- **Leave Feedback:** Rate experience

**Winner Determination:**
- Primary: Highest progress % toward goal
- Tiebreaker 1: Check-in consistency %
- Tiebreaker 2: Total check-ins
- Tiebreaker 3: Joined circle first

---

## Section 3: Detailed Feature Specifications

### 3.1 FitCircle Creation

**Required Fields:**
- Name: 3-50 characters
- Start date: Tomorrow minimum, 90 days maximum
- End date: 7+ days after start, max 1 year

**Optional Fields:**
- Description: 200 character limit
- Max participants: Default unlimited, max 100

**Auto-Generated:**
- Invite code: 9 alphanumeric characters
- Invite link: fitcircle.app/join/{code}
- Circle ID: UUID

**Default Settings:**
- Visibility: Invite-only (locked for MVP)
- Check-in requirement: Daily encouraged, not required
- Late join: Allowed until day 3
- Time zone: Creator's timezone for day boundaries

### 3.2 Invite System

**Invite Link Structure:**
```
https://fitcircle.app/join/{INVITE_CODE}

Example: https://fitcircle.app/join/ABC123XYZ
```

**Invite Code Generation:**
- Format: 9 alphanumeric characters (A-Z, 0-9)
- Case insensitive
- Excludes ambiguous characters (O/0, I/1/l)
- One code per circle (not per invite)
- Never expires while circle active

**Email Invitation:**
- Sent from: noreply@fitcircle.app
- Subject: "{Name} invited you to join a FitCircle!"
- Tracks: Sent, opened, clicked
- Includes unsubscribe link

**Invite Tracking:**
- Who invited whom (referral tracking)
- Invite method used (link/email)
- Conversion rate per method
- Time from invite to join

### 3.3 Goal Setting

**Weight Loss Goals:**
```javascript
{
  type: "weight_loss",
  current_weight: 200, // lbs or kg
  target_weight: 180,
  unit: "lbs", // or "kg"
  weekly_target: 1.5, // calculated safe loss rate
  total_to_lose: 20
}
```

**Step Count Goals:**
```javascript
{
  type: "step_count",
  current_daily_avg: 5000,
  target_daily_avg: 10000,
  total_target: 300000, // for 30-day challenge
  count_method: "daily_average"
}
```

**Workout Frequency Goals:**
```javascript
{
  type: "workout_frequency",
  current_per_week: 2,
  target_per_week: 5,
  total_target: 20, // for 4-week challenge
  workout_types: ["cardio", "strength"] // optional
}
```

**Custom Goals:**
```javascript
{
  type: "custom",
  description: "Complete Couch to 5K",
  current_value: 0,
  target_value: 100,
  unit: "percent",
  milestones: [25, 50, 75, 100] // optional
}
```

**Progress Calculation Formula:**
```
For decreasing metrics (weight loss):
Progress = ((Start - Current) / (Start - Target)) × 100

For increasing metrics (steps, workouts):
Progress = (Current / Target) × 100

Capped at 100% (can't exceed goal)
Minimum 0% (can't go backwards from start)
```

### 3.4 Privacy Model

**Always Private (Never Shared):**
- Actual weight (current, start, target)
- Specific measurements
- Daily check-in values
- Personal notes
- Mood/energy scores (unless user shares)
- Goal details and targets

**Shared with Circle:**
- Progress percentage
- Check-in status (did/didn't today)
- Streak count
- Join date
- Last active date
- High-fives given/received

**Public Profile (Optional):**
- Display name
- Avatar
- Bio (if added)
- Number of circles joined
- Total circles completed

**Privacy Settings (Future):**
- Hide from specific members
- Share actual values with select friends
- Make progress history public

### 3.5 Leaderboard

**Display Format:**
```
Rank | Avatar | Name | Progress | Streak | Last Active | Actions
-----|--------|------|----------|--------|-------------|--------
1 🏆 | SM     | Sarah| 78%      | 🔥14   | 2 hrs ago   | 👏
2 🥈 | MJ     | Mike | 72%      | 🔥7    | Today       | 👏
3 🥉 | ED     | Emma | 65%      | 🔥21   | 12 hrs ago  | 👏
```

**Ranking Logic:**
1. Sort by progress_percentage DESC
2. Ties broken by check_in_consistency
3. Further ties broken by total_check_ins
4. Final tie breaker: joined_at ASC

**Update Frequency:**
- Real-time on check-in
- Batch recalculation every hour
- Cache for 5 minutes for performance

**Visual Indicators:**
- 🏆 Gold crown for 1st place
- 🥈 Silver medal for 2nd
- 🥉 Bronze medal for 3rd
- 🔥 Flame + number for streaks
- 🟢 Green dot if checked in today
- ⬆️⬇️ Arrows for rank changes

**Empty States:**
- No members: "Be the first to join!"
- No check-ins: "No one has checked in yet"
- User not checked in: "Check in to see your rank"

### 3.6 Social Interactions

**High-Fives:**
- Limit: 10 per user per day
- Animation: Hand emoji flies across screen
- Notification: "Sarah gave you a high-five!"
- Counter: Shows total received today

**Milestone Celebrations:**
- Automated at: 25%, 50%, 75%, 100% progress
- System message in circle feed
- Special animation on leaderboard
- Push notification to circle members

**Encouragement Messages (Future):**
- Quick preset messages:
  - "Keep going! 💪"
  - "You've got this!"
  - "Amazing progress!"
  - "So proud of you!"
- Custom messages: 100 character limit
- Limit: 5 messages per day

**Check-In Reactions:**
- Six emoji reactions available
- One reaction per check-in per user
- Shows count and who reacted

### 3.7 Notifications

**Notification Types & Triggers:**

**Invite Notifications:**
- Email: Immediately when invited
- In-app: When someone joins via your invite

**Circle Notifications:**
- Start reminder: 24 hours before start
- Daily check-in: 8 AM local time
- Missed check-in: 8 PM if not done
- Circle ending: 24 hours before end
- Results ready: When circle completes

**Social Notifications:**
- High-five received
- Milestone reached (25%, 50%, 75%, 100%)
- Someone joined your circle
- New leader on leaderboard

**Settings (Per Circle):**
- All notifications on/off
- Daily reminders on/off
- Social updates on/off
- Email frequency: Instant/Daily digest/Off

---

## Section 4: Technical Specifications

### 4.1 Database Schema

**Modified/New Tables Required:**

```sql
-- Modify existing challenges table for FitCircle needs
ALTER TABLE challenges
ADD COLUMN invite_code VARCHAR(9) UNIQUE,
ADD COLUMN invite_link_active BOOLEAN DEFAULT true,
ADD COLUMN allow_late_join BOOLEAN DEFAULT true,
ADD COLUMN late_join_deadline INTEGER DEFAULT 3; -- days after start

-- Create fitcircle_members table (extends challenge_participants)
CREATE TABLE fitcircle_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circle_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    invited_by UUID REFERENCES profiles(id),
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    join_method TEXT CHECK (join_method IN ('link', 'email', 'direct')),

    -- Goal data (private)
    goal_type TEXT CHECK (goal_type IN ('weight_loss', 'step_count', 'workout_frequency', 'custom')),
    goal_config JSONB NOT NULL, -- Stores all goal details
    goal_set_at TIMESTAMPTZ,
    goal_locked BOOLEAN DEFAULT false, -- Locked when circle starts

    -- Progress tracking
    starting_value DECIMAL(10,2),
    current_value DECIMAL(10,2),
    target_value DECIMAL(10,2),
    progress_percentage DECIMAL(5,2) DEFAULT 0,

    -- Engagement metrics
    check_ins_count INTEGER DEFAULT 0,
    streak_days INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_check_in_at TIMESTAMPTZ,
    total_high_fives_sent INTEGER DEFAULT 0,
    total_high_fives_received INTEGER DEFAULT 0,

    -- Status
    is_active BOOLEAN DEFAULT true,
    left_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(circle_id, user_id)
);

-- Create fitcircle_checkins table (simplified)
CREATE TABLE fitcircle_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES fitcircle_members(id) ON DELETE CASCADE,
    circle_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    check_in_date DATE NOT NULL,
    check_in_value DECIMAL(10,2) NOT NULL, -- The actual metric value (private)
    progress_percentage DECIMAL(5,2), -- Calculated at check-in time

    -- Optional tracking
    mood_score INTEGER CHECK (mood_score BETWEEN 1 AND 10),
    energy_level INTEGER CHECK (energy_level BETWEEN 1 AND 10),
    note TEXT CHECK (LENGTH(note) <= 100),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(member_id, check_in_date)
);

-- Create fitcircle_encouragements table
CREATE TABLE fitcircle_encouragements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circle_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    from_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    to_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT CHECK (type IN ('high_five', 'message', 'reaction')),
    content TEXT, -- For messages
    reaction_emoji TEXT, -- For reactions
    related_checkin_id UUID REFERENCES fitcircle_checkins(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create fitcircle_invites table (track invite flow)
CREATE TABLE fitcircle_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    circle_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
    inviter_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    invite_method TEXT CHECK (invite_method IN ('link', 'email')),
    recipient_email TEXT, -- Only if email invite
    invite_code VARCHAR(9) NOT NULL,
    clicked_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ,
    joined_user_id UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_fitcircle_members_circle ON fitcircle_members(circle_id);
CREATE INDEX idx_fitcircle_members_user ON fitcircle_members(user_id);
CREATE INDEX idx_fitcircle_members_progress ON fitcircle_members(circle_id, progress_percentage DESC);
CREATE INDEX idx_fitcircle_checkins_date ON fitcircle_checkins(check_in_date DESC);
CREATE INDEX idx_fitcircle_checkins_member ON fitcircle_checkins(member_id);
CREATE INDEX idx_fitcircle_encouragements_circle ON fitcircle_encouragements(circle_id);
CREATE INDEX idx_fitcircle_invites_code ON fitcircle_invites(invite_code);
```

### 4.2 API Endpoints

**Circle Management:**

```typescript
// Create a new FitCircle
POST /api/circles
Request: {
  name: string,
  description?: string,
  start_date: string,
  end_date: string,
  max_participants?: number
}
Response: {
  circle: Circle,
  invite_code: string,
  invite_link: string
}

// Get circle details (public info only)
GET /api/circles/:id
Response: {
  id: string,
  name: string,
  description: string,
  start_date: string,
  end_date: string,
  member_count: number,
  status: string,
  days_remaining: number
}

// Get user's circles
GET /api/circles/my-circles
Response: {
  active: Circle[],
  upcoming: Circle[],
  completed: Circle[]
}
```

**Invite Management:**

```typescript
// Generate invite link
POST /api/circles/:id/invite
Response: {
  invite_code: string,
  invite_link: string,
  share_text: string
}

// Send email invites
POST /api/circles/:id/invite/email
Request: {
  emails: string[], // Array of email addresses
  message?: string // Optional personal message
}
Response: {
  sent: number,
  failed: string[]
}

// Join via invite code
POST /api/circles/join/:code
Request: {
  user_id?: string // If logged in
}
Response: {
  circle: Circle,
  requires_goal: boolean,
  redirect_url: string
}

// Validate invite code
GET /api/circles/validate/:code
Response: {
  valid: boolean,
  circle_name?: string,
  starts_in_days?: number,
  member_count?: number
}
```

**Goal Management:**

```typescript
// Set personal goal
POST /api/circles/:id/goal
Request: {
  goal_type: 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom',
  goal_config: {
    current_value: number,
    target_value: number,
    unit?: string,
    description?: string // For custom goals
  }
}
Response: {
  goal_id: string,
  progress_percentage: number
}

// Update goal (only before circle starts)
PUT /api/circles/:id/goal
Request: {
  goal_config: object
}
Response: {
  updated: boolean,
  locked_at?: string
}
```

**Check-ins:**

```typescript
// Submit daily check-in
POST /api/circles/:id/checkin
Request: {
  value: number, // Current value for the metric
  mood_score?: number, // 1-10
  energy_level?: number, // 1-10
  note?: string // Max 100 chars
}
Response: {
  progress_percentage: number,
  rank_change: number, // +2, -1, 0, etc
  streak_days: number,
  milestone_reached?: string // "25%", "50%", etc
}

// Get check-in history
GET /api/circles/:id/checkins
Query: {
  user_id?: string, // Defaults to current user
  limit?: number, // Default 30
  offset?: number
}
Response: {
  checkins: Array<{
    date: string,
    progress_percentage: number, // Only % shown, not values
    mood_score?: number,
    energy_level?: number,
    note?: string
  }>
}
```

**Leaderboard:**

```typescript
// Get leaderboard
GET /api/circles/:id/leaderboard
Query: {
  include_inactive?: boolean // Include dropped members
}
Response: {
  leaderboard: Array<{
    rank: number,
    user_id: string,
    display_name: string,
    avatar_url?: string,
    progress_percentage: number,
    streak_days: number,
    last_check_in_at: string,
    checked_in_today: boolean,
    high_fives_received: number
  }>,
  user_rank?: number, // Current user's rank
  last_updated: string
}
```

**Social Interactions:**

```typescript
// Send encouragement
POST /api/circles/:id/encourage
Request: {
  to_user_id: string,
  type: 'high_five' | 'message' | 'reaction',
  content?: string, // For messages
  reaction_emoji?: string, // For reactions
  checkin_id?: string // If reacting to specific check-in
}
Response: {
  sent: boolean,
  daily_limit_remaining: number
}

// Get encouragements
GET /api/circles/:id/encouragements
Query: {
  type?: string,
  limit?: number
}
Response: {
  encouragements: Array<{
    from_user: User,
    type: string,
    content?: string,
    created_at: string
  }>
}
```

**Notifications:**

```typescript
// Get notifications
GET /api/notifications
Query: {
  circle_id?: string,
  unread_only?: boolean
}
Response: {
  notifications: Notification[],
  unread_count: number
}

// Mark as read
PUT /api/notifications/:id/read
Response: {
  marked_read: boolean
}

// Update notification settings
PUT /api/circles/:id/notifications
Request: {
  daily_reminders: boolean,
  social_updates: boolean,
  email_frequency: 'instant' | 'daily' | 'off'
}
```

### 4.3 Frontend Components

**Core Components to Build:**

```typescript
// Circle creation and management
CircleCreationWizard     // Multi-step form for creating circles
CircleCard               // Display circle summary card
CircleList               // List of user's circles
CircleDetailView         // Full circle dashboard

// Invite system
InviteFriendsModal       // Shows invite link and email options
JoinCircleFlow           // Landing page for invite links
InviteLinkDisplay        // Copyable invite link with share buttons
EmailInviteForm          // Form to send email invites

// Goal setting
GoalSettingForm          // Set personal goal when joining
GoalTypeSelector         // Choose between goal types
GoalProgressRing         // Circular progress visualization
GoalEditModal            // Edit goal before circle starts

// Leaderboard
PrivateLeaderboard       // Main leaderboard component
LeaderboardRow           // Individual row with privacy controls
RankBadge                // Visual rank indicators (1st, 2nd, 3rd)
ProgressBar              // Horizontal progress indicator

// Check-ins
DailyCheckInForm         // Quick check-in form
CheckInHistory           // Personal check-in history
StreakIndicator          // Visual streak counter
MoodEnergySlider         // Circular sliders for mood/energy

// Social features
HighFiveButton           // Animated high-five interaction
EncouragementFeed        // Stream of encouragements
MilestoneToast           // Celebration notifications
ReactionPicker           // Emoji reaction selector

// Privacy indicators
PrivacyBadge             // Shows what's private/shared
DataVisibilityTooltip   // Explains privacy on hover
PrivacySettingsModal     // Configure privacy preferences

// Status and analytics
CircleStatusBanner       // Shows days left, current rank
CircleStatsCard          // Aggregate circle statistics
CompletionSummary        // End-of-circle results
```

**Component Architecture:**

```
/components
  /circles
    CircleCreationWizard.tsx
    CircleCard.tsx
    CircleList.tsx
    CircleDetailView.tsx
  /invite
    InviteFriendsModal.tsx
    JoinCircleFlow.tsx
    InviteLinkDisplay.tsx
  /goals
    GoalSettingForm.tsx
    GoalProgressRing.tsx
  /leaderboard
    PrivateLeaderboard.tsx
    LeaderboardRow.tsx
  /checkins
    DailyCheckInForm.tsx
    CheckInHistory.tsx
  /social
    HighFiveButton.tsx
    EncouragementFeed.tsx
  /shared
    PrivacyBadge.tsx
    LoadingSpinner.tsx
    ErrorBoundary.tsx
```

### 4.4 Business Logic

**Progress Calculation Service:**

```typescript
class ProgressCalculator {
  static calculateProgress(goal: Goal, currentValue: number): number {
    switch(goal.type) {
      case 'weight_loss':
        // For decreasing metrics
        const totalToLose = goal.startValue - goal.targetValue;
        const actuallyLost = goal.startValue - currentValue;
        return Math.min(100, Math.max(0, (actuallyLost / totalToLose) * 100));

      case 'step_count':
      case 'workout_frequency':
        // For increasing metrics
        return Math.min(100, Math.max(0, (currentValue / goal.targetValue) * 100));

      case 'custom':
        // User-defined calculation
        return Math.min(100, Math.max(0, (currentValue / goal.targetValue) * 100));
    }
  }

  static calculateDailyStepAverage(checkins: CheckIn[]): number {
    const last7Days = checkins.slice(-7);
    const total = last7Days.reduce((sum, c) => sum + c.value, 0);
    return total / last7Days.length;
  }

  static isRealisticGoal(goal: Goal, durationDays: number): boolean {
    if (goal.type === 'weight_loss') {
      const weeklyLoss = ((goal.startValue - goal.targetValue) / durationDays) * 7;
      return weeklyLoss <= 2; // Max 2 lbs per week
    }
    if (goal.type === 'step_count') {
      return goal.targetValue <= 50000; // Max 50k steps per day
    }
    return true;
  }
}
```

**Check-in Requirements Service:**

```typescript
class CheckInService {
  static canCheckIn(member: CircleMember): boolean {
    // Can only check in once per day
    const lastCheckIn = member.lastCheckInAt;
    if (!lastCheckIn) return true;

    const today = new Date().setHours(0,0,0,0);
    const lastDate = new Date(lastCheckIn).setHours(0,0,0,0);
    return today > lastDate;
  }

  static calculateStreak(checkins: CheckIn[]): number {
    let streak = 0;
    const today = new Date().setHours(0,0,0,0);

    for (let i = 0; i < 30; i++) {
      const targetDate = new Date(today - (i * 86400000));
      const hasCheckIn = checkins.some(c =>
        new Date(c.date).toDateString() === targetDate.toDateString()
      );

      if (hasCheckIn) {
        streak++;
      } else if (i > 0) {
        break; // Streak broken
      }
    }
    return streak;
  }

  static shouldSendReminder(member: CircleMember): boolean {
    const now = new Date();
    const hour = now.getHours();

    // Send at 8 AM if haven't checked in today
    if (hour === 8 && !member.checkedInToday) return true;

    // Send at 8 PM if still haven't checked in
    if (hour === 20 && !member.checkedInToday) return true;

    return false;
  }
}
```

**Winner Determination Service:**

```typescript
class WinnerService {
  static determineWinner(members: CircleMember[]): CircleMember {
    // Sort by multiple criteria
    return members.sort((a, b) => {
      // 1. Highest progress percentage
      if (a.progressPercentage !== b.progressPercentage) {
        return b.progressPercentage - a.progressPercentage;
      }

      // 2. Check-in consistency (% of days checked in)
      const aConsistency = a.checkInsCount / a.totalDays;
      const bConsistency = b.checkInsCount / b.totalDays;
      if (aConsistency !== bConsistency) {
        return bConsistency - aConsistency;
      }

      // 3. Total check-ins
      if (a.checkInsCount !== b.checkInsCount) {
        return b.checkInsCount - a.checkInsCount;
      }

      // 4. Joined first (earlier timestamp)
      return a.joinedAt.getTime() - b.joinedAt.getTime();
    })[0];
  }

  static calculateCircleStats(circle: Circle): CircleStats {
    const members = circle.members;
    return {
      avgProgress: members.reduce((sum, m) => sum + m.progressPercentage, 0) / members.length,
      totalCheckIns: members.reduce((sum, m) => sum + m.checkInsCount, 0),
      completionRate: members.filter(m => m.progressPercentage >= 100).length / members.length,
      avgStreak: members.reduce((sum, m) => sum + m.streakDays, 0) / members.length,
      mostConsistent: members.sort((a, b) => b.checkInsCount - a.checkInsCount)[0]
    };
  }
}
```

**Invite Code Generation:**

```typescript
class InviteService {
  static generateInviteCode(): string {
    // Use safe characters (no ambiguous ones)
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 9; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  static formatInviteLink(code: string): string {
    return `${process.env.NEXT_PUBLIC_APP_URL}/join/${code}`;
  }

  static validateInviteCode(code: string): boolean {
    // Check format: 9 alphanumeric, no ambiguous chars
    const pattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{9}$/;
    return pattern.test(code.toUpperCase());
  }

  static async canJoinCircle(circle: Circle, user: User): Promise<{
    canJoin: boolean,
    reason?: string
  }> {
    // Check if already member
    if (circle.members.some(m => m.userId === user.id)) {
      return { canJoin: false, reason: 'Already a member' };
    }

    // Check if circle started
    if (circle.status === 'active' && !circle.allowLateJoin) {
      return { canJoin: false, reason: 'Circle has already started' };
    }

    // Check late join deadline
    if (circle.status === 'active') {
      const daysSinceStart = getDaysSince(circle.startDate);
      if (daysSinceStart > circle.lateJoinDeadline) {
        return { canJoin: false, reason: 'Late join period has ended' };
      }
    }

    // Check max participants
    if (circle.maxParticipants && circle.memberCount >= circle.maxParticipants) {
      return { canJoin: false, reason: 'Circle is full' };
    }

    return { canJoin: true };
  }
}
```

---

## Section 5: User Experience Details

### 5.1 Invite Link Experience

**Complete User Journey:**

1. **Creator Shares Link**
   - Clicks "Invite Friends" → Modal appears
   - Link auto-copied with toast confirmation
   - Share buttons for WhatsApp, SMS, Email
   - QR code for in-person sharing

2. **Recipient Clicks Link**
   - Opens fitcircle.app/join/ABC123XYZ
   - Sees circle preview (name, duration, member count)
   - Privacy assurance: "Your metrics stay private"
   - Two paths: Sign Up or Log In

3. **Join Flow (New User)**
   - Quick signup (email, password, name)
   - Auto-login after signup
   - Goal setting screen appears
   - Select goal type and enter targets
   - Confirm and join circle
   - Land on circle dashboard

4. **Join Flow (Existing User)**
   - Login if needed
   - Goal setting screen
   - Join confirmation
   - Added to circle immediately

### 5.2 Privacy Indicators

**Visual Privacy System:**

- 🔒 **Lock Icon:** Next to all private data
- 👁️ **Eye Icon:** Next to shared progress
- **Green/Red Dots:** Show visibility status
- **Tooltips:** Explain on hover

**Privacy Education Moments:**

1. **During Goal Setting:**
   ```
   "Your actual weight will never be shown to others.
   Only your progress % toward your goal is visible."
   ```

2. **First Check-in:**
   ```
   "Enter your current weight. Don't worry -
   others only see that you're 15% toward your goal!"
   ```

3. **Leaderboard View:**
   ```
   "Everyone's actual metrics are private.
   You're competing on effort, not numbers!"
   ```

### 5.3 Empty States

**No Circles Yet:**
```
Visual: Illustration of people in a circle
Title: "Ready to start your fitness journey?"
Message: "Create your first FitCircle and invite friends to stay motivated together."
CTA: "Create FitCircle" button
Secondary: "Learn how it works" link
```

**Circle Created, No Members:**
```
Visual: Single avatar with dotted circles around it
Title: "You're the first one here!"
Message: "Invite friends to join your circle. The more people, the more motivation!"
CTA: "Invite Friends" button
Helper: Shows invite link with copy button
```

**No Check-ins Today:**
```
Visual: Empty calendar icon
Title: "No check-ins yet today"
Message: "Be the first to check in and set the pace!"
CTA: "Check In Now" button
```

**Circle Ended:**
```
Visual: Trophy icon with confetti
Title: "Challenge Complete!"
Message: "Great job! You completed a {X}-day challenge."
Stats: Show final results
CTA: "Create Rematch" / "Start New Circle"
```

### 5.4 Error Handling

**Invalid Invite Code:**
```
Title: "Invite code not found"
Message: "This invite code doesn't exist or has expired.
         Please check the code or ask for a new invite."
Action: "Enter different code" / "Go to dashboard"
```

**Circle Already Started:**
```
Title: "Circle has already started"
Message: "This circle started {X} days ago and isn't accepting new members.
         You can create your own circle or browse upcoming ones."
Action: "Create New Circle" / "Browse Circles"
```

**Circle Full:**
```
Title: "Circle is full"
Message: "This circle has reached its maximum of {X} members.
         Ask the creator to increase the limit or start your own!"
Action: "Create Similar Circle" / "Contact Creator"
```

**Network Errors:**
```
Title: "Connection issue"
Message: "We couldn't complete your request. Please check your
         internet connection and try again."
Action: "Retry" / "Refresh Page"
```

**Goal Validation Errors:**
- Weight loss > 2lbs/week: "For healthy weight loss, aim for maximum 2 lbs per week"
- Steps > 50,000/day: "That's over 50,000 steps per day! Consider a more achievable goal"
- Invalid dates: "End date must be at least 7 days after start date"

---

## Section 6: Success Metrics

### 6.1 MVP Success Criteria

**Primary Metrics (Month 3 targets):**

| Metric | Target | Measurement |
|--------|--------|-------------|
| Active Circles | 1,000+ | Circles with 3+ members |
| Avg Circle Size | 5 members | Total members / total circles |
| Circle Completion Rate | 60% | Members active until end date |
| Check-in Consistency | 80% | Weekly check-ins / expected |
| Multi-circle Users | 50% | Users in 2+ circles |
| Viral Coefficient | 1.5 | Invites sent × conversion rate |

### 6.2 Key Metrics to Track

**Acquisition Metrics:**
- Sign-up conversion rate (land on join page → create account)
- Invite acceptance rate (receive invite → join circle)
- Time from invite to join
- Organic vs invited users

**Activation Metrics:**
- Goal setting completion rate
- First check-in rate (within 24 hours)
- Profile completion rate
- First high-five sent

**Retention Metrics:**
- D1, D7, D30 retention
- Check-in frequency over time
- Circle completion rate by duration
- Repeat circle creation rate

**Engagement Metrics:**
- Daily Active Users (DAU)
- Weekly Active Users (WAU)
- Average session duration
- Check-ins per user per week
- High-fives sent per user
- Messages/reactions per circle

**Growth Metrics:**
- Viral coefficient (K-factor)
- Invite send rate
- Invite acceptance rate
- Average invites per user
- Time to first invite sent

### 6.3 Analytics Implementation

**Event Tracking:**

```typescript
// Key events to track
analytics.track('Circle Created', {
  circle_id: string,
  duration_days: number,
  max_participants: number
});

analytics.track('Invite Sent', {
  circle_id: string,
  method: 'link' | 'email',
  recipient_count: number
});

analytics.track('Circle Joined', {
  circle_id: string,
  join_method: 'link' | 'email' | 'direct',
  referred_by: string
});

analytics.track('Goal Set', {
  circle_id: string,
  goal_type: string,
  duration_days: number
});

analytics.track('Check-in Submitted', {
  circle_id: string,
  day_number: number,
  streak_days: number,
  progress_percentage: number
});

analytics.track('High Five Sent', {
  circle_id: string,
  recipient_id: string
});

analytics.track('Circle Completed', {
  circle_id: string,
  final_progress: number,
  check_in_rate: number,
  final_rank: number
});
```

---

## Section 7: Implementation Plan

### Phase 1: Core Circle Management (Week 1)

**Goals:** Basic circle creation and joining

**Tasks:**
1. Database migrations for fitcircle tables
2. Circle creation API and UI
3. Invite code generation and validation
4. Join circle flow (link landing page)
5. Basic circle dashboard view

**Deliverables:**
- Create circle with dates
- Generate and share invite link
- Join via invite link
- View circle details

### Phase 2: Goals & Progress (Week 2)

**Goals:** Personal goal setting and progress tracking

**Tasks:**
1. Goal setting UI and validation
2. Progress calculation service
3. Daily check-in form and API
4. Progress percentage display
5. Check-in history view

**Deliverables:**
- Set personal goals when joining
- Submit daily check-ins
- Calculate and display progress %
- View check-in history

### Phase 3: Privacy-First Leaderboard (Week 3)

**Goals:** Competition with privacy protection

**Tasks:**
1. Leaderboard calculation service
2. Privacy-aware leaderboard UI
3. Rank change notifications
4. Streak tracking
5. Real-time updates on check-in

**Deliverables:**
- View leaderboard with progress % only
- See rank changes
- Track check-in streaks
- Update positions in real-time

### Phase 4: Social Features (Week 4)

**Goals:** Engagement and encouragement

**Tasks:**
1. High-five system implementation
2. Milestone celebration notifications
3. Encouragement feed
4. Email/push notifications
5. Social interaction limits

**Deliverables:**
- Send/receive high-fives
- Automated milestone celebrations
- Daily interaction limits
- Notification preferences

### Phase 5: Polish & Edge Cases (Week 5)

**Goals:** Production readiness

**Tasks:**
1. Error handling and validation
2. Empty states and loading states
3. Circle completion flow
4. Results summary and sharing
5. Performance optimization
6. Beta testing

**Deliverables:**
- Smooth error recovery
- Circle completion experience
- Performance under load
- Beta feedback incorporated

---

## Section 8: Open Questions & Decisions Needed

### 8.1 Product Decisions

1. **Maximum Circle Size**
   - Option A: 25 members (intimate, manageable)
   - Option B: 50 members (more social proof)
   - Option C: 100 members (community feel)
   - **Recommendation:** Start with 50, monitor engagement

2. **Late Join Policy**
   - Option A: No late joins after start
   - Option B: Allow joins for first 3 days
   - Option C: Allow joins for first week with penalty
   - **Recommendation:** Allow for 3 days to maintain momentum

3. **Check-in Requirements**
   - Option A: Daily check-ins required
   - Option B: Minimum 5 check-ins per week
   - Option C: No minimum, just affects ranking
   - **Recommendation:** No minimum, but show "inactive" after 3 days

4. **Goal Modification**
   - Option A: Locked once set
   - Option B: Can modify until circle starts
   - Option C: Can modify anytime with visibility
   - **Recommendation:** Modify until start, then locked

5. **Circle Administration**
   - Option A: Creator has admin powers (remove members)
   - Option B: Democratic (vote to remove)
   - Option C: No removal possible
   - **Recommendation:** MVP = no removal, add in v2

### 8.2 Technical Decisions

1. **Real-time Updates**
   - WebSockets for live leaderboard?
   - Polling every X minutes?
   - **Recommendation:** 5-minute cache, refresh on check-in

2. **Notification Delivery**
   - Email only for MVP?
   - Add push notifications?
   - **Recommendation:** Email only for MVP, push in v2

3. **Data Retention**
   - How long to keep completed circles?
   - Archive strategy?
   - **Recommendation:** Keep 1 year, then archive

### 8.3 Business Model (Future)

1. **Monetization Strategy**
   - Freemium with limits?
   - Premium features?
   - **Future consideration:** Free for MVP, explore premium in v2

2. **Premium Features (v2)**
   - Unlimited circles
   - Advanced analytics
   - Custom themes
   - Larger circle sizes
   - Priority support

---

## Section 9: Future Enhancements (Post-MVP)

### 9.1 Version 2.0 Features

**Advanced Competition:**
- Team vs team competitions
- Tournament brackets
- Seasonal challenges
- Public leaderboards (opt-in)

**Enhanced Social:**
- In-circle chat/messaging
- Photo check-ins (optional)
- Video celebrations
- Friend system

**Integrations:**
- Apple Health sync
- Google Fit sync
- Fitbit integration
- Strava connection

**Gamification:**
- Achievement badges
- Level system
- Points/rewards
- Streaks and bonuses

### 9.2 Version 3.0 Vision

**AI Features:**
- Personalized goal recommendations
- Smart reminder timing
- Progress predictions
- Coaching suggestions

**Monetization:**
- Sponsored challenges with prizes
- Premium circle features
- Personal training add-on
- Nutrition tracking integration

**Platform Expansion:**
- iOS/Android native apps
- Apple Watch app
- Voice assistants (Alexa/Google)
- Smart scale integration

---

## Appendix A: Competitive Analysis

### Direct Competitors

**DietBet:**
- Monetary stakes (users bet money)
- Public weight loss percentages
- 4-week or 6-month challenges
- **Gap:** Requires financial commitment

**Strava Challenges:**
- Activity-based competitions
- Public leaderboards
- Kudos system
- **Gap:** Shows all activity data publicly

**MyFitnessPal Challenges:**
- Private groups
- Multiple metric tracking
- **Gap:** No competitive elements

### Our Differentiation

1. **Privacy First:** Only progress % visible
2. **No Money Required:** Pure motivation
3. **Flexible Goals:** Any metric, any target
4. **Simple Setup:** Under 2 minutes to create
5. **Friend-Focused:** Not strangers

---

## Appendix B: Sample User Flows

### Complete Check-in Flow

```
1. User opens dashboard
2. Sees "Check in" button (prominent)
3. Clicks button → Modal opens
4. Enters current weight: 192 lbs
5. Optional: Mood slider (7/10)
6. Optional: Energy slider (6/10)
7. Optional: Note "Feeling good!"
8. Clicks "Submit Check-in"
9. Progress ring animates to 45%
10. Leaderboard updates position
11. Toast: "Nice! You're now 45% to your goal!"
12. If milestone: Celebration animation
```

### Invite Acceptance Flow

```
1. Receives WhatsApp with link
2. Clicks link → Landing page
3. Sees "Join Sarah's Summer Challenge"
4. Sees "12 people already joined!"
5. Clicks "Sign Up to Join"
6. Enters email and password
7. Auto-logged in
8. Goal setting screen appears
9. Selects "Weight Loss"
10. Enters current: 180, target: 165
11. Clicks "Join Circle"
12. Lands on circle dashboard
13. Prompt: "Make your first check-in!"
```

---

## Approval and Sign-off

**Product Manager:** ___________________ Date: ___________

**Engineering Lead:** ___________________ Date: ___________

**Design Lead:** ___________________ Date: ___________

**Stakeholder:** ___________________ Date: ___________

---

**Document Status:** Ready for Review

**Next Steps:**
1. Review with engineering team
2. Create technical design doc
3. Design mockups/wireframes
4. Set up development environment
5. Begin Phase 1 implementation

---

*End of Document*