# User Engagement Infrastructure - Product Requirements Document
**Version 2.0 | Created: October 27, 2025**

---

## Executive Summary

FitCircle's current engagement infrastructure lacks critical retention mechanics: users have no daily/weekly goals beyond manual check-ins, no competitive leaderboards to drive social accountability, and no notification system to encourage habit formation. This PRD defines a two-phase engagement system that will increase D7 retention from baseline to 35%+ and boost DAU by 50% through daily goals, streaks, leaderboards, and a comprehensive notification infrastructure.

### Phase 1: Core Engagement Features
Daily Goals, Weekly Goals, FitCircle Leaderboards, Daily Streak Check-in, and Active Data Submission will transform passive tracking into an engaging daily ritual that ladders up to FitCircle competitions.

### Phase 2: Notification Infrastructure
Push notifications (iOS/Android), email reminders, and user preference management will create consistent touchpoints that drive habit formation without overwhelming users.

### Key Objectives
- **Increase D7 retention** from baseline to 35%+ through daily engagement hooks
- **Boost DAU by 50%** via clear daily goal completion mechanics and social competition
- **Improve challenge completion rates by 25%** through structured daily/weekly milestones
- **Reduce churn by 30%** through notification-driven re-engagement

### Success Metrics (Phase 1 + 2 Combined)
- D7 Retention: 35%+ (industry avg: 15%)
- Daily Active Users (DAU): +50% increase
- Daily goal completion rate: 65%+
- Streak maintenance (7+ days): 40% of active users
- Notification opt-in rate: 75%+
- Notification-driven return rate: 25%+
- Leaderboard engagement: 80% of FitCircle members view weekly

---

## Research Insights

### 1. Competitive Engagement Tactics

**Strava:**
- **Weekly streaks** (not daily) reduce pressure while maintaining consistency
- Challenges are brand-sponsored, creating massive participation (50M+ athletes)
- Social kudos and high-fives drive micro-interactions (5+ per session)
- Segments and leaderboards create ambient competition without explicit betting

**Key Takeaway:** FitCircle should use **weekly goals as primary drivers** (lower pressure) with daily goals as optional stretch targets. Leaderboards must be real-time and FitCircle-scoped to create intimate competition.

**MyFitnessPal:**
- **Users logging 4+ days in first week are 7x more likely to succeed**
- Daily calorie counter acts as visual progress bar (immediate feedback)
- Challenges provide structured goal achievement with community support
- Streaks and badges prevent abandonment through loss aversion

**Key Takeaway:** First-week engagement is CRITICAL. FitCircle must guide new users to 4+ check-ins in Week 1 through aggressive onboarding nudges.

**Peloton:**
- **Real-time leaderboards** during classes create competitive motivation
- "High fives" and friend activity notifications drive social stickiness
- Teams of up to 50,000 people compete toward shared goals
- Streaks and milestone shoutouts celebrated publicly

**Key Takeaway:** FitCircle leaderboards need real-time updates (not daily batch). Social recognition through "encouragement" actions must be frictionless (1-tap).

### 2. Habit Formation Psychology

**The 66-Day Rule:**
- Average habit takes **66 days to form** (range: 18-254 days)
- Initial weeks show rapid automaticity development, then plateau
- Context cues (time of day, trigger events) strengthen habit formation

**Streak Mechanics:**
- **Loss aversion** is the primary driver: longer streaks = greater perceived loss if broken
- **"Never Miss Twice" rule:** Missing 1 day is recoverable; missing 2 kills momentum
- **Start small:** 2-minute minimum viable actions ensure daily showing up
- **Positive reinforcement > punishment:** Harsh self-judgment kills habit recovery

**Key Takeaway:** FitCircle streak system should allow **1 "freeze" per week** to prevent all-or-nothing thinking. Celebrate recovery ("You're back!") rather than shaming lapses.

### 3. Notification Best Practices (2025)

**Frequency:**
- **2-5 notifications per week** works for most apps
- **3-4 per week optimal for fitness apps**
- More than 1/week causes 10% to disable notifications, 6% to uninstall
- Set **frequency caps: max 3 per day, no notifications 10 PM - 7 AM**

**Timing:**
- Send during user's **activity patterns** (machine-learned windows)
- **40% higher open rates** with time-of-day personalization
- Fitness reminders work best: morning (7-9 AM), lunchtime (12-1 PM), evening (6-8 PM)

**Content:**
- **Personalized notifications: 4x higher open rates** than generic
- Trigger based on **predicted inactivity** or **goal progress**
- Motivational > transactional ("You're 500 steps from your goal!" vs "Log your steps")

**Key Takeaway:** FitCircle must learn user check-in patterns (morning logger vs evening logger) and send notifications 30-60 minutes before their typical window.

---

## Phase 1: Core Engagement Features

### Feature 1: Daily Goals

#### Problem Statement
Users lack short-term, actionable targets between long-term FitCircle challenges. Without daily structure, motivation drops and users only engage when manually remembering to check in.

#### User Stories
- **As a new user**, I want suggested daily goals based on my baseline activity, so I don't feel overwhelmed by unrealistic targets
- **As an active user**, I want my daily goals to adapt based on my progress, so I'm always challenged but not discouraged
- **As a competitive user**, I want to see if I hit my daily goals to maintain my FitCircle ranking

#### Specifications

**Goal Types (Day 1 Launch):**
1. **Steps Goal** (default: 7,000 for new users, personalized after 7 days)
2. **Weight Change Goal** (daily target: -0.1 to -0.3 lbs for weight loss challenges)
3. **Check-in Goal** (binary: did user complete daily check-in?)

**Goal Calculation Logic:**
- **New users (Days 1-7):** Conservative defaults
  - Steps: 5,000 (sedentary) or 7,000 (moderate baseline)
  - Weight: No daily goal (too early for meaningful daily tracking)
  - Check-in: Required daily
- **Established users (Day 8+):** Baseline-adjusted
  - Steps: Average of last 7 days + 10% (capped at 15,000)
  - Weight: Pro-rata of weekly FitCircle weight loss target
  - Check-in: Required daily

**UI/UX Requirements:**
- **Dashboard Widget:** Horizontal card showing 2-3 daily goals
- **Visual Progress:** Circular progress rings (Apple Fitness style)
  - Steps: Cyan ring
  - Weight: Purple ring
  - Check-in: Green checkmark (binary)
- **Completion State:** Goals "close" when met (full ring + celebration animation)
- **Daily Reset:** Goals reset at midnight in user's timezone

**Data Model:**
```typescript
// Table: daily_goals
{
  id: UUID
  user_id: UUID
  date: DATE
  goal_type: 'steps' | 'weight' | 'checkin' | 'workout' | 'water'
  target_value: NUMERIC
  actual_value: NUMERIC
  completed: BOOLEAN
  created_at: TIMESTAMPTZ
}
```

**API Endpoints:**
- `GET /api/goals/daily` - Fetch today's goals
- `POST /api/goals/daily/generate` - Generate personalized daily goals
- `PUT /api/goals/daily/{id}/progress` - Update goal progress
- `GET /api/goals/daily/history?days=7` - Fetch goal completion history

**Technical Considerations:**
- Goals auto-generate at midnight via cron job (`/api/cron/generate-daily-goals`)
- Use **baseline calculation service** to compute adaptive targets
- Cache daily goals in Zustand store (avoid repeated API calls)
- Fallback to conservative defaults if baseline calculation fails

#### Success Metrics
- **Daily goal completion rate:** 65%+ (target: 70% after 30 days)
- **Goal view rate:** 90%+ of DAUs view goals
- **Adaptive goal accuracy:** <20% variance between goal and actual achievement
- **User satisfaction:** NPS +5 points for daily goal feature

---

### Feature 2: Weekly Goals

#### Problem Statement
Users need medium-term milestones between daily actions and long-term FitCircle challenges (30-90 days). Weekly goals provide a "mini-finish line" that keeps momentum high and prevents mid-challenge dropout.

#### User Stories
- **As a FitCircle participant**, I want to see my weekly progress toward my challenge goal, so I know if I'm on track
- **As a user without active challenges**, I want weekly goals to maintain structure and motivation
- **As a team member**, I want to see how my weekly performance impacts my team's leaderboard position

#### Specifications

**Goal Types (Day 1 Launch):**
1. **Weekly Steps Total** (default: 50,000 steps)
2. **Weekly Weight Loss** (calculated: FitCircle target / weeks remaining)
3. **Weekly Check-in Streak** (target: 7/7 days)
4. **Weekly Active Days** (target: 5+ days with 3,000+ steps)

**Goal Calculation Logic:**
- **FitCircle participants:** Weekly goals derived from challenge targets
  - Weight loss: `(starting_weight - target_weight) / weeks_remaining`
  - Steps: `challenge_step_goal / 7`
- **Non-participants:** Baseline-adjusted weekly targets
  - Steps: `daily_goal * 7`
  - Weight: Maintenance mode (no loss/gain target)
  - Streak: Always 7/7 days

**UI/UX Requirements:**
- **Weekly Summary Card:** Displayed on Dashboard and FitCircle detail page
- **Progress Visualization:** Horizontal progress bars with daily breakdowns
  - Monday through Sunday mini-bars showing daily contribution
  - Overall progress percentage
- **Weekly Reset:** Goals reset Monday 12:00 AM user timezone
- **Weekly Digest:** Sunday evening notification summarizing week performance

**Data Model:**
```typescript
// Table: weekly_goals
{
  id: UUID
  user_id: UUID
  week_start: DATE // Always a Monday
  goal_type: 'steps' | 'weight' | 'streak' | 'active_days'
  target_value: NUMERIC
  actual_value: NUMERIC
  daily_breakdown: JSONB // [Mon: 8500, Tue: 9200, ...]
  completed: BOOLEAN
  fitcircle_id: UUID | NULL // Link to FitCircle if part of challenge
  created_at: TIMESTAMPTZ
}
```

**API Endpoints:**
- `GET /api/goals/weekly` - Fetch current week's goals
- `POST /api/goals/weekly/generate` - Generate personalized weekly goals
- `GET /api/goals/weekly/history?weeks=4` - Fetch 4-week trend
- `GET /api/goals/weekly/team` - Fetch team's aggregated weekly performance

**Technical Considerations:**
- Weekly goals auto-generate on Mondays via cron (`/api/cron/generate-weekly-goals`)
- **Daily rollup aggregation:** Daily check-ins update `daily_breakdown` field
- Weekly Digest email triggered Sunday 8 PM via cron
- For FitCircle challenges: recalculate weekly targets when users join/leave

#### Success Metrics
- **Weekly goal completion rate:** 50%+ (lower than daily due to cumulative difficulty)
- **Weekly Digest open rate:** 35%+ (email notifications)
- **Week-over-week progression:** 60% of users improve or maintain weekly performance
- **Challenge correlation:** Users hitting 3+ weekly goals have 2x higher challenge completion rate

---

### Feature 3: FitCircle Leaderboards

#### Problem Statement
FitCircles lack competitive dynamics and real-time social accountability. Users can't see how they rank within their circles, reducing motivation to outperform peers.

#### User Stories
- **As a FitCircle member**, I want to see how I rank against my friends in real-time, so I'm motivated to stay active
- **As a competitive user**, I want daily, weekly, and monthly leaderboards to create short- and long-term competition goals
- **As a team leader**, I want to see who's contributing most to our team's success

#### Specifications

**Leaderboard Types:**
1. **Daily Leaderboard** (resets daily at midnight)
   - Metric: Steps taken today
   - Display: Top 10 + user's position
2. **Weekly Leaderboard** (resets Monday)
   - Metric: Total steps this week OR % toward weekly weight loss goal
   - Display: Full FitCircle roster (up to 50 members)
3. **Monthly Leaderboard** (resets 1st of month)
   - Metric: Total weight lost this month OR total steps
   - Display: Full FitCircle roster
4. **All-Time Leaderboard**
   - Metric: Total weight lost since joining OR total steps
   - Display: Full FitCircle roster

**Ranking Logic:**
- **Steps-based challenges:** Sum of steps (Apple Health/Google Fit integration)
- **Weight loss challenges:** Percentage of goal achieved (normalizes for different starting weights)
  - Formula: `(starting_weight - current_weight) / (starting_weight - target_weight) * 100`
- **Ties:** Rank by earliest achievement timestamp (incentivizes early check-ins)

**UI/UX Requirements:**
- **FitCircle Page Tab:** "Leaderboard" tab alongside Overview, Members, Activity Feed
- **User Row Design:**
  - Rank badge (#1, #2, #3 highlighted with gold/silver/bronze)
  - User avatar + name
  - Metric value (10,234 steps OR 85% to goal)
  - Movement indicator (▲▼ from yesterday/last week)
- **Current User Highlight:** User's row always visible (sticky or highlighted)
- **Real-time Updates:** Leaderboard refreshes every 5 minutes when viewing
- **Time Period Selector:** Tabs for Daily / Weekly / Monthly / All-Time

**Data Model:**
```typescript
// Table: fitcircle_leaderboard_entries
{
  id: UUID
  fitcircle_id: UUID
  user_id: UUID
  period: 'daily' | 'weekly' | 'monthly' | 'all_time'
  period_start: DATE
  metric_type: 'steps' | 'weight_loss_pct' | 'checkin_streak'
  metric_value: NUMERIC
  rank: INTEGER
  rank_change: INTEGER // +2, -1, 0 from previous period
  last_updated: TIMESTAMPTZ
}

// Index: (fitcircle_id, period, period_start, rank) for fast queries
```

**API Endpoints:**
- `GET /api/fitcircles/{id}/leaderboard?period=weekly` - Fetch leaderboard
- `POST /api/fitcircles/{id}/leaderboard/refresh` - Force recalculation (cron only)
- `GET /api/fitcircles/{id}/leaderboard/user/{userId}` - Get user's rank across all periods

**Technical Considerations:**
- **Cron jobs for batch recalculation:**
  - Daily leaderboard: Recalculate every 5 minutes during peak hours (6 AM - 11 PM), hourly overnight
  - Weekly leaderboard: Recalculate hourly
  - Monthly leaderboard: Recalculate daily
- **Real-time updates:** When user submits data (check-in, Apple Health sync), trigger incremental rank update for their FitCircles
- **Performance:** Cache leaderboard in Redis for 5-minute TTL
- **Scalability:** For FitCircles >100 members, paginate and show Top 10 + user's position + 3 above/below

#### Success Metrics
- **Leaderboard view rate:** 80% of FitCircle members view weekly
- **Engagement lift:** Users viewing leaderboards have 30% higher daily check-in rate
- **Social actions:** 40% of leaderboard viewers send encouragement or high-fives
- **Competitive drive:** Top 5 users check leaderboard 2x more frequently than bottom 5

---

### Feature 4: Daily Streak Check-In

#### Problem Statement
Current check-ins are passive data entry with no habit-forming mechanics. Users lack motivation to maintain consistency, and there's no acknowledgment of previous day's effort.

#### User Stories
- **As a daily user**, I want to claim my streak each day and see my progress, so I'm motivated to maintain consistency
- **As a returning user**, I want to acknowledge yesterday's steps and reflect on my effort
- **As a streaky user**, I want to see my longest streak and feel loss aversion when considering skipping a day

#### Specifications

**Streak Mechanics:**
- **Streak Counter:** Increments daily when user completes check-in
- **Check-in Requirements:** User must:
  1. Log mood (1-5 scale)
  2. Log energy (1-5 scale)
  3. Acknowledge previous day's steps (view + confirm)
  4. Optionally log today's weight
- **Streak Freeze:** 1 free "freeze" per week (user can miss 1 day without breaking streak)
- **Streak Reset:** Missing 2 consecutive days resets to 0
- **Longest Streak:** Track all-time longest streak for user

**Acknowledgment Flow:**
- **Previous Day Steps Review:**
  - Show: "Yesterday you walked 8,234 steps"
  - Visual: Circular progress ring showing % of goal
  - Prompt: "How do you feel about yesterday?" (Great / OK / Could be better)
  - Save sentiment to `daily_tracking.previous_day_sentiment`
- **Mood & Energy Check:**
  - Circular sliders (existing UI component)
  - Quick-select emoji shortcuts (😴 😐 😊 😄 🔥)

**UI/UX Requirements:**
- **Check-in Modal:** Multi-step flow
  1. **Step 1:** Acknowledge yesterday's steps + sentiment
  2. **Step 2:** Today's mood & energy
  3. **Step 3:** Optional weight entry
  4. **Step 4:** Streak celebration (if >7 days)
- **Streak Display:** Dashboard widget showing:
  - Current streak: "🔥 14 days"
  - Longest streak: "Best: 32 days"
  - Freeze available: "💎 1 freeze left this week"
- **Streak Milestones:**
  - 7 days: "1 Week Warrior" badge
  - 30 days: "Monthly Master" badge
  - 100 days: "Centurion" badge

**Data Model:**
```typescript
// Table: user_streaks
{
  id: UUID
  user_id: UUID
  current_streak: INTEGER
  longest_streak: INTEGER
  last_checkin_date: DATE
  freeze_used_this_week: BOOLEAN
  week_start_date: DATE // For freeze reset
  created_at: TIMESTAMPTZ
  updated_at: TIMESTAMPTZ
}

// Table: daily_tracking (extend existing)
{
  // ... existing fields ...
  previous_day_sentiment: 'great' | 'ok' | 'could_be_better' | NULL
  previous_day_steps: INTEGER
  streak_day: INTEGER // Which day of streak this check-in represents
}
```

**API Endpoints:**
- `GET /api/streaks/current` - Fetch user's current streak
- `POST /api/streaks/checkin` - Complete check-in and increment streak
- `POST /api/streaks/freeze` - Use weekly freeze
- `GET /api/streaks/milestones` - Fetch earned milestone badges

**Technical Considerations:**
- **Cron job: Nightly streak validation** (`/api/cron/validate-streaks`)
  - Run at 12:05 AM in each timezone
  - Check if users missed check-in yesterday
  - Send "streak at risk" notification if 1 day missed with freeze available
- **Timezone handling:** Streak day boundaries are per-user timezone
- **Freeze logic:** Auto-apply freeze if user has 1 miss and freeze available; notify user

#### Success Metrics
- **7-day streak retention:** 40% of users maintain 7+ day streaks
- **30-day streak retention:** 15% of users reach 30 days
- **Freeze usage rate:** 60% of users use their weekly freeze at least once per month
- **Check-in completion rate:** 85%+ of DAUs complete full check-in flow
- **Sentiment tracking:** 70%+ of check-ins include previous day sentiment

---

### Feature 5: FitCircle Data Submission

#### Problem Statement
Currently, Apple Health/Google Fit data syncs passively to the database, but users aren't actively submitting it to FitCircle leaderboards. This creates a disconnect: users may be hitting their goals but not "claiming credit" in their social competitions.

#### User Stories
- **As a FitCircle member**, I want to submit my daily steps to the leaderboard so my team sees my contribution
- **As a competitive user**, I want to see when I've submitted data vs when my peers have submitted, so I know if I'm falling behind
- **As a team captain**, I want to know which team members haven't submitted data yet, so I can encourage them

#### Specifications

**Submission Model:**
- **Auto-sync:** Apple Health/Google Fit data syncs to `daily_tracking` table automatically
- **Manual Submission:** User must **claim data** to count toward FitCircle leaderboards
- **Submission Window:** Users can submit data up to 11:59 PM the same day
- **Late Submission:** After midnight, previous day's data is locked (cannot submit)

**Why Require Active Submission?**
1. **Intentional engagement:** Forces users to open app daily
2. **Social accountability:** Submission timestamp visible to FitCircle ("Sarah submitted 2 hours ago")
3. **Gamification hook:** Submission triggers leaderboard update + rank change notification
4. **Habit formation:** Creates daily ritual beyond passive background sync

**UI/UX Requirements:**
- **Dashboard Widget: "Submit Today's Data"**
  - Display: Steps count (synced from Apple Health), weight (if logged)
  - Primary CTA: "Submit to FitCircles" button
  - Visual feedback: Green checkmark when submitted
  - State: Disabled after submission (prevent double-submit)
- **FitCircle Activity Feed:**
  - Real-time feed item: "🏃 Alex submitted 10,234 steps" (visible to all members)
  - Timestamp: "2 hours ago"
  - Quick action: "🔥 Encourage" button (1-tap social interaction)
- **Submission Reminder:**
  - Notification at 8 PM if data not yet submitted
  - In-app banner: "Don't forget to submit your steps today!"

**Data Model:**
```typescript
// Table: fitcircle_data_submissions
{
  id: UUID
  fitcircle_id: UUID
  user_id: UUID
  submission_date: DATE
  steps: INTEGER
  weight: NUMERIC
  submitted_at: TIMESTAMPTZ
  rank_after_submission: INTEGER
  rank_change: INTEGER // +2, -1, 0
}

// Table: daily_tracking (extend existing)
{
  // ... existing fields ...
  submitted_to_fitcircles: BOOLEAN // Flag to prevent double-submit
  submission_timestamp: TIMESTAMPTZ
}
```

**API Endpoints:**
- `POST /api/fitcircles/{id}/submit` - Submit today's data to FitCircle
- `GET /api/fitcircles/{id}/submissions/today` - Fetch who's submitted today
- `GET /api/user/submissions/pending` - Check if user has pending submissions

**Technical Considerations:**
- **Submission triggers leaderboard update:**
  - Recalculate user's rank in real-time
  - Insert activity feed item: "User submitted X steps"
  - Send push notification to FitCircle members: "Alex just submitted 10K steps—can you beat that?"
- **Prevent double submission:** Check `submitted_to_fitcircles` flag before allowing submit
- **Multi-FitCircle handling:** If user is in 3 FitCircles, submission applies to all
- **Late submission grace period:** Allow submission until 12:30 AM for users in different timezones

#### Success Metrics
- **Daily submission rate:** 75%+ of DAUs submit data
- **Submission timing:** 60% submit before 6 PM (proactive vs reactive)
- **Social engagement:** 40% of submissions trigger encouragement/reactions from FitCircle members
- **Leaderboard impact:** Submitted data changes user's rank 50%+ of the time (indicating competitive balance)

---

## Phase 2: Notification Infrastructure

### Overview
Phase 2 builds the notification system that drives Phase 1 engagement. Without reminders, users forget to check in, submit data, and view leaderboards. This phase implements push notifications (iOS/Android), email notifications, and user preference controls.

### Feature 6: Push Notifications (iOS/Android)

#### Problem Statement
Users don't habitually open the app daily. Without push notifications, they miss streak deadlines, forget to submit data, and disengage from FitCircles.

#### User Stories
- **As a mobile user**, I want push notifications to remind me to check in, so I maintain my streak
- **As a FitCircle member**, I want to be notified when teammates submit data, so I feel social accountability
- **As a privacy-conscious user**, I want granular control over which notifications I receive

#### Specifications

**Notification Types:**

| Notification Type | Trigger | Timing | Frequency Cap | User Control |
|---|---|---|---|---|
| **Daily Check-in Reminder** | No check-in by 8 PM | 8:00 PM user timezone | 1/day | Required (cannot disable) |
| **Streak At Risk** | Missed yesterday, freeze available | 9:00 AM user timezone | 1/day | Optional |
| **Weekly Goal Progress** | 50% of week elapsed, <50% of goal | Wednesday 6:00 PM | 1/week | Optional |
| **FitCircle Data Submission** | No submission by 8 PM | 8:00 PM user timezone | 1/day | Optional |
| **Leaderboard Position Change** | User's rank changes ±3 | Real-time (throttled to 1/hour) | 3/day | Optional |
| **Social Engagement** | Friend sends encouragement, high-five | Real-time | 10/day | Optional |
| **Weekly Digest** | End of week summary | Sunday 8:00 PM | 1/week | Optional |
| **Challenge Milestone** | Hit 25%, 50%, 75%, 100% of goal | Real-time | 4 per challenge | Required (cannot disable) |

**Notification Content Examples:**
- **Daily Check-in Reminder:** "⏰ Complete your check-in to keep your 14-day streak alive!"
- **Streak At Risk:** "🔥 You're 1 day away from losing your 21-day streak. Use your freeze?"
- **Weekly Goal Progress:** "📊 You're halfway through the week but only at 35% of your step goal. You've got this!"
- **FitCircle Data Submission:** "🏃 Submit today's 8,234 steps to your FitCircles before midnight!"
- **Leaderboard Position Change:** "📈 You moved up to #3 in 'Work Warriors'! Can you reach #2?"
- **Social Engagement:** "💪 Alex sent you encouragement: 'Amazing progress!'"
- **Weekly Digest:** "📅 Week in Review: 52,341 steps, 7-day streak maintained, #2 in Work Warriors"
- **Challenge Milestone:** "🎉 Halfway there! You're 50% to your weight loss goal."

**Technical Implementation:**

**iOS (APNs - Apple Push Notification Service):**
- Use Supabase Edge Functions + APNs HTTP/2 API
- Device token registration: Store in `user_push_tokens` table
- Payload format:
```json
{
  "aps": {
    "alert": {
      "title": "Daily Check-in Reminder",
      "body": "Complete your check-in to keep your 14-day streak!"
    },
    "badge": 1,
    "sound": "default"
  },
  "data": {
    "type": "daily_checkin",
    "deep_link": "fitcircle://checkin"
  }
}
```

**Android (FCM - Firebase Cloud Messaging):**
- Use Supabase Edge Functions + FCM API
- Device token registration: Store in `user_push_tokens` table
- Payload format:
```json
{
  "notification": {
    "title": "Daily Check-in Reminder",
    "body": "Complete your check-in to keep your 14-day streak!"
  },
  "data": {
    "type": "daily_checkin",
    "deep_link": "fitcircle://checkin"
  },
  "android": {
    "priority": "high"
  }
}
```

**Data Model:**
```typescript
// Table: user_push_tokens
{
  id: UUID
  user_id: UUID
  device_token: TEXT
  platform: 'ios' | 'android'
  active: BOOLEAN
  last_used: TIMESTAMPTZ
  created_at: TIMESTAMPTZ
}

// Table: notification_logs
{
  id: UUID
  user_id: UUID
  notification_type: TEXT
  sent_at: TIMESTAMPTZ
  delivered: BOOLEAN
  opened: BOOLEAN
  payload: JSONB
}
```

**API Endpoints:**
- `POST /api/notifications/register` - Register device token
- `POST /api/notifications/send` - Send push notification (internal only)
- `GET /api/notifications/history` - Fetch user's notification history
- `PUT /api/notifications/preferences` - Update notification preferences

**Cron Jobs:**
- `/api/cron/notifications/daily-checkin` - Runs hourly (8-9 PM all timezones)
- `/api/cron/notifications/weekly-digest` - Runs Sundays 8 PM all timezones
- `/api/cron/notifications/streak-risk` - Runs daily 9 AM all timezones

**Technical Considerations:**
- **Timezone handling:** Store user timezone, calculate "8 PM" per user
- **Frequency caps:** Check `notification_logs` before sending (max 3/day)
- **Batch processing:** Group notifications by timezone, send in batches
- **Retry logic:** Retry failed sends 3x with exponential backoff
- **Token invalidation:** Mark tokens inactive if APNs/FCM returns "invalid token"

#### Success Metrics
- **Opt-in rate:** 75%+ of users enable push notifications
- **Open rate:** 25%+ of notifications opened within 1 hour
- **Engagement lift:** Users with notifications enabled have 40% higher D7 retention
- **Opt-out rate:** <10% of users disable notifications within 30 days

---

### Feature 7: Email Notifications

#### Problem Statement
Not all users enable push notifications. Email serves as a fallback channel for critical reminders and a primary channel for weekly digests.

#### User Stories
- **As a user who disabled push**, I want email reminders for streaks and goals, so I don't lose progress
- **As a data-conscious user**, I want weekly email summaries instead of daily push notifications
- **As a team captain**, I want email updates on FitCircle activity

#### Specifications

**Email Types:**

| Email Type | Trigger | Timing | Frequency Cap | User Control |
|---|---|---|---|---|
| **Welcome Email** | New user signup | Immediate | 1 lifetime | Required |
| **Daily Check-in Reminder** | No check-in by 9 PM, no push token | 9:00 PM user timezone | 1/day | Optional |
| **Streak At Risk** | Missed yesterday, freeze available | 9:00 AM user timezone | 1/day | Optional |
| **Weekly Digest** | End of week summary | Sunday 8:00 PM | 1/week | Optional |
| **Monthly Progress Report** | End of month summary | 1st of month 9:00 AM | 1/month | Optional |
| **FitCircle Invitation** | Invited to FitCircle | Immediate | Unlimited | Required |
| **Challenge Milestone** | Hit 50%, 100% of goal | Real-time | 2 per challenge | Required |

**Email Content Examples:**

**Welcome Email:**
```
Subject: Welcome to FitCircle! Let's get started 🎉

Hi [Name],

You're now part of FitCircle—where fitness meets fun and accountability!

Here's what to do next:
✅ Complete your first daily check-in
✅ Join or create your first FitCircle
✅ Set your daily and weekly goals

[Complete Check-in CTA]

See you inside!
—The FitCircle Team
```

**Weekly Digest:**
```
Subject: Your Week in Review: 52,341 steps, 7-day streak 🔥

Hi [Name],

Here's how your week went:

📊 **This Week's Stats:**
- Steps: 52,341 (104% of goal)
- Streak: 7 days maintained
- Weight: -1.2 lbs
- Leaderboard: #2 in "Work Warriors"

🏆 **Top Achievement:**
You hit your daily goal 6 out of 7 days—your best week yet!

📈 **Next Week's Challenge:**
Your weekly step goal is increasing to 55,000 based on your progress.

[View Full Dashboard CTA]

Keep crushing it!
—The FitCircle Team
```

**Streak At Risk:**
```
Subject: ⚠️ Your 21-day streak is at risk!

Hi [Name],

You missed yesterday's check-in. Your 21-day streak is at risk!

Good news: You have 1 freeze left this week. We'll automatically use it to protect your streak.

[Complete Today's Check-in CTA]

Don't lose your momentum!
—The FitCircle Team
```

**Technical Implementation:**
- **Email Service:** Use Resend (https://resend.com) for transactional emails
  - Modern API, React Email template support
  - 99.9% deliverability, excellent dev experience
- **Email Templates:** React Email components stored in `/apps/web/emails/`
- **Sending Logic:** Supabase Edge Functions call Resend API
- **Unsubscribe Handling:** One-click unsubscribe links (CAN-SPAM compliant)

**Data Model:**
```typescript
// Table: email_preferences
{
  id: UUID
  user_id: UUID
  daily_checkin_reminder: BOOLEAN DEFAULT TRUE
  streak_at_risk: BOOLEAN DEFAULT TRUE
  weekly_digest: BOOLEAN DEFAULT TRUE
  monthly_report: BOOLEAN DEFAULT TRUE
  fitcircle_invites: BOOLEAN DEFAULT TRUE
  challenge_milestones: BOOLEAN DEFAULT TRUE
  updated_at: TIMESTAMPTZ
}

// Table: email_logs
{
  id: UUID
  user_id: UUID
  email_type: TEXT
  sent_at: TIMESTAMPTZ
  opened: BOOLEAN
  clicked: BOOLEAN
}
```

**API Endpoints:**
- `POST /api/emails/send` - Send email (internal only)
- `PUT /api/emails/preferences` - Update email preferences
- `GET /api/emails/unsubscribe?token={token}` - One-click unsubscribe

**Cron Jobs:**
- `/api/cron/emails/daily-reminders` - Runs hourly (9-10 PM all timezones)
- `/api/cron/emails/weekly-digest` - Runs Sundays 8 PM all timezones
- `/api/cron/emails/monthly-report` - Runs 1st of month 9 AM all timezones

#### Success Metrics
- **Email deliverability:** 99%+ delivered (not bounced)
- **Open rate:** 30%+ for weekly digest, 40%+ for streak at risk
- **Click-through rate:** 15%+ for CTA links
- **Unsubscribe rate:** <5% within 30 days
- **Engagement lift:** Users receiving weekly digests have 20% higher D30 retention

---

### Feature 8: User Notification Preferences

#### Problem Statement
Users have different tolerance for notifications. One-size-fits-all notification strategies cause opt-outs and uninstalls. Users need granular control.

#### User Stories
- **As a notification-sensitive user**, I want to disable social notifications but keep streak reminders
- **As a busy professional**, I want to set "Do Not Disturb" hours when I won't receive notifications
- **As a data-driven user**, I want to see which notifications I've received and which I've acted on

#### Specifications

**Preference Categories:**

**1. Notification Channels:**
- Push notifications (iOS/Android)
- Email notifications
- In-app notifications (notification bell)

**2. Notification Types:**
- **Critical (cannot disable):**
  - Daily check-in reminder
  - Challenge milestones
  - FitCircle invitations
- **Optional:**
  - Streak at risk
  - Weekly goal progress
  - Leaderboard position changes
  - Social engagement (encouragement, high-fives)
  - Weekly digest
  - Monthly progress report

**3. Timing Preferences:**
- **Daily Reminder Time:** User selects 6 AM - 11 PM
- **Do Not Disturb Hours:** User selects start/end time (e.g., 10 PM - 7 AM)
- **Weekend Behavior:** "Pause non-critical notifications on weekends"

**UI/UX Requirements:**
- **Settings Page:** `/settings/notifications`
- **Channel Toggles:** Master switches for Push / Email / In-app
- **Type Controls:** Individual toggles for each notification type
  - Visual: Switch component with label + description
  - Disabled state: Critical notifications show "Required" label
- **Timing Controls:**
  - Time picker for daily reminder
  - Time range picker for DND hours
  - Checkbox for weekend pause
- **Notification History:** List of last 30 notifications
  - Columns: Type, Sent At, Opened (Y/N), Action Taken (Y/N)
  - Filter: By type, by channel

**Data Model:**
```typescript
// Table: notification_preferences
{
  id: UUID
  user_id: UUID

  // Channels
  push_enabled: BOOLEAN DEFAULT TRUE
  email_enabled: BOOLEAN DEFAULT TRUE
  inapp_enabled: BOOLEAN DEFAULT TRUE

  // Types (push)
  push_daily_checkin: BOOLEAN DEFAULT TRUE
  push_streak_risk: BOOLEAN DEFAULT TRUE
  push_weekly_goal: BOOLEAN DEFAULT TRUE
  push_data_submission: BOOLEAN DEFAULT TRUE
  push_leaderboard_change: BOOLEAN DEFAULT TRUE
  push_social_engagement: BOOLEAN DEFAULT TRUE
  push_weekly_digest: BOOLEAN DEFAULT TRUE
  push_challenge_milestone: BOOLEAN DEFAULT TRUE

  // Types (email)
  email_daily_checkin: BOOLEAN DEFAULT TRUE
  email_streak_risk: BOOLEAN DEFAULT TRUE
  email_weekly_digest: BOOLEAN DEFAULT TRUE
  email_monthly_report: BOOLEAN DEFAULT TRUE
  email_fitcircle_invite: BOOLEAN DEFAULT TRUE
  email_challenge_milestone: BOOLEAN DEFAULT TRUE

  // Timing
  daily_reminder_time: TIME DEFAULT '20:00:00'
  dnd_start: TIME DEFAULT '22:00:00'
  dnd_end: TIME DEFAULT '07:00:00'
  pause_weekends: BOOLEAN DEFAULT FALSE

  updated_at: TIMESTAMPTZ
}
```

**API Endpoints:**
- `GET /api/notifications/preferences` - Fetch user's preferences
- `PUT /api/notifications/preferences` - Update preferences
- `GET /api/notifications/history?limit=30` - Fetch notification history

**Technical Considerations:**
- **Default preferences:** Create row on user signup with defaults
- **Preference checks:** Before sending notification, query `notification_preferences`
- **DND enforcement:** Check current time against DND hours before sending
- **Weekend pause:** Check if today is Saturday/Sunday before sending non-critical
- **Preference caching:** Cache preferences in Redis (5-minute TTL) to reduce DB load

#### Success Metrics
- **Preference customization rate:** 40%+ of users customize preferences within 7 days
- **Opt-out reduction:** Granular controls reduce full opt-out rate by 50%
- **Timing accuracy:** 90%+ of notifications sent within user's preferred time windows
- **User satisfaction:** NPS +10 points for notification experience

---

## Success Metrics Summary

### Phase 1 Metrics (Core Engagement)

| Metric | Baseline | Target | Measurement |
|---|---|---|---|
| D7 Retention | Industry: 15% | 35%+ | Cohort analysis |
| Daily Active Users | Current baseline | +50% | Daily unique logins |
| Daily Goal Completion | N/A | 65%+ | % of users completing all daily goals |
| Weekly Goal Completion | N/A | 50%+ | % of users completing all weekly goals |
| Leaderboard View Rate | N/A | 80% | % of FitCircle members viewing weekly |
| 7-Day Streak Maintenance | N/A | 40% | % of users with 7+ day streaks |
| Data Submission Rate | N/A | 75%+ | % of DAUs submitting data to FitCircles |
| Check-in Completion Rate | Current: ~60% | 85%+ | % of DAUs completing full check-in flow |

### Phase 2 Metrics (Notification Infrastructure)

| Metric | Baseline | Target | Measurement |
|---|---|---|---|
| Push Opt-in Rate | N/A | 75%+ | % of users enabling push |
| Push Open Rate | N/A | 25%+ | % of notifications opened within 1 hour |
| Email Deliverability | N/A | 99%+ | % of emails not bounced |
| Email Open Rate | N/A | 30%+ weekly, 40%+ streak | % of emails opened |
| Notification-Driven Return | N/A | 25%+ | % of users opening app from notification |
| Preference Customization | N/A | 40%+ | % of users editing preferences in 7 days |
| Opt-out Rate | N/A | <10% | % of users disabling all notifications in 30 days |

### Combined Impact (Phase 1 + 2)

| Metric | Baseline | Target | Measurement |
|---|---|---|---|
| Overall Retention (D7) | 15% | 35%+ | Cohort analysis |
| Overall Retention (D30) | 10% | 20%+ | Cohort analysis |
| Challenge Completion | Current: ~55% | 70%+ | % of challenges completed |
| Churn Reduction | Current churn | -30% | Monthly churn rate |
| Sessions per Week | Current: 8 | 12+ | Avg sessions per active user |

---

## Implementation Considerations

### Phase 1: Core Engagement (Est. 6 weeks)

**Week 1-2: Daily & Weekly Goals**
- Build goal generation service with baseline calculation
- Create Dashboard widgets (circular progress rings)
- Implement API endpoints for goal CRUD
- Set up cron jobs for goal generation
- Testing: Unit tests for baseline calculation, E2E tests for goal flows

**Week 3-4: Leaderboards & Streaks**
- Build leaderboard ranking service with Redis caching
- Create FitCircle leaderboard UI components
- Implement streak tracking logic with freeze mechanics
- Build check-in flow with previous day acknowledgment
- Testing: Load tests for leaderboard queries, E2E tests for streak flows

**Week 5-6: Data Submission & Polish**
- Implement manual data submission flow
- Build FitCircle activity feed for submissions
- Add social encouragement actions
- Polish UI/UX based on internal testing
- Testing: Integration tests for submission → leaderboard updates

### Phase 2: Notification Infrastructure (Est. 4 weeks)

**Week 7-8: Push Notifications**
- Set up APNs and FCM integrations
- Build notification service in Supabase Edge Functions
- Implement device token registration
- Create notification preference data model
- Set up cron jobs for scheduled notifications
- Testing: Test notifications on real iOS/Android devices

**Week 9: Email Notifications**
- Integrate Resend email service
- Build React Email templates
- Implement email sending logic
- Set up email preference controls
- Testing: Test email deliverability across providers (Gmail, Outlook, etc.)

**Week 10: User Preferences & Launch**
- Build notification preferences UI
- Implement DND and timing controls
- Create notification history page
- Final QA and bug fixes
- Beta testing with 50 users
- Production launch

### Dependencies

**External Services:**
- **Apple Push Notification Service (APNs):** Requires Apple Developer account ($99/year)
- **Firebase Cloud Messaging (FCM):** Free tier sufficient for launch
- **Resend Email Service:** $20/month for 100K emails
- **Redis:** Vercel KV (included in Vercel Pro plan) for leaderboard caching

**Internal Dependencies:**
- Daily tracking system (already exists)
- Apple Health / Google Fit integration (already exists)
- FitCircle system (already exists)
- User authentication (already exists)

### Technical Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Leaderboard query performance** | High | Redis caching, batch recalculation, pagination for large FitCircles |
| **Notification delivery failures** | High | Retry logic, fallback to email, monitoring/alerting |
| **Timezone handling complexity** | Medium | Use user's stored timezone, test across all major timezones |
| **Streak calculation edge cases** | Medium | Comprehensive unit tests, freeze logic fallback |
| **User preference explosion** | Low | Start with 8-10 key preferences, expand based on user feedback |

### Rollout Strategy

**Beta Phase (Week 10-12):**
- Invite 50-100 active users
- A/B test notification frequency (2/week vs 4/week)
- Collect qualitative feedback via in-app survey
- Success criteria: 75%+ opt-in rate, 30%+ notification open rate

**Phased Launch (Week 12-14):**
- Week 12: Roll out to 25% of users
- Week 13: Roll out to 50% of users
- Week 14: Roll out to 100% of users
- Monitor metrics daily, rollback if critical issues

**Post-Launch Optimization (Month 4-6):**
- A/B test notification copy and timing
- Optimize leaderboard caching strategies
- Add user-requested notification types
- Expand to web push notifications (desktop)

---

## User Flows

### Flow 1: New User First Week (Onboarding to Habit Formation)

**Day 1 (Signup):**
1. User completes signup and onboarding
2. System generates conservative daily goals (5K steps, check-in only)
3. Welcome email sent immediately
4. User prompted to enable push notifications (75% opt-in target)
5. User completes first check-in → 1-day streak starts
6. User joins or creates first FitCircle
7. Push notification at 8 PM: "Complete your check-in to start your streak!"

**Day 2:**
1. Push notification at 8 PM: "Keep it going! Complete your check-in for a 2-day streak."
2. User opens app from notification
3. Check-in flow: Acknowledge Day 1 steps → Log mood/energy → Claim streak
4. User views leaderboard: Sees they're #5 in FitCircle
5. User submits data manually: "Submit 7,234 steps to Work Warriors"
6. Activity feed updates: "You submitted 7,234 steps"

**Day 3-4:**
1. User establishes check-in habit (8 PM reminder if not completed)
2. Daily goals remain conservative (building confidence)
3. User receives encouragement from FitCircle member → Push notification

**Day 5 (First Missed Day):**
1. User forgets to check in by midnight
2. Next morning (9 AM): Push notification "Your 4-day streak is at risk! You have 1 freeze left this week."
3. User opens app, sees freeze was auto-applied
4. User completes check-in, streak continues (but freeze used)

**Day 7 (First Milestone):**
1. User completes 7th consecutive check-in
2. Celebration animation: "🎉 1 Week Warrior badge unlocked!"
3. Push notification: "You did it! 7-day streak complete. Your daily goals are now personalized based on your baseline."
4. System recalculates goals: Steps increase from 5K → 8.5K (user's avg + 10%)
5. Weekly Digest email sent Sunday 8 PM

**Week 2 onward:**
1. User now in habit loop: Morning check, submit data, view leaderboard, evening check-in
2. Weekly goals provide medium-term structure
3. Leaderboard position changes drive competitive engagement
4. Social encouragement from FitCircle keeps motivation high

---

### Flow 2: Returning User Daily Loop

**Morning (7-9 AM):**
1. User wakes up, checks phone
2. Push notification: "Good morning! Your daily goals are ready."
3. User opens app → Dashboard shows:
   - Yesterday's performance: "8,234 steps (117% of goal) ✅"
   - Today's goals: Steps 8,500 | Check-in ⭕ | Weight ⭕
   - Current streak: 🔥 14 days
4. User completes quick check-in (2 minutes):
   - Acknowledge yesterday's steps + sentiment ("Great!")
   - Log mood/energy via circular sliders
   - Optionally log weight
5. User views FitCircle leaderboard: Sees they're #3, 500 steps behind #2

**Midday (12-1 PM):**
1. User checks app during lunch break
2. Sees leaderboard updated: Now #2 (teammates submitted data)
3. User sends encouragement to #1: "💪 Great pace today!"

**Evening (6-8 PM):**
1. Push notification: "You're at 7,200 steps—only 1,300 to go!"
2. User motivated to take evening walk
3. User checks app after walk: 8,700 steps (102% of goal)
4. Dashboard ring closes → Celebration animation

**Night (8-10 PM):**
1. Push notification: "Submit today's steps to Work Warriors before midnight!"
2. User submits data: "8,700 steps submitted to 3 FitCircles"
3. Activity feed updates: Real-time notification to FitCircle members
4. Leaderboard recalculates: User maintains #2 position
5. User closes app, satisfied with progress

**Weekly (Sunday 8 PM):**
1. Weekly Digest email arrives
2. User reviews: 58,400 steps (105% of weekly goal), 7-day streak maintained, #2 in Work Warriors
3. User feels pride, shares screenshot to Instagram
4. Next week's goals calculated: 60,000 steps (adaptive increase)

---

### Flow 3: Competitive User Leaderboard Engagement

**Scenario:** User is in close leaderboard battle for #1 position

**Monday Morning:**
1. User checks FitCircle leaderboard: Currently #2, 200 steps behind #1 (Sarah)
2. User submits yesterday's data: 10,234 steps
3. Leaderboard updates: User moves to #1
4. Push notification to Sarah: "📉 You dropped to #2 in Work Warriors"

**Monday Afternoon:**
1. Sarah submits 11,000 steps → Retakes #1
2. Push notification to user: "📉 Sarah just passed you in Work Warriors!"
3. User checks leaderboard: 766 steps behind
4. User goes for extra walk

**Monday Evening:**
1. User submits 11,800 steps → Reclaims #1
2. Activity feed: "🏃 [User] submitted 11,800 steps—now #1!"
3. Sarah sends encouragement: "🔥 Great hustle today!"
4. User responds: "💪 You too—see you at the top tomorrow!"

**Tuesday Morning:**
1. Weekly leaderboard shows close race (Monday = Day 1 of week)
2. User motivated to maintain lead all week
3. User checks leaderboard 3x more frequently than usual
4. Engagement metrics spike for both users

**Sunday Evening (Week End):**
1. Weekly Digest: "You won Work Warriors this week! 🏆"
2. User finished #1 with 62,340 steps (104% of goal)
3. Sarah finished #2 with 59,120 steps (98% of goal)
4. Both users' challenge completion likelihood increased due to sustained engagement

---

## Open Questions & Future Considerations

### Open Questions for User Research
1. **Optimal freeze policy:** Should users get 1 freeze/week or 2 freezes/month?
2. **Leaderboard anxiety:** Do bottom-ranked users feel demotivated? Should we hide bottom 20%?
3. **Notification fatigue threshold:** At what point do users find notifications overwhelming?
4. **Goal difficulty:** Should weekly goals be "achievable by 70% of users" or "stretch goals for 40%"?
5. **Social pressure:** Do FitCircle submission notifications create positive accountability or negative pressure?

### Future Feature Expansions (Post-Phase 2)
1. **Workout Goals:** Daily/weekly workout frequency targets (3x/week, 30 min/session)
2. **Nutrition Goals:** Macro tracking integration with MyFitnessPal
3. **Sleep Goals:** Sleep duration/quality tracking (Apple Health/Google Fit integration)
4. **Team Challenges:** FitCircle vs FitCircle competitions with aggregate leaderboards
5. **Personalized Goal Recommendations:** AI-powered goal adjustments based on historical performance
6. **Voice Notifications:** Alexa/Google Home integration for daily goal readouts
7. **Wearable Notifications:** Apple Watch/Fitbit notification delivery
8. **Web Push Notifications:** Desktop browser notifications for web app users

### A/B Testing Roadmap
- **Notification frequency:** 2/week vs 3/week vs 4/week
- **Notification timing:** 8 PM vs user's typical check-in time ±30 min
- **Leaderboard display:** Full roster vs Top 10 + user position
- **Streak freeze policy:** 1/week vs 2/month vs unlimited (premium feature)
- **Daily goal difficulty:** Conservative (70% success rate) vs Stretch (50% success rate)
- **Submission UX:** Auto-submit vs manual claim

---

## Conclusion

This two-phase engagement system transforms FitCircle from a passive tracking app into a habit-forming daily ritual. By combining daily/weekly goals, competitive leaderboards, streak mechanics, and intelligent notifications, we create multiple engagement loops that drive retention and reduce churn.

**Phase 1** provides the core mechanics users interact with: goals, leaderboards, streaks, and data submission. **Phase 2** ensures users remember to engage through push notifications, emails, and granular preference controls.

Together, these phases target a **35%+ D7 retention rate** (2.3x industry average) and a **50% increase in DAU**, positioning FitCircle as a best-in-class social fitness platform.

### Next Steps
1. **Technical design review** with engineering team (Week 1)
2. **User research sessions** with 10-15 target users to validate notification preferences (Week 1-2)
3. **Begin Phase 1 development** (Week 2)
4. **Set up APNs/FCM accounts and Resend integration** (Week 2)
5. **Beta recruitment:** Identify 50-100 active users for beta testing (Week 8)
6. **Launch readiness review** (Week 10)

---

**Document Owner:** Product Team
**Engineering Lead:** TBD
**Design Lead:** TBD
**Target Launch:** Phase 1: Week 6 | Phase 2: Week 10
**Success Review:** 30 days post-launch (metrics dashboard)
