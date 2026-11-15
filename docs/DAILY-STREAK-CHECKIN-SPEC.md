# Daily Streak Check-In Feature - Product Specification

> **Shield economy superseded (2026-11-13).** The streak-shield / freeze earning, starter and cap rules in this historical document are out of date. Current rules: docs/STREAKS-SPEC.md (1 shield per 7-day streak, no monthly bonus, 2 starter shields at onboarding completion, bank up to 3; all three tunable in Admin Tools).

**Version:** 1.0
**Last Updated:** 2025-10-31
**Status:** Ready for Implementation
**Owner:** Product Team

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Research Findings](#research-findings)
3. [Feature Overview & Goals](#feature-overview--goals)
4. [User Flows & Decision Points](#user-flows--decision-points)
5. [API Endpoint Specifications](#api-endpoint-specifications)
6. [Database Schema Requirements](#database-schema-requirements)
7. [UX/UI Guidelines](#uxui-guidelines)
8. [Gamification Mechanics](#gamification-mechanics)
9. [User Stories & Acceptance Criteria](#user-stories--acceptance-criteria)
10. [Success Metrics](#success-metrics)
11. [Implementation Phases](#implementation-phases)

---

## Executive Summary

The Daily Streak Check-In feature transforms FitCircle's daily tracking into an addictive, gamified experience that drives consistent user engagement. Drawing inspiration from Duolingo's industry-leading streak mechanics (9M+ users with 1-year streaks), Snapchat's social streak system, and Apple Fitness's activity ring closures, this feature will be the cornerstone of habit formation in FitCircle.

### Key Design Principles
1. **ONE Daily Streak Check-In** counts toward the streak (prevents gaming the system)
2. **Multiple Updates Per Day** allowed but don't increment streak (mood, energy, weight can be updated throughout the day)
3. **Clear Visual Distinction** between "Today's Check-In" (streak-eligible) vs "Update Stats" (non-streak)
4. **Generous Grace Mechanics** with Streak Freezes to reduce churn
5. **Celebration-First Design** with animations, badges, and milestones
6. **Loss Aversion Psychology** - users should feel emotional investment in maintaining their streak

### Impact Goals
- **+60% increase** in daily active users (DAU) - based on Duolingo's streak impact
- **+21% reduction** in user churn - based on Streak Freeze effectiveness
- **3.6x more likely** to complete 90-day challenges - users with 7+ day streaks
- **85%+ retention** at 30 days for users who reach a 7-day streak

---

## Research Findings

### Duolingo Streak Mechanics (Industry Leader)
- **9 million users** maintain 1-year+ streaks
- **Streak Freeze** feature reduced churn by **21%** for at-risk users
- Users with **7-day streaks** are **3.6x more likely** to complete their goals
- **Double Streak Freeze** (2 equipped at once) increased active learners by **+0.38%**
- **Streak Repair** allows one restoration per month (premium feature)
- **Home Screen Widget** provides constant visual reminder of current streak
- **Friend Streaks** add social accountability layer

### Snapchat Streak System
- Streaks start after **3 consecutive days** of mutual interaction
- **Fire emoji + number** shows days (e.g., 🔥 127)
- **Hourglass emoji ⏳** warns when about to expire (4-hour window)
- **Group Streaks** introduced in 2024 for collective accountability
- **Instant Streaks** (premium feature) skip 3-day requirement
- **One free restore per month** for premium subscribers
- Psychology: **Commitment bias** - users invested in their progress don't want to lose it

### Apple Fitness Activity Rings
- **Retroactive awards** - users get credit for past achievements
- **Streak badges** for consecutive days of ring closures (Move, Exercise, Stand, All)
- **Monthly challenges** require 7 consecutive days in January for New Year's badge
- **Smart notifications** remind users to "check your rings" if behind pace
- Visual design: **Circular progress meters** create satisfying closure experience

### Strava & Fitbit
- **Daily Readiness Score** (Fitbit) combines sleep quality, HRV, and recent activity
- **Habit trackers** with daily reminders and progress reports
- **Trophy Case** showcases all completed challenges (social proof)
- **Streak-based incentives** linked to premium benefits

### Key Takeaways for FitCircle
1. **Streaks are THE killer feature** - Duolingo's billion-dollar business is built on them
2. **Loss aversion > achievement motivation** - fear of losing a 100-day streak is more powerful than earning a badge
3. **Grace mechanics are essential** - Streak Freezes reduce churn by 21%
4. **Social accountability multiplies engagement** - Friend Streaks and Group Streaks
5. **Visual design matters** - Fire emoji, rings, numbers create satisfying progress visualization
6. **Premium monetization opportunity** - Extra freezes, streak repairs, early streak bonuses
7. **Daily Readiness + Check-In** - Adapt challenge intensity to user's state

---

## Feature Overview & Goals

### What Counts Toward the Engagement Streak?

The **Engagement Streak** tracks consecutive days where the user completes **at least one qualifying activity**:

#### Streak-Eligible Activities (ONE per day counts)
1. **Daily Check-In Completion** - Completes the full check-in flow (mood + energy + optional weight/steps)
2. **Circle Check-In** - Submits a check-in to any active FitCircle
3. **Weight Log** - Logs weight for the day
4. **Steps Log** - Logs or syncs steps (10,000+ steps or daily goal)
5. **Mood/Energy Log** - Logs both mood AND energy

**Rule:** The **first qualifying activity of the day** starts the check-in and counts toward the streak. Subsequent activities update stats but don't re-increment the streak.

#### Non-Streak Activities (Still Valuable!)
- Viewing dashboard
- Browsing circles
- Chatting with friends
- Updating profile
- Reading content

### Multiple Check-Ins Per Day - UX Design

**Challenge:** Users may want to update mood/energy throughout the day, but only ONE check-in should count toward the streak.

**Solution:** Two distinct interaction modes:

#### Mode 1: "Daily Check-In" (Streak-Eligible) ⭐
- **When:** First check-in of the day
- **UI:** Large, prominent card on dashboard
- **CTA:** "Complete Today's Check-In" with flame icon 🔥
- **Flow:** Full onboarding sequence with celebration
- **Badge:** "Streak Check-In Complete" ✅
- **Color:** Orange/Gold gradient (emphasizes importance)
- **Animation:** Confetti + flame animation on completion
- **Locks After:** First completion - button disabled, shows "✅ Check-In Complete"

#### Mode 2: "Update Stats" (Non-Streak) 📊
- **When:** After completing daily check-in
- **UI:** Smaller, secondary button on dashboard
- **CTA:** "Update Mood & Energy" (no flame icon)
- **Flow:** Quick inline form, no celebration animation
- **Badge:** "Stats Updated" (subtle)
- **Color:** Muted blue/gray
- **Animation:** Simple fade transition
- **Always Available:** Can update multiple times per day

**Visual Hierarchy:**
```
┌─────────────────────────────────────────────────┐
│  🔥 COMPLETE TODAY'S CHECK-IN (Day 47)          │  ← Large, orange, prominent
│  Lock in your streak! (Once per day)            │
│  [COMPLETE CHECK-IN] ←─────────────────────────┐│
│                                                  │
│  ✅ Check-In Complete! (Today at 9:32 AM)       │  ← After completion
│  [UPDATE MOOD & ENERGY] ←───────────────────────┤│  ← Smaller, secondary
│                                                  │
│  Last updated: Just now                          │
│  Mood: 😊 8/10  |  Energy: ⚡ 7/10               │
└─────────────────────────────────────────────────┘
```

### Streak Freeze System

Drawing from Duolingo's proven mechanics:

#### How Freezes Work
- **Starting Freezes:** 1 freeze on signup
- **Earn Freezes:** Gain 1 freeze every **7 consecutive days** of maintained streak
- **Maximum Freezes:** 5 freezes (prevents hoarding)
- **Auto-Use:** If you miss a day, a freeze is **automatically consumed** (user doesn't have to remember)
- **Weekly Refresh:** Gain 1 freeze every 7 days (up to max of 5)

#### Freeze Notifications
- **Before Missing:** "Don't forget to check in! You have 2 freezes available if you miss today."
- **When Used:** "Streak Freeze Used! Your 47-day streak is safe. You have 1 freeze remaining."
- **Last Freeze Warning:** "⚠️ This is your last freeze! Check in tomorrow to keep your 52-day streak alive."
- **No Freezes:** "💔 Streak broken! Your 89-day streak has ended. Start a new one today!"

#### Purchase Additional Freezes (Premium Monetization)
- **Cost:** $0.99 per freeze or 100 XP
- **Bundle:** 5 freezes for $3.99 (20% discount)
- **Max Purchase:** Can't exceed 5 total freezes
- **Premium Perk:** FitCircle Pro members get **2 starting freezes** and earn freezes every **5 days** instead of 7

### Streak Repair System

Inspired by Duolingo's "Streak Repair" feature:

#### How Repair Works
- **Window:** Can repair a broken streak within **24 hours** of it breaking
- **Cost:**
  - **Free users:** $2.99 one-time fee
  - **Pro users:** 1 free repair per month, then $2.99
- **Limitations:** Can only repair streaks **7 days or longer**
- **Cooldown:** 30-day cooldown between repairs (prevents abuse)

#### Repair Flow
1. User misses a day → Streak breaks → Notification sent
2. "💔 Your 47-day streak is broken! Repair it within 24 hours?"
3. User taps "Repair Streak" → Payment/XP confirmation
4. Streak restored → Celebration animation
5. Badge earned: "Second Chance" 🔄

---

## User Flows & Decision Points

### Flow 1: First-Time Daily Check-In (New User - Day 1)

```
START: User opens app in the morning
  ↓
[Dashboard shows: "Start Your Streak!" card]
  ↓
User taps "Complete Today's Check-In"
  ↓
┌─────────────────────────────────────────┐
│ STEP 1: Yesterday Acknowledgment        │
│ (Only shown on Day 1 or after break)    │
│                                          │
│ "How do you feel about yesterday?"      │
│ - Great! Ready for today 😊              │
│ - OK, could be better 😐                 │
│ - Not great, but I'm here 😟             │
└─────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────┐
│ STEP 2: Mood & Energy Sliders           │
│                                          │
│ "How's your mood right now?" (1-10)     │
│ [Circular slider with emoji feedback]   │
│                                          │
│ "What's your energy level?" (1-10)      │
│ [Circular slider with battery emoji]    │
└─────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────┐
│ STEP 3: Optional Weight Entry           │
│                                          │
│ "Track your weight today?" (Optional)   │
│ [Weight input with unit toggle]         │
│ [Skip] or [Add Weight]                  │
└─────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────┐
│ STEP 4: Celebration! 🎉                 │
│                                          │
│ "🔥 Day 1 Streak Started!"              │
│ [Flame animation]                        │
│ "Keep it up tomorrow to build your      │
│  streak!"                                │
│                                          │
│ Reward: +10 XP, "Fresh Start" badge     │
└─────────────────────────────────────────┘
  ↓
END: Dashboard shows "✅ Check-In Complete"
     + "Update Stats" button now available
```

### Flow 2: Daily Check-In (Established User - Day 47)

```
START: User opens app (10:00 AM)
  ↓
[Dashboard shows: "🔥 Complete Today's Check-In (Day 47)" - Prominent card]
  ↓
User taps "Complete Check-In"
  ↓
┌─────────────────────────────────────────┐
│ STEP 1: Mood & Energy (Streamlined)     │
│                                          │
│ "Good morning! How are you feeling?"    │
│                                          │
│ Mood: [Circular slider] 8/10 😊          │
│ Energy: [Circular slider] 6/10 ⚡        │
│                                          │
│ [Quick entry - no "Yesterday" question] │
└─────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────┐
│ STEP 2: Optional Weight (Smart Prompt)  │
│                                          │
│ "It's been 3 days since your last       │
│  weigh-in. Track weight today?"         │
│                                          │
│ [Skip] or [Add Weight]                  │
│                                          │
│ Logic: Only prompt if 3+ days since     │
│        last weight entry                │
└─────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────┐
│ STEP 3: Milestone Celebration! 🎊       │
│                                          │
│ "🔥 47 DAY STREAK! 🔥"                   │
│ [Fire ring animation]                    │
│                                          │
│ Streak Milestones Achieved:             │
│ ✅ 7-Day Warrior                        │
│ ✅ 30-Day Champion                      │
│ ✅ Week 7 Complete                      │
│                                          │
│ Next Milestone: 50 Days (3 days away!)  │
│                                          │
│ Reward: +50 XP, +1 Streak Freeze        │
│         "Week 7" badge unlocked         │
└─────────────────────────────────────────┘
  ↓
END: Dashboard shows "✅ Check-In Complete - Day 47"
     + "Update Stats" button available
     + Streak counter incremented
```

### Flow 3: Updating Stats Later in Day (Non-Streak)

```
START: User had morning check-in, now it's 4:00 PM and feeling tired
  ↓
[Dashboard shows: "✅ Check-In Complete" with "Update Stats" button]
  ↓
User taps "Update Mood & Energy"
  ↓
┌─────────────────────────────────────────┐
│ Quick Update Modal (Inline)             │
│                                          │
│ "Update your stats for today"           │
│                                          │
│ Mood: [Slider] 6/10 😐 (was 8/10)        │
│ Energy: [Slider] 4/10 🔋 (was 6/10)      │
│                                          │
│ Note: "Feeling tired after work"        │
│                                          │
│ [Cancel] [Save Update]                  │
│                                          │
│ ℹ️ No streak impact - you already       │
│    checked in today!                    │
└─────────────────────────────────────────┘
  ↓
[Simple confirmation: "Stats Updated ✓"]
  ↓
END: Dashboard shows updated mood/energy
     Streak counter unchanged (still Day 47)
```

### Flow 4: Missing a Day - Freeze Auto-Applied

```
START: User forgot to check in yesterday
  ↓
User opens app the next day
  ↓
[Push notification already sent: "Streak Freeze Used! Check in today."]
  ↓
┌─────────────────────────────────────────┐
│ Dashboard Alert Card                     │
│                                          │
│ "⚠️ Streak Freeze Used Yesterday"        │
│                                          │
│ "You missed Day 48, but we've got your  │
│  back! A Streak Freeze was automatically│
│  used to protect your 47-day streak."   │
│                                          │
│ Current Streak: 🔥 48 days (protected)   │
│ Freezes Remaining: 2 ❄️                  │
│                                          │
│ "Check in today to keep your streak     │
│  going!"                                 │
│                                          │
│ [Complete Today's Check-In]             │
└─────────────────────────────────────────┘
  ↓
User completes check-in normally
  ↓
END: Streak continues (49 days)
```

### Flow 5: Streak Broken - Repair Option

```
START: User missed 2 days in a row, no freezes left
  ↓
[Push notification: "💔 Your 89-day streak is broken! Repair within 24h?"]
  ↓
User opens app
  ↓
┌─────────────────────────────────────────┐
│ Streak Broken Modal (Full Screen)       │
│                                          │
│ 💔                                       │
│ "Your 89-Day Streak Ended"              │
│                                          │
│ "You missed 2 days without freezes."    │
│                                          │
│ Good news: You can repair it!           │
│                                          │
│ [Repair Streak - $2.99] ←─ Prominent    │
│ [Start Fresh] ←─────────── Secondary     │
│                                          │
│ Timer: "23h 47m remaining"              │
│                                          │
│ Fine print: "You can repair streaks     │
│ 7+ days once every 30 days"             │
└─────────────────────────────────────────┘
  ↓
OPTION A: User pays $2.99
  ↓
  [Payment confirmation]
  ↓
  "🔥 Streak Repaired! Welcome back!"
  ↓
  [Flame resurrection animation]
  ↓
  Streak restored to 89 days
  ↓
  Badge earned: "Second Chance" 🔄
  ↓
  END: Continue as normal

OPTION B: User taps "Start Fresh"
  ↓
  Confirmation: "Are you sure? This can't be undone."
  ↓
  [Yes, Start Over] [Cancel]
  ↓
  Streak resets to 0
  ↓
  "Fresh Start! 🌱 Let's build an even better streak."
  ↓
  END: New streak begins
```

### Flow 6: Earning Milestone Rewards

```
Milestones trigger at specific streak thresholds:

DAY 3:  "🔥 3-Day Streak!"
        → Badge: "Getting Started"
        → Reward: +30 XP

DAY 7:  "🔥 1 WEEK STREAK! 🎉"
        → Badge: "Week Warrior"
        → Reward: +100 XP, +1 Streak Freeze
        → Fun Fact: "You're 3.6x more likely to hit your 90-day goal!"

DAY 14: "🔥 2 WEEK STREAK! 💪"
        → Badge: "Fortnight Champion"
        → Reward: +200 XP, +1 Streak Freeze

DAY 30: "🔥 30 DAYS! YOU'RE A LEGEND! 🏆"
        → Badge: "Monthly Master"
        → Reward: +500 XP, +2 Streak Freezes, Exclusive Avatar Frame
        → Unlock: "Streak Superstar" profile badge (visible to friends)

DAY 50: "🔥 50 DAYS! UNSTOPPABLE! 🚀"
        → Badge: "Halfway to 100"
        → Reward: +750 XP, Custom Flame Color (Gold)

DAY 100: "🔥 100 DAY CENTURION! 🥇"
         → Badge: "Centurion"
         → Reward: +2000 XP, Diamond Flame, Exclusive Celebration Video
         → Unlock: "100 Club" membership (leaderboard)

DAY 365: "🔥 1 YEAR STREAK! ELITE STATUS! 👑"
         → Badge: "Annual Legend"
         → Reward: +10,000 XP, Lifetime Pro features, Physical Medal mailed
         → Unlock: "Hall of Fame" entry
```

---

## API Endpoint Specifications

### Base URL
```
Production: https://fitcircle.app/api/mobile
Development: http://localhost:3000/api/mobile
```

### Authentication
All endpoints require Bearer token authentication:
```
Authorization: Bearer <jwt_token>
```

---

### 1. POST `/api/mobile/streaks/check-in`

**Description:** Complete daily check-in and increment streak

**Request Body:**
```typescript
{
  "mood_score": number;        // 1-10, required
  "energy_level": number;      // 1-10, required
  "weight_kg?": number;        // Optional weight entry
  "steps?": number;            // Optional steps entry
  "notes?": string;            // Optional text note
  "yesterday_feeling?": string; // Only on Day 1 or after break: "great" | "ok" | "not_great"
  "check_in_time": string;     // ISO 8601 timestamp (client time)
}
```

**Response (Success - 200):**
```typescript
{
  "success": true,
  "data": {
    "streak": {
      "current_streak": number;           // e.g., 47
      "longest_streak": number;           // e.g., 89
      "freezes_available": number;        // e.g., 3
      "last_check_in_date": string;       // "2025-10-31"
      "is_first_check_in_today": boolean; // true if this was the streak-eligible check-in
    },
    "milestone": {
      "achieved": boolean;           // true if milestone hit
      "milestone_type": string;      // "day_7", "day_30", "day_100", etc.
      "title": string;               // "Week Warrior!"
      "message": string;             // "7 day streak! You're 3.6x more likely..."
      "rewards": {
        "xp": number;                // XP earned
        "badges": string[];          // Badge IDs earned
        "streak_freezes": number;    // Freezes earned (if any)
        "unlocks": string[];         // Feature unlocks (avatar frames, etc.)
      }
    },
    "tracking_entry": {
      "id": string;
      "tracking_date": string;       // "2025-10-31"
      "mood_score": number;
      "energy_level": number;
      "weight_kg": number | null;
      "steps": number | null;
      "created_at": string;
    }
  },
  "meta": {
    "request_time": number;          // ms
    "next_check_in_available": string; // ISO timestamp for tomorrow
  }
}
```

**Response (Already Checked In Today - 200):**
```typescript
{
  "success": true,
  "data": {
    "streak": {
      "current_streak": 47,
      "longest_streak": 89,
      "freezes_available": 3,
      "last_check_in_date": "2025-10-31",
      "is_first_check_in_today": false  // ← Key indicator
    },
    "milestone": null,  // No new milestone
    "tracking_entry": {
      // Updated entry (same day)
      "id": "existing-id",
      "tracking_date": "2025-10-31",
      "mood_score": 6,  // Updated value
      "energy_level": 4, // Updated value
      "weight_kg": null,
      "steps": null,
      "updated_at": "2025-10-31T16:32:00Z"
    }
  },
  "message": "Stats updated! You already completed your check-in today.",
  "meta": {
    "request_time": 23,
    "next_check_in_available": "2025-11-01T00:00:00Z"
  }
}
```

**Response (Error - 400):**
```typescript
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": {
      "mood_score": "Must be between 1 and 10",
      "energy_level": "Must be between 1 and 10"
    }
  }
}
```

**Response (Error - 401):**
```typescript
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token"
  }
}
```

---

### 2. GET `/api/mobile/streaks/status`

**Description:** Get current streak status and availability

**Query Parameters:**
- None

**Response (200):**
```typescript
{
  "success": true,
  "data": {
    "current_streak": number;           // e.g., 47
    "longest_streak": number;           // e.g., 89
    "freezes_available": number;        // e.g., 3
    "last_check_in_date": string;       // "2025-10-30"
    "last_check_in_time": string;       // "2025-10-30T09:15:00Z"
    "checked_in_today": boolean;        // true if already checked in
    "streak_safe": boolean;             // true if streak is protected or checked in today
    "next_milestone": {
      "days_until": number;             // e.g., 3 (for day 50)
      "milestone_type": string;         // "day_50"
      "title": string;                  // "50-Day Streak"
      "preview_reward": string;         // "Unlock Gold Flame"
    },
    "freeze_info": {
      "last_freeze_used_date": string | null;  // "2025-10-25" or null
      "freezes_used_this_week": number;        // 1
      "next_freeze_earned_at": number;         // Days until next freeze (e.g., 3)
    },
    "paused": boolean;                  // true if streak is paused
    "pause_end_date": string | null;    // "2025-11-15" if paused
  },
  "meta": {
    "server_time": string;              // ISO timestamp
    "user_timezone": string;            // "America/Los_Angeles"
  }
}
```

---

### 3. POST `/api/mobile/streaks/freeze/use`

**Description:** Manually use a streak freeze (rare - usually auto-applied)

**Request Body:**
```typescript
{
  "date": string;  // Date to apply freeze to (YYYY-MM-DD)
}
```

**Response (200):**
```typescript
{
  "success": true,
  "data": {
    "freeze_applied": true,
    "date": "2025-10-30",
    "freezes_remaining": 2,
    "current_streak": 47,
    "message": "Streak Freeze applied to October 30. Your streak is safe!"
  }
}
```

**Response (Error - 400):**
```typescript
{
  "success": false,
  "error": {
    "code": "NO_FREEZES_AVAILABLE",
    "message": "You have no Streak Freezes remaining",
    "details": {
      "freezes_available": 0,
      "can_purchase": true,
      "purchase_cost_usd": 0.99
    }
  }
}
```

---

### 4. POST `/api/mobile/streaks/freeze/purchase`

**Description:** Purchase additional streak freezes

**Request Body:**
```typescript
{
  "quantity": number;     // 1 or 5 (bundle)
  "payment_method": string; // "stripe" | "apple_pay" | "google_pay" | "xp"
  "payment_token?": string; // Required for paid purchases
}
```

**Response (200):**
```typescript
{
  "success": true,
  "data": {
    "freezes_purchased": 1,
    "freezes_available": 4,
    "payment": {
      "amount": 0.99,
      "currency": "USD",
      "transaction_id": "txn_abc123"
    },
    "message": "1 Streak Freeze purchased! You now have 4 freezes."
  }
}
```

**Response (Error - 400):**
```typescript
{
  "success": false,
  "error": {
    "code": "MAX_FREEZES_REACHED",
    "message": "You already have the maximum of 5 freezes",
    "details": {
      "max_freezes": 5,
      "current_freezes": 5
    }
  }
}
```

---

### 5. POST `/api/mobile/streaks/repair`

**Description:** Repair a broken streak within 24-hour window

**Request Body:**
```typescript
{
  "payment_method": string;  // "stripe" | "apple_pay" | "google_pay"
  "payment_token": string;   // Payment token from client
  "streak_value": number;    // Streak value to restore (for validation)
}
```

**Response (200):**
```typescript
{
  "success": true,
  "data": {
    "streak_repaired": true,
    "restored_streak": 89,
    "payment": {
      "amount": 2.99,
      "currency": "USD",
      "transaction_id": "txn_xyz789"
    },
    "badge_earned": {
      "id": "second_chance",
      "title": "Second Chance",
      "description": "Repaired a streak",
      "icon_url": "https://..."
    },
    "message": "Streak Repaired! Your 89-day streak is back. Welcome back! 🔥"
  }
}
```

**Response (Error - 400):**
```typescript
{
  "success": false,
  "error": {
    "code": "REPAIR_WINDOW_EXPIRED",
    "message": "Streak repair window has expired (24 hours)",
    "details": {
      "streak_broken_at": "2025-10-29T08:00:00Z",
      "repair_deadline": "2025-10-30T08:00:00Z",
      "current_time": "2025-10-30T10:00:00Z"
    }
  }
}
```

**Response (Error - 400):**
```typescript
{
  "success": false,
  "error": {
    "code": "REPAIR_COOLDOWN_ACTIVE",
    "message": "You can only repair a streak once every 30 days",
    "details": {
      "last_repair_date": "2025-10-15",
      "next_available_date": "2025-11-14"
    }
  }
}
```

**Response (Error - 400):**
```typescript
{
  "success": false,
  "error": {
    "code": "STREAK_TOO_SHORT",
    "message": "Streak must be 7+ days to repair",
    "details": {
      "broken_streak_value": 5,
      "minimum_required": 7
    }
  }
}
```

---

### 6. GET `/api/mobile/streaks/history`

**Description:** Get streak history with calendar view data

**Query Parameters:**
- `days` (optional): Number of days to fetch (default: 90, max: 365)

**Response (200):**
```typescript
{
  "success": true,
  "data": {
    "history": [
      {
        "date": "2025-10-31",
        "checked_in": true,
        "freeze_used": false,
        "activities": ["weight_log", "mood_log", "circle_checkin"],
        "streak_on_date": 47
      },
      {
        "date": "2025-10-30",
        "checked_in": false,
        "freeze_used": true,  // ← Freeze auto-applied
        "activities": [],
        "streak_on_date": 46
      },
      {
        "date": "2025-10-29",
        "checked_in": true,
        "freeze_used": false,
        "activities": ["mood_log", "steps_log"],
        "streak_on_date": 46
      }
      // ... more dates
    ],
    "summary": {
      "total_days": 90,
      "days_with_check_ins": 83,
      "freezes_used": 2,
      "check_in_rate": 92.2,  // percentage
      "current_streak": 47,
      "longest_streak_in_period": 47
    },
    "milestones_achieved": [
      {
        "date": "2025-10-24",
        "milestone_type": "day_7",
        "title": "Week Warrior"
      },
      {
        "date": "2025-10-17",
        "milestone_type": "day_30",
        "title": "Monthly Master"
      }
    ]
  }
}
```

---

### 7. GET `/api/mobile/streaks/leaderboard`

**Description:** Get streak leaderboard (friends and global)

**Query Parameters:**
- `scope` (optional): "friends" | "global" | "circle" (default: "friends")
- `circle_id` (optional): Circle ID if scope is "circle"
- `limit` (optional): Number of results (default: 50, max: 100)

**Response (200):**
```typescript
{
  "success": true,
  "data": {
    "leaderboard": [
      {
        "rank": 1,
        "user_id": "user_123",
        "username": "FitWarrior",
        "avatar_url": "https://...",
        "current_streak": 287,
        "longest_streak": 365,
        "badge": "Annual Legend",
        "flame_color": "diamond"  // Special color for 100+ day streaks
      },
      {
        "rank": 2,
        "user_id": "user_456",
        "username": "HealthHero",
        "avatar_url": "https://...",
        "current_streak": 156,
        "longest_streak": 156,
        "badge": "Centurion",
        "flame_color": "diamond"
      },
      // ... more users
      {
        "rank": 12,
        "user_id": "current_user",  // Current user
        "username": "You",
        "avatar_url": "https://...",
        "current_streak": 47,
        "longest_streak": 89,
        "badge": "Week Warrior",
        "flame_color": "orange",
        "is_current_user": true  // ← Highlight
      }
    ],
    "user_rank": 12,
    "total_users": 1234,
    "percentile": 99.0  // User is in top 1%
  }
}
```

---

### 8. POST `/api/mobile/streaks/pause`

**Description:** Pause streak for life events (vacation, illness, etc.)

**Request Body:**
```typescript
{
  "resume_date": string;  // YYYY-MM-DD, max 90 days in future
  "reason": string;       // "vacation" | "illness" | "life_event" | "other"
  "notes?": string;       // Optional user note
}
```

**Response (200):**
```typescript
{
  "success": true,
  "data": {
    "paused": true,
    "pause_start_date": "2025-10-31",
    "pause_end_date": "2025-11-15",
    "days_paused": 15,
    "current_streak": 47,  // Preserved
    "message": "Streak paused until November 15. Your 47-day streak is safe!"
  }
}
```

**Response (Error - 400):**
```typescript
{
  "success": false,
  "error": {
    "code": "PAUSE_TOO_LONG",
    "message": "Pause duration cannot exceed 90 days",
    "details": {
      "max_pause_days": 90,
      "requested_days": 120
    }
  }
}
```

---

### 9. POST `/api/mobile/streaks/resume`

**Description:** Resume a paused streak early

**Request Body:**
```typescript
{}  // Empty body
```

**Response (200):**
```typescript
{
  "success": true,
  "data": {
    "resumed": true,
    "streak_preserved": 47,
    "message": "Welcome back! Your 47-day streak is still active. Check in today!"
  }
}
```

---

### 10. GET `/api/mobile/streaks/milestones`

**Description:** Get all milestone definitions and user progress

**Response (200):**
```typescript
{
  "success": true,
  "data": {
    "milestones": [
      {
        "milestone_type": "day_3",
        "days_required": 3,
        "title": "Getting Started",
        "description": "Complete 3 consecutive days",
        "rewards": {
          "xp": 30,
          "badges": ["getting_started"],
          "streak_freezes": 0
        },
        "achieved": true,
        "achieved_date": "2025-09-15"
      },
      {
        "milestone_type": "day_7",
        "days_required": 7,
        "title": "Week Warrior",
        "description": "Complete 7 consecutive days",
        "rewards": {
          "xp": 100,
          "badges": ["week_warrior"],
          "streak_freezes": 1
        },
        "achieved": true,
        "achieved_date": "2025-09-19"
      },
      {
        "milestone_type": "day_14",
        "days_required": 14,
        "title": "Fortnight Champion",
        "description": "Complete 14 consecutive days",
        "rewards": {
          "xp": 200,
          "badges": ["fortnight_champion"],
          "streak_freezes": 1
        },
        "achieved": true,
        "achieved_date": "2025-09-26"
      },
      {
        "milestone_type": "day_30",
        "days_required": 30,
        "title": "Monthly Master",
        "description": "Complete 30 consecutive days",
        "rewards": {
          "xp": 500,
          "badges": ["monthly_master"],
          "streak_freezes": 2,
          "unlocks": ["avatar_frame_gold"]
        },
        "achieved": true,
        "achieved_date": "2025-10-12"
      },
      {
        "milestone_type": "day_50",
        "days_required": 50,
        "title": "Halfway to 100",
        "description": "Complete 50 consecutive days",
        "rewards": {
          "xp": 750,
          "badges": ["halfway_hero"],
          "streak_freezes": 1,
          "unlocks": ["flame_color_gold"]
        },
        "achieved": false,
        "days_until": 3,  // ← Current streak is 47
        "progress_percent": 94.0
      },
      {
        "milestone_type": "day_100",
        "days_required": 100,
        "title": "Centurion",
        "description": "Complete 100 consecutive days",
        "rewards": {
          "xp": 2000,
          "badges": ["centurion"],
          "streak_freezes": 3,
          "unlocks": ["flame_color_diamond", "celebration_video"]
        },
        "achieved": false,
        "days_until": 53,
        "progress_percent": 47.0
      },
      {
        "milestone_type": "day_365",
        "days_required": 365,
        "title": "Annual Legend",
        "description": "Complete 365 consecutive days (1 year)",
        "rewards": {
          "xp": 10000,
          "badges": ["annual_legend"],
          "streak_freezes": 5,
          "unlocks": ["hall_of_fame", "lifetime_pro", "physical_medal"]
        },
        "achieved": false,
        "days_until": 318,
        "progress_percent": 12.9
      }
    ],
    "total_milestones": 7,
    "achieved_milestones": 4,
    "next_milestone": {
      "milestone_type": "day_50",
      "days_until": 3,
      "title": "Halfway to 100",
      "preview": "Unlock Gold Flame 🔥"
    }
  }
}
```

---

## Database Schema Requirements

### Changes to Existing Tables

#### 1. `engagement_streaks` Table (Already Exists)

**No changes needed** - Current schema is perfect:
```sql
CREATE TABLE engagement_streaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,

    -- Streak tracking
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_engagement_date DATE,

    -- Freeze/grace system
    streak_freezes_available INTEGER NOT NULL DEFAULT 1,
    streak_freezes_used_this_week INTEGER NOT NULL DEFAULT 0,
    auto_freeze_reset_date DATE,

    -- Pause system (life events)
    paused BOOLEAN NOT NULL DEFAULT false,
    pause_start_date DATE,
    pause_end_date DATE,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### 2. `engagement_activities` Table (Already Exists)

**Add column for check-in time:**
```sql
ALTER TABLE engagement_activities
ADD COLUMN IF NOT EXISTS activity_timestamp TIMESTAMPTZ DEFAULT NOW();

-- Add index for timestamp queries
CREATE INDEX IF NOT EXISTS idx_engagement_activities_timestamp
ON engagement_activities(user_id, activity_timestamp DESC);
```

#### 3. `daily_tracking` Table (Already Exists)

**Add columns for check-in state:**
```sql
ALTER TABLE daily_tracking
ADD COLUMN IF NOT EXISTS is_streak_check_in BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS check_in_timestamp TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS yesterday_feeling TEXT CHECK (
  yesterday_feeling IN ('great', 'ok', 'not_great')
);

-- Add index for streak check-in queries
CREATE INDEX IF NOT EXISTS idx_daily_tracking_streak_check_in
ON daily_tracking(user_id, tracking_date, is_streak_check_in);

-- Add comment
COMMENT ON COLUMN daily_tracking.is_streak_check_in IS
'True if this entry counted toward the daily engagement streak. Only the first check-in of the day sets this to true.';
```

### New Tables

#### 4. `streak_milestones` Table

**Purpose:** Track milestone achievements and rewards

```sql
CREATE TABLE IF NOT EXISTS streak_milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Milestone details
    milestone_type TEXT NOT NULL CHECK (milestone_type IN (
        'day_3', 'day_7', 'day_14', 'day_21', 'day_30',
        'day_50', 'day_100', 'day_180', 'day_365'
    )),
    days_achieved INTEGER NOT NULL,
    achieved_date DATE NOT NULL,

    -- Rewards
    xp_earned INTEGER NOT NULL DEFAULT 0,
    badges_earned TEXT[] DEFAULT '{}',  -- Array of badge IDs
    freezes_earned INTEGER DEFAULT 0,
    unlocks TEXT[] DEFAULT '{}',        -- Array of feature unlocks

    -- Celebration
    celebrated BOOLEAN DEFAULT false,
    celebration_viewed_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique constraint: one milestone per type per user
    CONSTRAINT unique_user_milestone UNIQUE (user_id, milestone_type)
);

-- Indexes
CREATE INDEX idx_streak_milestones_user_id ON streak_milestones(user_id);
CREATE INDEX idx_streak_milestones_achieved_date ON streak_milestones(achieved_date DESC);

-- RLS Policies
ALTER TABLE streak_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own milestones"
    ON streak_milestones FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage milestones"
    ON streak_milestones FOR ALL
    USING (auth.uid() IS NOT NULL);

-- Comments
COMMENT ON TABLE streak_milestones IS
'Tracks when users achieve streak milestones and what rewards they earned';
```

#### 5. `streak_repairs` Table

**Purpose:** Track streak repair purchases and cooldowns

```sql
CREATE TABLE IF NOT EXISTS streak_repairs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Repair details
    broken_streak_value INTEGER NOT NULL,
    broken_date DATE NOT NULL,
    repaired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Payment
    payment_method TEXT NOT NULL CHECK (payment_method IN (
        'stripe', 'apple_pay', 'google_pay', 'free_pro_repair'
    )),
    amount_paid DECIMAL(10,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    transaction_id TEXT,

    -- Cooldown tracking
    next_repair_available_date DATE NOT NULL,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_streak_repairs_user_id ON streak_repairs(user_id, repaired_at DESC);
CREATE INDEX idx_streak_repairs_next_available ON streak_repairs(user_id, next_repair_available_date);

-- RLS Policies
ALTER TABLE streak_repairs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own repairs"
    ON streak_repairs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage repairs"
    ON streak_repairs FOR ALL
    USING (auth.uid() IS NOT NULL);

-- Comments
COMMENT ON TABLE streak_repairs IS
'Tracks streak repair purchases and enforces 30-day cooldown';
```

#### 6. `streak_freeze_purchases` Table

**Purpose:** Track freeze purchases for monetization analytics

```sql
CREATE TABLE IF NOT EXISTS streak_freeze_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Purchase details
    quantity INTEGER NOT NULL,  -- 1 or 5 (bundle)
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',

    -- Payment
    payment_method TEXT NOT NULL CHECK (payment_method IN (
        'stripe', 'apple_pay', 'google_pay', 'xp'
    )),
    transaction_id TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_freeze_purchases_user_id ON streak_freeze_purchases(user_id, created_at DESC);
CREATE INDEX idx_freeze_purchases_created_at ON streak_freeze_purchases(created_at DESC);

-- RLS Policies
ALTER TABLE streak_freeze_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own purchases"
    ON streak_freeze_purchases FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage purchases"
    ON streak_freeze_purchases FOR ALL
    USING (auth.uid() IS NOT NULL);

-- Comments
COMMENT ON TABLE streak_freeze_purchases IS
'Tracks streak freeze purchases for revenue analytics';
```

#### 7. `streak_freeze_usage` Table

**Purpose:** Track when freezes are used (for analytics and transparency)

```sql
CREATE TABLE IF NOT EXISTS streak_freeze_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Usage details
    freeze_date DATE NOT NULL,        -- Date the freeze was applied to
    auto_applied BOOLEAN DEFAULT true, -- True if auto-applied, false if manual
    streak_value INTEGER NOT NULL,    -- Streak value when freeze was used

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_freeze_usage_user_id ON streak_freeze_usage(user_id, freeze_date DESC);
CREATE INDEX idx_freeze_usage_date ON streak_freeze_usage(freeze_date DESC);

-- RLS Policies
ALTER TABLE streak_freeze_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own freeze usage"
    ON streak_freeze_usage FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage freeze usage"
    ON streak_freeze_usage FOR ALL
    USING (auth.uid() IS NOT NULL);

-- Comments
COMMENT ON TABLE streak_freeze_usage IS
'Tracks when streak freezes are used for transparency and analytics';
```

### Migration Script

**File:** `/supabase/migrations/030_daily_streak_checkin.sql`

```sql
-- ============================================================================
-- Daily Streak Check-In Feature Migration
-- Enhances existing streak system with check-in mechanics
-- ============================================================================

-- Add columns to daily_tracking for check-in state
ALTER TABLE daily_tracking
ADD COLUMN IF NOT EXISTS is_streak_check_in BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS check_in_timestamp TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS yesterday_feeling TEXT CHECK (
  yesterday_feeling IN ('great', 'ok', 'not_great')
);

CREATE INDEX IF NOT EXISTS idx_daily_tracking_streak_check_in
ON daily_tracking(user_id, tracking_date, is_streak_check_in);

COMMENT ON COLUMN daily_tracking.is_streak_check_in IS
'True if this entry counted toward the daily engagement streak';

-- Add timestamp to engagement_activities
ALTER TABLE engagement_activities
ADD COLUMN IF NOT EXISTS activity_timestamp TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_engagement_activities_timestamp
ON engagement_activities(user_id, activity_timestamp DESC);

-- Create streak_milestones table
CREATE TABLE IF NOT EXISTS streak_milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    milestone_type TEXT NOT NULL CHECK (milestone_type IN (
        'day_3', 'day_7', 'day_14', 'day_21', 'day_30',
        'day_50', 'day_100', 'day_180', 'day_365'
    )),
    days_achieved INTEGER NOT NULL,
    achieved_date DATE NOT NULL,
    xp_earned INTEGER NOT NULL DEFAULT 0,
    badges_earned TEXT[] DEFAULT '{}',
    freezes_earned INTEGER DEFAULT 0,
    unlocks TEXT[] DEFAULT '{}',
    celebrated BOOLEAN DEFAULT false,
    celebration_viewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_milestone UNIQUE (user_id, milestone_type)
);

CREATE INDEX idx_streak_milestones_user_id ON streak_milestones(user_id);
CREATE INDEX idx_streak_milestones_achieved_date ON streak_milestones(achieved_date DESC);

ALTER TABLE streak_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own milestones"
    ON streak_milestones FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage milestones"
    ON streak_milestones FOR ALL
    USING (auth.uid() IS NOT NULL);

-- Create streak_repairs table
CREATE TABLE IF NOT EXISTS streak_repairs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    broken_streak_value INTEGER NOT NULL,
    broken_date DATE NOT NULL,
    repaired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payment_method TEXT NOT NULL CHECK (payment_method IN (
        'stripe', 'apple_pay', 'google_pay', 'free_pro_repair'
    )),
    amount_paid DECIMAL(10,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    transaction_id TEXT,
    next_repair_available_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_streak_repairs_user_id ON streak_repairs(user_id, repaired_at DESC);
CREATE INDEX idx_streak_repairs_next_available ON streak_repairs(user_id, next_repair_available_date);

ALTER TABLE streak_repairs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own repairs"
    ON streak_repairs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage repairs"
    ON streak_repairs FOR ALL
    USING (auth.uid() IS NOT NULL);

-- Create streak_freeze_purchases table
CREATE TABLE IF NOT EXISTS streak_freeze_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(10,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    payment_method TEXT NOT NULL CHECK (payment_method IN (
        'stripe', 'apple_pay', 'google_pay', 'xp'
    )),
    transaction_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_freeze_purchases_user_id ON streak_freeze_purchases(user_id, created_at DESC);
CREATE INDEX idx_freeze_purchases_created_at ON streak_freeze_purchases(created_at DESC);

ALTER TABLE streak_freeze_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own purchases"
    ON streak_freeze_purchases FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage purchases"
    ON streak_freeze_purchases FOR ALL
    USING (auth.uid() IS NOT NULL);

-- Create streak_freeze_usage table
CREATE TABLE IF NOT EXISTS streak_freeze_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    freeze_date DATE NOT NULL,
    auto_applied BOOLEAN DEFAULT true,
    streak_value INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_freeze_usage_user_id ON streak_freeze_usage(user_id, freeze_date DESC);
CREATE INDEX idx_freeze_usage_date ON streak_freeze_usage(freeze_date DESC);

ALTER TABLE streak_freeze_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own freeze usage"
    ON streak_freeze_usage FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage freeze usage"
    ON streak_freeze_usage FOR ALL
    USING (auth.uid() IS NOT NULL);

-- Comments
COMMENT ON TABLE streak_milestones IS
'Tracks when users achieve streak milestones and what rewards they earned';

COMMENT ON TABLE streak_repairs IS
'Tracks streak repair purchases and enforces 30-day cooldown';

COMMENT ON TABLE streak_freeze_purchases IS
'Tracks streak freeze purchases for revenue analytics';

COMMENT ON TABLE streak_freeze_usage IS
'Tracks when streak freezes are used for transparency and analytics';
```

---

## UX/UI Guidelines

### Visual Design System

#### Streak Counter Component

**Primary Display (Dashboard):**
```
┌────────────────────────────────────────────┐
│  🔥 47 DAY STREAK                          │
│  ━━━━━━━━━━━━━━━━━━━━━━━ 94%              │
│                                             │
│  Next Milestone: 50 Days (3 days away)     │
│  Unlock: Gold Flame 🥇                      │
│                                             │
│  Freezes: ❄️ ❄️ ❄️ (3 available)           │
└────────────────────────────────────────────┘
```

**Design Specs:**
- **Font:** SF Pro Display Bold (iOS), Roboto Bold (Android)
- **Flame Icon:** Animated flame emoji 🔥 (scales 1.0 → 1.1 → 1.0 on 2s loop)
- **Number Size:** 48px, Weight: 800
- **Progress Bar:**
  - Height: 8px
  - Border Radius: 4px
  - Colors:
    - 0-6 days: Orange gradient (#FF6B00 → #FF9500)
    - 7-29 days: Orange gradient (#FF6B00 → #FF9500)
    - 30-99 days: Gold gradient (#FFD700 → #FFA500)
    - 100+ days: Diamond gradient (#B9F2FF → #00D4FF)
  - Background: rgba(255,255,255,0.1)
  - Animation: Shimmer effect on milestone achievement

#### Check-In Button States

**State 1: Not Checked In Today (Primary CTA)**
```
┌────────────────────────────────────────────┐
│  🔥 COMPLETE TODAY'S CHECK-IN (Day 47)     │
│  Lock in your streak!                       │
│                                             │
│  [  COMPLETE CHECK-IN  ] ←────────────────┐│
│     Primary Button (Large)                 │
└────────────────────────────────────────────┘
```
- **Button Size:** Full width - 32px padding, 56px height
- **Color:** Orange gradient (#FF6B00 → #FF9500)
- **Text:** White, 18px, Bold
- **Shadow:** 0 4px 16px rgba(255,107,0,0.4)
- **Haptic:** Medium impact on press

**State 2: Already Checked In Today**
```
┌────────────────────────────────────────────┐
│  ✅ CHECK-IN COMPLETE (Day 47)             │
│  Completed today at 9:32 AM                │
│                                             │
│  [ UPDATE MOOD & ENERGY ] ←───────────────┐│
│     Secondary Button (Medium)              │
│                                             │
│  Current Stats:                             │
│  Mood: 😊 8/10  |  Energy: ⚡ 7/10          │
└────────────────────────────────────────────┘
```
- **Checkmark Badge:** Green circle with white checkmark
- **Secondary Button Size:** 80% width, 44px height
- **Color:** Gray gradient (#6B7280 → #4B5563)
- **Text:** White, 16px, Medium
- **Shadow:** 0 2px 8px rgba(0,0,0,0.2)

#### Milestone Celebration Modal

**Full-Screen Overlay:**
```
┌────────────────────────────────────────────┐
│                                             │
│         🔥 🔥 🔥 🔥 🔥                      │
│                                             │
│         47 DAY STREAK!                      │
│                                             │
│      [Animated ring animation]              │
│                                             │
│   Milestones Achieved:                      │
│   ✅ 7-Day Warrior                         │
│   ✅ 30-Day Champion                       │
│   ✅ Week 7 Complete                       │
│                                             │
│   Rewards Earned:                           │
│   • +50 XP                                  │
│   • +1 Streak Freeze ❄️                    │
│   • "Week 7" Badge 🏅                       │
│                                             │
│   Next Milestone: 50 Days (3 away!)        │
│                                             │
│   [  AWESOME!  ]                            │
└────────────────────────────────────────────┘
```

**Animation Sequence (3 seconds total):**
1. **0.0s:** Fade in overlay with dark backdrop (rgba(0,0,0,0.9))
2. **0.2s:** Flame emojis fly in from edges (bounce easing)
3. **0.5s:** "47 DAY STREAK!" text zooms in (scale 0 → 1.2 → 1.0)
4. **0.8s:** Confetti explosion (50 particles, random colors)
5. **1.0s:** Ring animation (circular progress draw)
6. **1.5s:** Milestones list fade in one-by-one (stagger 0.1s)
7. **2.0s:** Rewards list fade in (glow effect)
8. **2.5s:** "Next Milestone" hint appears
9. **3.0s:** Button enabled with haptic feedback

**Design Specs:**
- **Backdrop:** Dark overlay with blur effect
- **Card:** White background with rounded corners (24px)
- **Confetti:** 50 particles in brand colors (orange, purple, cyan, green)
- **Ring:** SVG animated stroke-dasharray from 0 to full circle
- **Sound:** Optional celebration chime (user setting)

#### Streak Freeze Visual Indicator

**Freeze Counter:**
```
Freezes: ❄️ ❄️ ❄️ ❄️ ❄️ (5 available)
         ^  ^  ^  🔒 🔒 (0 available, locked)
```

**Freeze Used Alert:**
```
┌────────────────────────────────────────────┐
│  ⚠️ STREAK FREEZE USED YESTERDAY            │
│                                             │
│  You missed Day 48, but we've got your     │
│  back! A Streak Freeze was automatically   │
│  used to protect your 47-day streak.       │
│                                             │
│  Current Streak: 🔥 48 days (protected)     │
│  Freezes Remaining: 2 ❄️                    │
│                                             │
│  ⏰ Check in today to keep your streak      │
│     going!                                  │
│                                             │
│  [  COMPLETE TODAY'S CHECK-IN  ]           │
└────────────────────────────────────────────┘
```

- **Alert Color:** Amber/Warning (#F59E0B)
- **Border:** 2px solid amber with subtle glow
- **Icon:** Animated melting snowflake
- **Priority:** Top of dashboard, dismissible after check-in

#### Streak Broken Modal

**Full-Screen Takeover:**
```
┌────────────────────────────────────────────┐
│                                             │
│              💔                             │
│                                             │
│      Your 89-Day Streak Ended              │
│                                             │
│   You missed 2 days without freezes.       │
│                                             │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━       │
│                                             │
│   Good news: You can repair it!            │
│                                             │
│   [  REPAIR STREAK - $2.99  ] ←────────┐   │
│      Primary, Large, Green               │   │
│                                             │
│   [  Start Fresh  ] ←──────────────────┐   │
│      Secondary, Medium, Gray             │   │
│                                             │
│   ⏰ 23h 47m remaining                      │
│                                             │
│   You can repair streaks 7+ days once      │
│   every 30 days                             │
└────────────────────────────────────────────┘
```

**Design Specs:**
- **Backdrop:** Dark red-tinted overlay (rgba(220,38,38,0.1))
- **Broken Heart:** Large animated broken heart emoji (splits animation)
- **Timer:** Live countdown in red (#DC2626)
- **Repair Button:** Green (#10B981) with pulsing glow effect
- **Psychology:** Emphasize repairability to reduce pain of loss

### Color Palette for Streak System

| Element | Color | Hex | Usage |
|---------|-------|-----|-------|
| **Flame (0-6 days)** | Orange | #FF6B00 | New streaks |
| **Flame (7-29 days)** | Bright Orange | #FF9500 | Established streaks |
| **Flame (30-99 days)** | Gold | #FFD700 | Monthly champions |
| **Flame (100+ days)** | Diamond Blue | #00D4FF | Centurions |
| **Freeze Icon** | Ice Blue | #60A5FA | Available freezes |
| **Freeze Used** | Gray | #9CA3AF | Used freezes |
| **Success Green** | Emerald | #10B981 | Check-in complete |
| **Warning Amber** | Amber | #F59E0B | Freeze used alert |
| **Error Red** | Red | #DC2626 | Streak broken |
| **Background Dark** | Slate | #0F172A | Dark mode base |
| **Card Background** | Slate 800 | #1E293B | Card containers |

### Accessibility

- **VoiceOver/TalkBack:** Full screen reader support for all streak elements
- **Dynamic Type:** Text scales with system settings (iOS)
- **Haptic Feedback:**
  - Light impact on button press
  - Medium impact on check-in complete
  - Heavy impact on milestone achievement
- **Reduced Motion:** Disable confetti/animations if user preference set
- **High Contrast:** Alternative color scheme for accessibility settings

---

## Gamification Mechanics

### Psychological Principles Applied

#### 1. Loss Aversion (Primary Driver)
- **Principle:** People are more motivated to avoid losing something than to gain something new
- **Implementation:**
  - Streak counter prominently displayed (always visible)
  - Emotional language: "Don't break your 47-day streak!"
  - Warning notifications before streak expiration
  - Grace mechanics (freezes) reduce anxiety while maintaining urgency
- **Data:** Duolingo's streak loss accounts for 21% churn reduction with Streak Freeze

#### 2. Commitment Bias
- **Principle:** People continue behaviors they've invested time/effort in
- **Implementation:**
  - Streak counter shows investment (47 days = 47 moments of commitment)
  - Historical calendar view shows pattern of dedication
  - "You've come so far, don't stop now!"
- **Data:** Users with 7+ day streaks are 3.6x more likely to reach 90-day goals

#### 3. Variable Rewards (Milestone System)
- **Principle:** Unpredictable rewards increase engagement (slot machine effect)
- **Implementation:**
  - Milestone celebrations at varying intervals (3, 7, 14, 30, 50, 100, 365 days)
  - Surprise rewards at milestones (badges, XP, freezes, unlocks)
  - "Next milestone" tease keeps users curious
- **Data:** Milestone badges boost completion rates by 30% (fitness app research)

#### 4. Social Proof & Competition
- **Principle:** People want to match or exceed peers
- **Implementation:**
  - Streak leaderboard (friends and global)
  - Friend streak comparisons
  - "X% of users have shorter streaks than you!"
  - Share achievements to social media
- **Data:** Social features drive 40% more engagement (Strava)

#### 5. Progress Visualization
- **Principle:** Seeing progress motivates continued effort
- **Implementation:**
  - Circular progress rings (Apple Fitness inspiration)
  - Animated progress bars
  - Calendar heatmap showing daily check-ins
  - "You're 94% to your next milestone!"
- **Data:** Visual progress tracking reduces churn by 15%

#### 6. Immediate Feedback
- **Principle:** Fast feedback loops increase behavior reinforcement
- **Implementation:**
  - Instant celebration animation on check-in
  - XP gain notification immediately visible
  - Confetti/haptic feedback on completion
- **Data:** Immediate feedback creates dopamine release (neuroscience research)

### Reward Schedule

#### XP Rewards
- **Daily Check-In:** +10 XP (base)
- **3-Day Streak:** +30 XP (bonus)
- **7-Day Streak:** +100 XP (milestone)
- **14-Day Streak:** +200 XP (milestone)
- **30-Day Streak:** +500 XP (milestone)
- **50-Day Streak:** +750 XP (milestone)
- **100-Day Streak:** +2,000 XP (milestone)
- **365-Day Streak:** +10,000 XP (legendary)

**XP Multipliers:**
- **Perfect Week (7/7 days):** +20% XP bonus for that week
- **Perfect Month (30/30 days):** +50% XP bonus for that month
- **Pro Membership:** +25% XP on all check-ins

#### Badge System

**Tier 1: Starter (Days 1-7)**
- 🌱 "Fresh Start" - Complete Day 1
- 🔥 "Getting Started" - 3-day streak
- ⚡ "Week Warrior" - 7-day streak

**Tier 2: Intermediate (Days 8-30)**
- 💪 "Fortnight Champion" - 14-day streak
- 🏃 "Three Weeks Strong" - 21-day streak
- 🏆 "Monthly Master" - 30-day streak

**Tier 3: Advanced (Days 31-99)**
- 🎖️ "Six Weeks Elite" - 42-day streak
- 🥈 "Halfway to 100" - 50-day streak
- 🔓 "60-Day Achiever" - 60-day streak
- 🌟 "90-Day Legend" - 90-day streak

**Tier 4: Expert (Days 100-364)**
- 🥇 "Centurion" - 100-day streak
- 💎 "Diamond Tier" - 180-day streak
- 👑 "Elite Status" - 270-day streak

**Tier 5: Legendary (Day 365+)**
- 🏅 "Annual Legend" - 365-day streak
- 🔥 "Streak God" - 500-day streak
- ♾️ "Infinite Commitment" - 730-day streak (2 years)

**Special Badges:**
- 🔄 "Second Chance" - Repaired a broken streak
- 🧊 "Ice Warrior" - Used 10 streak freezes
- 💰 "Investor" - Purchased 25 streak freezes
- 🤝 "Social Butterfly" - 30-day friend streak with 5+ friends
- 📅 "Perfect Month" - 30/30 days in a calendar month
- 🎯 "Consistency King/Queen" - 100-day streak with 0 freezes used

#### Unlockable Features

**Cosmetic Unlocks:**
- **Day 30:** Gold Avatar Frame
- **Day 50:** Gold Flame Color (instead of orange)
- **Day 100:** Diamond Flame Color (instead of gold)
- **Day 100:** Custom Celebration Video (personalized)
- **Day 180:** Rainbow Flame Animation
- **Day 365:** Crown Icon next to username
- **Day 365:** "Hall of Fame" profile badge (visible to all)

**Functional Unlocks:**
- **Day 30:** Custom Streak Freeze Icon
- **Day 50:** Streak Widget (home screen)
- **Day 100:** Streak Insurance (one free repair per year)
- **Day 365:** Lifetime FitCircle Pro (all premium features)
- **Day 365:** Physical Medal mailed to address

**Social Unlocks:**
- **Day 7:** Friend Streak feature enabled
- **Day 14:** Streak Leaderboard access
- **Day 30:** "Streak Superstar" profile badge (public)
- **Day 100:** "100 Club" membership (exclusive community)
- **Day 365:** "Hall of Fame" listing (website feature)

### Monetization Opportunities

#### Premium Features (FitCircle Pro - $9.99/month)
- **2 Starting Freezes** (instead of 1)
- **Earn Freezes Every 5 Days** (instead of 7)
- **1 Free Streak Repair per Month** (usually $2.99)
- **+25% XP Bonus** on all check-ins
- **Early Access to Milestones** (celebrate 1 day early)
- **Custom Flame Colors** unlocked immediately
- **No Ads** in celebration screens

#### In-App Purchases (One-Time)
- **Streak Freeze:** $0.99 each
- **Streak Freeze Bundle (5):** $3.99 (20% discount)
- **Streak Repair:** $2.99 (once per 30 days)
- **Streak Shield:** $9.99 (prevents next streak break, one-time use)
- **XP Booster (7 days):** $4.99 (+50% XP for 1 week)

#### Alternative Currency (XP-Based Purchases)
- **Streak Freeze:** 100 XP
- **Streak Repair:** 500 XP (if available)
- **XP Booster (7 days):** 300 XP

**Strategy:** Make purchases expensive enough to value real money, but possible to earn through dedication

### Notification Strategy

#### Daily Reminders
- **Morning (9 AM):** "Good morning! Start your Day 47 streak check-in 🔥"
- **Afternoon (2 PM):** "Halfway through the day! Have you checked in yet?"
- **Evening (7 PM):** "Don't forget your check-in tonight! 🔥 47-day streak"
- **Late Night (10 PM):** "⚠️ 2 hours left! Don't break your 47-day streak!"

**Smart Timing:**
- Learn user's typical check-in time (e.g., 9:32 AM)
- Send reminders 1 hour before typical time
- Reduce reminder frequency as streak grows (7+ days = trust user)

#### Freeze Alerts
- **Freeze Used:** "Streak Freeze Used! Your 47-day streak is safe. You have 2 freezes remaining."
- **Last Freeze:** "⚠️ Last freeze remaining! Check in tomorrow to keep your 52-day streak alive."
- **No Freezes:** "⚠️ No freezes left! Missing tomorrow will break your 47-day streak."

#### Milestone Previews
- **2 Days Before Milestone:** "Just 2 days until your 50-day milestone! Unlock Gold Flame 🔥"
- **1 Day Before Milestone:** "Tomorrow is Day 50! 🎉 Keep it up!"
- **Milestone Day:** "🔥 Today is your 50th day! Check in to celebrate!"

#### Re-Engagement (Lapsed Users)
- **Day 1 After Break:** "💔 Your 89-day streak ended. Repair it within 24 hours? [Repair Now]"
- **Day 2 After Break:** "Start fresh today! Your longest streak was 89 days - let's beat it! 🔥"
- **Day 7 After Break:** "We miss you! Come back and rebuild your streak. You've got this! 💪"

---

## User Stories & Acceptance Criteria

### Epic: Daily Streak Check-In

---

### User Story 1: First-Time Check-In (New User)

**As a** new FitCircle user
**I want to** complete my first daily check-in
**So that** I can start building my engagement streak

#### Acceptance Criteria
- [ ] Dashboard shows "Start Your Streak!" prominent card
- [ ] User taps "Complete Today's Check-In" button
- [ ] Step 1 shown: "How do you feel about yesterday?" with 3 emoji options
- [ ] Step 2 shown: Mood slider (1-10) with circular interaction
- [ ] Step 3 shown: Energy slider (1-10) with circular interaction
- [ ] Step 4 shown (optional): Weight entry with skip option
- [ ] Celebration modal appears with "🔥 Day 1 Streak Started!" message
- [ ] Confetti animation plays (3 seconds)
- [ ] User earns +10 XP and "Fresh Start" badge
- [ ] Database records:
  - `daily_tracking` entry with `is_streak_check_in = true`
  - `engagement_activities` entry with `activity_type = 'mood_log'`
  - `engagement_streaks` record created with `current_streak = 1`
  - `streak_milestones` entry for Day 1 (if milestone exists)
- [ ] Dashboard updates to show "✅ Check-In Complete" state
- [ ] "Update Stats" button now available

#### Edge Cases
- [ ] User exits mid-flow → Progress saved, resume on return
- [ ] User loses connection → Retry mechanism with offline queue
- [ ] User tries to check in at 11:59 PM → Succeeds (counts for that day)
- [ ] User tries to check in at 12:01 AM → Counts as next day's check-in

---

### User Story 2: Daily Check-In (Established User)

**As an** established FitCircle user with a 47-day streak
**I want to** complete my daily check-in quickly
**So that** I can maintain my streak without friction

#### Acceptance Criteria
- [ ] Dashboard shows "🔥 Complete Today's Check-In (Day 47)" prominent card
- [ ] User taps "Complete Check-In" button
- [ ] Streamlined flow shown (no "Yesterday" question)
- [ ] Mood slider defaults to previous value (smart default)
- [ ] Energy slider defaults to previous value (smart default)
- [ ] Weight prompt only shown if 3+ days since last weigh-in
- [ ] User can complete check-in in <30 seconds
- [ ] Celebration modal appears if milestone reached
- [ ] Dashboard updates to show "✅ Check-In Complete - Day 47"
- [ ] Streak counter increments to 48 (visible immediately)
- [ ] Database records:
  - `daily_tracking` entry with `is_streak_check_in = true`
  - `engagement_streaks` updated with `current_streak = 48`
  - `streak_milestones` entry if milestone achieved
  - `engagement_activities` entry logged

#### Edge Cases
- [ ] User already has highest streak → Longest streak updated
- [ ] Milestone reached (e.g., Day 50) → Celebration modal with rewards shown
- [ ] User earns freeze (every 7 days) → Notification shown, freezes incremented
- [ ] Multiple devices → Last check-in wins, no duplicate streaks

---

### User Story 3: Updating Stats Later in Day

**As a** user who already checked in this morning
**I want to** update my mood and energy later in the day
**So that** I can track my state throughout the day without affecting my streak

#### Acceptance Criteria
- [ ] Dashboard shows "✅ Check-In Complete" with "Update Stats" button
- [ ] "Update Stats" button is visually secondary (gray, smaller)
- [ ] User taps "Update Mood & Energy"
- [ ] Inline modal appears (not full-screen)
- [ ] Mood and energy sliders pre-filled with current values
- [ ] Optional notes field available
- [ ] User saves update
- [ ] Simple "Stats Updated ✓" confirmation shown (no celebration)
- [ ] Dashboard shows updated mood/energy values
- [ ] Streak counter DOES NOT increment (still Day 47)
- [ ] Database records:
  - `daily_tracking` entry updated (same record, `is_streak_check_in = false` for this update)
  - `updated_at` timestamp updated
  - `engagement_activities` entry NOT created (non-streak activity)
- [ ] Info tooltip: "ℹ️ No streak impact - you already checked in today!"

#### Edge Cases
- [ ] User updates stats multiple times → All updates saved, latest wins
- [ ] User tries to re-check-in → Blocked, message shown: "You already checked in today"
- [ ] User updates stats at 11:58 PM → Update succeeds for current day

---

### User Story 4: Missing a Day - Freeze Auto-Applied

**As a** user who forgot to check in yesterday
**I want** my streak to be automatically protected with a Streak Freeze
**So that** I don't lose my 47-day streak and feel motivated to continue

#### Acceptance Criteria
- [ ] User missed Day 48 (no check-in yesterday)
- [ ] User has 3 available freezes
- [ ] System automatically applies 1 freeze at 12:01 AM (day after missed day)
- [ ] Push notification sent: "Streak Freeze Used! Check in today."
- [ ] Database records:
  - `engagement_streaks` updated: `streak_freezes_available = 2`
  - `streak_freeze_usage` entry created with `auto_applied = true`
  - Streak continues: `current_streak = 48` (protected)
- [ ] User opens app next day
- [ ] Dashboard shows prominent alert card: "⚠️ Streak Freeze Used Yesterday"
- [ ] Alert explains freeze was auto-applied
- [ ] Current streak shows: "🔥 48 days (protected)"
- [ ] Freezes remaining: "2 ❄️"
- [ ] Alert dismissible after today's check-in
- [ ] User completes check-in normally
- [ ] Streak continues to 49

#### Edge Cases
- [ ] User has 0 freezes → Streak breaks, see User Story 5
- [ ] User misses 2 days in a row → 2 freezes used (if available)
- [ ] User has 1 freeze, misses 2 days → 1 freeze used, streak breaks on day 2
- [ ] User paused streak → No freeze used, streak doesn't break

---

### User Story 5: Streak Broken - Repair Option

**As a** user whose 89-day streak just broke
**I want** the option to repair my streak within 24 hours
**So that** I can recover from a mistake and continue my progress

#### Acceptance Criteria
- [ ] User missed 2 consecutive days without freezes
- [ ] Streak breaks at 12:01 AM on second missed day
- [ ] Push notification sent immediately: "💔 Your 89-day streak is broken! Repair within 24h?"
- [ ] Database records:
  - `engagement_streaks` updated: `current_streak = 0`, `longest_streak = 89`
- [ ] User opens app within 24 hours
- [ ] Full-screen modal appears: "Your 89-Day Streak Ended"
- [ ] Modal shows:
  - Broken heart emoji 💔
  - Explanation: "You missed 2 days without freezes."
  - "Good news: You can repair it!"
  - Prominent green "Repair Streak - $2.99" button
  - Secondary gray "Start Fresh" button
  - Live countdown timer: "23h 47m remaining"
  - Fine print: "You can repair streaks 7+ days once every 30 days"
- [ ] User taps "Repair Streak"
- [ ] Payment modal appears (Apple Pay / Google Pay / Stripe)
- [ ] User completes payment
- [ ] Celebration: "🔥 Streak Repaired! Welcome back!"
- [ ] Flame resurrection animation plays
- [ ] Streak restored to 89 days
- [ ] Database records:
  - `streak_repairs` entry created
  - `engagement_streaks` updated: `current_streak = 89`
  - `next_repair_available_date` set to 30 days from now
- [ ] Badge earned: "Second Chance" 🔄

#### Edge Cases
- [ ] 24-hour window expired → Repair option disabled, "Start Fresh" only option
- [ ] User repaired in last 30 days → Repair button disabled, cooldown message shown
- [ ] Broken streak was < 7 days → Repair option not available
- [ ] User has FitCircle Pro with free monthly repair → Repair is free
- [ ] Payment fails → Error message, retry option
- [ ] User taps "Start Fresh" → Confirmation modal, streak resets to 0

---

### User Story 6: Milestone Achievement

**As a** user reaching a 50-day streak
**I want** to be celebrated with rewards and recognition
**So that** I feel motivated to continue and proud of my achievement

#### Acceptance Criteria
- [ ] User completes check-in on Day 50
- [ ] System detects milestone achievement
- [ ] Full-screen celebration modal appears (after check-in flow)
- [ ] Animation sequence (3 seconds):
  - Flame emojis fly in from edges
  - "50 DAY STREAK!" text zooms in
  - Confetti explosion (50 particles)
  - Circular ring animation completes
  - Milestones list fades in
  - Rewards list fades in with glow
- [ ] Modal shows:
  - "🔥 50 DAY STREAK! 🔥" headline
  - List of achieved milestones (7, 30, 50 with checkmarks)
  - Rewards earned:
    - +750 XP
    - +1 Streak Freeze
    - "Halfway to 100" badge
    - Gold Flame unlock
  - Next milestone tease: "100 Days (50 days away!)"
- [ ] User taps "Awesome!" button
- [ ] Database records:
  - `streak_milestones` entry created for Day 50
  - `engagement_streaks` updated: `streak_freezes_available += 1`
  - User XP incremented by 750
  - Badge added to user profile
- [ ] Badge notification appears on profile screen
- [ ] Flame color changes to gold on all streak displays
- [ ] Push notification sent: "🔥 Milestone! You hit 50 days! Unlock: Gold Flame"

#### Edge Cases
- [ ] User achieves multiple milestones on same day (rare) → Show all in one modal
- [ ] User dismisses modal → Can view celebration again from profile history
- [ ] User reaches Day 100 → Personalized celebration video generated

---

### User Story 7: Purchasing Streak Freezes

**As a** user with 0 freezes remaining
**I want** to purchase additional Streak Freezes
**So that** I can protect my streak from future breaks

#### Acceptance Criteria
- [ ] User has 0 freezes available
- [ ] Dashboard shows "0 ❄️" with "Buy More" button
- [ ] User taps "Buy More" or goes to Streak Shop
- [ ] Purchase modal appears showing options:
  - 1 Freeze: $0.99
  - 5 Freezes (Bundle): $3.99 (20% discount badge)
  - 100 XP alternative option (if user has enough XP)
- [ ] User selects option
- [ ] Payment modal appears (Apple Pay / Google Pay / Stripe)
- [ ] User completes payment
- [ ] Success confirmation: "Freeze Purchased! You now have X freezes."
- [ ] Database records:
  - `streak_freeze_purchases` entry created
  - `engagement_streaks` updated: `streak_freezes_available += quantity`
  - Transaction ID stored
- [ ] Dashboard updates to show new freeze count
- [ ] Receipt sent via email

#### Edge Cases
- [ ] User already has 5 freezes (max) → Purchase disabled, message: "Max freezes reached"
- [ ] Payment fails → Error message, retry option
- [ ] User purchases via XP → XP deducted, no financial transaction
- [ ] User has FitCircle Pro → Gets discount: $0.79 per freeze

---

### User Story 8: Viewing Streak History

**As a** user with a 47-day streak
**I want** to view my check-in history in a calendar format
**So that** I can see my consistency and identify patterns

#### Acceptance Criteria
- [ ] User navigates to "Streak History" screen
- [ ] Calendar view shows last 90 days by default
- [ ] Each day shows:
  - Green dot: Checked in ✅
  - Orange dot: Freeze used ❄️
  - Gray dot: No check-in (before streak started)
  - Empty: Future dates
- [ ] User taps a day
- [ ] Detail modal appears showing:
  - Date
  - Check-in time (if checked in)
  - Activities logged that day
  - Mood and energy values
  - Streak value on that date
- [ ] Summary stats shown at top:
  - Total days tracked: 90
  - Check-in rate: 92.2%
  - Freezes used: 2
  - Current streak: 47
  - Longest streak: 89
- [ ] User can toggle view: Calendar | List | Graph
- [ ] User can export history as CSV (Pro feature)

#### Edge Cases
- [ ] User has < 90 days of data → Show all available data
- [ ] User wants to see more than 90 days → "View Full Year" option (loads 365 days)
- [ ] User has broken streak in visible range → Broken days marked with 💔

---

### User Story 9: Streak Leaderboard

**As a** competitive user
**I want** to see how my streak compares to my friends and the global community
**So that** I feel motivated by social competition

#### Acceptance Criteria
- [ ] User navigates to "Streak Leaderboard" screen
- [ ] Three tabs shown: Friends | Global | Circle
- [ ] **Friends Tab:**
  - Shows all friends sorted by current streak (descending)
  - Shows rank, username, avatar, current streak, badge
  - Current user highlighted in gold
  - User's rank and percentile shown at top
- [ ] **Global Tab:**
  - Shows top 100 users globally
  - Same format as Friends
  - Current user shown if in top 100, otherwise shows "Your rank: #1,234"
- [ ] **Circle Tab:**
  - Shows members of selected FitCircle
  - Sorted by current streak
  - Team average streak shown at top
- [ ] User taps another user
- [ ] Profile modal appears showing their streak stats and badges
- [ ] Pull-to-refresh updates leaderboard
- [ ] Leaderboard updates in real-time (WebSocket or 5-minute polling)

#### Edge Cases
- [ ] User has no friends → Empty state with "Invite Friends" CTA
- [ ] User not in any circles → Circle tab disabled
- [ ] Leaderboard tie → Sorted by longest streak as tiebreaker
- [ ] User blocks someone → Blocked user doesn't appear in leaderboard

---

### User Story 10: Pausing Streak for Vacation

**As a** user going on vacation for 2 weeks
**I want** to pause my streak without breaking it
**So that** I can take a break guilt-free and resume when I return

#### Acceptance Criteria
- [ ] User navigates to Streak Settings
- [ ] "Pause Streak" option available
- [ ] User taps "Pause Streak"
- [ ] Modal appears:
  - "Pause your streak for how long?"
  - Date picker for resume date
  - Reason dropdown: Vacation | Illness | Life Event | Other
  - Optional notes field
  - "Max 90 days" notice
- [ ] User selects resume date (15 days from now)
- [ ] Confirmation modal: "Are you sure? Your streak will be frozen until [date]"
- [ ] User confirms
- [ ] Database records:
  - `engagement_streaks` updated: `paused = true`, `pause_start_date`, `pause_end_date`
- [ ] Dashboard shows "🛑 Streak Paused" banner
- [ ] Banner shows: "Paused until November 15. Your 47-day streak is safe!"
- [ ] Check-in prompts disabled during pause
- [ ] User can resume early via "Resume Early" button
- [ ] On resume date, automatic notification sent: "Welcome back! Resume your streak today!"

#### Edge Cases
- [ ] User selects resume date > 90 days → Error: "Max 90 days"
- [ ] User tries to pause already paused streak → Error: "Already paused"
- [ ] User resumes early → Streak continues from pause point
- [ ] User doesn't resume on date → Automatic resume triggered, check-in required to continue

---

## Success Metrics

### Primary KPIs

#### 1. Daily Active Users (DAU)
- **Baseline:** Current DAU pre-streak feature
- **Target:** +60% increase in DAU within 90 days of launch
- **Measurement:** Track daily unique users who open the app
- **Rationale:** Duolingo's streak system drove 60% increase in engagement

#### 2. User Retention
- **Baseline:** Current 30-day retention rate
- **Target:** 85%+ retention for users who reach 7-day streaks
- **Measurement:** Cohort analysis of users by streak length
- **Rationale:** Users with 7+ day streaks are 3.6x more likely to complete goals

#### 3. Check-In Completion Rate
- **Baseline:** Current daily tracking rate
- **Target:** 90%+ of users check in at least once per day
- **Measurement:** Daily check-in count / Total active users
- **Rationale:** High check-in rate indicates effective habit formation

#### 4. Churn Reduction
- **Baseline:** Current 90-day churn rate
- **Target:** 21% reduction in churn among users with streaks
- **Measurement:** Compare churn rates before/after streak feature
- **Rationale:** Streak Freeze reduced Duolingo churn by 21%

### Secondary KPIs

#### 5. Milestone Achievement Rate
- **Target:** 70% of users reach Day 7 milestone
- **Target:** 40% of users reach Day 30 milestone
- **Target:** 15% of users reach Day 100 milestone
- **Measurement:** Count of users achieving each milestone / Total users

#### 6. Freeze Usage Rate
- **Target:** Average 1.5 freezes used per user per month
- **Measurement:** Total freezes used / Total users / Months
- **Rationale:** Indicates users are engaged enough to have streaks worth protecting

#### 7. Repair Purchase Rate
- **Target:** 10% of users with broken streaks 7+ days purchase repair
- **Measurement:** Repairs purchased / Streaks broken (7+ days)
- **Rationale:** Indicates strong emotional attachment to streaks

#### 8. Freeze Purchase Rate
- **Target:** 5% of users purchase additional freezes
- **Measurement:** Users who purchased freezes / Total users
- **Rationale:** Premium monetization metric

### Engagement Metrics

#### 9. Average Streak Length
- **Target:** Average streak of 21+ days across all active users
- **Measurement:** Mean current streak across all users

#### 10. Longest Streak Distribution
- **Target:** 20% of users have longest streak of 30+ days
- **Measurement:** Distribution histogram of longest streaks

#### 11. Multiple Check-Ins Per Day Rate
- **Target:** 30% of users update stats after initial check-in
- **Measurement:** Days with multiple tracking updates / Total check-in days
- **Rationale:** Indicates high engagement and real-time tracking value

#### 12. Social Leaderboard Engagement
- **Target:** 50% of users view leaderboard at least once per week
- **Measurement:** Unique users viewing leaderboard / Total active users

### Revenue Metrics

#### 13. Freeze Purchase Revenue
- **Target:** $0.50 average revenue per user per month (ARPU)
- **Measurement:** Total freeze purchases / Total users / Months

#### 14. Repair Purchase Revenue
- **Target:** $0.25 ARPU from repairs
- **Measurement:** Total repair purchases / Total users / Months

#### 15. Pro Conversion Rate (Streak-Driven)
- **Target:** 15% of users with 30+ day streaks convert to Pro
- **Measurement:** Pro conversions from streak users / Users with 30+ streaks

### User Satisfaction Metrics

#### 16. NPS (Net Promoter Score)
- **Target:** +20 points increase in NPS after streak feature launch
- **Measurement:** Survey question: "How likely are you to recommend FitCircle?"

#### 17. App Store Rating
- **Target:** 4.7+ star average rating
- **Measurement:** Average rating on App Store and Google Play

#### 18. Feature Satisfaction
- **Target:** 85% of users rate streak feature as "Very Useful" or "Extremely Useful"
- **Measurement:** In-app survey after 14-day streak

### Technical Metrics

#### 19. API Response Time
- **Target:** <200ms for check-in endpoint (p95)
- **Measurement:** Monitor `/api/mobile/streaks/check-in` latency

#### 20. Error Rate
- **Target:** <0.1% error rate on check-in flow
- **Measurement:** Failed check-ins / Total check-in attempts

#### 21. Push Notification Delivery Rate
- **Target:** 95%+ delivery rate for streak reminders
- **Measurement:** Delivered notifications / Sent notifications

### Success Dashboard (Weekly Review)

| Metric | Baseline | Target | Current | Status |
|--------|----------|--------|---------|--------|
| DAU | 10,000 | 16,000 | 14,500 | 🟡 On Track |
| 30-Day Retention | 45% | 60% | 58% | 🟢 Exceeding |
| Check-In Rate | 65% | 90% | 87% | 🟢 Exceeding |
| Avg Streak Length | 5 days | 21 days | 18 days | 🟡 On Track |
| Day 7 Milestone | - | 70% | 72% | 🟢 Exceeding |
| Day 30 Milestone | - | 40% | 38% | 🟡 On Track |
| Freeze Purchases | - | 5% | 4.2% | 🟡 On Track |
| Repair Purchases | - | 10% | 12% | 🟢 Exceeding |
| NPS | 35 | 55 | 52 | 🟡 On Track |
| API P95 Latency | - | <200ms | 145ms | 🟢 Exceeding |

**Status Legend:**
- 🟢 Exceeding Target
- 🟡 On Track (90%+ of target)
- 🔴 Below Target (action needed)

---

## Implementation Phases

### Phase 1: Core Check-In Flow (Weeks 1-2)

**Goal:** Launch MVP with basic check-in and streak tracking

#### Deliverables
- ✅ Database migration (030_daily_streak_checkin.sql)
- ✅ Backend API endpoints:
  - POST `/api/mobile/streaks/check-in`
  - GET `/api/mobile/streaks/status`
- ✅ Service layer:
  - Enhanced `EngagementStreakService` with check-in logic
  - `StreakMilestoneService` for milestone detection
- ✅ iOS UI components:
  - Daily check-in button (primary/secondary states)
  - Mood & energy circular sliders
  - Simple celebration animation
  - Streak counter display
- ✅ Push notifications:
  - Daily check-in reminder
  - Streak at-risk warning

#### Success Criteria
- Users can complete daily check-in in <30 seconds
- Streak counter increments correctly
- Multiple check-ins per day don't duplicate streak
- API response time <200ms (p95)

---

### Phase 2: Freeze System & Milestones (Weeks 3-4)

**Goal:** Add grace mechanics and milestone celebrations

#### Deliverables
- ✅ Auto-freeze logic in backend
- ✅ Freeze notification system
- ✅ Milestone detection and rewards
- ✅ Enhanced celebration modals:
  - Confetti animation
  - Milestone badge display
  - XP gain notification
- ✅ Freeze purchase flow (IAP integration)
- ✅ Streak history calendar view
- ✅ Badge system integration

#### Success Criteria
- Freezes auto-apply correctly when user misses day
- 70% of users reach Day 7 milestone
- Celebration animations complete without lag
- Users can purchase freezes successfully

---

### Phase 3: Repair & Advanced Features (Weeks 5-6)

**Goal:** Add streak repair and social features

#### Deliverables
- ✅ Streak repair purchase flow
- ✅ Repair cooldown enforcement (30 days)
- ✅ Repair window timer (24 hours)
- ✅ Streak leaderboard (friends & global)
- ✅ Pause/resume streak functionality
- ✅ Advanced milestone rewards (unlocks)
- ✅ Flame color system (gold, diamond)
- ✅ Share achievements to social media

#### Success Criteria
- 10%+ of broken streaks (7+ days) are repaired
- Leaderboard loads in <1 second
- Pause/resume works without breaking streaks
- Users share milestones to social media

---

### Phase 4: Premium & Optimization (Weeks 7-8)

**Goal:** Monetization and performance optimization

#### Deliverables
- ✅ FitCircle Pro streak benefits
- ✅ XP-based freeze purchases
- ✅ Streak widget (home screen)
- ✅ Performance optimization:
  - Caching strategy for streak data
  - WebSocket for real-time leaderboard
  - Image optimization for badges
- ✅ Analytics dashboard for tracking KPIs
- ✅ A/B testing framework for milestone intervals
- ✅ Reduced motion accessibility mode

#### Success Criteria
- Pro conversion rate of 15%+ among 30-day streak users
- API latency reduced to <100ms (p95)
- Widget install rate of 40%+ among iOS users
- All accessibility guidelines met (WCAG AA)

---

### Phase 5: Advanced Gamification (Weeks 9-12)

**Goal:** Social features and advanced gamification

#### Deliverables
- ✅ Friend Streaks (shared streaks with friends)
- ✅ Circle Streaks (team collective streaks)
- ✅ Streak Insurance (premium feature)
- ✅ Custom celebration videos (Day 100+)
- ✅ Hall of Fame (Day 365 users)
- ✅ Physical medal program (Day 365 users)
- ✅ Lifetime Pro unlock (Day 365)
- ✅ Streak challenges (e.g., "Perfect Week" challenges)
- ✅ Smart reminders (ML-based timing)

#### Success Criteria
- 30% of users engage with Friend Streaks
- Average team streak of 14+ days in Circles
- 50% of Day 100 users watch their custom video
- Physical medal program launched (logistics in place)

---

## Appendix

### Glossary

- **Engagement Streak:** Consecutive days with at least one qualifying activity (check-in, weight log, etc.)
- **Streak-Eligible Activity:** Activity that counts toward daily streak (first check-in of the day)
- **Non-Streak Activity:** Activity that doesn't count toward streak (updates after first check-in)
- **Streak Freeze:** Grace day that protects streak when user misses a day
- **Streak Repair:** One-time purchase to restore a recently broken streak (24-hour window)
- **Milestone:** Achievement unlocked at specific streak thresholds (7, 30, 100 days, etc.)
- **Longest Streak:** Highest consecutive streak ever achieved by user
- **Current Streak:** Active streak count (resets to 0 when broken)
- **Pause:** Temporary halt of streak counting for life events (max 90 days)

### References

1. Duolingo Streak Mechanics (2024): https://blog.duolingo.com/how-duolingo-streak-builds-habit/
2. Snapchat Streak System: https://help.snapchat.com/hc/en-us/articles/7012394193684
3. Apple Fitness Gamification: Activity rings and streak awards
4. Behavioral Psychology Research: Loss aversion (Kahneman & Tversky)
5. Gamification in Fitness Apps (2024): Industry benchmarks and best practices

---

**Document Status:** ✅ Ready for Development
**Next Steps:** Review with engineering team, prioritize Phase 1 implementation
**Questions?** Contact Product Team
