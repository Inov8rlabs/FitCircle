# HealthKit Backend Integration - Implementation Summary

**Date:** October 16, 2025
**Status:** Complete - Ready for Testing
**Related PRD:** `/iOS/FitCircle/HEALTHKIT_INTEGRATION_PRD.md`

## Overview

This document summarizes the backend implementation for HealthKit (and Google Fit) integration in FitCircle. The implementation enables automatic step tracking with intelligent conflict resolution between manual entries and auto-synced data.

## Files Created/Modified

### 1. Database Migration

**File:** `/Users/ani/Code/FitCircleCode/FitCircleBE/supabase/migrations/024_healthkit_integration.sql`

**Changes:**
- Added `steps_source` column (VARCHAR(20), enum: 'manual', 'healthkit', 'google_fit')
- Added `steps_synced_at` column (TIMESTAMPTZ) - timestamp of last sync
- Added `is_override` column (BOOLEAN) - flag for manual overrides
- Created indexes for efficient queries on step source and sync timestamp
- Backfilled existing records with default values

**To Apply Migration:**
```sql
-- Run in Supabase SQL Editor
-- Copy contents of 024_healthkit_integration.sql and execute
```

### 2. TypeScript Types

**File:** `/Users/ani/Code/FitCircleCode/FitCircleBE/apps/web/app/lib/types/tracking.ts` (NEW)

**Exported Types:**
- `StepsSource` - Union type for step data sources
- `DailyTrackingEntry` - Complete tracking entry from database
- `DailyTrackingInput` - Input data for creating/updating entries
- `BulkSyncEntry` - Single entry in bulk sync request
- `BulkSyncRequest` - Bulk sync API request format
- `BulkSyncResult` - Result for a single synced entry
- `BulkSyncResponse` - Complete bulk sync API response

### 3. Service Layer

**File:** `/Users/ani/Code/FitCircleCode/FitCircleBE/apps/web/app/lib/services/mobile-api-service.ts`

**Changes to `upsertDailyTracking()` method:**

**New Parameters:**
```typescript
{
  steps_source?: 'manual' | 'healthkit' | 'google_fit';
  steps_synced_at?: string;
  is_override?: boolean;
}
```

**Conflict Resolution Logic:**

1. **Manual Override Protection**
   - If existing entry has `is_override = true`, auto-sync NEVER overwrites
   - Logs: "Preserving manual override for user X on date Y"

2. **Manual Entry Preservation**
   - If existing entry is manual and incoming is auto-sync (without override flag), keep manual
   - Logs: "Preserving manual entry over auto-sync for user X on date Y"

3. **Stale Sync Prevention**
   - If incoming auto-sync is older than existing `steps_synced_at`, skip update
   - Logs: "Skipping stale auto-sync for user X on date Y"

4. **Manual Override Detection**
   - If user manually edits auto-synced data, set `is_override = true`
   - Logs: "User manually overriding auto-synced data for date Y"

### 4. API Endpoints

#### Updated: POST /api/mobile/tracking/daily

**File:** `/Users/ani/Code/FitCircleCode/FitCircleBE/apps/web/app/api/mobile/tracking/daily/route.ts`

**New Request Fields:**
```typescript
{
  trackingDate: string;        // YYYY-MM-DD (required)
  weightKg?: number;
  steps?: number;
  moodScore?: number;
  energyLevel?: number;
  notes?: string;
  // NEW HealthKit fields
  stepsSource?: 'manual' | 'healthkit' | 'google_fit';
  stepsSyncedAt?: string;      // ISO datetime
  isOverride?: boolean;
}
```

**Response Includes:**
- All fields from `daily_tracking` table (including `steps_source`, `steps_synced_at`, `is_override`)
- Updated stats (streak, weekly average, etc.)

#### New: POST /api/mobile/tracking/bulk-sync

**File:** `/Users/ani/Code/FitCircleCode/FitCircleBE/apps/web/app/api/mobile/tracking/bulk-sync/route.ts`

**Purpose:**
- Efficiently sync 1-30 days of historical step data from HealthKit/Google Fit
- Use case: Initial connection, re-connection, offline backfill

**Request Format:**
```typescript
{
  steps_data: [
    { date: "2025-10-01", steps: 8247 },
    { date: "2025-10-02", steps: 10582 },
    // ... up to 30 entries
  ],
  source: "healthkit" | "google_fit"
}
```

**Response Format:**
```typescript
{
  success: true,
  synced_at: "2025-10-16T12:34:56Z",
  inserted_count: 15,      // New entries created
  updated_count: 10,       // Existing auto-sync entries updated
  skipped_count: 5,        // Manual entries preserved
  failed_count: 0,         // Errors
  results: [
    {
      date: "2025-10-01",
      success: true,
      action: "inserted",
    },
    {
      date: "2025-10-02",
      success: true,
      action: "skipped",
      reason: "manual override exists"
    }
  ],
  meta: {
    total_entries: 30,
    source: "healthkit",
    request_time: 234
  }
}
```

**Validation:**
- Minimum 1 entry, maximum 30 entries
- Each entry must have valid date (YYYY-MM-DD) and steps (0-1,000,000)
- Source must be 'healthkit' or 'google_fit'

**Conflict Resolution:**
- Always sets `is_override = false` (bulk sync never overrides manual entries)
- Respects existing manual entries and overrides
- Updates only if sync is newer than existing `steps_synced_at`

## Conflict Resolution Examples

### Scenario 1: Manual Entry Exists, HealthKit Syncs

**Initial State:**
```
Date: 2025-10-15
Steps: 5000
Source: manual
Is Override: false
```

**HealthKit Sync Request:**
```json
{
  "trackingDate": "2025-10-15",
  "steps": 7500,
  "stepsSource": "healthkit",
  "stepsSyncedAt": "2025-10-15T18:00:00Z"
}
```

**Result:** Manual entry preserved (5000 steps)
**Log:** "Preserving manual entry over auto-sync for user X on 2025-10-15"

---

### Scenario 2: User Overrides HealthKit Data

**Initial State:**
```
Date: 2025-10-15
Steps: 8000
Source: healthkit
Synced At: 2025-10-15T12:00:00Z
Is Override: false
```

**Manual Override Request:**
```json
{
  "trackingDate": "2025-10-15",
  "steps": 10000,
  "stepsSource": "manual"
}
```

**Result:**
```
Steps: 10000
Source: manual
Is Override: true
Synced At: null
```

**Future HealthKit Sync:** Will NOT overwrite (is_override = true)

---

### Scenario 3: Stale HealthKit Update

**Initial State:**
```
Date: 2025-10-15
Steps: 8000
Source: healthkit
Synced At: 2025-10-15T18:00:00Z
```

**Stale Sync Request:**
```json
{
  "trackingDate": "2025-10-15",
  "steps": 7500,
  "stepsSource": "healthkit",
  "stepsSyncedAt": "2025-10-15T12:00:00Z"  // Older than existing
}
```

**Result:** Skipped (existing data preserved)
**Log:** "Skipping stale auto-sync for user X on 2025-10-15"

---

### Scenario 4: Bulk Sync with Mixed Data

**Request:**
```json
{
  "steps_data": [
    { "date": "2025-10-01", "steps": 5000 },  // No existing entry
    { "date": "2025-10-02", "steps": 6000 },  // Manual entry exists
    { "date": "2025-10-03", "steps": 7000 }   // Old auto-sync exists
  ],
  "source": "healthkit"
}
```

**Results:**
```json
{
  "inserted_count": 1,  // 2025-10-01
  "updated_count": 1,   // 2025-10-03
  "skipped_count": 1,   // 2025-10-02 (manual preserved)
  "failed_count": 0
}
```

## Testing Guide

### Manual Testing Steps

#### 1. Database Migration Test

```sql
-- In Supabase SQL Editor

-- Run migration
-- (Copy 024_healthkit_integration.sql contents)

-- Verify new columns exist
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'daily_tracking'
  AND column_name IN ('steps_source', 'steps_synced_at', 'is_override');

-- Should return:
-- steps_source     | character varying | 'manual'
-- steps_synced_at  | timestamp with time zone | NULL
-- is_override      | boolean | false

-- Verify indexes
SELECT indexname FROM pg_indexes
WHERE tablename = 'daily_tracking'
  AND indexname LIKE '%steps%';

-- Should include:
-- idx_daily_tracking_steps_source
-- idx_daily_tracking_synced_at
```

#### 2. Manual Entry Test (Baseline)

```bash
# POST /api/mobile/tracking/daily
curl -X POST https://your-app.vercel.app/api/mobile/tracking/daily \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "trackingDate": "2025-10-16",
    "steps": 5000,
    "stepsSource": "manual"
  }'

# Expected Response:
# {
#   "success": true,
#   "data": {
#     "id": "...",
#     "steps": 5000,
#     "steps_source": "manual",
#     "is_override": false,
#     "steps_synced_at": null
#   }
# }
```

#### 3. HealthKit Sync Test

```bash
# Sync HealthKit data for same date
curl -X POST https://your-app.vercel.app/api/mobile/tracking/daily \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "trackingDate": "2025-10-16",
    "steps": 8000,
    "stepsSource": "healthkit",
    "stepsSyncedAt": "2025-10-16T12:00:00Z"
  }'

# Expected Response:
# {
#   "success": true,
#   "data": {
#     "steps": 5000,  # Manual entry PRESERVED
#     "steps_source": "manual",
#     "is_override": false
#   }
# }
```

#### 4. Manual Override Test

```bash
# User edits existing HealthKit data
# First, create HealthKit entry
curl -X POST https://your-app.vercel.app/api/mobile/tracking/daily \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "trackingDate": "2025-10-15",
    "steps": 8000,
    "stepsSource": "healthkit",
    "stepsSyncedAt": "2025-10-15T12:00:00Z"
  }'

# Then override with manual entry
curl -X POST https://your-app.vercel.app/api/mobile/tracking/daily \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "trackingDate": "2025-10-15",
    "steps": 10000,
    "stepsSource": "manual"
  }'

# Expected Response:
# {
#   "data": {
#     "steps": 10000,
#     "steps_source": "manual",
#     "is_override": true,  # Override flag set
#     "steps_synced_at": null
#   }
# }

# Now try to sync HealthKit again - should be ignored
curl -X POST https://your-app.vercel.app/api/mobile/tracking/daily \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "trackingDate": "2025-10-15",
    "steps": 8500,
    "stepsSource": "healthkit",
    "stepsSyncedAt": "2025-10-15T18:00:00Z"
  }'

# Expected Response:
# {
#   "data": {
#     "steps": 10000,  # Manual override PRESERVED
#     "is_override": true
#   }
# }
```

#### 5. Bulk Sync Test

```bash
# Sync 7 days of historical data
curl -X POST https://your-app.vercel.app/api/mobile/tracking/bulk-sync \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "steps_data": [
      { "date": "2025-10-10", "steps": 7500 },
      { "date": "2025-10-11", "steps": 8200 },
      { "date": "2025-10-12", "steps": 6800 },
      { "date": "2025-10-13", "steps": 9100 },
      { "date": "2025-10-14", "steps": 7900 },
      { "date": "2025-10-15", "steps": 8400 },
      { "date": "2025-10-16", "steps": 8700 }
    ],
    "source": "healthkit"
  }'

# Expected Response:
# {
#   "success": true,
#   "inserted_count": 5,  # New entries for dates 10-14
#   "updated_count": 0,
#   "skipped_count": 2,   # Dates 15-16 have manual entries
#   "failed_count": 0,
#   "results": [
#     { "date": "2025-10-10", "success": true, "action": "inserted" },
#     ...
#     { "date": "2025-10-15", "success": true, "action": "skipped", "reason": "manual override exists" }
#   ]
# }
```

#### 6. Stale Sync Test

```bash
# Create entry with recent sync timestamp
curl -X POST https://your-app.vercel.app/api/mobile/tracking/daily \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "trackingDate": "2025-10-14",
    "steps": 8000,
    "stepsSource": "healthkit",
    "stepsSyncedAt": "2025-10-14T18:00:00Z"
  }'

# Try to sync older data
curl -X POST https://your-app.vercel.app/api/mobile/tracking/daily \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "trackingDate": "2025-10-14",
    "steps": 7500,
    "stepsSource": "healthkit",
    "stepsSyncedAt": "2025-10-14T12:00:00Z"  # Older timestamp
  }'

# Expected: Steps should remain 8000 (newer sync preserved)
```

### Automated Test Scenarios

Create test file: `/FitCircleBE/apps/web/app/lib/services/__tests__/mobile-api-service-healthkit.test.ts`

```typescript
describe('MobileAPIService - HealthKit Integration', () => {
  describe('upsertDailyTracking - Conflict Resolution', () => {
    it('should preserve manual entry when HealthKit syncs', async () => {
      // Test Case 1
    });

    it('should mark manual override when user edits HealthKit data', async () => {
      // Test Case 2
    });

    it('should prevent stale HealthKit updates', async () => {
      // Test Case 3
    });

    it('should never overwrite manual overrides', async () => {
      // Test Case 4
    });
  });

  describe('Bulk Sync', () => {
    it('should insert new entries for dates without data', async () => {});
    it('should update existing auto-sync entries', async () => {});
    it('should skip manual entries', async () => {});
    it('should handle mixed scenarios correctly', async () => {});
    it('should enforce 30-day limit', async () => {});
  });
});
```

## Error Handling

### Validation Errors

**Invalid Date Format:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": {
      "trackingDate": "Invalid date format (YYYY-MM-DD)"
    }
  }
}
```

**Invalid Steps Source:**
```json
{
  "error": {
    "details": {
      "stepsSource": "Invalid enum value. Expected 'manual', 'healthkit', or 'google_fit'"
    }
  }
}
```

**Bulk Sync Too Large:**
```json
{
  "error": {
    "details": {
      "steps_data": "Maximum 30 days of data allowed"
    }
  }
}
```

### Authentication Errors

**Missing/Invalid Token:**
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token"
  }
}
```

## Logging

All conflict resolution decisions are logged for debugging:

```
[upsertDailyTracking] Preserving manual override for user abc123 on 2025-10-15
[upsertDailyTracking] Preserving manual entry over auto-sync for user abc123 on 2025-10-16
[upsertDailyTracking] Skipping stale auto-sync for user abc123 on 2025-10-14 (existing: 2025-10-14T18:00:00Z, incoming: 2025-10-14T12:00:00Z)
[upsertDailyTracking] User manually overriding auto-synced data for 2025-10-15
[Bulk Sync] User abc123 syncing 30 days from healthkit
[Bulk Sync] Completed for user abc123: inserted=15, updated=10, skipped=5, failed=0
```

## Database Schema Reference

```sql
CREATE TABLE daily_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tracking_date DATE NOT NULL,
  weight_kg DECIMAL(5,2) CHECK (weight_kg > 0 AND weight_kg < 1000),
  steps INTEGER CHECK (steps >= 0),
  mood_score INTEGER CHECK (mood_score >= 1 AND mood_score <= 10),
  energy_level INTEGER CHECK (energy_level >= 1 AND energy_level <= 10),
  notes TEXT,

  -- HealthKit Integration Fields (NEW)
  steps_source VARCHAR(20) DEFAULT 'manual' CHECK (steps_source IN ('manual', 'healthkit', 'google_fit')),
  steps_synced_at TIMESTAMPTZ,
  is_override BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tracking_date)
);

-- Indexes
CREATE INDEX idx_daily_tracking_user_date ON daily_tracking(user_id, tracking_date DESC);
CREATE INDEX idx_daily_tracking_steps_source ON daily_tracking(user_id, steps_source);
CREATE INDEX idx_daily_tracking_synced_at ON daily_tracking(user_id, steps_synced_at DESC) WHERE steps_synced_at IS NOT NULL;
```

## API Contract Summary

### POST /api/mobile/tracking/daily

**Request:**
```typescript
{
  trackingDate: string;              // YYYY-MM-DD (required)
  weightKg?: number;
  steps?: number;
  moodScore?: number;                // 1-10
  energyLevel?: number;              // 1-10
  notes?: string;
  stepsSource?: 'manual' | 'healthkit' | 'google_fit';
  stepsSyncedAt?: string;            // ISO datetime
  isOverride?: boolean;
}
```

**Response:**
```typescript
{
  success: true,
  data: DailyTrackingEntry,
  stats: {
    todaySteps: number | null,
    todayWeight: number | null,
    weeklyAvgSteps: number,
    currentStreak: number
  }
}
```

### POST /api/mobile/tracking/bulk-sync

**Request:**
```typescript
{
  steps_data: Array<{
    date: string;    // YYYY-MM-DD
    steps: number;   // 0 - 1,000,000
  }>,               // Min 1, Max 30 entries
  source: 'healthkit' | 'google_fit'
}
```

**Response:**
```typescript
{
  success: true,
  synced_at: string,
  inserted_count: number,
  updated_count: number,
  skipped_count: number,
  failed_count: number,
  results: Array<{
    date: string,
    success: boolean,
    action?: 'inserted' | 'updated' | 'skipped',
    reason?: string,
    error?: string
  }>,
  meta: {
    total_entries: number,
    source: string,
    request_time: number
  }
}
```

## Next Steps

1. **Run Database Migration**
   - Execute `024_healthkit_integration.sql` in Supabase SQL Editor
   - Verify columns and indexes are created

2. **Deploy Backend Changes**
   - Commit changes to git (when user approves)
   - Push to GitHub
   - Vercel will auto-deploy

3. **Test API Endpoints**
   - Use Postman or curl to test scenarios above
   - Verify conflict resolution logic
   - Test bulk sync with 30 days of data

4. **iOS Integration**
   - Implement HealthKitManager in iOS app
   - Call POST /api/mobile/tracking/daily with HealthKit data
   - Use POST /api/mobile/tracking/bulk-sync for initial connection

5. **Monitor Production**
   - Watch logs for conflict resolution decisions
   - Track bulk sync success rates
   - Monitor database performance with new indexes

## Backward Compatibility

- Existing manual entries are unaffected (backfilled with `steps_source='manual'`)
- Existing API calls without HealthKit fields continue to work
- `steps_source`, `steps_synced_at`, `is_override` are all optional
- Default behavior matches pre-HealthKit implementation (manual entry)

## Security Considerations

- All endpoints require valid JWT authentication
- User can only access their own tracking data
- Bulk sync limited to 30 days to prevent abuse
- Input validation prevents SQL injection
- Sanitization applied to notes field

## Performance Notes

- New indexes ensure efficient queries on `steps_source` and `steps_synced_at`
- Bulk sync processes entries sequentially (not parallel) to maintain data consistency
- Each bulk sync entry performs individual conflict resolution
- Expected bulk sync time: ~100-200ms per entry (~3-6 seconds for 30 days)

---

**Implementation Complete:** All backend changes ready for testing and deployment.
