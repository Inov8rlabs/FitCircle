# Multi-Tier Streak System - Integration Guide

## Overview

This guide documents how to integrate the Multi-Tier Streak System into existing FitCircle services.

## Database Migration

**File:** `/supabase/migrations/022_streak_system.sql`

**Run this migration first:**
```sql
-- Run in Supabase SQL Editor
-- This creates:
-- - engagement_streaks table (Tier 1)
-- - engagement_activities table
-- - metric_streaks table (Tier 2)
-- - circle_streak_tracking table (Tier 3)
```

## Integration Points

### 1. Daily Tracking Service Integration

When users log daily metrics (weight, steps, mood), record engagement activities and update metric streaks.

#### File: `/apps/web/app/api/mobile/tracking/daily/route.ts`

**Add imports:**
```typescript
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';
import { MetricStreakService } from '@/lib/services/metric-streak-service';
```

**In POST handler, after successful tracking insert:**
```typescript
// After MobileAPIService.upsertDailyTracking()

// Record engagement activities and update streaks
const trackingDate = validatedData.trackingDate;

if (validatedData.weightKg !== undefined) {
  // Record weight log engagement
  await EngagementStreakService.recordActivity(
    user.id,
    'weight_log',
    trackingEntry.id,
    trackingDate
  );

  // Update weight metric streak
  await MetricStreakService.updateMetricStreak(
    user.id,
    'weight',
    trackingDate
  );
}

if (validatedData.steps !== undefined) {
  // Record steps log engagement
  await EngagementStreakService.recordActivity(
    user.id,
    'steps_log',
    trackingEntry.id,
    trackingDate
  );

  // Update steps metric streak
  await MetricStreakService.updateMetricStreak(
    user.id,
    'steps',
    trackingDate
  );
}

if (validatedData.moodScore !== undefined) {
  // Record mood log engagement
  await EngagementStreakService.recordActivity(
    user.id,
    'mood_log',
    trackingEntry.id,
    trackingDate
  );

  // Update mood metric streak
  await MetricStreakService.updateMetricStreak(
    user.id,
    'mood',
    trackingDate
  );
}
```

### 2. Circle Check-In Integration

When users check in to a circle, record engagement activity and update circle streak.

#### File: `/apps/web/app/api/mobile/circles/[id]/check-in/route.ts`

**This is already handled in CircleService.submitCheckIn()**, but ensure the route calls it correctly:

```typescript
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';

// After CircleService.submitCheckIn()
await EngagementStreakService.recordActivity(
  user.id,
  'circle_checkin',
  checkInResult.check_in_id,
  checkInDate
);

// Circle streak is automatically updated in CircleService.submitCheckIn()
// via CircleService.updateCircleStreak()
```

### 3. Social Interaction Integration

When users send encouragements, record social interaction engagement.

#### File: `/apps/web/app/api/fitcircles/[id]/encouragements/route.ts` (if exists)

**Add after CircleService.sendEncouragement():**
```typescript
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';

// After CircleService.sendEncouragement()
await EngagementStreakService.recordActivity(
  user.id,
  'social_interaction',
  encouragementId
);
```

### 4. Legacy Check-in System Integration

#### File: `/apps/web/app/api/checkins/route.ts`

**In POST handler, after check-in creation:**
```typescript
import { EngagementStreakService } from '@/lib/services/engagement-streak-service';
import { MetricStreakService } from '@/lib/services/metric-streak-service';

// After supabase.from('checkins').insert()

// Record engagement activities
if (validatedData.weight) {
  await EngagementStreakService.recordActivity(
    user.id,
    'weight_log',
    data.id,
    checkInDateStr
  );

  await MetricStreakService.updateMetricStreak(
    user.id,
    'weight',
    checkInDateStr
  );
}

// Add similar checks for other metrics...
```

## API Endpoints

### Engagement Streaks (Tier 1)

1. **GET /api/streaks/engagement**
   - Get user's current engagement streak
   - Returns: current_streak, longest_streak, freezes_available, paused, etc.

2. **GET /api/streaks/engagement/history?days=90**
   - Get last N days of engagement activity
   - Returns: array of dates with activities

3. **POST /api/streaks/engagement/pause**
   - Pause streak for life events (max 90 days)
   - Body: `{ resume_date?: string, reason?: string }`

4. **POST /api/streaks/engagement/resume**
   - Resume paused streak

5. **POST /api/streaks/engagement/purchase-freeze**
   - Purchase additional freeze (100 XP or $0.99)
   - Body: `{ payment_method: 'xp' | 'money' }`

### Metric Streaks (Tier 2)

1. **GET /api/streaks/metrics**
   - Get all metric streaks (weight, steps, mood, measurements, photos)
   - Returns: object with each metric's streak data

### Circle Streaks (Tier 3)

Circle streaks are managed through CircleService:

```typescript
// Get team collective streak
const teamStreak = await CircleService.getTeamCollectiveStreak(circleId);

// Update circle streak (called automatically in submitCheckIn)
await CircleService.updateCircleStreak(userId, circleId);
```

## Frontend Integration

### Display Engagement Streak

```typescript
// Fetch streak data
const response = await fetch('/api/streaks/engagement');
const { data } = await response.json();

// data contains:
// - current_streak: number
// - longest_streak: number
// - freezes_available: number
// - paused: boolean
// - pause_end_date: string | null
```

### Display Metric Streaks

```typescript
// Fetch all metric streaks
const response = await fetch('/api/streaks/metrics');
const { data } = await response.json();

// data contains:
// - weight: { current_streak, longest_streak, ... } | null
// - steps: { current_streak, longest_streak, ... } | null
// - mood: { current_streak, longest_streak, ... } | null
// - measurements: { current_streak, longest_streak, ... } | null
// - photos: { current_streak, longest_streak, ... } | null
```

### Display Engagement History

```typescript
// Fetch last 90 days
const response = await fetch('/api/streaks/engagement/history?days=90');
const { data } = await response.json();

// data contains:
// - entries: Array<{ date, activities, activity_count }>
// - total_days: number
// - total_activities: number
```

## Metric Frequency Configuration

Each metric has specific logging requirements:

| Metric | Frequency | Grace Days | Window |
|--------|-----------|------------|--------|
| Weight | Daily | 1 per week | Any day |
| Steps | Daily | 1 per week | Any day |
| Mood | Daily | 2 per week | Any day |
| Measurements | Weekly | 0 | Mon-Sun |
| Photos | Weekly | 0 | Fri-Sun (3-day window) |

## Streak Calculation Logic

### Engagement Streak (Tier 1)
- Consecutive days with ≥1 engagement activity
- Grace: Auto-use freeze if day missed (max 5 freezes)
- Freezes reset weekly (+1 every 7 days)
- Earn 1 freeze per 7-day streak milestone
- Today (day 0) doesn't break streak

### Metric Streak (Tier 2)
- **Daily metrics**: Consecutive days logging that metric
  - Grace days available based on metric type
  - Grace resets weekly (e.g., 1 miss per week for weight)
- **Weekly metrics**: Consecutive weeks with ≥1 log
  - Measurements: Any day during Mon-Sun
  - Photos: Must be during Fri-Sun window

### Circle Streak (Tier 3)
- **Individual**: Consecutive days checking in to that circle
- **Team Collective**: Consecutive days where ALL members checked in
- Grace days: 1 per week of challenge duration (min 2-week challenge)

## Error Handling

All streak services throw `StreakError` with specific codes:

```typescript
import { StreakError, STREAK_ERROR_CODES } from '@/lib/types/streak';

try {
  await EngagementStreakService.pauseStreak(userId);
} catch (error) {
  if (error instanceof StreakError) {
    switch (error.code) {
      case STREAK_ERROR_CODES.ALREADY_PAUSED:
        // Handle already paused
        break;
      case STREAK_ERROR_CODES.PAUSE_TOO_LONG:
        // Handle pause duration too long
        break;
      // ... other cases
    }
  }
}
```

## Testing

Unit tests should cover:

1. **Streak calculation logic**
   - Edge cases (today, yesterday, gaps)
   - Grace day usage
   - Freeze earning and reset
   - Weekly window calculations

2. **Integration tests**
   - Recording activities updates streaks correctly
   - Pause/resume functionality
   - Freeze purchase
   - Team collective streak calculation

3. **API endpoint tests**
   - Authentication
   - Input validation
   - Error responses

## Performance Considerations

1. **Batch operations**: When recording multiple activities, use transactions
2. **Caching**: Consider caching streak data for 5-10 minutes
3. **Team collective streak**: Calculated on-demand, can be expensive for large circles
4. **Indexes**: Migration includes all necessary indexes

## Monitoring

Log key metrics:
- Streak calculations taking >1s
- Freeze usage patterns
- Pause/resume frequency
- API endpoint response times

## Future Enhancements

1. **Streak recovery**: Allow users to "recover" broken streaks with premium currency
2. **Streak sharing**: Social features around streaks
3. **Streak challenges**: Compete with friends on longest streak
4. **Streak rewards**: Unlock badges, avatars, etc. at milestones
5. **Weekly streak recap**: Email/notification with week's activities

## Questions?

Contact the product manager for clarification on business logic or requirements.
