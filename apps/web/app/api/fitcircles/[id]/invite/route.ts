import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { sendInvitationEmail, sendBatchInvitationEmails } from '@/lib/email/email-service';
import { INVALID_EMAIL_MESSAGE, checkInviteEmails } from '@/lib/email/invite-email-check';
import { contactHash } from '@/lib/services/referral-invite-service';
import { createAdminSupabase } from '@/lib/supabase-admin';
import { createServerSupabase } from '@/lib/supabase-server';

// Shape only — addresses are validated by checkInviteEmails (typos, real TLD, DNS) below.
const inviteSchema = z.object({
  email: z.string().max(320),
});

const batchInviteSchema = z.object({
  emails: z.array(z.string().max(320)).min(1).max(50),
});

/**
 * POST /api/fitcircles/[id]/invite
 * Send invitation email(s) to join a FitCircle
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createServerSupabase();
    const { id: challengeId } = await context.params;

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();

    // Determine if single or batch invite
    const isBatch = Array.isArray(body.emails);
    let emails: string[];

    if (isBatch) {
      const validated = batchInviteSchema.parse(body);
      emails = validated.emails;
    } else {
      const validated = inviteSchema.parse(body);
      emails = [validated.email];
    }

    // Reject typos (`…@yahoo.comr`) before anything is sent: 422 with a suggestion per address.
    const { invalid, normalized } = await checkInviteEmails(emails.map((email, index) => ({ index, email })));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: 'INVALID_EMAIL', message: INVALID_EMAIL_MESSAGE, invalidEmails: invalid },
        { status: 422, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    emails = emails.map((_, index) => normalized.get(index)!);

    // Suppression: never mail an address that unsubscribed from invites (or, once the
    // Resend bounce webhook lands, hard-bounced — it should write to the same table).
    const hashes = emails.map((email) => contactHash('email', email.toLowerCase()));
    const { data: optouts } = await createAdminSupabase()
      .from('referral_email_optouts')
      .select('email_hash')
      .in('email_hash', hashes);
    const suppressed = new Set(((optouts ?? []) as Array<{ email_hash: string }>).map((o) => o.email_hash));
    const skipped = emails.filter((_, i) => suppressed.has(hashes[i]));
    emails = emails.filter((_, i) => !suppressed.has(hashes[i]));
    if (emails.length === 0) {
      return NextResponse.json({ success: true, sent: 0, failed: 0, skipped: skipped.length, message: 'Nothing to send' });
    }

    // Get challenge details
    const { data: challenge, error: challengeError } = await supabase
      .from('fitcircles')
      .select(`
        id,
        name,
        type,
        start_date,
        end_date,
        invite_code,
        creator_id,
        profiles:creator_id (
          display_name
        )
      `)
      .eq('id', challengeId)
      .single();

    if (challengeError || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });
    }

    // Cast to any for type flexibility with Supabase joins
    const challengeData = challenge as any;

    // Get current participant count
    const { count: participantCount } = await supabase
      .from('fitcircle_members')
      .select('*', { count: 'exact', head: true })
      .eq('fitcircle_id', challengeId)
      .eq('status', 'active');

    // Get inviter's name
    const inviterName = challengeData.profiles?.display_name || user.email?.split('@')[0] || 'A friend';

    // Send invitations
    if (isBatch) {
      // Send batch invitations
      const invitations = emails.map((email) => ({
        to: email,
        invitedByName: inviterName,
        circleName: challengeData.name,
        circleType: challengeData.type as 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom',
        startDate: challengeData.start_date,
        endDate: challengeData.end_date,
        participantCount: participantCount || 1,
        inviteCode: challengeData.invite_code,
      }));

      const results = await sendBatchInvitationEmails(invitations);

      return NextResponse.json({
        success: true,
        sent: results.success,
        failed: results.failed,
        skipped: skipped.length,
        errors: results.errors.length > 0 ? results.errors : undefined,
      });
    } else {
      // Send single invitation
      const result = await sendInvitationEmail({
        to: emails[0],
        invitedByName: inviterName,
        circleName: challengeData.name,
        circleType: challengeData.type as 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom',
        startDate: challengeData.start_date,
        endDate: challengeData.end_date,
        participantCount: participantCount || 1,
        inviteCode: challengeData.invite_code,
      });

      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'Failed to send invitation' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `Invitation sent to ${emails[0]}`,
      });
    }
  } catch (error) {
    console.error('Error in invite API:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
