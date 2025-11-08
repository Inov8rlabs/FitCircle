# Streak Claiming System - Quick Start Guide

## Quick Reference

### Files Created
```
supabase/migrations/
  └── 029_streak_claiming_system.sql

apps/web/app/lib/
  ├── types/streak-claiming.ts
  └── services/streak-claiming-service.ts

apps/web/app/api/streaks/
  ├── claim/route.ts
  ├── claim-status/route.ts
  ├── claimable-days/route.ts
  ├── freeze/activate/route.ts
  ├── shields/route.ts
  └── recovery/start/route.ts

apps/web/app/api/cron/streaks/
  ├── daily-check/route.ts
  ├── weekly-reset/route.ts
  └── cleanup-recoveries/route.ts

vercel.json (cron config)
```

### Database Tables
- `streak_claims` - Individual claim records
- `streak_shields` - Available shields by type
- `streak_recoveries` - Recovery attempts
- `engagement_streaks` - Extended with claiming columns

### API Endpoints

#### Claim Streak
```bash
POST /api/streaks/claim
{
  "claimDate": "2025-10-29",  # optional
  "timezone": "America/Los_Angeles"
}
```

#### Check Status
```bash
GET /api/streaks/claim-status?date=2025-10-29&timezone=America/Los_Angeles
```

#### Get Claimable Days
```bash
GET /api/streaks/claimable-days?timezone=America/Los_Angeles
```

#### Activate Shield
```bash
POST /api/streaks/freeze/activate
{
  "date": "2025-10-28",
  "timezone": "America/Los_Angeles"
}
```

#### Get Shields
```bash
GET /api/streaks/shields
```

#### Start Recovery
```bash
POST /api/streaks/recovery/start
{
  "brokenDate": "2025-10-28",
  "recoveryType": "weekend_warrior"
}
```

### Constants

```typescript
RETROACTIVE_WINDOW_DAYS: 7
GRACE_PERIOD_HOURS: 3
WEEKLY_FREE_FREEZE: 1
MAX_TOTAL_SHIELDS: 5
FREEZE_RESET_DAY: 1 (Monday)
WEEKEND_WARRIOR_ACTIONS: 2
WEEKEND_WARRIOR_WINDOW_HOURS: 24
MILESTONE_SHIELDS: { 30: 1, 60: 1, 100: 2, 365: 3 }
```

### Key Rules

1. **Two Claiming Methods:**
   - Explicit: User presses button → `/api/streaks/claim`
   - Automatic: User enters data → auto-claimed in `PUT /api/mobile/tracking/daily/[date]`

2. **No Auto-Claim on Sync:**
   - HealthKit/Google Fit bulk sync does NOT claim streaks
   - Only syncs data

3. **7-Day Retroactive Window:**
   - Can claim any date within last 7 days
   - Must have health data for that date

4. **3am Grace Period:**
   - Can claim yesterday until 3am local time
   - After 3am, must claim explicitly (retroactive)

5. **Shield Priority:**
   - Auto-applied: freeze → milestone → purchased
   - Max 5 shields total across all types

6. **Milestone Shields:**
   - 30 days: +1 shield
   - 60 days: +1 shield
   - 100 days: +2 shields
   - 365 days: +3 shields

### Cron Jobs

```
Daily at midnight UTC: Check broken streaks, apply shields
Every Monday at midnight UTC: Reset weekly freezes
Every hour: Clean up expired recoveries
```

### Testing Locally

```bash
# 1. Run migration
# Execute in Supabase SQL Editor:
# /supabase/migrations/029_streak_claiming_system.sql

# 2. Test claim endpoint
curl -X POST http://localhost:3000/api/streaks/claim \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"timezone": "America/Los_Angeles"}'

# 3. Test shields endpoint
curl http://localhost:3000/api/streaks/shields \
  -H "Authorization: Bearer YOUR_TOKEN"

# 4. Test claimable days
curl "http://localhost:3000/api/streaks/claimable-days?timezone=America/Los_Angeles" \
  -H "Authorization: Bearer YOUR_TOKEN"

# 5. Test manual entry auto-claim
curl -X PUT http://localhost:3000/api/mobile/tracking/daily/2025-10-29 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "weightKg": 70.5,
    "timezone": "America/Los_Angeles"
  }'
```

### Environment Setup

```bash
# .env.local
CRON_SECRET=generate_random_secure_string_here
```

### Quick Deploy Checklist

- [ ] Run migration in Supabase
- [ ] Deploy code to Vercel
- [ ] Verify vercel.json cron config
- [ ] Test claim endpoint
- [ ] Test auto-claim on manual entry
- [ ] Verify bulk sync doesn't auto-claim
- [ ] Manually trigger cron jobs (with CRON_SECRET)
- [ ] Monitor logs for errors

### Common Patterns

#### Service Layer Usage
```typescript
import { StreakClaimingService } from '@/lib/services/streak-claiming-service';

// Claim streak
const result = await StreakClaimingService.claimStreak(
  userId,
  new Date(),
  'America/Los_Angeles',
  'explicit'
);

// Check if can claim
const canClaim = await StreakClaimingService.canClaimStreak(
  userId,
  new Date(),
  'America/Los_Angeles'
);

// Get shields
const shields = await StreakClaimingService.getAvailableShields(userId);

// Start recovery
const recovery = await StreakClaimingService.startRecovery(
  userId,
  new Date(),
  'weekend_warrior'
);
```

#### Error Handling
```typescript
try {
  await StreakClaimingService.claimStreak(userId, date, timezone, 'explicit');
} catch (error) {
  if (error instanceof StreakClaimError) {
    switch (error.code) {
      case CLAIM_ERROR_CODES.ALREADY_CLAIMED:
        // Handle duplicate claim
        break;
      case CLAIM_ERROR_CODES.NO_HEALTH_DATA:
        // Handle missing data
        break;
      case CLAIM_ERROR_CODES.TOO_OLD:
        // Handle date too old
        break;
    }
  }
}
```

### Troubleshooting

**Problem: Claim returns 400 "No health data"**
- Solution: Check `daily_tracking` table for that date
- User must have weight, steps, mood, or energy logged

**Problem: Can't claim yesterday**
- Solution: Check current time vs 3am grace period
- After 3am, must use retroactive claim (within 7 days)

**Problem: Shields not resetting weekly**
- Solution: Check cron job logs in Vercel dashboard
- Verify `CRON_SECRET` is configured
- Check `last_reset_at` in `streak_shields` table

**Problem: Streak was reset unexpectedly**
- Solution: Check if user had available shields
- Review `streak_recoveries` for that date
- Check daily cron job logs

### Debug SQL Queries

```sql
-- User's recent claims
SELECT claim_date, claim_method, claimed_at
FROM streak_claims
WHERE user_id = 'USER_ID'
ORDER BY claim_date DESC
LIMIT 10;

-- User's shields
SELECT shield_type, available_count, last_reset_at
FROM streak_shields
WHERE user_id = 'USER_ID';

-- Active recoveries
SELECT broken_date, recovery_type, recovery_status, expires_at
FROM streak_recoveries
WHERE user_id = 'USER_ID'
  AND recovery_status = 'pending';

-- Health data for date
SELECT tracking_date, weight_kg, steps, mood, energy
FROM daily_tracking
WHERE user_id = 'USER_ID'
  AND tracking_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY tracking_date DESC;
```

### Next Steps

1. **Complete Tests**
   - Implement full integration tests
   - Add E2E tests for claiming flow

2. **Add Monitoring**
   - Set up Sentry for error tracking
   - Add custom metrics for claim rates

3. **Documentation**
   - API docs (Swagger/OpenAPI)
   - Mobile app integration guide
   - User-facing help docs

4. **Future Enhancements**
   - Push notifications for broken streaks
   - "Claim all" button for retroactive days
   - Analytics dashboard
   - Social features (share milestones)

---

For complete implementation details, see `STREAK_CLAIMING_IMPLEMENTATION.md`
