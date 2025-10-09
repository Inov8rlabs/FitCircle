import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { sendInvitationEmail, sendBatchInvitationEmails } from '@/lib/email/email-service';
import { z } from 'zod';

// Validation schema for single invite
const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
});

// Validation schema for batch invites
const batchInviteSchema = z.object({
  emails: z.array(z.string().email('Invalid email address')).min(1).max(50),
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

    // Get challenge details
    const { data: challenge, error: challengeError } = await supabase
      .from('challenges')
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

    // Get current participant count
    const { count: participantCount } = await supabase
      .from('challenge_participants')
      .select('*', { count: 'exact', head: true })
      .eq('challenge_id', challengeId)
      .eq('status', 'active');

    // Get inviter's name
    const inviterName = challenge.profiles?.display_name || user.email?.split('@')[0] || 'A friend';

    // Send invitations
    if (isBatch) {
      // Send batch invitations
      const invitations = emails.map((email) => ({
        to: email,
        invitedByName: inviterName,
        circleName: challenge.name,
        circleType: challenge.type as 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom',
        startDate: challenge.start_date,
        endDate: challenge.end_date,
        participantCount: participantCount || 1,
        inviteCode: challenge.invite_code,
      }));

      const results = await sendBatchInvitationEmails(invitations);

      return NextResponse.json({
        success: true,
        sent: results.success,
        failed: results.failed,
        errors: results.errors.length > 0 ? results.errors : undefined,
      });
    } else {
      // Send single invitation
      const result = await sendInvitationEmail({
        to: emails[0],
        invitedByName: inviterName,
        circleName: challenge.name,
        circleType: challenge.type as 'weight_loss' | 'step_count' | 'workout_frequency' | 'custom',
        startDate: challenge.start_date,
        endDate: challenge.end_date,
        participantCount: participantCount || 1,
        inviteCode: challenge.invite_code,
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
