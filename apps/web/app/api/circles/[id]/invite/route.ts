import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { CircleService } from '@/app/lib/services/circle-service';
import { z } from 'zod';

// Validation schema for creating an invite
const createInviteSchema = z.object({
  emails: z.array(z.string().email()).optional(),
  message: z.string().max(200).optional(),
});

// POST /api/circles/[id]/invite - Generate invite or send email invites
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Get authenticated user
    const supabase = createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user is a member of the circle
    const members = await CircleService.getCircleMembers(params.id);
    const isMember = members.some(m => m.user_id === user.id);

    if (!isMember) {
      return NextResponse.json(
        { error: 'You must be a member of this circle to invite others' },
        { status: 403 }
      );
    }

    // Get circle details for invite link
    const circle = await CircleService.getCircle(params.id);

    // Parse request body if present (for email invites)
    const body = await request.json().catch(() => ({}));
    const validation = createInviteSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          validation_errors: validation.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          }))
        },
        { status: 400 }
      );
    }

    const { emails, message } = validation.data;

    // Process email invites if provided
    const inviteResults = [];
    const failedEmails = [];

    if (emails && emails.length > 0) {
      for (const email of emails) {
        try {
          const invite = await CircleService.createInvite(params.id, user.id, email);
          inviteResults.push(invite);

          // TODO: Send email notification here (would integrate with email service)
          // For MVP, we'll just create the invite record
        } catch (error) {
          failedEmails.push(email);
        }
      }
    } else {
      // Just create a general invite record without email
      const invite = await CircleService.createInvite(params.id, user.id);
      inviteResults.push(invite);
    }

    // Generate invite link and share text
    const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL || 'https://fitcircle.app'}/join/${circle.invite_code}`;

    const durationDays = Math.ceil(
      (new Date(circle.end_date).getTime() - new Date(circle.start_date).getTime()) / (24 * 60 * 60 * 1000)
    );

    const shareText = `Hey! I'm starting a ${durationDays}-day fitness challenge on ${new Date(circle.start_date).toLocaleDateString()}.
Join my FitCircle - we track progress % only, your actual data stays private!
${inviteLink}`;

    return NextResponse.json({
      success: true,
      data: {
        invite_code: circle.invite_code,
        invite_link: inviteLink,
        share_text: shareText,
        sent: inviteResults.length - failedEmails.length,
        failed: failedEmails,
      }
    });
  } catch (error: any) {
    console.error('Create invite error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create invite' },
      { status: 500 }
    );
  }
}