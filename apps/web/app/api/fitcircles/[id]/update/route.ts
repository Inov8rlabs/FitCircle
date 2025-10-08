import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';

export async function PATCH(
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

    // Get the challenge to verify ownership
    const { data: challenge, error: fetchError } = await supabase
      .from('challenges')
      .select('creator_id')
      .eq('id', challengeId)
      .single();

    if (fetchError || !challenge) {
      return NextResponse.json({ error: 'Challenge not found' }, { status: 404 });
    }

    // Only creator can update
    if (challenge.creator_id !== user.id) {
      return NextResponse.json({ error: 'Only the creator can update this challenge' }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { name, start_date, end_date } = body;

    // Build update object
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (start_date !== undefined) {
      // Ensure date is stored at noon UTC to avoid timezone issues
      // This prevents "Sept 1" from becoming "Aug 31" due to timezone shifts
      const normalizedStartDate = start_date.includes('T') ? start_date : `${start_date}T12:00:00Z`;
      updates.start_date = normalizedStartDate;
      // Also update registration_deadline to be same as start_date or earlier
      // to satisfy the constraint: registration_deadline <= start_date
      updates.registration_deadline = normalizedStartDate;
    }
    if (end_date !== undefined) {
      // Ensure date is stored at noon UTC to avoid timezone issues
      const normalizedEndDate = end_date.includes('T') ? end_date : `${end_date}T12:00:00Z`;
      updates.end_date = normalizedEndDate;
    }

    // Validate dates if both are being updated or if one is being updated
    if (start_date && end_date) {
      if (new Date(start_date) >= new Date(end_date)) {
        return NextResponse.json({ error: 'Start date must be before end date' }, { status: 400 });
      }
    } else if (start_date) {
      // Get current end date from challenge
      const { data: currentChallenge } = await supabase
        .from('challenges')
        .select('end_date')
        .eq('id', challengeId)
        .single();

      if (currentChallenge && new Date(start_date) >= new Date(currentChallenge.end_date)) {
        return NextResponse.json({ error: 'Start date must be before end date' }, { status: 400 });
      }
    } else if (end_date) {
      // Get current start date from challenge
      const { data: currentChallenge } = await supabase
        .from('challenges')
        .select('start_date')
        .eq('id', challengeId)
        .single();

      if (currentChallenge && new Date(end_date) <= new Date(currentChallenge.start_date)) {
        return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 });
      }
    }

    // Update challenge
    const { data, error: updateError } = await supabase
      .from('challenges')
      .update(updates)
      .eq('id', challengeId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating challenge:', updateError);
      return NextResponse.json({ error: 'Failed to update challenge' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error in update challenge API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
