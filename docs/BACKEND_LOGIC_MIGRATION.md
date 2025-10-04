# Backend Logic Migration - Stored Procedures Removal

## Summary

All stored procedures have been removed from the database and replaced with backend logic in Next.js API routes and service layers. This provides better maintainability, testability, and keeps business logic in the application layer.

## Changes Made

### 1. Database Changes

**Run this SQL in Supabase SQL Editor:**

```sql
-- Run the migration file
-- File: /supabase/migrations/006_remove_stored_procedures.sql
```

This will:
- Drop all stored procedures
- Drop RLS helper functions
- Update RLS policies to work without function dependencies
- Keep simple utility triggers (`update_daily_tracking_updated_at`)

### 2. New Service Layer

Created `/apps/web/app/lib/services/challenge-service.ts` which replaces all stored procedure logic:

**Replaced Functions:**
- `increment_participant_count()` → `ChallengeService.updateParticipantCount()`
- `decrement_participant_count()` → `ChallengeService.updateParticipantCount()`
- `increment_team_member_count()` → `ChallengeService.updateTeamMemberCount()`
- `decrement_team_member_count()` → `ChallengeService.updateTeamMemberCount()`
- `update_participant_stats()` → `ChallengeService.updateParticipantStats()`
- `update_leaderboard()` → `ChallengeService.updateLeaderboard()`
- `process_challenge_status_updates()` → `ChallengeService.processChallengeStatusUpdates()`
- `award_achievement()` → `ChallengeService.awardAchievement()`
- `process_streak_achievements()` → `ChallengeService.processStreakAchievements()`

### 3. Cron Jobs

Created `/apps/web/app/api/cron/challenges/route.ts` to replace database cron jobs.

**Setup Cron:**

#### Option A: Vercel Cron (Recommended for Vercel deployment)

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/challenges",
      "schedule": "0 0 * * *"
    }
  ]
}
```

#### Option B: External Cron Service

Use a service like cron-job.org or EasyCron to hit:
```
POST https://your-domain.com/api/cron/challenges
Authorization: Bearer YOUR_CRON_SECRET
```

Set `CRON_SECRET` in your environment variables.

### 4. Updated Files

- `/apps/web/app/api/challenges/[id]/join/route.ts` - Uses `ChallengeService` instead of RPC calls
- All future API routes should use service layer methods

## Benefits

### Before (Stored Procedures):
❌ Business logic split between database and application
❌ Harder to test and debug
❌ Vendor lock-in to PostgreSQL
❌ Difficult to version control logic changes
❌ No easy way to add logging/monitoring

### After (Backend Logic):
✅ All business logic in one place (TypeScript)
✅ Easy to unit test
✅ Better error handling and logging
✅ Type-safe with TypeScript
✅ Easier to maintain and refactor
✅ Portable across databases

## Migration Steps

1. **Run the SQL migration:**
   ```bash
   # Go to Supabase SQL Editor and run:
   # supabase/migrations/006_remove_stored_procedures.sql
   ```

2. **Verify current functionality:**
   - Daily tracking still works (uses `daily_tracking` table)
   - User registration/login still works
   - Dashboard loads properly

3. **Set up cron jobs** (when challenges feature is needed):
   - Add Vercel cron configuration OR
   - Set up external cron service

4. **Test challenge features** (when implementing):
   - Join/leave challenges
   - Check-ins
   - Leaderboard updates
   - Achievement awards

## Environment Variables

Add to `.env.local`:

```bash
# Optional: Cron job authentication
CRON_SECRET=your-secure-random-string
```

## Future Development

When adding new features:

1. ❌ **Don't** create stored procedures
2. ✅ **Do** add methods to service layer
3. ✅ **Do** call service methods from API routes
4. ✅ **Do** keep RLS policies simple (authentication only)

## Example: Adding New Business Logic

```typescript
// Add to /apps/web/app/lib/services/challenge-service.ts
export class ChallengeService {
  static async yourNewMethod(param: string) {
    const supabaseAdmin = createAdminSupabase();

    // Your business logic here
    // Use supabaseAdmin for database operations
    // Return result or throw error
  }
}

// Call from API route
import { ChallengeService } from '@/lib/services/challenge-service';

export async function POST(request: NextRequest) {
  try {
    const result = await ChallengeService.yourNewMethod(param);
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

## Rollback Plan

If needed, you can restore stored procedures:

```sql
-- Run the old migration files in order:
-- 003_functions_procedures.sql
-- 004_stored_procedures.sql
-- 002_rls_policies.sql (to restore function-based RLS)
```

However, this is not recommended as the backend logic approach is superior.

## Notes

- The `update_daily_tracking_updated_at()` trigger function is kept as it's a simple utility that doesn't contain business logic
- All authentication is still handled by Supabase Auth
- RLS policies are simplified to check `auth.uid()` only
- Service layer uses admin client for database operations after authentication is verified in API routes
