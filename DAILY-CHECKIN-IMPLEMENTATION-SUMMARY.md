# Daily Streak Check-In Backend Implementation Summary

## Overview

Implemented the backend API for the Daily Streak Check-In feature as specified in `/docs/DAILY-STREAK-CHECKIN-SPEC.md`. This implementation includes complete business logic for streak tracking, XP/points rewards, freeze mechanics, and milestone achievements.

## Implementation Date

2025-10-31

## What Was Implemented

### 1. Database Migration

**File:** `/supabase/migrations/030_daily_checkin_enhancements.sql`

Added support for:
- `total_points` column on `engagement_streaks` (tracks XP earned)
- `last_freeze_earned_at` column on `engagement_streaks` (tracks when last freeze was earned)
- New activity types in `engagement_activities`:
  - `streak_checkin` - Daily check-in activity
  - `freeze_used` - Manual or auto-applied freeze
  - `freeze_earned` - Freeze reward earned
  - `milestone_achieved` - Streak milestone reached
- `metadata` JSONB column on `engagement_activities` (stores additional details)
- Performance indexes for faster queries

### 2. Service Layer

**File:** `/apps/web/app/lib/services/daily-checkin-service.ts` (579 lines)

Comprehensive business logic including:

#### Core Functions

1. **`performDailyCheckIn()`**
   - Validates if first check-in of the day (for streak purposes)
   - Increments streak for consecutive days
   - Auto-applies freeze if user missed 1 day and freeze available
   - Resets streak if more than 1 day missed without freeze
   - Awards XP: 10 XP per check-in, +5 XP for milestones
   - Detects and records milestone achievements
   - Earns freeze every 7 consecutive days (up to max 5)
   - Updates or creates `daily_tracking` entry with mood/energy/weight
   - Allows multiple check-ins per day (only first counts for streak)

2. **`getStreakStatus()`**
   - Returns current streak information
   - Checks if user has checked in today
   - Calculates next milestone and days until it
   - Returns streak color based on progress
   - Shows freezes available and total points

3. **`useFreeze()`**
   - Manually uses a freeze for planned absence
   - Validates freeze availability
   - Prevents duplicate freeze usage for same day
   - Records freeze usage in `engagement_activities`

#### Helper Functions

- `getTodayDateString()` - Get current date in ISO format
- `getYesterdayDateString()` - Get yesterday's date
- `isConsecutiveDay()` - Check if dates are consecutive
- `missedOneDay()` - Check if user missed exactly 1 day
- `getNextMilestone()` - Get next milestone for current streak
- `getStreakColor()` - Get color based on streak (gray, yellow, orange, green, blue, purple, gold)
- `checkMilestoneAchieved()` - Detect if milestone just reached

#### Constants

- `XP_PER_CHECKIN = 10`
- `XP_MILESTONE_BONUS = 5`
- `FREEZE_EARN_INTERVAL = 7` days
- `MAX_FREEZES = 5`
- `STREAK_MILESTONES` - Array of 7 milestones (3, 7, 14, 30, 50, 100, 365 days)

### 3. API Endpoints

All endpoints use `requireMobileAuth` middleware and follow the existing API response pattern.

#### POST /api/mobile/streaks/check-in

**File:** `/apps/web/app/api/mobile/streaks/check-in/route.ts`

**Request Body:**
```typescript
{
  date?: string;              // ISO date (YYYY-MM-DD), defaults to today
  previousDaySentiment?: 'great' | 'ok' | 'could_be_better';
  mood: number;               // 1-5 (required)
  energy: number;             // 1-5 (required)
  weight?: number;            // kg (optional)
  notes?: string;             // max 500 chars (optional)
}
```

**Response:**
```typescript
{
  success: true,
  data: {
    newStreak: 47,
    isFirstCheckInToday: true,
    milestoneAchieved?: {
      days: 50,
      name: "50-Day Hero",
      description: "Halfway to 100!",
      badge: "⭐"
    },
    pointsEarned: 15,          // 10 + 5 milestone bonus
    totalPoints: 570,
    freezeApplied?: false,
    freezeEarned?: true,       // Earned at day 49
    message: "🎉 Milestone achieved! 50-Day Hero - 50 days! You earned a freeze!"
  },
  error: null,
  meta: { timestamp: "..." }
}
```

**Validation:**
- `mood` and `energy` are required (1-5)
- `date` must match YYYY-MM-DD format
- `weight` must be positive
- `notes` max 500 characters

**Logic:**
1. Checks if first check-in today (queries `engagement_activities`)
2. Gets or creates streak record
3. Determines streak action:
   - Consecutive day → increment streak
   - Missed 1 day + freeze available → auto-apply freeze
   - Missed 1 day + no freeze → reset to 1
   - More than 1 day missed → reset to 1
4. Checks for milestone achievement
5. Awards XP (10 base + 5 if milestone)
6. Earns freeze every 7 consecutive days
7. Updates `engagement_streaks` table
8. Records check-in in `engagement_activities`
9. Updates or creates `daily_tracking` entry

#### GET /api/mobile/streaks/status

**File:** `/apps/web/app/api/mobile/streaks/status/route.ts`

**Response:**
```typescript
{
  success: true,
  data: {
    currentStreak: 47,
    longestStreak: 52,
    lastCheckInDate: "2025-10-31",
    hasCheckedInToday: true,
    freezesAvailable: 3,
    nextMilestone: 50,
    daysUntilNextMilestone: 3,
    canCheckInAgain: true,    // Always true (can update mood/energy)
    streakColor: "orange",    // gray, yellow, orange, green, blue, purple, gold
    totalPoints: 570
  },
  error: null,
  meta: { timestamp: "..." }
}
```

**Logic:**
1. Fetches streak record from `engagement_streaks`
2. Checks if user has checked in today
3. Calculates next milestone
4. Returns comprehensive status

#### POST /api/mobile/streaks/freeze/use

**File:** `/apps/web/app/api/mobile/streaks/freeze/use/route.ts`

**Request Body:** `{}` (empty)

**Response (Success):**
```typescript
{
  success: true,
  data: {
    success: true,
    freezesRemaining: 2,
    message: "Freeze applied successfully! 2 freezes remaining."
  },
  error: null,
  meta: { timestamp: "..." }
}
```

**Response (No Freezes):**
```typescript
{
  success: false,
  data: {
    success: false,
    freezesRemaining: 0,
    message: "No freezes available"
  },
  error: {
    code: "FREEZE_UNAVAILABLE",
    message: "No freezes available",
    ...
  },
  meta: { timestamp: "..." }
}
```

**Logic:**
1. Validates freeze availability
2. Checks if freeze already used today
3. Decrements `streak_freezes_available`
4. Records freeze usage in `engagement_activities`

## Key Features

### Streak Logic

1. **First Check-In of Day**
   - Only the first check-in of each day counts toward streak
   - Subsequent check-ins update mood/energy/weight only
   - Tracked via `engagement_activities` with type='streak_checkin'

2. **Auto-Freeze Application**
   - If user missed exactly 1 day and has freeze available
   - Automatically applied to maintain streak
   - Decrements `streak_freezes_available`
   - Records in `engagement_activities` with type='freeze_used'

3. **Freeze Earning**
   - Earn 1 freeze every 7 consecutive days
   - Maximum 5 freezes stored
   - Tracked via `last_freeze_earned_at` column
   - Records in `engagement_activities` with type='freeze_earned'

4. **Milestone Detection**
   - 7 milestones: 3, 7, 14, 30, 50, 100, 365 days
   - Detected by comparing previous streak to new streak
   - Awards +5 XP bonus
   - Records in `engagement_activities` with type='milestone_achieved'

### XP/Points System

- **10 XP** per check-in
- **+5 XP** milestone bonus
- Stored in `engagement_streaks.total_points`
- Metadata stored in `engagement_activities.metadata`

### Data Tracking

All check-ins update `daily_tracking` table:
- `mood` (1-5)
- `energy` (1-5)
- `weight` (optional, kg)
- `notes` (optional, max 500 chars)
- `previous_day_sentiment` (optional)
- `streak_day` (current streak number)

## Database Tables Used

### engagement_streaks (Updated)

```sql
- id
- user_id
- current_streak
- longest_streak
- last_engagement_date
- streak_freezes_available
- streak_freezes_used_this_week
- auto_freeze_reset_date
- paused
- pause_start_date
- pause_end_date
- total_points              -- NEW
- last_freeze_earned_at     -- NEW
- created_at
- updated_at
```

### engagement_activities (Updated)

```sql
- id
- user_id
- activity_date
- activity_type             -- NEW TYPES: streak_checkin, freeze_used, freeze_earned, milestone_achieved
- reference_id
- metadata                  -- NEW: JSONB for additional data
- created_at
```

### daily_tracking (Existing)

```sql
- id
- user_id
- tracking_date
- mood
- energy
- weight
- notes
- previous_day_sentiment
- streak_day
- steps
- ...
```

## Authentication

All endpoints require Bearer token authentication via `requireMobileAuth` middleware:

```typescript
Authorization: Bearer <access_token>
```

## Error Handling

All endpoints return consistent error responses:

```typescript
{
  success: false,
  data: null,
  error: {
    code: "ERROR_CODE",
    message: "Human-readable message",
    details: { ... },
    timestamp: "..."
  },
  meta: null
}
```

Error codes:
- `UNAUTHORIZED` (401) - Invalid or expired token
- `VALIDATION_ERROR` (400) - Invalid input data
- `FREEZE_UNAVAILABLE` (400) - No freezes available
- `INTERNAL_SERVER_ERROR` (500) - Unexpected error

## Testing Recommendations

### Manual Testing Scenarios

1. **First Check-In**
   - POST to `/api/mobile/streaks/check-in` with mood=4, energy=5
   - Expect: newStreak=1, isFirstCheckInToday=true, pointsEarned=10

2. **Consecutive Days**
   - Check in on Day 1, Day 2, Day 3
   - Expect: streak increments (1, 2, 3)
   - Day 3: milestone achieved (3-Day Starter), pointsEarned=15

3. **Multiple Check-Ins Same Day**
   - First check-in: newStreak increments
   - Second check-in: isFirstCheckInToday=false, streak stays same

4. **Auto-Freeze Application**
   - Check in Day 1, skip Day 2, check in Day 3
   - Expect: freezeApplied=true, streak continues

5. **Freeze Earning**
   - Check in 7 consecutive days
   - Expect: freezeEarned=true on day 7

6. **Manual Freeze Usage**
   - POST to `/api/mobile/streaks/freeze/use`
   - Expect: freezesRemaining decremented

7. **Status Check**
   - GET `/api/mobile/streaks/status`
   - Verify all fields present and accurate

### Integration Testing

- Test with existing `engagement_streaks` records
- Test with missing streak record (auto-creation)
- Test freeze limit (max 5)
- Test milestone detection for all 7 milestones
- Test date validation (past dates, future dates)

## iOS App Integration

The iOS app should now receive real data instead of mock responses:

**Before:**
```swift
// iOS logs showed: "Feature not yet implemented on backend, returning mock data"
```

**After:**
```swift
// iOS logs should show successful API responses with real streak data
```

## Migration Instructions

1. **Run Migration:**
   ```sql
   -- Execute in Supabase SQL Editor
   -- File: supabase/migrations/030_daily_checkin_enhancements.sql
   ```

2. **Verify Tables:**
   ```sql
   -- Check new columns exist
   SELECT total_points, last_freeze_earned_at
   FROM engagement_streaks
   LIMIT 1;

   -- Check new activity types
   SELECT DISTINCT activity_type
   FROM engagement_activities;
   ```

3. **Test Endpoints:**
   ```bash
   # Check-in
   curl -X POST http://localhost:3000/api/mobile/streaks/check-in \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"mood": 4, "energy": 5}'

   # Status
   curl -X GET http://localhost:3000/api/mobile/streaks/status \
     -H "Authorization: Bearer <token>"

   # Use freeze
   curl -X POST http://localhost:3000/api/mobile/streaks/freeze/use \
     -H "Authorization: Bearer <token>"
   ```

## Files Created/Modified

### New Files (4)

1. `/supabase/migrations/030_daily_checkin_enhancements.sql`
2. `/apps/web/app/lib/services/daily-checkin-service.ts`
3. `/apps/web/app/api/mobile/streaks/check-in/route.ts`
4. `/apps/web/app/api/mobile/streaks/status/route.ts`
5. `/apps/web/app/api/mobile/streaks/freeze/use/route.ts`

### Modified Files (0)

No existing files were modified.

## Code Quality

- ✅ Follows existing service layer pattern
- ✅ Uses `requireMobileAuth` middleware
- ✅ Consistent error handling
- ✅ Input validation with Zod
- ✅ Type-safe TypeScript
- ✅ Comprehensive comments and documentation
- ✅ Transaction-safe operations
- ✅ Follows "no stored procedures" rule
- ✅ Simple RLS policies (no changes needed)
- ✅ Clean separation of concerns (service layer vs API routes)

## Next Steps (Future Enhancements)

### Phase 2 (Not Implemented Yet)

1. **Cron Job for Midnight Validation**
   - Check all users at midnight
   - Auto-apply freezes if missed yesterday
   - Break streaks if no freeze available
   - Send push notifications

2. **Achievement Badges**
   - Store milestone badges in user profile
   - Display badge collection in UI

3. **Leaderboards**
   - Weekly streak leaderboards
   - All-time longest streak leaderboards

4. **Analytics**
   - Track check-in completion rates
   - Analyze freeze usage patterns
   - Monitor milestone achievement rates

5. **Social Features**
   - Share milestone achievements
   - Challenge friends to streak competitions

## Notes

- All business logic is in TypeScript (service layer)
- No stored procedures or complex database functions
- Uses existing `engagement_streaks` table from migration 022
- Uses existing `engagement_activities` table
- Uses existing `daily_tracking` table
- Freeze mechanics simplified: `streak_freezes_available` tracks remaining freezes
- Weekly freeze reset handled by existing logic
- Compatible with existing streak-service-v2.ts

## Support

For questions or issues:
- See full spec: `/docs/DAILY-STREAK-CHECKIN-SPEC.md`
- Review service code: `/apps/web/app/lib/services/daily-checkin-service.ts`
- Check existing patterns: `/apps/web/app/lib/services/streak-service-v2.ts`

---

**Implementation Status:** ✅ Complete (Phase 1 - Core Check-In Flow)

**Last Updated:** 2025-10-31

**Implemented By:** Claude (with Ani)
