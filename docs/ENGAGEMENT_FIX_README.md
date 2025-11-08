# Engagement Activities Fix

## Problem Summary

**Issue:** User daily tracking records (weight, steps, mood) are being saved to the `daily_tracking` table, but corresponding engagement activities are NOT being recorded in the `engagement_activities` table, resulting in `last_engagement_date: null` in the engagement streak API.

## Root Cause Analysis

### 1. RLS Policy Misconfiguration

The `engagement_activities` table had RLS policies that only allowed `auth.uid() = user_id` for INSERT operations. However, the backend service layer uses the **admin client (service role)** to insert activities on behalf of users. The service role was not explicitly granted bypass permissions in the RLS policies.

**Location:** `/supabase/migrations/022_streak_system.sql` (lines 163-170)

**Problem:**
```sql
-- Original policy - requires authenticated user context
CREATE POLICY "Users can insert own engagement activities"
    ON engagement_activities FOR INSERT
    WITH CHECK (auth.uid() = user_id);
```

When the service role tries to insert, `auth.uid()` is NULL (service role doesn't have a user context), causing the insert to fail silently.

### 2. Silent Error Handling

The `upsertDailyTracking` method in `/apps/web/app/lib/services/mobile-api-service.ts` (lines 514-518) caught ALL errors from `recordActivity()` and silently continued execution:

```typescript
} catch (streakError) {
  // Log streak errors but don't fail the main operation
  console.error('[upsertDailyTracking] Streak update error:', streakError);
  // Continue execution - tracking data was saved successfully
}
```

**Result:**
- Daily tracking saves successfully
- Engagement activity insert fails due to RLS
- Error is logged but hidden from the user
- User sees "success" but engagement tracking is broken

### 3. Lack of Observability

Without detailed logging or error surfacing, it was impossible to diagnose the issue from the API response alone. The only indicator was the `last_engagement_date: null` in the streak API response.

## Solution

### Fix 1: Update RLS Policies ✅

**File:** `/supabase/migrations/023_fix_engagement_activities_rls.sql`

Added explicit service role bypass policies for all streak-related tables:

```sql
-- Service role has full access (for backend operations)
CREATE POLICY "Service role has full access to engagement activities"
    ON engagement_activities FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
```

This allows the admin client to insert/update activities on behalf of users while still maintaining user-level RLS for authenticated client access.

**Tables updated:**
- `engagement_activities` - Service role can insert activities
- `engagement_streaks` - Service role can create/update streaks
- `metric_streaks` - Service role can update metric-specific streaks

### Fix 2: Improve Error Handling ✅

**File:** `/apps/web/app/lib/services/mobile-api-service.ts`

Enhanced error handling to:
1. Track success/failure for each streak operation independently
2. Log detailed error information for each metric (weight, steps, mood)
3. Provide a summary of streak operations (e.g., "2/3 succeeded")
4. Warn when ALL streak operations fail (critical issue)

**Benefits:**
- Errors are now visible in server logs with full context
- Can diagnose which specific streak operation is failing
- Still doesn't break the main tracking operation (graceful degradation)

### Fix 3: Add Verification Tools ✅

**File:** `/scripts/verify-engagement-fix.ts`

Created a comprehensive verification script that:
1. Checks if tables exist and are accessible
2. Verifies RLS policies allow service role access
3. Tests inserting an engagement activity
4. Displays existing data for debugging
5. Provides actionable next steps

**Usage:**
```bash
cd /Users/ani/Code/FitCircleCode/FitCircleBE
npx tsx scripts/verify-engagement-fix.ts [USER_ID]
```

## Deployment Steps

### Step 1: Run Database Migration

Run the migration in Supabase SQL Editor:

```sql
-- File: /supabase/migrations/023_fix_engagement_activities_rls.sql
-- This updates RLS policies to allow service role access
```

**Verification:**
```bash
npx tsx scripts/verify-engagement-fix.ts d15217cf-28ec-4d31-bd2c-908330e8993a
```

### Step 2: Deploy Backend Code

The updated `mobile-api-service.ts` includes improved error handling. Deploy via:

```bash
cd /Users/ani/Code/FitCircleCode/FitCircleBE
git add apps/web/app/lib/services/mobile-api-service.ts
git commit -m "Improve engagement activity error handling and logging"
git push
```

Vercel will auto-deploy the changes.

### Step 3: Test End-to-End

1. Have the user log a new weight/steps/mood entry via the iOS app
2. Check Vercel server logs for:
   ```
   [upsertDailyTracking] Recording weight log engagement for user ...
   [upsertDailyTracking] Streak operations: 3/3 succeeded
   ```
3. Query the engagement streak API:
   ```bash
   GET /api/mobile/streaks/engagement
   ```
   Verify `last_engagement_date` is no longer null

### Step 4: Backfill Historical Data (Optional)

If you want to retroactively create engagement activities for existing daily tracking records:

```typescript
// Run this script to backfill engagement activities
// File: /scripts/backfill-engagement-activities.ts

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function backfill(userId: string) {
  // Get all daily tracking records
  const { data: records } = await supabase
    .from('daily_tracking')
    .select('*')
    .eq('user_id', userId)
    .order('tracking_date', { ascending: true });

  for (const record of records || []) {
    const activities = [];

    if (record.weight_kg) {
      activities.push({
        user_id: userId,
        activity_date: record.tracking_date,
        activity_type: 'weight_log',
        reference_id: record.id,
      });
    }

    if (record.steps) {
      activities.push({
        user_id: userId,
        activity_date: record.tracking_date,
        activity_type: 'steps_log',
        reference_id: record.id,
      });
    }

    if (record.mood_score) {
      activities.push({
        user_id: userId,
        activity_date: record.tracking_date,
        activity_type: 'mood_log',
        reference_id: record.id,
      });
    }

    // Insert activities (ignore duplicates)
    for (const activity of activities) {
      await supabase.from('engagement_activities').insert(activity);
    }
  }

  console.log(`Backfilled ${records?.length} tracking records`);
}

backfill('d15217cf-28ec-4d31-bd2c-908330e8993a').catch(console.error);
```

## Verification Checklist

- [ ] Migration 023 executed successfully in Supabase
- [ ] Verification script passes all checks
- [ ] Service role can insert engagement activities
- [ ] New daily tracking entries create engagement activities
- [ ] Engagement streak API returns `last_engagement_date` (not null)
- [ ] Server logs show "Streak operations: X/Y succeeded"
- [ ] No warnings about "All streak operations failed"

## Files Changed

### Database
- ✅ `/supabase/migrations/023_fix_engagement_activities_rls.sql` (NEW)

### Backend Services
- ✅ `/apps/web/app/lib/services/mobile-api-service.ts` (MODIFIED)

### Scripts & Tools
- ✅ `/scripts/verify-engagement-fix.ts` (NEW)
- ✅ `/scripts/debug-engagement.ts` (NEW - for manual debugging)

### Documentation
- ✅ `/ENGAGEMENT_FIX_README.md` (THIS FILE)

## Testing

### Manual Test

1. Log a weight entry via iOS app:
   ```
   POST /api/mobile/tracking/daily
   {
     "trackingDate": "2025-10-16",
     "weightKg": 75.5
   }
   ```

2. Check server logs (Vercel):
   ```
   [upsertDailyTracking] Recording weight log engagement for user d15217cf...
   [EngagementStreakService.recordActivity] Recording weight_log for user d15217cf... on 2025-10-16
   [EngagementStreakService.recordActivity] Successfully recorded activity and updated streak
   [upsertDailyTracking] Streak operations: 1/1 succeeded
   ```

3. Query engagement activities:
   ```sql
   SELECT * FROM engagement_activities
   WHERE user_id = 'd15217cf-28ec-4d31-bd2c-908330e8993a'
   ORDER BY activity_date DESC
   LIMIT 10;
   ```

4. Query engagement streak:
   ```bash
   GET /api/mobile/streaks/engagement
   ```
   Expected response:
   ```json
   {
     "success": true,
     "data": {
       "current_streak": 1,
       "longest_streak": 1,
       "freezes_available": 1,
       "paused": false,
       "pause_end_date": null,
       "last_engagement_date": "2025-10-16"
     }
   }
   ```

### Automated Test

Run the verification script:

```bash
cd /Users/ani/Code/FitCircleCode/FitCircleBE
npx tsx scripts/verify-engagement-fix.ts d15217cf-28ec-4d31-bd2c-908330e8993a
```

Expected output:
```
✅ Tables exist and are accessible
✅ Service role can insert activities
✅ Activities are being recorded
✅ Found X existing activities
✅ Last engagement date: 2025-10-16
```

## Expected Behavior After Fix

### Before Fix
```
User logs weight → daily_tracking saved ✅
                 → engagement_activities NOT created ❌
                 → engagement_streaks NOT updated ❌
                 → last_engagement_date remains null ❌
```

### After Fix
```
User logs weight → daily_tracking saved ✅
                 → engagement_activities created ✅
                 → engagement_streaks updated ✅
                 → last_engagement_date set to today ✅
```

## Future Improvements

1. **Add Integration Tests**
   - Test `upsertDailyTracking` → `recordActivity` flow
   - Verify engagement activities are created
   - Check streak calculations

2. **Monitoring & Alerts**
   - Set up Vercel alert for "All streak operations failed" warnings
   - Track streak operation success rate
   - Monitor engagement activity creation rate

3. **Admin Dashboard**
   - View engagement activities for any user
   - Manually trigger streak recalculation
   - Debug streak freezes and pauses

4. **Retry Logic**
   - If streak operation fails, retry once before logging error
   - Implement exponential backoff for database errors

## Related Files

- **Service Layer:** `/apps/web/app/lib/services/mobile-api-service.ts`
- **Engagement Service:** `/apps/web/app/lib/services/engagement-streak-service.ts`
- **Metric Service:** `/apps/web/app/lib/services/metric-streak-service.ts`
- **API Route:** `/apps/web/app/api/mobile/tracking/daily/route.ts`
- **Types:** `/apps/web/app/lib/types/streak.ts`

## Support

If issues persist after deploying this fix:

1. Check Vercel logs for streak-related errors
2. Run the verification script with the user's ID
3. Manually query `engagement_activities` table
4. Verify RLS policies are applied correctly
5. Check if service role key is correctly configured

---

**Last Updated:** 2025-10-16
**Author:** Claude (with Ani)
**Status:** Ready for deployment
