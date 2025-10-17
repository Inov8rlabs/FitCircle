import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { MobileAPIService } from '@/lib/services/mobile-api-service';
import type { BulkSyncResult } from '@/lib/types/tracking';

// Validation schema for bulk sync
const bulkSyncSchema = z.object({
  steps_data: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
        steps: z.number().int().min(0).max(1000000), // Max 1M steps per day (sanity check)
      })
    )
    .min(1, 'At least one entry required')
    .max(30, 'Maximum 30 days of data allowed'),
  source: z.enum(['healthkit', 'google_fit']),
});

/**
 * POST /api/mobile/tracking/bulk-sync
 * Bulk upsert daily step tracking data from HealthKit or Google Fit
 *
 * Use cases:
 * - Initial HealthKit connection: sync last 30 days of historical data
 * - Re-connection after disconnect: backfill missing days
 * - Batch sync after offline period
 *
 * Request body:
 * {
 *   "steps_data": [
 *     { "date": "2025-10-01", "steps": 8247 },
 *     { "date": "2025-10-02", "steps": 10582 }
 *   ],
 *   "source": "healthkit" | "google_fit"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "synced_at": "2025-10-16T12:34:56Z",
 *   "inserted_count": 15,
 *   "updated_count": 10,
 *   "skipped_count": 5,
 *   "failed_count": 0,
 *   "results": [
 *     { "date": "2025-10-01", "success": true, "action": "inserted" },
 *     { "date": "2025-10-02", "success": true, "action": "updated" },
 *     { "date": "2025-10-03", "success": true, "action": "skipped", "reason": "manual override exists" }
 *   ]
 * }
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Verify authentication
    const user = await requireMobileAuth(request);

    // Parse and validate request body
    const body = await request.json();
    const validatedData = bulkSyncSchema.parse(body);

    const syncedAt = new Date().toISOString();
    const results: BulkSyncResult[] = [];

    console.log(
      `[Bulk Sync] User ${user.id} syncing ${validatedData.steps_data.length} days from ${validatedData.source}`
    );

    // Process each entry
    for (const entry of validatedData.steps_data) {
      try {
        const trackingEntry = await MobileAPIService.upsertDailyTracking(
          user.id,
          entry.date,
          {
            steps: entry.steps,
            steps_source: validatedData.source,
            steps_synced_at: syncedAt,
            is_override: false, // Bulk sync never overrides manual entries
          }
        );

        // Determine action taken based on response
        // If the returned steps match what we sent, it was inserted/updated
        // If they differ, it was skipped (manual entry preserved)
        const action: 'inserted' | 'updated' | 'skipped' =
          trackingEntry.steps === entry.steps
            ? trackingEntry.created_at === trackingEntry.updated_at
              ? 'inserted'
              : 'updated'
            : 'skipped';

        results.push({
          date: entry.date,
          success: true,
          action,
          reason:
            action === 'skipped'
              ? trackingEntry.is_override
                ? 'manual override exists'
                : 'manual entry exists'
              : undefined,
        });
      } catch (error: any) {
        console.error(`[Bulk Sync] Failed to sync ${entry.date}:`, error);
        results.push({
          date: entry.date,
          success: false,
          error: error.message || 'Unknown error',
        });
      }
    }

    // Calculate summary statistics
    const insertedCount = results.filter((r) => r.action === 'inserted').length;
    const updatedCount = results.filter((r) => r.action === 'updated').length;
    const skippedCount = results.filter((r) => r.action === 'skipped').length;
    const failedCount = results.filter((r) => !r.success).length;

    console.log(
      `[Bulk Sync] Completed for user ${user.id}: inserted=${insertedCount}, updated=${updatedCount}, skipped=${skippedCount}, failed=${failedCount}`
    );

    return NextResponse.json({
      success: true,
      synced_at: syncedAt,
      inserted_count: insertedCount,
      updated_count: updatedCount,
      skipped_count: skippedCount,
      failed_count: failedCount,
      results,
      meta: {
        total_entries: validatedData.steps_data.length,
        source: validatedData.source,
        request_time: Date.now() - startTime,
      },
      error: null,
    });
  } catch (error: any) {
    console.error('[Mobile API] Bulk sync error:', {
      userId: error.userId,
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });

    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            details: {},
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 401 }
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.errors.reduce((acc: any, err) => {
              acc[err.path.join('.')] = err.message;
              return acc;
            }, {}),
            timestamp: new Date().toISOString(),
          },
          meta: null,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred during bulk sync',
          details: {},
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500 }
    );
  }
}
