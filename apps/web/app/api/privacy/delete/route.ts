import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { AccountDeletionService } from '@/lib/services/account-deletion-service';

/**
 * GDPR Article 17: Right to Erasure ("Right to be Forgotten")
 * CCPA: Right to Delete
 *
 * Permanently delete all user data
 * Must fulfill within 30 days (GDPR) or 45 days (CCPA)
 *
 * This endpoint uses the AccountDeletionService to ensure:
 * 1. Only the user's personal data is deleted
 * 2. Shared resources (FitCircles with other members) are preserved
 * 3. Ownership of shared challenges is transferred to another member
 * 4. Data integrity is maintained for other users
 * 5. Leaderboards are recalculated after user removal
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

    console.log(`⚠️ Account deletion requested by user: ${user.id} (${user.email})`);

    // Use the comprehensive AccountDeletionService
    const result = await AccountDeletionService.deleteAccount(user.id, {
      confirmEmail,
      userEmail: user.email,
      ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    });

    console.log(`✅ Account deletion completed: ${user.id}`);
    console.log(`   - Challenges transferred: ${result.challenges_transferred}`);
    console.log(`   - Challenges deleted: ${result.challenges_deleted}`);
    console.log(`   - Data deleted:`, result.data_summary);

    return NextResponse.json(result);
  } catch (error) {
    console.error('❌ Account deletion error:', error);
    return NextResponse.json(
      {
        error: 'Failed to delete account',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
