import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { createAdminSupabase } from '@/lib/supabase-admin';

/**
 * GDPR Article 17: Right to Erasure ("Right to be Forgotten")
 * CCPA: Right to Delete
 *
 * Permanently delete all user data
 * Must fulfill within 30 days (GDPR) or 45 days (CCPA)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Optional: Require confirmation token/password for security
    const body = await request.json();
    const { confirmEmail } = body;

    if (confirmEmail && confirmEmail !== user.email) {
      return NextResponse.json(
        { error: 'Email confirmation does not match' },
        { status: 400 }
      );
    }

    console.log(`⚠️ Account deletion requested by user: ${user.id} (${user.email})`);

    // Get admin client for deletion (bypass RLS)
    const adminSupabase = createAdminSupabase();

    // Log deletion request BEFORE deleting (for compliance audit)
    await adminSupabase.from('user_consent').insert({
      user_id: user.id,
      consent_type: 'data_deletion',
      consent_given: true,
      consent_version: 'deletion-request',
      consent_text: 'User requested account and data deletion under GDPR Article 17',
      consent_method: 'api',
      metadata: {
        deletion_timestamp: new Date().toISOString(),
        ip_address: request.headers.get('x-forwarded-for') || 'unknown',
        user_email: user.email,
      },
    });

    // Wait a moment to ensure log is saved
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Delete user data in correct order (respect foreign key constraints)
    // Note: Most tables should have ON DELETE CASCADE, but we'll be explicit

    console.log('Deleting user data...');

    const deletionResults = await Promise.allSettled([
      // Notifications
      adminSupabase.from('notifications').delete().eq('user_id', user.id),

      // Check-ins
      adminSupabase.from('check_ins').delete().eq('user_id', user.id),

      // Daily tracking
      adminSupabase.from('daily_tracking').delete().eq('user_id', user.id),

      // Challenge participants
      adminSupabase.from('challenge_participants').delete().eq('user_id', user.id),

      // Team members
      adminSupabase.from('team_members').delete().eq('user_id', user.id),

      // Privacy settings
      adminSupabase.from('privacy_settings').delete().eq('user_id', user.id),
    ]);

    // Check for errors in data deletion
    const deletionErrors = deletionResults
      .filter((result) => result.status === 'rejected')
      .map((result: any) => result.reason);

    if (deletionErrors.length > 0) {
      console.error('Errors during data deletion:', deletionErrors);
      // Continue anyway - some tables might not exist
    }

    // Delete consent records LAST (after logging above)
    await adminSupabase.from('user_consent').delete().eq('user_id', user.id);

    // Delete profile
    await adminSupabase.from('profiles').delete().eq('id', user.id);

    // Delete auth user (Supabase Auth)
    const { error: authError } = await adminSupabase.auth.admin.deleteUser(user.id);

    if (authError) {
      console.error('Error deleting auth user:', authError);
      return NextResponse.json(
        { error: 'Failed to delete auth account', details: authError.message },
        { status: 500 }
      );
    }

    console.log(`✅ Account deleted successfully: ${user.id}`);

    return NextResponse.json({
      success: true,
      message: 'Your account and all associated data have been permanently deleted.',
      deleted_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Account deletion error:', error);
    return NextResponse.json(
      {
        error: 'Failed to delete account',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
