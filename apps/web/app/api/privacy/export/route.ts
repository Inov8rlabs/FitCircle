import { type NextRequest, NextResponse } from 'next/server';

import { applyRateLimit, getIdentifier } from '@/lib/middleware/rate-limit';
import { DataExportService, dataExportRateLimiter } from '@/lib/services/data-export-service';
import { createServerSupabase } from '@/lib/supabase-server';

/**
 * GDPR Article 15: Right to Access
 * GDPR Article 20: Right to Data Portability
 *
 * Export all user data in machine-readable format (JSON). Free for every
 * signed-in account. The content is built by DataExportService (shared with
 * /api/mobile/privacy/export).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limited = await applyRateLimit(request, dataExportRateLimiter, getIdentifier(request, user.id));
    if (limited) return limited;

    console.log(`[Data Export] requested by user: ${user.id}`);

    const exportData = await DataExportService.buildExport(
      {
        id: user.id,
        email: user.email ?? null,
        created_at: user.created_at ?? null,
        last_sign_in_at: user.last_sign_in_at ?? null,
      },
      { platform: 'web' }
    );

    await DataExportService.logExport(user.id, {
      ipAddress: request.headers.get('x-forwarded-for'),
      platform: 'web',
    });

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="fitcircle-data-export-${user.id}-${Date.now()}.json"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Data export error:', error);
    return NextResponse.json(
      { error: 'Failed to export data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
