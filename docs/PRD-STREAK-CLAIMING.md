# Daily Streak Claiming Feature - Product Requirements Document

**Version 1.0 | Last Updated: January 2025**
**Status:** Design Phase
**Owner:** Product Team
**Stakeholders:** iOS, Android, Backend, Design

---

## Executive Summary

This PRD defines the daily streak claiming feature for FitCircle, a social fitness competition platform. Currently, FitCircle tracks daily streaks automatically when users log data. To improve engagement and create habit-forming behaviors, we will introduce **active streak claiming** that requires users to take a deliberate daily action.

### Key Changes
- **Streaks require claiming**: Users must click "Claim Streak" or manually enter any daily data (weight, mood, energy, steps)
- **Auto-sync continues**: HealthKit/Google Fit still syncs steps and vitals for the last 7 days automatically
- **7-day retroactive claiming**: Users can claim any of the past 7 days they have data for
- **Enhanced gamification**: Visual rewards, milestone celebrations, and recovery mechanics

### Expected Impact
- **+25% Daily Active Users (DAU)**: Based on Duolingo's 60% engagement increase from streak focus
- **+40% D7 Retention**: Users with 3+ day streaks show 2x retention vs non-streak users
- **+15% Average Session Length**: Daily claiming ritual increases time in app

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Competitive Analysis](#competitive-analysis)
3. [User Research Insights](#user-research-insights)
4. [Feature Specification](#feature-specification)
5. [User Flows](#user-flows)
6. [Technical Requirements](#technical-requirements)
7. [Design Recommendations](#design-recommendations)
8. [Engagement Strategy](#engagement-strategy)
9. [Success Metrics](#success-metrics)
10. [Implementation Phases](#implementation-phases)
11. [Risk Analysis](#risk-analysis)
12. [Open Questions](#open-questions)

---

## Problem Statement

### Current State
FitCircle automatically tracks daily streaks when users log any data (weight, steps, mood). While this is convenient, it creates **passive engagement** where users may not consciously build daily habits.

**Issues with automatic streaks:**
- Users don't develop intentional daily rituals
- No sense of accomplishment from maintaining streak
- Missed opportunity for daily touchpoint
- Lower perceived value of streak achievement
- No structured time for users to review progress

### Desired State
Create an **active claiming system** where users must take deliberate action each day, while maintaining convenience through:
- One-tap claim button for users with auto-synced data
- Manual data entry as alternative claiming method
- 7-day retroactive claiming window for flexibility
- Enhanced visual rewards and celebration moments

### User Impact
- **Competitive Casey** (Primary Persona): Wants to see progress recognized daily, motivated by visible achievements
- **Social Sarah** (Secondary Persona): Needs daily reminder to engage with fitness community
- **Motivated Mike** (Tertiary Persona): Appreciates structured daily check-in without complexity

---

## Competitive Analysis

### Duolingo - The Gold Standard for Streaks

**Mechanics:**
- **Simple goal**: Complete 1 lesson per day to maintain streak
- **Claiming**: Automatic when lesson completed (not separate action)
- **Visual prominence**: Streak flame icon always visible, changes to yellow for "Perfect Week"
- **Grace period**: Streak Freeze available (can buy or earn)
- **Recovery**: "Earn Back" feature allows recovery through extra effort (2x XP next day)

**Key Learnings:**
- Simplicity drives consistency: "1 lesson" is clearer than "practice 5 minutes"
- Streaks became Duolingo's #1 driver of DAU after 600+ experiments
- Loss aversion is powerful: Users care more about maintaining than starting
- Visual differentiation (Perfect Week flame) creates aspirational goals

**Metrics:**
- 60% increase in user commitment from iOS widget showing streaks
- Streak feature credited as most important lever for DAU growth

### Habitica - RPG-Style Habit Tracking

**Mechanics:**
- **Daily tasks**: Users create custom "Dailies" that must be checked off
- **Claiming**: Manual checkbox for each daily habit
- **Streaks**: Track consecutive days completing each habit
- **Grace/Flexibility**: Users can set which days a Daily applies (skip weekends)
- **Recovery**: Manual streak editing allowed (trust-based system)
- **Gamification**: Streaks increase gold rewards by 1% per day

**Key Learnings:**
- Manual check-off creates satisfying completion moment
- Too many tasks leads to "grinding" instead of behavior change
- Focus on 3-5 core behaviors for best results
- Flexibility (free days) prevents demotivation from occasional misses

### Strava - Weekly Activity Streaks

**Mechanics:**
- **Frequency**: Weekly-based (upload once per week to maintain)
- **Claiming**: Automatic when activity uploaded
- **Visual**: Streak calendar in "You" tab
- **No recovery**: No freeze or grace mechanics

**Key Learnings:**
- Weekly cadence too forgiving for daily engagement
- Users requested more granular (daily) streak tracking
- Mixed reception: Some find it adds clutter without value
- Third-party apps exist to add daily streak tracking (unmet need)

### MyFitnessPal - Login-Based Streaks

**Mechanics:**
- **Simple trigger**: Just logging in counts (don't need to log food)
- **Claiming**: Automatic on login
- **No recovery**: No freeze mechanics
- **Technical issues**: Counter resets incorrectly, requires support to fix

**Key Learnings:**
- Login-only is too easy, doesn't drive meaningful engagement
- Lack of recovery mechanics creates frustration
- Technical reliability critical for user trust

### Key Patterns Across Apps (2025 Best Practices)

**Streak Freeze Mechanics:**
- 1-2 freezes per week standard
- Can earn through sustained streaks (Duolingo: earn 1 per 7 days)
- Max 5 freezes stored
- Option to purchase additional ($0.99 or in-app currency)

**Grace Periods:**
- 2-4 hours past midnight common
- Helps with timezone changes and late-night users
- "Earn Back" systems allow recovery through extra effort

**Notification Timing:**
- Morning reminder: 8-10am ("Start your day with...")
- Evening reminder: 6-8pm ("Don't break your streak!")
- 4-6 hours before midnight for last-chance reminders
- Apple Watch-style coaching throughout day

**Visual Design:**
- Circular progress indicators (Apple Watch influence)
- Fire/flame emoji for streaks (Duolingo, Snapchat)
- Color changes for milestones (yellow flame = perfect week)
- Calendar heat maps for long-term visualization

---

## User Research Insights

### Behavioral Psychology Principles

**1. Loss Aversion (Kahneman & Tversky)**
- People are 2x more motivated to avoid losses than gain rewards
- A 30-day streak represents investment users don't want to lose
- Design implication: Show what's at risk when streak endangered

**2. Habit Formation (BJ Fogg Behavior Model)**
- Behavior = Motivation × Ability × Prompt
- Daily streaks provide the Prompt (notification)
- Must keep Ability high (easy to claim)
- Motivation increases with streak length (investment)

**3. Variable Rewards (Nir Eyal - Hooked)**
- Predictable daily claim is "base layer"
- Add surprise elements: milestone badges, bonus XP, special animations
- Uncertainty in rewards drives engagement

**4. Progress Visualization**
- Endowed Progress Effect: Showing partial completion increases follow-through
- Streak calendar provides visual momentum
- Activity rings show daily progress toward multiple goals

### User Sentiment from Competitive Apps

**What Users Love:**
- "The streak keeps me coming back every day" (Duolingo)
- "Satisfying to check off my daily habits" (Habitica)
- "Love seeing my progress calendar" (Multiple apps)
- "Freeze feature saved my 100-day streak" (Duolingo)

**What Users Hate:**
- "Lost my 365-day streak due to timezone change" (MyFitnessPal)
- "Too many tasks makes it feel like a chore" (Habitica)
- "Streak calendar pushed down features I actually use" (Strava)
- "No way to recover from missing one day" (Most apps)

### FitCircle-Specific Considerations

**Existing User Base:**
- 93.3% test coverage indicates mature codebase
- Dark theme with bright accents already established
- Circular design language (Apple Watch inspiration) fits streak rings perfectly
- Multi-platform: Web, iOS (early development)

**Current Streak Implementation:**
- 3-tier system: Engagement, Metric, Circle streaks
- Freeze mechanics already built (1 per week)
- Weekly freeze reset on Mondays
- Grace system with auto-freeze application

---

## Feature Specification

### Core Requirements

#### 1. Claiming Mechanics

**P0 - Must Have**

**Claiming Methods (Either counts for the day):**

1. **Explicit Claim Button**
   - One-tap "Claim Today's Streak" button on dashboard
   - Available if any auto-synced data exists for today
   - Visual: Prominent circular button with flame icon
   - State changes: Unclaimed → Claimed (with animation)

2. **Implicit Claiming via Data Entry**
   - Manually entering ANY data claims the streak:
     - Weight log
     - Mood check-in
     - Energy level
     - Manual steps entry
   - Note: Auto-synced steps do NOT automatically claim
   - User must interact with the app to claim

**Rules:**
- One claim per calendar day (based on user's local timezone)
- Can claim any of the past 7 days if data exists
- Today (day 0) doesn't break streak until 3am next day (grace period)
- Auto-synced data populates but doesn't auto-claim

**Technical Validation:**
```typescript
interface ClaimValidation {
  can_claim: boolean;
  reason?: 'already_claimed' | 'no_data' | 'outside_window';
  data_sources: ('healthkit' | 'manual' | 'google_fit')[];
  has_auto_synced_data: boolean;
  has_manual_data: boolean;
}
```

#### 2. Data Sync vs. Claiming Separation

**Auto-Sync Behavior (Unchanged):**
- HealthKit/Google Fit sync last 7 days of steps and vitals
- Runs in background every 4 hours when app open
- Runs immediately on app launch
- Data visible in charts and activity rings
- Does NOT automatically claim streak

**Claiming Behavior (New):**
- User must take action to claim
- Claim button appears when auto-synced data exists
- Manual data entry also claims
- 7-day retroactive claiming window

**Example Scenarios:**

**Scenario 1: Active User**
- Day 1: User opens app, sees auto-synced 10K steps, clicks "Claim Streak" → Streak = 1
- Day 2: User manually logs weight → Auto-claimed → Streak = 2
- Day 3: User opens app, sees steps, forgets to claim → Streak still 2 (grace until 3am Day 4)
- Day 4 at 2am: User claims Day 3 retroactively → Streak = 3

**Scenario 2: Weekend Warrior**
- Friday: Claims streak (5-day streak)
- Saturday: Forgets to open app, no claim
- Sunday: Forgets to open app, no claim
- Monday: Opens app, sees 3 days of auto-synced data
  - Can claim Friday (already claimed ✓)
  - Can claim Saturday retroactively ✓
  - Can claim Sunday retroactively ✓
  - Claims today (Monday) ✓
  - Result: 7-day streak maintained with 1 freeze used

**Scenario 3: Passive Syncer**
- Auto-sync brings in 7 days of HealthKit data while user doesn't open app
- Day 8: User opens app, sees all data but hasn't claimed
- Streak = 0 (broken on Day 2 at 3am)
- Can start new streak by claiming Day 8

#### 3. Retroactive Claiming (7-Day Window)

**Rules:**
- Can claim any unclaimed day within past 7 days
- Must have data for that day (auto-synced or manual)
- Claims consume freezes for missed days
- Claims processed in chronological order

**UI/UX:**
- Calendar view shows last 7 days
- Days with data but unclaimed show "Claim" badge
- Already-claimed days show checkmark
- Days without data show greyed out
- Tap day to claim retroactively

**Freeze Consumption:**
```typescript
interface RetroactiveClaim {
  date: string;
  has_data: boolean;
  claimed: boolean;
  freeze_required: boolean; // True if previous day missed
  freeze_available: boolean;
  can_claim: boolean;
}
```

**Example:**
- Current streak: 10 days (last claim: Day 10)
- Day 11: Missed (no claim)
- Day 12: Missed (no claim)
- Day 13: User opens app, wants to claim Days 11-13
  - Claim Day 11: Requires freeze → Uses 1 freeze → Streak = 11
  - Claim Day 12: Consecutive to Day 11 → No freeze needed → Streak = 12
  - Claim Day 13: Consecutive to Day 12 → No freeze needed → Streak = 13

#### 4. Timezone Handling

**Challenge:** Users expect streaks to reset at midnight local time, but travel/DST can complicate this.

**Solution:**
- Store all timestamps in UTC
- Calculate streak windows in user's current timezone
- Detect timezone changes and adjust grace period
- Show user when their "day" expires in local time

**Technical Implementation:**
```typescript
interface StreakDay {
  date_utc: string; // YYYY-MM-DD in UTC
  date_local: string; // YYYY-MM-DD in user's timezone
  timezone: string; // IANA timezone (e.g., "America/Los_Angeles")
  expires_at: string; // ISO timestamp when day expires (3am next day local)
}
```

**Grace Period Adjustment:**
- Standard: Claim available until 3am next day (local time)
- Timezone change detected: Extend grace by 6 hours
- Prevents penalizing international travelers

**Edge Case: DST Transitions**
- Spring forward (lose hour): No penalty, use previous day's timezone
- Fall back (gain hour): No benefit, use current day's timezone

#### 5. Streak Freeze System (Existing, Enhanced)

**Current Implementation (Keep):**
- Start with 1 freeze
- Earn 1 freeze per 7-day streak milestone (max 5 freezes stored)
- Auto-reset: Add 1 freeze weekly (Mondays)
- Auto-apply: If miss a day, auto-use freeze if available

**Enhancements (New):**
- **Manual Freeze Activation**: User can manually activate freeze BEFORE missing a day
  - Use case: "I know I'll be traveling tomorrow"
  - UI: "Use Freeze" button on dashboard
  - Marks next day as "frozen" in advance

- **Freeze Purchase**: Buy additional freezes
  - Price: 100 XP or $0.99
  - Max 5 freezes stored
  - Clear messaging: "Insurance for your streak"

- **Freeze Transparency**: Always show freeze status
  - "You have 3 freezes available"
  - "Freeze used automatically on [date]"
  - "Next freeze resets in 3 days"

**Technical:**
```typescript
interface FreezeStatus {
  freezes_available: number;
  freezes_used_this_week: number;
  auto_freeze_reset_date: string;
  last_freeze_earned_streak: number;
  manual_freeze_activated_for_date?: string;
}
```

#### 6. Streak Recovery (New)

**Weekend Warrior Pass (Duolingo-inspired "Earn Back"):**
- If streak broken, user can recover by completing 2x daily actions next day
- Example: Log weight AND steps manually (not just claim auto-synced)
- Available only once per month
- Must recover within 48 hours of break
- UI: "Recover Your Streak" banner with countdown

**Milestone Shields (New Mechanic):**
- At 30, 60, 100, 365-day milestones, earn a "Streak Shield"
- Shield automatically saves streak once if broken
- One-time use per shield
- UI: Shield icon appears on streak counter when active

**Technical:**
```typescript
interface RecoveryStatus {
  streak_broken_date: string | null;
  recovery_available: boolean;
  recovery_deadline: string | null;
  recovery_completed_actions: string[]; // ['weight_log', 'steps_log']
  recovery_required_actions: number; // 2
  shields_available: number;
  shields_earned_at_streaks: number[]; // [30, 60, 100, 365]
}
```

### User Stories & Acceptance Criteria

#### User Story 1: Daily Claiming

**As a** FitCircle user
**I want to** claim my daily streak each day
**So that** I feel a sense of accomplishment and maintain my habit

**Acceptance Criteria:**
- [ ] Claim button visible on dashboard if data exists for today
- [ ] Claim button disabled if already claimed today
- [ ] Tapping claim button increments streak counter with animation
- [ ] Claim button shows checkmark after claiming
- [ ] Manual data entry (weight, mood, energy) auto-claims the day
- [ ] Streak counter updates immediately after claim
- [ ] Claiming triggers XP reward (+10 XP)
- [ ] Milestone claims show special celebration animation

#### User Story 2: Retroactive Claiming

**As a** busy user who missed claiming yesterday
**I want to** claim previous days if I have data
**So that** I don't lose my streak due to forgetting to open the app

**Acceptance Criteria:**
- [ ] 7-day calendar view shows claimable days
- [ ] Days with data but unclaimed show "Claim" badge
- [ ] Tapping past day claims it retroactively
- [ ] Freezes consumed for gap days automatically
- [ ] Clear messaging if insufficient freezes to claim
- [ ] Chronological claiming enforced (can't skip days)
- [ ] Visual feedback when retroactive claim succeeds
- [ ] Streak counter updates to reflect retroactive claims

#### User Story 3: Freeze Management

**As a** user planning to travel
**I want to** activate a freeze in advance
**So that** my streak is protected even if I can't access the app

**Acceptance Criteria:**
- [ ] "Use Freeze" button visible on dashboard
- [ ] Confirmation modal explains freeze usage
- [ ] Freeze status shows "Next day frozen" after activation
- [ ] Frozen days show ice crystal icon in calendar
- [ ] Freeze counter decrements after use
- [ ] Clear messaging when no freezes available
- [ ] Option to purchase more freezes (100 XP or $0.99)
- [ ] Weekly reset adds 1 freeze (max 5) on Mondays

#### User Story 4: Streak Recovery

**As a** user who broke a long streak
**I want to** recover my streak by extra effort
**So that** I don't lose months of progress to one mistake

**Acceptance Criteria:**
- [ ] "Recover Streak" banner appears if streak broken
- [ ] Banner shows countdown timer (48 hours)
- [ ] Recovery requires 2 manual data entries (not just claim)
- [ ] Progress shown: "1 of 2 actions completed"
- [ ] Streak restored to previous count if recovered
- [ ] Recovery option expires after 48 hours
- [ ] Milestone shields auto-recover streak if available
- [ ] Clear messaging on shield activation

#### User Story 5: Milestone Celebrations

**As a** motivated user reaching streak milestones
**I want to** receive special recognition
**So that** I feel rewarded for my consistency

**Acceptance Criteria:**
- [ ] Milestones at 3, 7, 14, 30, 60, 100, 365 days
- [ ] Full-screen celebration animation on milestone claim
- [ ] Unique badge awarded for each milestone
- [ ] Shareable achievement card generated
- [ ] Special notification sent at milestone achievement
- [ ] Milestone badge visible on profile
- [ ] Leaderboard highlights milestone achievers
- [ ] Milestone shields awarded at 30, 60, 100, 365 days

---

## User Flows

### Flow 1: First-Time Daily Claim

```
1. User opens FitCircle app (Day 1)
   ↓
2. HealthKit syncs 8,500 steps automatically
   ↓
3. Dashboard shows:
   - Activity rings (steps partial filled)
   - Prominent "Claim Today's Streak" button (glowing)
   - Streak counter: 0 days
   ↓
4. User taps "Claim Today's Streak"
   ↓
5. Animation: Flame icon appears, counter animates 0 → 1
   ↓
6. Toast notification: "Streak started! Come back tomorrow to keep it going 🔥"
   ↓
7. Button state changes to "Claimed Today ✓" (disabled)
   ↓
8. User receives +10 XP
```

### Flow 2: Morning Claim with Auto-Synced Data

```
1. User wakes up on Day 7 of streak
   ↓
2. Receives push notification at 8am:
   "Good morning! Your steps are ready. Claim your streak! 🔥"
   ↓
3. Taps notification → Opens app
   ↓
4. Dashboard shows:
   - Yesterday's steps (10,200) auto-synced overnight
   - "Claim Today's Streak" button (pulsing)
   - Streak: 6 days → 7 days pending claim
   ↓
5. User taps "Claim Today's Streak"
   ↓
6. Milestone animation: "7-Day Warrior! 💪"
   ↓
7. Badge unlocked: "1 Week Warrior"
   ↓
8. Shareable card offered: "I've maintained a 7-day fitness streak!"
   ↓
9. Streak counter: 7 days
   ↓
10. Freeze earned: +1 freeze (first 7-day milestone)
```

### Flow 3: Retroactive Claim After Weekend

```
1. User's last claim: Friday (5-day streak)
   ↓
2. Saturday: User doesn't open app (HealthKit still syncs in background)
   ↓
3. Sunday: User doesn't open app (HealthKit still syncs)
   ↓
4. Monday morning: User opens app
   ↓
5. Dashboard shows:
   - Streak status: "Streak at risk! Claim your missed days"
   - Calendar view (last 7 days):
     * Friday: ✓ Claimed
     * Saturday: ⚠️ Unclaimed (data available)
     * Sunday: ⚠️ Unclaimed (data available)
     * Monday: 🔵 Claim Today
   - Freezes available: 1
   ↓
6. User taps Saturday
   ↓
7. Modal: "Claim Saturday's streak?"
   - "You have 10,500 steps synced for this day"
   - "This will use 1 freeze (consecutive to Friday)"
   - [Cancel] [Claim Saturday]
   ↓
8. User taps "Claim Saturday"
   ↓
9. Animation: Saturday checkmark appears, freeze counter: 1 → 0
   ↓
10. User taps Sunday
   ↓
11. Modal: "Claim Sunday's streak?"
   - "You have 9,800 steps synced for this day"
   - "No freeze needed (consecutive to Saturday)"
   - [Cancel] [Claim Sunday]
   ↓
12. User taps "Claim Sunday"
   ↓
13. Animation: Sunday checkmark appears
   ↓
14. User taps "Claim Today" for Monday
   ↓
15. Success: Streak now 8 days, 0 freezes remaining
   ↓
16. Toast: "Welcome back! Your 8-day streak is safe 🎉"
```

### Flow 4: Manual Data Entry Claims Streak

```
1. User opens app on Day 12 of streak
   ↓
2. No auto-synced data available (HealthKit disabled)
   ↓
3. Dashboard shows:
   - "No data yet today. Log to claim your streak!"
   - Weight log card (empty)
   - Streak: 11 days (claimed yesterday)
   ↓
4. User taps "Log Weight"
   ↓
5. Weight entry modal appears
   ↓
6. User enters 185.2 lbs
   ↓
7. User taps "Save"
   ↓
8. Weight saved to database
   ↓
9. Automatic streak claim triggered
   ↓
10. Animation: Streak counter 11 → 12
   ↓
11. Toast: "Weight logged & streak claimed! 🔥"
   ↓
12. Dashboard updates:
   - Weight chart shows new data point
   - "Claimed Today ✓" button appears (disabled)
   - Streak: 12 days
```

### Flow 5: Freeze Used Automatically

```
1. User has 15-day streak, 2 freezes
   ↓
2. Day 16: User travels, doesn't open app
   ↓
3. Day 16 expires at 3am Day 17 (local time)
   ↓
4. Backend cron job runs at 3:10am:
   - Detects no claim for Day 16
   - User has 2 freezes available
   - Auto-applies 1 freeze
   - Maintains streak at 15 days
   - Freezes: 2 → 1
   ↓
5. Day 17 at 10am: User opens app
   ↓
6. Banner message:
   "⚠️ Streak Protected! We used 1 freeze for yesterday"
   - "You have 1 freeze remaining"
   - "Claim today to keep your 15-day streak going!"
   ↓
7. Calendar shows Day 16 with ice crystal icon (❄️)
   ↓
8. User taps "Claim Today"
   ↓
9. Streak continues: 16 days, 1 freeze remaining
```

### Flow 6: Streak Broken, Recovery Offered

```
1. User has 42-day streak, 0 freezes
   ↓
2. Day 43: User ill, doesn't open app
   ↓
3. Day 43 expires at 3am Day 44
   ↓
4. Backend cron: No freezes available, streak breaks
   ↓
5. Day 44 at 9am: User opens app
   ↓
6. Full-screen modal:
   "💔 Your 42-day streak ended yesterday"
   - "But you can recover it!"
   - "Complete 2 actions today to restore your streak"
   - "Recovery available for 48 hours"
   - [Dismiss] [Start Recovery]
   ↓
7. User taps "Start Recovery"
   ↓
8. Dashboard shows recovery banner:
   "Streak Recovery Active (47:32 remaining)"
   - "Log 2 different data types today"
   - Progress: 0 of 2 actions
   ↓
9. User logs weight → Progress: 1 of 2 ✓
   ↓
10. User logs mood → Progress: 2 of 2 ✓
   ↓
11. Success animation: "Streak Recovered! 🎉"
   ↓
12. Streak restored to 42 days
   ↓
13. Recovery cooldown: Next recovery available in 30 days
```

### Flow 7: Milestone Shield Auto-Recovery

```
1. User reaches 100-day streak
   ↓
2. Celebration: "Centurion! 👑"
   ↓
3. Badge: "100-Day Centurion" unlocked
   ↓
4. Milestone Shield awarded: "Your next streak break is automatically protected"
   ↓
5. Dashboard shows shield icon next to streak counter
   ↓
...
6. Day 142: User forgets to claim, 0 freezes
   ↓
7. Backend cron: Streak would break, but shield available
   ↓
8. Shield auto-activates, streak maintained
   ↓
9. Day 143: User opens app
   ↓
10. Banner: "🛡️ Milestone Shield Protected Your Streak!"
   - "Your 100-day shield saved your streak yesterday"
   - "Shield used (1-time protection)"
   - "Earn another shield at 365 days!"
   ↓
11. Shield icon removed from streak counter
   ↓
12. Streak continues: 142 days
```

---

## Technical Requirements

### Database Schema Changes

#### New Tables

**1. `streak_claims` table** (New)
```sql
CREATE TABLE streak_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  claim_date DATE NOT NULL,

  -- Claiming metadata
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claim_method TEXT NOT NULL CHECK (claim_method IN (
    'explicit_button',
    'weight_log',
    'steps_log',
    'mood_log',
    'energy_log'
  )),

  -- Retroactive claiming
  is_retroactive BOOLEAN NOT NULL DEFAULT false,
  retroactive_claimed_at TIMESTAMPTZ,
  freeze_used BOOLEAN NOT NULL DEFAULT false,

  -- Data validation
  had_auto_synced_data BOOLEAN NOT NULL DEFAULT false,
  had_manual_data BOOLEAN NOT NULL DEFAULT false,

  -- Timezone tracking
  timezone TEXT NOT NULL, -- IANA timezone

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One claim per user per day
  CONSTRAINT unique_user_claim_date UNIQUE (user_id, claim_date)
);

CREATE INDEX idx_streak_claims_user_date ON streak_claims(user_id, claim_date DESC);
CREATE INDEX idx_streak_claims_claimed_at ON streak_claims(claimed_at);
```

**2. `streak_recoveries` table** (New)
```sql
CREATE TABLE streak_recoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Recovery window
  streak_broken_date DATE NOT NULL,
  recovery_deadline TIMESTAMPTZ NOT NULL,
  recovered_at TIMESTAMPTZ,

  -- Recovery requirements
  required_actions INTEGER NOT NULL DEFAULT 2,
  completed_actions JSONB NOT NULL DEFAULT '[]', -- ['weight_log', 'steps_log']

  -- Recovery result
  recovery_status TEXT NOT NULL CHECK (recovery_status IN (
    'active',
    'completed',
    'expired',
    'cancelled'
  )),
  previous_streak INTEGER NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_streak_recoveries_user ON streak_recoveries(user_id);
CREATE INDEX idx_streak_recoveries_status ON streak_recoveries(recovery_status);
```

**3. `streak_shields` table** (New)
```sql
CREATE TABLE streak_shields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Shield details
  earned_at_streak INTEGER NOT NULL, -- 30, 60, 100, 365
  earned_date DATE NOT NULL,

  -- Usage
  used BOOLEAN NOT NULL DEFAULT false,
  used_date DATE,
  protected_date DATE, -- Which day was protected

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_streak_shields_user ON streak_shields(user_id);
CREATE INDEX idx_streak_shields_unused ON streak_shields(user_id, used) WHERE used = false;
```

#### Modified Tables

**Update `engagement_streaks` table** (Add claiming fields)
```sql
-- Add new columns to existing engagement_streaks table
ALTER TABLE engagement_streaks
  ADD COLUMN last_claim_date DATE,
  ADD COLUMN last_claim_method TEXT,
  ADD COLUMN total_claims INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN recovery_available_date DATE, -- When next recovery unlocks
  ADD COLUMN manual_freeze_active_for_date DATE; -- Manually activated freeze

-- Add comment
COMMENT ON COLUMN engagement_streaks.last_claim_date IS 'Last date streak was claimed (may differ from last_engagement_date)';
COMMENT ON COLUMN engagement_streaks.recovery_available_date IS 'Date when streak recovery becomes available again (30-day cooldown)';
```

### API Endpoints

#### 1. Streak Claiming Endpoints

**POST `/api/streaks/claim`** - Claim today's or past streak
```typescript
// Request
{
  date?: string; // Optional, defaults to today. Format: YYYY-MM-DD
  method: 'explicit_button' | 'weight_log' | 'steps_log' | 'mood_log' | 'energy_log';
  timezone: string; // IANA timezone
}

// Response
{
  success: boolean;
  streak: {
    current_streak: number;
    longest_streak: number;
    last_claim_date: string;
    freezes_available: number;
    freeze_used: boolean;
    milestone_reached?: {
      days: number;
      name: string;
      badge: string;
      shield_earned: boolean;
    };
  };
  error?: string;
}
```

**GET `/api/streaks/claim-status`** - Check if can claim
```typescript
// Query params: ?date=YYYY-MM-DD (optional, defaults to today)

// Response
{
  can_claim: boolean;
  reason?: 'already_claimed' | 'no_data' | 'outside_window' | 'insufficient_freezes';
  data_sources: ('healthkit' | 'manual' | 'google_fit')[];
  has_auto_synced_data: boolean;
  has_manual_data: boolean;
  freeze_required: boolean;
  freezes_available: number;
}
```

**GET `/api/streaks/claimable-days`** - Get last 7 days claim status
```typescript
// Response
{
  days: Array<{
    date: string; // YYYY-MM-DD
    claimed: boolean;
    can_claim: boolean;
    has_data: boolean;
    freeze_required: boolean;
    data_sources: string[];
    expires_at: string; // ISO timestamp
  }>;
  current_streak: number;
  freezes_available: number;
}
```

#### 2. Freeze Management Endpoints

**POST `/api/streaks/freeze/activate`** - Manually activate freeze
```typescript
// Request
{
  for_date?: string; // Optional, defaults to tomorrow. Format: YYYY-MM-DD
}

// Response
{
  success: boolean;
  freezes_remaining: number;
  freeze_active_for: string; // Date freeze protects
  error?: string;
}
```

**POST `/api/streaks/freeze/purchase`** - Purchase additional freeze
```typescript
// Request
{
  payment_method: 'xp' | 'stripe';
  payment_id?: string; // Stripe payment intent ID if using Stripe
}

// Response
{
  success: boolean;
  freezes_available: number;
  xp_balance?: number; // If paid with XP
  error?: string;
}
```

#### 3. Recovery Endpoints

**POST `/api/streaks/recovery/start`** - Start streak recovery
```typescript
// Request
{
  broken_date: string; // YYYY-MM-DD
}

// Response
{
  success: boolean;
  recovery: {
    id: string;
    deadline: string; // ISO timestamp
    required_actions: number;
    completed_actions: string[];
    previous_streak: number;
  };
  error?: string;
}
```

**POST `/api/streaks/recovery/record-action`** - Record recovery action
```typescript
// Request
{
  recovery_id: string;
  action: 'weight_log' | 'steps_log' | 'mood_log' | 'energy_log';
}

// Response
{
  success: boolean;
  recovery: {
    completed_actions: string[];
    required_actions: number;
    is_complete: boolean;
    streak_restored: boolean;
  };
  error?: string;
}
```

**GET `/api/streaks/recovery/status`** - Get active recovery status
```typescript
// Response
{
  has_active_recovery: boolean;
  recovery?: {
    id: string;
    deadline: string;
    required_actions: number;
    completed_actions: string[];
    time_remaining_seconds: number;
  };
  next_recovery_available: string | null; // ISO date
}
```

### Business Logic Service Layer

**`/apps/web/app/lib/services/streak-claiming-service.ts`**

```typescript
export class StreakClaimingService {
  /**
   * Claim a streak for a specific date
   * Handles validation, freeze consumption, milestone detection
   */
  static async claimStreak(
    userId: string,
    date: string,
    method: ClaimMethod,
    timezone: string
  ): Promise<ClaimResult>

  /**
   * Check if a date can be claimed
   * Returns detailed validation info
   */
  static async canClaimDate(
    userId: string,
    date: string,
    timezone: string
  ): Promise<ClaimValidation>

  /**
   * Get claimable days within 7-day window
   * Returns array of days with claim status
   */
  static async getClaimableDays(
    userId: string,
    timezone: string
  ): Promise<ClaimableDay[]>

  /**
   * Calculate freeze requirement for claiming a date
   * Handles gap detection and freeze availability
   */
  static async calculateFreezeRequirement(
    userId: string,
    targetDate: string
  ): Promise<FreezeRequirement>

  /**
   * Detect and return milestone if reached
   */
  static async detectMilestone(
    previousStreak: number,
    newStreak: number
  ): Promise<StreakMilestone | null>

  /**
   * Award milestone shield if applicable
   */
  static async awardMilestoneShield(
    userId: string,
    streakDays: number
  ): Promise<void>

  /**
   * Process retroactive claims in chronological order
   * Handles multiple days with freeze consumption
   */
  static async processRetroactiveClaims(
    userId: string,
    dates: string[],
    timezone: string
  ): Promise<RetroactiveClaimResult>
}
```

### Platform-Specific Considerations

#### iOS Implementation

**HealthKit Data Sync:**
```swift
// Sync last 7 days of steps and vitals
func syncHealthKitData() async throws {
    let endDate = Date()
    let startDate = Calendar.current.date(byAdding: .day, value: -7, to: endDate)!

    // Query HealthKit for steps
    let steps = try await querySteps(from: startDate, to: endDate)

    // Query vitals (heart rate, sleep, etc.)
    let vitals = try await queryVitals(from: startDate, to: endDate)

    // Send to backend (does NOT auto-claim)
    try await api.syncHealthData(steps: steps, vitals: vitals)
}

// Claim streak button action
func claimStreakForToday() async throws {
    let timezone = TimeZone.current.identifier
    let result = try await api.claimStreak(
        date: Date(),
        method: .explicitButton,
        timezone: timezone
    )

    // Show animation
    if let milestone = result.milestone {
        showMilestoneAnimation(milestone)
    }

    // Haptic feedback
    HapticFeedback.success()
}
```

**Local Timezone Handling:**
```swift
// Calculate when today's claim window expires
func getClaimExpirationTime() -> Date {
    let calendar = Calendar.current
    var components = calendar.dateComponents([.year, .month, .day], from: Date())
    components.hour = 3  // 3am grace period
    components.minute = 0
    components.second = 0

    let tomorrow = calendar.date(byAdding: .day, value: 1, to: Date())!
    return calendar.date(from: components)!
}
```

#### Android Implementation

**Google Fit Data Sync:**
```kotlin
// Sync last 7 days of activity data
suspend fun syncGoogleFitData() {
    val endTime = System.currentTimeMillis()
    val startTime = endTime - TimeUnit.DAYS.toMillis(7)

    // Query Google Fit for steps
    val stepsResponse = Fitness.getHistoryClient(context, account)
        .readData(DataReadRequest.Builder()
            .read(DataType.TYPE_STEP_COUNT_DELTA)
            .setTimeRange(startTime, endTime, TimeUnit.MILLISECONDS)
            .build())
        .await()

    // Send to backend (does NOT auto-claim)
    api.syncHealthData(steps = stepsResponse.dataSets)
}

// Claim streak button
suspend fun claimStreakForToday() {
    val timezone = TimeZone.getDefault().id
    val result = api.claimStreak(
        date = LocalDate.now(),
        method = ClaimMethod.ExplicitButton,
        timezone = timezone
    )

    // Show animation
    result.milestone?.let { showMilestoneAnimation(it) }
}
```

#### Web Implementation

**Claim Button Component:**
```typescript
// /apps/web/app/components/StreakClaimButton.tsx
export function StreakClaimButton() {
  const { user } = useAuth();
  const [claiming, setClaiming] = useState(false);
  const [claimStatus, setClaimStatus] = useState<ClaimStatus | null>(null);

  // Check claim status on mount
  useEffect(() => {
    async function checkStatus() {
      const status = await api.getClaimStatus();
      setClaimStatus(status);
    }
    checkStatus();
  }, []);

  const handleClaim = async () => {
    setClaiming(true);
    try {
      const result = await api.claimStreak({
        method: 'explicit_button',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      if (result.milestone_reached) {
        showMilestoneModal(result.milestone_reached);
      }

      toast.success(`${result.streak.current_streak}-day streak! 🔥`);
      setClaimStatus({ ...claimStatus, claimed: true });
    } catch (error) {
      toast.error('Failed to claim streak');
    } finally {
      setClaiming(false);
    }
  };

  if (claimStatus?.claimed) {
    return (
      <Button disabled variant="success">
        Claimed Today ✓
      </Button>
    );
  }

  return (
    <Button
      onClick={handleClaim}
      loading={claiming}
      disabled={!claimStatus?.can_claim}
      variant="primary"
      size="large"
      className="streak-claim-button"
    >
      <FlameIcon /> Claim Today's Streak
    </Button>
  );
}
```

### Cron Jobs / Scheduled Tasks

**1. Daily Streak Validation** (Runs at 3:10am in all timezones)
```typescript
// /apps/web/app/api/cron/validate-streak-claims/route.ts
export async function GET(request: NextRequest) {
  // Verify cron secret
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = await StreakClaimingService.validateAllStreaks();

  return NextResponse.json({
    validated: results.validated,
    freezes_used: results.freezesUsed,
    shields_used: results.shieldsUsed,
    streaks_broken: results.streaksBroken,
    recoveries_offered: results.recoveriesOffered,
  });
}

// vercel.json cron config
{
  "crons": [{
    "path": "/api/cron/validate-streak-claims",
    "schedule": "10 3 * * *"  // 3:10am daily
  }]
}
```

**2. Weekly Freeze Reset** (Runs Monday at 12:01am)
```typescript
// /apps/web/app/api/cron/reset-weekly-freezes/route.ts
export async function GET(request: NextRequest) {
  // Verify cron secret
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = await EngagementStreakService.resetWeeklyFreezes(createAdminSupabase());

  return NextResponse.json({
    users_reset: results.reset,
    error: results.error,
  });
}

// vercel.json cron config
{
  "crons": [{
    "path": "/api/cron/reset-weekly-freezes",
    "schedule": "1 0 * * 1"  // Monday 12:01am
  }]
}
```

**3. Recovery Expiration Check** (Runs every hour)
```typescript
// /apps/web/app/api/cron/expire-recoveries/route.ts
export async function GET(request: NextRequest) {
  // Verify cron secret
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = await StreakRecoveryService.expireExpiredRecoveries();

  return NextResponse.json({
    expired: results.expired,
  });
}

// vercel.json cron config
{
  "crons": [{
    "path": "/api/cron/expire-recoveries",
    "schedule": "0 * * * *"  // Every hour
  }]
}
```

---

## Design Recommendations

### Visual Design Language

**FitCircle Design Principles:**
- **Dark theme forced**: Slate-950/900 gradients
- **Bright accents**: Cyan (#06b6d4), Purple (#8b5cf6), Orange (#f97316), Green (#10b981)
- **Circular motifs**: Apple Watch-inspired activity rings
- **Glass-morphism**: Backdrop blur, translucent cards
- **Brand colors**:
  - Indigo (#6366f1): Steps, info states
  - Purple (#8b5cf6): Weight tracking, achievements, CTA buttons
  - Orange (#f97316): Streaks, energy levels 🔥
  - Green (#10b981): Success states, check-ins

### Streak UI Components

#### 1. Dashboard Claim Button (Primary CTA)

**Unclaimed State:**
```
┌─────────────────────────────────────────┐
│                                         │
│        🔥 Claim Today's Streak         │
│                                         │
│     [Large circular button, glowing]    │
│     Background: Orange gradient         │
│     Pulsing animation (subtle)          │
│                                         │
└─────────────────────────────────────────┘
```

**Claimed State:**
```
┌─────────────────────────────────────────┐
│                                         │
│          ✓ Claimed Today!              │
│                                         │
│     [Large circular button, green]      │
│     Static (no animation)               │
│     Disabled state                      │
│                                         │
└─────────────────────────────────────────┘
```

**Sizes:**
- Desktop: 200px diameter circle
- Mobile: 160px diameter circle
- Touch target: Minimum 44px (iOS HIG compliance)

**States:**
- Default (claimable): Orange gradient (#f97316 → #ea580c), pulsing shadow
- Hover: Slight scale (1.05), brighter shadow
- Active: Scale (0.98), deeper shadow
- Claimed: Green (#10b981), checkmark icon, disabled
- No data: Gray (#6b7280), "Log Data to Claim" text, disabled

#### 2. Streak Counter Display

**Circular Ring Design (Apple Watch-inspired):**
```
┌─────────────────────────────────────────┐
│                                         │
│             ╭─────────╮                │
│            ╱  🔥  42  ╲               │
│           │    days    │              │
│            ╲ ▓▓▓▓▓▓▓▓ ╱               │
│             ╰─────────╯                │
│                                         │
│        Longest: 85 days  🏆           │
│                                         │
└─────────────────────────────────────────┘
```

**Ring Segments:**
- 0-6 days: Orange single ring (thin)
- 7-29 days: Orange + Purple dual rings
- 30-99 days: Orange + Purple + Cyan triple rings
- 100+ days: Full rainbow gradient, thick rings

**Progress Indication:**
- Ring fills clockwise from top
- Next milestone shown as ghost segment
- Milestone markers at 7, 14, 30, 60, 100, 365 days

#### 3. 7-Day Calendar View (Retroactive Claiming)

**Layout:**
```
┌────────────────────────────────────────────────────────┐
│  Last 7 Days                                           │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Mon   Tue   Wed   Thu   Fri   Sat   Sun             │
│  ───   ───   ───   ───   ───   ───   ───             │
│  [✓]   [✓]   [⚠️]   [⚠️]   [✓]   [❄️]   [🔵]        │
│  Jan8  Jan9  Jan10 Jan11 Jan12 Jan13 Jan14           │
│                                                        │
│  ✓  Claimed    ⚠️ Unclaimed    ❄️ Frozen    🔵 Today  │
│                                                        │
│  Tap a day to claim retroactively                     │
│  Freezes available: 2                                 │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Day Cell States:**
- Claimed: Green background, checkmark
- Unclaimed (data available): Orange pulsing border, warning icon
- No data: Gray, locked icon
- Frozen: Blue-white gradient, ice crystal
- Today: Blue accent, highlighted border
- Outside window: Faded, non-interactive

**Interaction:**
- Tap day → Modal with claim details
- Long press → Preview data for that day
- Swipe left → Extend to 14 days (power user feature)

#### 4. Milestone Celebration Modal

**Full-Screen Takeover Animation:**
```
┌────────────────────────────────────────────────────────┐
│                                                        │
│                    [Confetti animation]                │
│                                                        │
│                         🏆                            │
│                                                        │
│                    30-Day Master!                     │
│                                                        │
│          You've maintained a 30-day streak            │
│                                                        │
│                    [Badge visual]                     │
│                                                        │
│                 🛡️ Milestone Shield Earned!           │
│         Your next streak break is protected           │
│                                                        │
│              [Share Achievement button]               │
│                [Continue button]                      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Animation Sequence:**
1. Screen fade to dark
2. Confetti explosion from center (1s)
3. Badge scales in with bounce (0.8s)
4. Title fades in with glow effect (0.5s)
5. Description slides up (0.3s)
6. Buttons fade in (0.3s)
Total: ~3 seconds

**Badges:**
- 3 days: Bronze flame 🔥
- 7 days: Silver muscle 💪
- 14 days: Gold trophy 🏆
- 30 days: Platinum medal 🎖️ + shield
- 60 days: Diamond star ⭐ + shield
- 100 days: Crown 👑 + shield
- 365 days: Legendary medal 🏅 + shield

#### 5. Freeze Management Widget

**Compact View (Dashboard):**
```
┌────────────────────────────────────────────────────────┐
│  Streak Freezes: ❄️❄️❄️ (3 available)                │
│  Next reset in 4 days                                  │
│                                                        │
│  [Use Freeze] [Buy More]                              │
└────────────────────────────────────────────────────────┘
```

**Expanded View (Settings):**
```
┌────────────────────────────────────────────────────────┐
│  Streak Protection                                     │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ❄️ Freezes Available: 3 / 5                         │
│  [▓▓▓░░]                                              │
│                                                        │
│  🔄 Weekly Reset: Monday (4 days)                    │
│  Earn 1 freeze every 7-day streak maintained          │
│                                                        │
│  ┌────────────────────────────────────┐              │
│  │  Activate Freeze                   │              │
│  │                                    │              │
│  │  Protect tomorrow's streak         │              │
│  │  (for planned travel/busy day)     │              │
│  │                                    │              │
│  │  [Activate Freeze for Tomorrow]   │              │
│  └────────────────────────────────────┘              │
│                                                        │
│  ┌────────────────────────────────────┐              │
│  │  Purchase Freeze                   │              │
│  │                                    │              │
│  │  100 XP or $0.99                  │              │
│  │  Max 5 freezes stored              │              │
│  │                                    │              │
│  │  [Buy with XP] [Buy with Card]    │              │
│  └────────────────────────────────────┘              │
│                                                        │
└────────────────────────────────────────────────────────┘
```

#### 6. Recovery Banner (Streak Broken)

**Alert Banner (Top of Dashboard):**
```
┌────────────────────────────────────────────────────────┐
│  💔 Streak Broken                                      │
│  Your 42-day streak ended yesterday                    │
│                                                        │
│  But you can recover it! Complete 2 actions today:    │
│                                                        │
│  ☐ Log weight        ☐ Log mood                       │
│                                                        │
│  ⏰ Recovery expires in 47:32                         │
│                                                        │
│  [Dismiss] [Start Recovery]                           │
└────────────────────────────────────────────────────────┘
```

**Progress View (During Recovery):**
```
┌────────────────────────────────────────────────────────┐
│  🔄 Streak Recovery Active                             │
│                                                        │
│  Progress: 1 of 2 actions completed                    │
│  [▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░] 50%                          │
│                                                        │
│  ✅ Weight logged                                      │
│  ☐ Waiting for 1 more action...                       │
│                                                        │
│  ⏰ 47:32 remaining                                   │
│                                                        │
│  Quick actions:                                       │
│  [Log Mood] [Log Energy] [Log Steps]                 │
└────────────────────────────────────────────────────────┘
```

#### 7. Milestone Shield Indicator

**Shield Badge (On Streak Counter):**
```
┌─────────────────────────────────────────┐
│                                         │
│          ╭─────────╮                   │
│         ╱ 🛡️🔥 42 ╲                  │
│        │   days    │                  │
│         ╲ ▓▓▓▓▓▓▓ ╱                   │
│          ╰─────────╯                   │
│                                         │
│     Protected by 100-day Shield        │
│                                         │
└─────────────────────────────────────────┘
```

**Shield on streak counter indicates:**
- Unlocked at 30, 60, 100, 365-day milestones
- One-time automatic protection
- Glows with blue-white shimmer
- Removed once used

### Accessibility

**Color Contrast:**
- All text meets WCAG AA (4.5:1 contrast ratio)
- Claim button meets WCAG AAA (7:1 contrast ratio)
- Alternative indicators beyond color (icons, text)

**Screen Readers:**
- Claim button: "Claim today's streak. You have 10,500 steps synced today. Current streak: 15 days"
- Calendar days: "Monday January 8th, claimed. 10,200 steps logged"
- Freeze indicator: "3 freezes available. Next freeze reset in 4 days"

**Keyboard Navigation:**
- Tab order: Claim button → Calendar → Freeze widget
- Enter/Space: Activate claim button
- Arrow keys: Navigate calendar days
- Escape: Close modals

**Motion:**
- Respect prefers-reduced-motion
- Alternative: Static checkmark instead of confetti
- Milestone modal: Fade-in only, no complex animations

---

## Engagement Strategy

### Push Notifications

**Notification Schedule:**

**Morning Reminder (8:00am local time):**
- Title: "Good morning! Time to claim your streak 🔥"
- Body: "You have [X] steps synced. Tap to keep your [N]-day streak alive!"
- Action: Deep link to claim button

**Evening Reminder (8:00pm local time):**
- Title: "Don't break your [N]-day streak!"
- Body: "You haven't claimed today yet. [X] hours remaining!"
- Action: Deep link to claim button

**Last Chance (11:00pm local time):**
- Title: "⚠️ Streak expires in 4 hours!"
- Body: "Claim your [N]-day streak before 3am"
- Action: Deep link to claim button with urgent styling

**Milestone Approaching (Day 6, 13, 29):**
- Title: "1 day until [Milestone Name]! 🎉"
- Body: "Claim today to reach your [N]-day milestone tomorrow"
- Action: Deep link to claim button

**Recovery Offered (Streak broken):**
- Title: "💔 Recover your [N]-day streak!"
- Body: "Complete 2 actions today to restore your streak. [X] hours left."
- Action: Deep link to recovery flow

**Freeze Running Low:**
- Title: "⚠️ You have 0 freezes remaining"
- Body: "Your [N]-day streak is at risk. Earn more by maintaining your streak!"
- Action: Deep link to freeze management

**Weekly Freeze Reset (Monday 9am):**
- Title: "✨ Freeze recharged!"
- Body: "You now have [N] freezes available. Keep your streak safe this week!"
- Action: Deep link to dashboard

### In-App Messages

**Contextual Tips (First-Time User):**
- Day 1: "Welcome! Claim your first streak to get started 🔥"
- Day 2: "Great! Come back tomorrow to build your streak"
- Day 3: "You're on fire! 3 days is where habits start to form 💪"
- Day 7: "Amazing! You've reached 1 week. You earned a freeze! ❄️"

**Behavioral Nudges:**
- User logged in but didn't claim: "You have data ready. Claim your streak!"
- User has unclaimed past days: "You can claim the last 3 days. Don't lose your streak!"
- User about to break streak: "⚠️ This is your last day to claim. Tap here!"

**Social Proof:**
- "1,234 people claimed their streaks today. Join them!"
- "Your friend Sarah just reached 30 days! Can you catch up?"

### Rewards & Incentives

**XP Rewards:**
- Daily claim: +10 XP
- 7-day milestone: +50 XP
- 30-day milestone: +200 XP
- 100-day milestone: +1,000 XP
- Perfect week (no freezes used): +25 bonus XP

**Badge Collection:**
- Visible on user profile
- Shareable achievement cards
- Leaderboard integration (Top Streakers)

**Exclusive Content Unlocks:**
- 30-day streak: Unlock advanced workout plans
- 60-day streak: Unlock premium AI coaching features
- 100-day streak: Unlock exclusive challenges
- 365-day streak: Lifetime Pro membership discount

**Social Recognition:**
- Profile badge: "365-Day Legend" 🏅
- Featured in community feed: "Streak Champion"
- Monthly streak leaderboard with prizes

### Retention Hooks

**Weekly Goals:**
- "Perfect Week" challenge: Claim all 7 days without freezes
- Reward: Yellow flame icon, bonus XP, special badge

**Monthly Challenges:**
- "30 Days of Consistency": Claim 30 consecutive days
- Reward: Exclusive badge, profile frame, raffle entry

**Streak Milestones Create Sunk Cost:**
- At 30 days: "You've invested 30 days. Don't lose it now!"
- At 100 days: "You're in the top 1% of users. Keep going!"
- At 365 days: "You're a legend. Immortalize your achievement!"

**Leaderboards & Competition:**
- Global: Top 100 longest streaks
- Friends: See who has the longest streak in your circle
- Circles: Team collective streak (all members claim daily)

### Recovery Mechanisms (Detailed)

**Mechanism 1: Weekend Warrior Pass (Earn Back)**
- **Trigger**: Streak broken within last 48 hours
- **Cost**: 2x daily actions (must be different types)
- **Frequency**: Once per 30 days
- **UI**: Prominent banner with countdown timer
- **Messaging**: "Don't give up! Recover your [N]-day streak by completing 2 actions today"

**Mechanism 2: Milestone Shields**
- **Earned at**: 30, 60, 100, 365-day milestones
- **Automatic**: Activates on first missed claim after earning
- **One-time use**: Consumed after protection
- **UI**: Shield icon on streak counter, glows when active
- **Messaging**: "🛡️ Your [N]-day milestone shield protected your streak!"

**Mechanism 3: Purchase Resurrection (Premium)**
- **Cost**: $2.99 or 500 XP
- **Limit**: Once per year
- **Restores**: Full streak to previous count
- **UI**: Offer modal after streak breaks
- **Messaging**: "Your [N]-day streak is precious. Restore it for $2.99?"
- **Note**: Controversial - may reduce perceived value of streaks. Consider A/B testing.

---

## Success Metrics

### North Star Metric
**Daily Streak Claim Rate (DSCR)**: Percentage of DAU who claim their streak each day

**Target**: 75% DSCR by Month 3
- Month 1: 50% (adoption phase)
- Month 2: 65% (habit formation)
- Month 3: 75% (steady state)

### Primary KPIs (Leading Indicators)

**Engagement Metrics:**
| Metric | Current (Automatic) | Target (Claiming) | % Increase |
|--------|---------------------|-------------------|------------|
| Daily Active Users (DAU) | 15,000 | 18,750 | +25% |
| Average Session Length | 4.2 min | 4.8 min | +15% |
| Sessions per Week | 3.5 | 5.0 | +43% |
| Daily Claim Rate | N/A | 75% | N/A (new) |

**Retention Metrics:**
| Metric | Current | Target | % Increase |
|--------|---------|--------|------------|
| D1 Retention | 40% | 50% | +25% |
| D7 Retention | 25% | 35% | +40% |
| D30 Retention | 15% | 22% | +47% |
| Users with 7+ day streak | 8% | 20% | +150% |

**Gamification Metrics:**
| Metric | Target | Rationale |
|--------|--------|-----------|
| Users reaching 7-day milestone | 20% of DAU | First major milestone |
| Users reaching 30-day milestone | 8% of DAU | Habit solidified |
| Users reaching 100-day milestone | 2% of DAU | Super users |
| Average streak length | 12 days | Up from 5 days |
| Freeze usage rate | 15% per week | Indicates engagement with feature |
| Recovery attempt rate | 40% of broken streaks | Users value their streaks |
| Recovery success rate | 60% of attempts | Recovery system working |

### Secondary KPIs (Lagging Indicators)

**Monetization:**
| Metric | Target | Impact |
|--------|--------|--------|
| Freeze purchases | $5K MRR | New revenue stream |
| Resurrection purchases | $2K MRR | Premium recovery |
| Conversion to Pro (streakers) | 25% | Higher than 15% baseline |

**Social/Viral:**
| Metric | Target | Impact |
|--------|--------|--------|
| Milestone shares | 30% of milestones | Organic marketing |
| Referred users from shares | 2% of shares | Viral growth |
| Friend leaderboard engagement | 60% of users | Social retention |

### Tracking Implementation

**Analytics Events:**

```typescript
// Amplitude/Mixpanel event structure
{
  event: 'streak_claimed',
  properties: {
    user_id: string,
    claim_date: string, // YYYY-MM-DD
    claim_method: 'explicit_button' | 'weight_log' | 'steps_log' | 'mood_log' | 'energy_log',
    is_retroactive: boolean,
    days_retroactive: number, // 0 if today
    current_streak: number,
    previous_streak: number,
    freeze_used: boolean,
    freezes_remaining: number,
    milestone_reached: string | null, // '7-Day Warrior'
    shield_earned: boolean,
    time_since_last_claim: number, // hours
    data_source: 'healthkit' | 'google_fit' | 'manual',
    timezone: string,
    platform: 'ios' | 'android' | 'web',
  }
}

{
  event: 'streak_broken',
  properties: {
    user_id: string,
    broken_date: string,
    previous_streak: number,
    freezes_available: number,
    shields_available: number,
    recovery_offered: boolean,
    days_since_last_claim: number,
    platform: 'ios' | 'android' | 'web',
  }
}

{
  event: 'streak_recovered',
  properties: {
    user_id: string,
    recovery_method: 'weekend_warrior' | 'milestone_shield' | 'purchase',
    previous_streak: number,
    actions_completed: string[],
    time_to_complete: number, // minutes
    platform: 'ios' | 'android' | 'web',
  }
}

{
  event: 'freeze_used',
  properties: {
    user_id: string,
    freeze_type: 'auto' | 'manual',
    protected_date: string,
    current_streak: number,
    freezes_remaining: number,
    platform: 'ios' | 'android' | 'web',
  }
}

{
  event: 'freeze_purchased',
  properties: {
    user_id: string,
    payment_method: 'xp' | 'stripe',
    amount: number,
    freezes_before: number,
    freezes_after: number,
    platform: 'ios' | 'android' | 'web',
  }
}

{
  event: 'milestone_reached',
  properties: {
    user_id: string,
    milestone_name: string, // '30-Day Master'
    milestone_days: number,
    badge_earned: string,
    shield_earned: boolean,
    shared: boolean,
    platform: 'ios' | 'android' | 'web',
  }
}
```

**Dashboards:**

1. **Streak Health Dashboard**
   - Daily claim rate (line chart, 30 days)
   - Streak distribution (histogram: 0-7, 8-14, 15-30, 31-60, 61-100, 100+)
   - Freeze usage over time
   - Recovery success rate
   - Milestone achievement funnel

2. **User Cohort Analysis**
   - Retention by streak length (0-7 days, 8-30 days, 31+ days)
   - Engagement by streak length
   - Churn rate by streak break
   - LTV by streak length

3. **Feature Performance**
   - Claim button CTR
   - Retroactive claim usage
   - Manual vs auto-sync claiming ratio
   - Notification effectiveness (open rate, claim rate)

### A/B Test Plan

**Phase 1: Claim Requirement**
- **Control**: Auto-claim on data entry (current behavior)
- **Variant A**: Explicit claim required + auto-sync continues
- **Variant B**: Explicit claim required + auto-sync paused (must manual entry)
- **Primary Metric**: D7 Retention
- **Secondary Metrics**: DAU, Session Length, Frustration (support tickets)
- **Duration**: 2 weeks, 33% / 33% / 33% split
- **Hypothesis**: Explicit claiming increases engagement without frustrating users

**Phase 2: Grace Period Duration**
- **Control**: 3am grace period (3 hours)
- **Variant A**: 6am grace period (6 hours)
- **Variant B**: 12pm grace period (12 hours next day)
- **Primary Metric**: Streak break rate
- **Secondary Metrics**: Late-night claim rate, user complaints
- **Duration**: 2 weeks, 33% / 33% / 33% split
- **Hypothesis**: Longer grace periods reduce frustration without reducing engagement

**Phase 3: Recovery Mechanism**
- **Control**: No recovery (streaks stay broken)
- **Variant A**: Weekend Warrior Pass (2x actions)
- **Variant B**: Purchase resurrection ($2.99)
- **Variant C**: Both options available
- **Primary Metric**: Recovery attempt rate, success rate
- **Secondary Metrics**: User sentiment, revenue
- **Duration**: 4 weeks, 25% / 25% / 25% / 25% split
- **Hypothesis**: Recovery options increase retention and goodwill

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)

**Goal**: Build core claiming infrastructure without changing user experience

**Backend:**
- [ ] Create `streak_claims` table
- [ ] Add claiming fields to `engagement_streaks` table
- [ ] Implement `StreakClaimingService`
- [ ] Create `/api/streaks/claim` endpoint
- [ ] Create `/api/streaks/claim-status` endpoint
- [ ] Create `/api/streaks/claimable-days` endpoint
- [ ] Add analytics events (Amplitude/Mixpanel)
- [ ] Write unit tests (target: 95% coverage)

**Web Frontend:**
- [ ] Create `StreakClaimButton` component
- [ ] Create `ClaimableCalendar` component
- [ ] Add claim status polling (every 30s)
- [ ] Implement claim animations (CSS + Framer Motion)
- [ ] Add analytics tracking to components
- [ ] Write component tests (React Testing Library)

**Infrastructure:**
- [ ] Deploy to staging environment
- [ ] Run load tests (1000 concurrent claims)
- [ ] Set up monitoring (DataDog/New Relic)
- [ ] Create admin dashboard for claim metrics

**Success Criteria:**
- [ ] All endpoints returning <200ms p95
- [ ] 0 errors in 1000 test claims
- [ ] Analytics events flowing correctly

### Phase 2: Soft Launch (Weeks 3-4)

**Goal**: Enable claiming for 10% of users, gather feedback, iterate

**Rollout:**
- [ ] Feature flag: `streak_claiming_enabled` (default: false)
- [ ] Enable for 10% of users (random selection, sticky by user_id)
- [ ] A/B test: Control (auto-claim) vs Variant (explicit claim)

**Web:**
- [ ] Show claim button to flagged users only
- [ ] Auto-claim for control group (current behavior)
- [ ] Show onboarding tooltip on first claim attempt
- [ ] Implement retroactive claiming (7-day window)

**Mobile (iOS):**
- [ ] Implement claim button in dashboard (SwiftUI)
- [ ] Add HealthKit sync (maintain current behavior)
- [ ] Implement claim API calls
- [ ] Add haptic feedback on claim

**Monitoring:**
- [ ] Daily review of metrics dashboard
- [ ] User feedback collection (in-app survey)
- [ ] Support ticket monitoring
- [ ] Bug triage daily

**Success Criteria:**
- [ ] <5% increase in support tickets
- [ ] D7 retention ≥ control group
- [ ] Average claim rate >50% in first week
- [ ] NPS score ≥ 45 from test users

### Phase 3: Full Rollout (Weeks 5-6)

**Goal**: Enable claiming for 100% of users, monitor stability

**Rollout:**
- [ ] Week 5: Increase to 50% of users
- [ ] Week 6: Increase to 100% of users
- [ ] Deprecate auto-claim logic (keep for 2 weeks as fallback)

**Web:**
- [ ] Polish animations based on feedback
- [ ] Optimize performance (lazy load calendar)
- [ ] Add keyboard shortcuts (Space = claim)

**Mobile:**
- [ ] Android implementation (Kotlin)
- [ ] Google Fit sync integration
- [ ] Push notification scheduling
- [ ] Widget support (iOS 17+, Android 12+)

**Communication:**
- [ ] In-app announcement: "New: Claim Your Streak Daily!"
- [ ] Email to users: Explain new claiming system
- [ ] Blog post: Why we're making streaks more intentional

**Success Criteria:**
- [ ] Overall D7 retention increases by 10%+
- [ ] Daily claim rate >70%
- [ ] Support ticket volume <2x baseline
- [ ] No P0/P1 bugs in production

### Phase 4: Enhancements (Weeks 7-10)

**Goal**: Add freeze management, recovery, and milestone features

**Freeze Management (Week 7):**
- [ ] Manual freeze activation
- [ ] Freeze purchase flow (XP + Stripe)
- [ ] Freeze status widget
- [ ] Weekly reset cron job

**Recovery System (Week 8-9):**
- [ ] Create `streak_recoveries` table
- [ ] Implement Weekend Warrior Pass logic
- [ ] Create recovery banner UI
- [ ] Recovery progress tracking
- [ ] Recovery expiration cron job

**Milestone Shields (Week 9-10):**
- [ ] Create `streak_shields` table
- [ ] Award shields at milestones (30, 60, 100, 365)
- [ ] Auto-apply shield on streak break
- [ ] Shield indicator on streak counter
- [ ] Shield celebration animation

**Success Criteria:**
- [ ] 15% weekly freeze usage rate
- [ ] 40% recovery attempt rate
- [ ] 60% recovery success rate
- [ ] Shield feature reduces churn by 5%

### Phase 5: Gamification & Social (Weeks 11-14)

**Goal**: Maximize engagement through competition and social features

**Milestone Celebrations (Week 11):**
- [ ] Full-screen celebration modals
- [ ] Unique badges for each milestone
- [ ] Shareable achievement cards (Open Graph)
- [ ] Milestone notification push

**Leaderboards (Week 12):**
- [ ] Global longest streaks leaderboard
- [ ] Friend leaderboards (opt-in)
- [ ] Circle collective streak tracking
- [ ] Weekly "Perfect Week" leaderboard

**Social Features (Week 13-14):**
- [ ] Streak sharing to social media
- [ ] Milestone badges on user profiles
- [ ] Friend streak comparison widget
- [ ] Challenge friends to streak battles
- [ ] Team collective streak goals

**Success Criteria:**
- [ ] 30% of milestone achievements shared
- [ ] 60% of users engage with friend leaderboards
- [ ] 2% referred users from shares
- [ ] Overall D30 retention increases by 20%+

---

## Risk Analysis

### Technical Risks

| Risk | Impact | Likelihood | Mitigation | Owner |
|------|--------|------------|------------|-------|
| **Timezone bugs break streaks** | Critical | High | Extensive timezone testing (50+ timezones), grace period buffer, manual streak restoration tool | Backend |
| **Race conditions in claim endpoint** | High | Medium | Idempotent claim logic, database unique constraints, optimistic locking | Backend |
| **HealthKit/Google Fit sync delays** | High | Medium | 7-day retroactive window, clear messaging, "refresh sync" button | Mobile |
| **Claim button not visible** | High | Low | Prominent positioning, onboarding tooltip, analytics tracking | Frontend |
| **Performance degradation (1M+ users)** | High | Medium | Database indexing, caching layer (Redis), load testing | DevOps |
| **Notification delivery failures** | Medium | High | Multiple notification providers, retry logic, delivery tracking | Backend |

### Business Risks

| Risk | Impact | Likelihood | Mitigation | Owner |
|------|--------|------------|------------|-------|
| **Users frustrated by active claiming** | Critical | Medium | A/B test first, generous grace period, retroactive claiming, clear onboarding | Product |
| **Streaks feel too hard to maintain** | High | Medium | Freeze system, recovery mechanics, 7-day window, reduce friction | Product |
| **Reduced engagement vs automatic** | Critical | Low | Competitive research shows opposite, soft launch to test, rollback plan | Product |
| **Support ticket volume spikes** | Medium | High | FAQ documentation, in-app help, automated streak restoration tool | Support |
| **Revenue decrease if freezes too cheap** | Medium | Low | Balanced pricing (100 XP / $0.99), limit purchases per week, monitor metrics | Product |
| **Negative user sentiment** | High | Medium | Transparent communication, user feedback loops, quick iteration, rollback ready | Marketing |

### User Experience Risks

| Risk | Impact | Likelihood | Mitigation | Owner |
|------|--------|------------|------------|-------|
| **Onboarding confusion** | High | High | Clear tooltip on first visit, animated walkthrough, help center article | Design |
| **Timezone travel breaks streaks** | High | Medium | 6-hour grace extension on timezone change, manual freeze activation | Backend |
| **Data sync delays cause frustration** | Medium | High | "Syncing..." indicator, manual refresh, clear error messages | Mobile |
| **Retroactive claiming too complex** | Medium | Medium | Simple calendar UI, visual indicators, suggested actions | Design |
| **Milestone FOMO (fear of missing out)** | Medium | Medium | Recovery options, milestone shields, reduce pressure messaging | Product |
| **Notification fatigue** | Medium | High | Customizable notification schedule, opt-out controls, smart send times | Product |

### Mitigation Strategies

**1. Gradual Rollout Plan:**
- Week 1-2: Internal team only (dogfooding)
- Week 3-4: 10% of users (A/B test)
- Week 5: 50% of users
- Week 6: 100% of users
- Rollback available at each stage

**2. Feature Flags:**
```typescript
// Gradual feature enablement
const flags = {
  streak_claiming_enabled: true,
  retroactive_claiming_enabled: true,
  manual_freeze_activation: false, // Coming in Phase 4
  recovery_system_enabled: false,  // Coming in Phase 4
  milestone_shields_enabled: false, // Coming in Phase 4
};
```

**3. Monitoring & Alerts:**
- Real-time claim rate monitoring
- Error rate alerts (>1% error rate)
- Support ticket volume tracking
- Sentiment analysis on feedback
- Daily metrics review meeting

**4. Rollback Plan:**
- One-click feature flag disable
- Database migrations reversible
- Automatic revert to auto-claim behavior
- User communication template prepared

**5. User Support:**
- Dedicated support category: "Streaks & Claiming"
- Admin tool: Manual streak adjustment
- FAQ documentation (15+ questions)
- In-app help widget
- Support ticket SLA: <4 hours

---

## Open Questions

### Product Questions

1. **Grace period duration**: Is 3am (3 hours) sufficient, or should we extend to 6am (6 hours)?
   - **Data needed**: User behavior analysis (what % claim after midnight?)
   - **Decision by**: Phase 2 A/B test results

2. **Retroactive window**: Is 7 days too long? Could encourage procrastination.
   - **Alternative**: 3-day window
   - **Decision by**: User research interviews (n=20)

3. **Recovery pricing**: Is $2.99 too cheap/expensive for resurrection?
   - **Alternative**: Dynamic pricing based on streak length ($0.99 per 10 days)
   - **Decision by**: Pricing research survey

4. **Auto-sync visibility**: Should we show auto-synced data differently than manual data?
   - **Design exploration**: Icon/badge to indicate data source
   - **Decision by**: Design review (Week 2)

5. **Notification frequency**: 3 notifications per day (8am, 8pm, 11pm) - too many?
   - **Alternative**: Smart notifications (only if user usually claims at that time)
   - **Decision by**: Notification opt-out rate monitoring

### Technical Questions

1. **Timezone storage**: Store user's timezone in profile or infer from device?
   - **Trade-off**: Accuracy vs. complexity (travelers change timezones)
   - **Decision by**: Technical design review

2. **Claim timestamp**: Use server timestamp or client timestamp?
   - **Trade-off**: Accuracy vs. user perception (clock drift)
   - **Decision by**: Technical design review

3. **Streak calculation**: Real-time or batch processing (nightly cron)?
   - **Current**: Real-time on claim, cron for validation
   - **Concern**: Performance at scale
   - **Decision by**: Load testing results

4. **Data retention**: How long to keep claim history?
   - **Proposal**: 2 years for analytics, then aggregate only
   - **Decision by**: Legal/compliance review

### Design Questions

1. **Claim button size**: Current proposal is 200px desktop, 160px mobile. Too large?
   - **Trade-off**: Prominence vs. screen space
   - **Decision by**: Usability testing (n=10)

2. **Animation duration**: Milestone celebration is ~3 seconds. Too long?
   - **Alternative**: 1.5s fast mode, skippable
   - **Decision by**: User feedback (Phase 2)

3. **Calendar layout**: Horizontal week view or vertical infinite scroll?
   - **Trade-off**: Simplicity vs. power user features
   - **Decision by**: Design exploration + user testing

4. **Shield visual**: Current is 🛡️ emoji. Too literal?
   - **Alternative**: Custom illustrated shield icon
   - **Decision by**: Design review (Week 9)

### Business Questions

1. **Pricing strategy**: Should freezes be free (earn only) or paid?
   - **Current proposal**: Earn 1 per week + purchase option
   - **Alternative**: Freemium model (2 free, purchase more)
   - **Decision by**: Business model review

2. **Competitive response**: What if Duolingo/Strava copies our recovery mechanics?
   - **Strategy**: Continuous innovation, focus on UX execution
   - **Decision by**: Ongoing competitive analysis

3. **International markets**: Are streaks as motivating in all cultures?
   - **Research**: Survey users in Japan, India, Brazil
   - **Decision by**: Market research (Q2 2025)

---

## Appendix

### Glossary

- **Claiming**: The act of explicitly recording that a user completed their daily engagement
- **Auto-sync**: Background process that pulls data from HealthKit/Google Fit
- **Retroactive claiming**: Claiming past days (within 7-day window)
- **Freeze**: Grace day that protects streak when user misses a day
- **Grace period**: 3-hour window past midnight when claiming still counts for previous day
- **Milestone**: Streak length achievement (7, 14, 30, 60, 100, 365 days)
- **Shield**: One-time automatic streak protection earned at milestones
- **Recovery**: Process of restoring a broken streak through extra effort
- **Weekend Warrior Pass**: Recovery mechanism requiring 2x actions
- **DSCR**: Daily Streak Claim Rate (% of DAU who claim each day)

### References

**Competitive Research:**
- [Duolingo's Gamification Secrets: How Streaks Boost Engagement by 60%](https://www.orizon.co/blog/duolingos-gamification-secrets)
- [Designing Streaks for Long-Term User Growth - Trophy](https://trophy.so/blog/designing-streaks-for-long-term-user-growth)
- [Habitica's Gamification Strategy: A Case Study (2025)](https://trophy.so/blog/habitica-gamification-case-study)
- [The Psychology of Hot Streak Game Design](https://uxmag.medium.com/the-psychology-of-hot-streak-game-design)

**Behavioral Psychology:**
- Kahneman & Tversky: *Prospect Theory: An Analysis of Decision under Risk*
- BJ Fogg: *Tiny Habits* and Behavior Model
- Nir Eyal: *Hooked: How to Build Habit-Forming Products*
- Charles Duhigg: *The Power of Habit*

**Design Patterns:**
- [Apple Human Interface Guidelines - Activity Rings](https://developer.apple.com/design/human-interface-guidelines/activity-rings)
- [Material Design - Progress Indicators](https://m3.material.io/components/progress-indicators)
- [Handling Time Zones in Global Gamification Features - Trophy](https://trophy.so/blog/handling-time-zones-gamification)

### Changelog

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-01-15 | Product Team | Initial PRD created |

---

**Next Steps:**
1. Review this PRD with engineering leads (iOS, Android, Backend)
2. Create detailed technical specs for Phase 1
3. Begin UI/UX design mockups (Figma)
4. Schedule user research interviews (n=20)
5. Set up analytics infrastructure (Amplitude events)
6. Create project timeline in Jira/Linear

**Questions or feedback?** Contact the Product Team or comment in #product-streak-claiming Slack channel.
