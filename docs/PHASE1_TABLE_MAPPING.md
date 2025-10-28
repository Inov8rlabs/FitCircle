# Phase 1 Engagement - Table Mapping Guide

## Overview

This document explains how Phase 1 features use **existing tables** from previous migrations instead of creating duplicates.

---

## Table Mapping

### 1. Daily Goals → Use Existing `daily_goals` Table

**Location:** Migration 026 (`026_daily_goals_system.sql`)

**Existing Columns:**
```sql
CREATE TABLE daily_goals (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    challenge_id UUID REFERENCES challenges(id),  -- Can be NULL for personal goals
    goal_type TEXT,  -- 'steps', 'weight_log', 'workout', 'mood', 'energy', 'custom'
    target_value DECIMAL(10,2),
    unit TEXT,
    start_date DATE,
    end_date DATE,
    frequency TEXT,  -- 'daily', 'weekdays', 'weekends', 'custom'
    is_active BOOLEAN,
    is_primary BOOLEAN,
    auto_adjust_enabled BOOLEAN,
    baseline_value DECIMAL(10,2),
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);
```

**Service Layer Mapping:**

| PRD Concept | Existing Column | Notes |
|-------------|----------------|-------|
| Daily steps goal | `goal_type = 'steps'` | Use existing enum value |
| Daily weight goal | `goal_type = 'weight_log'` | Use existing enum value |
| Daily check-in goal | `goal_type = 'mood'` or `goal_type = 'energy'` | Map to existing types |
| Target value | `target_value` | Direct mapping |
| Completion tracking | Use `goal_completion_history` table | Already exists |

**Important:**
- Set `challenge_id = NULL` for personal daily goals
- Set `is_active = TRUE` for current goals
- Use `start_date = CURRENT_DATE` and `end_date = CURRENT_DATE` for daily goals

---

### 2. User Streaks → Use Existing `engagement_streaks` Table

**Location:** Migration 022 (`022_streak_system.sql`)

**Existing Columns:**
```sql
CREATE TABLE engagement_streaks (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) UNIQUE,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_engagement_date DATE,
    streak_freezes_available INTEGER DEFAULT 1,
    streak_freezes_used_this_week INTEGER DEFAULT 0,
    auto_freeze_reset_date DATE,
    paused BOOLEAN DEFAULT FALSE,
    pause_start_date DATE,
    pause_end_date DATE,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);
```

**Service Layer Mapping:**

| PRD Concept | Existing Column | Notes |
|-------------|----------------|-------|
| Current streak | `current_streak` | Direct mapping |
| Longest streak | `longest_streak` | Direct mapping |
| Last check-in date | `last_engagement_date` | Direct mapping |
| Freeze available | `streak_freezes_used_this_week = 0` | Boolean check |
| Freeze used | `streak_freezes_used_this_week > 0` | Boolean check |
| Week start (for freeze reset) | `auto_freeze_reset_date` | Reset every Monday |

**Important Differences:**

1. **Freeze Logic:**
   - PRD: `freeze_used_this_week BOOLEAN`
   - Existing: `streak_freezes_used_this_week INTEGER`
   - **Mapping:** `freeze_used = (streak_freezes_used_this_week > 0)`

2. **Weekly Reset:**
   - PRD: `week_start_date DATE`
   - Existing: `auto_freeze_reset_date DATE`
   - **Mapping:** Same concept, different name

**Service Layer Functions to Update:**

```typescript
// In streak-service-v2.ts, map to existing table:

async getCurrentStreak(userId: string) {
  const { data } = await supabase
    .from('engagement_streaks')  // Use existing table
    .select('*')
    .eq('user_id', userId)
    .single();

  return {
    currentStreak: data.current_streak,
    longestStreak: data.longest_streak,
    lastCheckinDate: data.last_engagement_date,
    freezeUsedThisWeek: data.streak_freezes_used_this_week > 0,
    freezeAvailable: data.streak_freezes_used_this_week === 0,
    weekStartDate: data.auto_freeze_reset_date
  };
}

async useFreeze(userId: string) {
  // Increment streak_freezes_used_this_week instead of setting boolean
  await supabase
    .from('engagement_streaks')
    .update({
      streak_freezes_used_this_week: supabase.raw('streak_freezes_used_this_week + 1')
    })
    .eq('user_id', userId);
}
```

---

### 3. Engagement Activities → Use Existing `engagement_activities` Table

**Location:** Migration 022 (`022_streak_system.sql`)

**Existing Columns:**
```sql
CREATE TABLE engagement_activities (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES profiles(id),
    activity_date DATE,
    activity_type TEXT,  -- 'weight_log', 'steps_log', 'mood_log', 'circle_checkin', 'social_interaction'
    reference_id UUID,
    created_at TIMESTAMPTZ,
    UNIQUE(user_id, activity_date, activity_type, reference_id)
);
```

**Service Layer Mapping:**

| PRD Action | Activity Type | Reference ID |
|------------|---------------|--------------|
| Daily check-in | `'mood_log'` or `'steps_log'` | `daily_tracking.id` |
| FitCircle data submission | `'circle_checkin'` | `fitcircle_data_submissions.id` |
| Weight logged | `'weight_log'` | `daily_tracking.id` |
| Steps logged | `'steps_log'` | `daily_tracking.id` |

**Important:**
- Use this table to track activities for streak calculation
- One activity per type per day
- Automatically inserted when users complete actions

---

### 4. Daily Tracking → Already Extended

**Location:** Migration 005 (`005_daily_tracking.sql`) + Migration 027 (Phase 1)

**Columns Added in Phase 1:**
- `previous_day_sentiment` - User's feeling about yesterday
- `previous_day_steps` - Yesterday's step count
- `streak_day` - Which day of streak this represents
- `submitted_to_fitcircles` - Whether data submitted to leaderboards
- `submission_timestamp` - When data was submitted

**Column Already Existed:**
- `is_public` - Added in migration 026

---

## New Tables Created in Phase 1

These tables are **truly new** and don't have existing equivalents:

### 1. `weekly_goals` (NEW)
- Weekly milestone goals
- Links to FitCircles
- Daily breakdown tracking

### 2. `fitcircle_leaderboard_entries` (NEW)
- Leaderboard rankings by period (daily/weekly/monthly/all-time)
- Rank tracking and rank change
- Per-circle, per-user, per-period

### 3. `fitcircle_data_submissions` (NEW)
- Manual data submission tracking
- Ties submissions to specific FitCircles
- Tracks rank after submission

---

## Service Layer Updates Required

### Files to Update:

1. **`/apps/web/app/lib/services/streak-service-v2.ts`**
   - Change all references from `user_streaks` to `engagement_streaks`
   - Map freeze logic: `freeze_used_this_week > 0` instead of boolean

2. **`/apps/web/app/lib/services/goal-service.ts`**
   - Use existing `daily_goals` table (no changes needed if already implemented)
   - Ensure `challenge_id` is nullable for personal goals

3. **`/apps/web/app/lib/services/data-submission-service.ts`**
   - Insert into `engagement_activities` when data is submitted
   - Use activity_type `'circle_checkin'`

### Example Service Layer Update:

**Before (from PRD):**
```typescript
// ❌ OLD: Using non-existent table
const { data } = await supabase
  .from('user_streaks')
  .select('*')
  .eq('user_id', userId)
  .single();
```

**After (correct):**
```typescript
// ✅ NEW: Using existing table
const { data } = await supabase
  .from('engagement_streaks')
  .select('*')
  .eq('user_id', userId)
  .single();

// Map to PRD interface
return {
  currentStreak: data.current_streak,
  longestStreak: data.longest_streak,
  lastCheckinDate: data.last_engagement_date,
  freezeUsedThisWeek: data.streak_freezes_used_this_week > 0,
  // ... etc
};
```

---

## Migration Checklist

- [x] Remove duplicate `014_engagement_phase1.sql`
- [x] Create clean `027_engagement_phase1_clean.sql`
- [x] Update service layer to use existing tables
- [ ] Run migration in Supabase SQL Editor
- [ ] Test daily goals API with existing table
- [ ] Test streak API with engagement_streaks table
- [ ] Verify no duplicate data issues

---

## Benefits of This Approach

1. **No Duplicate Data** - Reuse existing streak and goal tracking
2. **Consistent Schema** - All goals in one table, all streaks in one table
3. **Less Migration Complexity** - Fewer tables to create and manage
4. **Backward Compatible** - Existing features continue working
5. **Single Source of Truth** - One place for streaks, one for goals

---

## Questions?

If you encounter issues with the mapping, check:
1. Are you using the correct table name? (`engagement_streaks` not `user_streaks`)
2. Are you mapping the freeze logic correctly? (integer vs boolean)
3. Is `challenge_id` nullable for personal daily goals?
4. Are you creating `engagement_activities` entries for check-ins and submissions?

