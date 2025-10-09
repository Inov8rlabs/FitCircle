import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase-server';
import { createAdminSupabase } from '@/lib/supabase-admin';

export async function DELETE(
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

    // Only creator can delete
    if (challenge.creator_id !== user.id) {
      return NextResponse.json({ error: 'Only the creator can delete this challenge' }, { status: 403 });
    }

    // Use admin client to delete (bypasses RLS)
    const supabaseAdmin = createAdminSupabase();

    // Delete all challenge participants first (cascade should handle this, but being explicit)
    const { error: participantsError } = await supabaseAdmin
      .from('challenge_participants')
      .delete()
      .eq('challenge_id', challengeId);

    if (participantsError) {
      console.error('Error deleting participants:', participantsError);
      // Continue anyway - cascade should handle it
    }

    // Delete the challenge
    const { error: deleteError } = await supabaseAdmin
      .from('challenges')
      .delete()
      .eq('id', challengeId);

    if (deleteError) {
      console.error('Error deleting challenge:', deleteError);
      return NextResponse.json({ error: 'Failed to delete challenge' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Challenge deleted successfully' });
  } catch (error) {
    console.error('Error in delete challenge API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
