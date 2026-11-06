import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { applyRateLimit, getIdentifier } from '@/lib/middleware/rate-limit';
import { DataExportService, dataExportRateLimiter } from '@/lib/services/data-export-service';

/**
 * GET /api/mobile/privacy/export
 *
 * Mobile counterpart of /api/privacy/export (bearer auth instead of cookies).
 * Returns the raw JSON export (not wrapped in the mobile envelope): iOS and
 * Android save the bytes as a file. Free for every signed-in account. The
 * content is built by DataExportService.
 *
 * GDPR Article 15: Right to Access
 * GDPR Article 20: Right to Data Portability
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);

    const limited = await applyRateLimit(request, dataExportRateLimiter, getIdentifier(request, user.id));
    if (limited) return limited;

    console.log(`[Mobile Data Export] requested by user: ${user.id}`);

    const exportData = await DataExportService.buildExport(
      { id: user.id, email: user.email ?? null },
      { platform: 'mobile' }
    );

    await DataExportService.logExport(user.id, {
      ipAddress: request.headers.get('x-forwarded-for'),
      platform: 'mobile',
    });

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="fitcircle-data-export-${user.id}-${Date.now()}.json"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error: any) {
    if (error?.message === 'Unauthorized') {
      return NextResponse.json(
        {
          success: false,
          data: null,
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

    console.error('[Mobile Data Export] error:', error);
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: {
          code: 'EXPORT_FAILED',
          message: 'Failed to export data',
          details: { message: error instanceof Error ? error.message : 'Unknown error' },
          timestamp: new Date().toISOString(),
        },
        meta: null,
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
