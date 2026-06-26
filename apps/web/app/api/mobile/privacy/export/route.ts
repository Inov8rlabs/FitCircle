import { type NextRequest, NextResponse } from 'next/server';

import { requireMobileAuth } from '@/lib/middleware/mobile-auth';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GET /api/mobile/privacy/export
 *
 * Mobile counterpart of /api/privacy/export. Uses the mobile bearer
 * middleware instead of cookie auth and gathers the same user data
 * (profile, daily_tracking, check-ins, fitcircle_members, notifications,
 * consents, privacy settings), returning a JSON download.
 *
 * GDPR Article 15: Right to Access
 * GDPR Article 20: Right to Data Portability
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireMobileAuth(request);
    const supabase = createAdminSupabase();

    console.log(`[Mobile Data Export] requested by user: ${user.id}`);

    // Gather all user data from all tables
    const [
      profile,
      dailyTracking,
      challenges,
      checkIns,
      notifications,
      consent,
      privacySettings,
    ] = await Promise.all([
      // Profile data
      supabase.from('profiles').select('*').eq('id', user.id).single(),

      // Daily tracking data (weight, steps, etc.)
      supabase
        .from('daily_tracking')
        .select('*')
        .eq('user_id', user.id)
        .order('tracking_date', { ascending: false }),

      // Challenge participation
      supabase
        .from('fitcircle_members')
        .select(
          `
          *,
          challenges (
            id,
            name,
            description,
            type,
            start_date,
            end_date,
            status
          )
        `
        )
        .eq('user_id', user.id),

      // Check-ins (if table exists)
      supabase.from('check_ins').select('*').eq('user_id', user.id).then(
        (result) => result,
        () => ({ data: [], error: null })
      ),

      // Notifications
      supabase.from('notifications').select('*').eq('user_id', user.id).then(
        (result) => result,
        () => ({ data: [], error: null })
      ),

      // Consent history (audit trail)
      supabase
        .from('user_consent')
        .select('*')
        .eq('user_id', user.id)
        .order('consent_timestamp', { ascending: false }),

      // Privacy settings
      supabase.from('privacy_settings').select('*').eq('user_id', user.id).single().then(
        (result) => result,
        () => ({ data: null, error: null })
      ),
    ]);

    // Compile export data
    const exportData = {
      export_metadata: {
        export_date: new Date().toISOString(),
        export_format: 'JSON',
        gdpr_article: 'Article 15 (Right to Access) & Article 20 (Right to Data Portability)',
        user_id: user.id,
      },
      account: {
        user_id: user.id,
        email: user.email,
        created_at: profile.data?.created_at || null,
        last_sign_in_at: profile.data?.last_active_at || null,
      },
      profile: profile.data || null,
      health_data: {
        daily_tracking: dailyTracking.data || [],
        check_ins: checkIns.data || [],
        record_count: (dailyTracking.data?.length || 0) + (checkIns.data?.length || 0),
      },
      challenges: {
        participations: challenges.data || [],
        count: challenges.data?.length || 0,
      },
      notifications: notifications.data || [],
      privacy: {
        consent_history: consent.data || [],
        current_settings: privacySettings.data || null,
      },
    };

    // Log the export for compliance audit
    await supabase.from('user_consent').insert({
      user_id: user.id,
      consent_type: 'data_deletion', // Reuse type for logging export
      consent_given: true,
      consent_version: 'data-export',
      consent_text: 'User requested data export under GDPR Article 15',
      consent_method: 'api',
      metadata: {
        export_timestamp: new Date().toISOString(),
        ip_address: request.headers.get('x-forwarded-for') || 'unknown',
        platform: 'mobile',
      },
    });

    // Return as JSON download
    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="fitcircle-data-export-${user.id}-${Date.now()}.json"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
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
      { status: 500 }
    );
  }
}
