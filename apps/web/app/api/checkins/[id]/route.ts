import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { cookies } from 'next/headers';

// Validation schema for updates
const updateCheckInSchema = z.object({
  weight: z.number().optional(),
  photos: z.object({
    front: z.string().optional(),
    side: z.string().optional(),
    back: z.string().optional(),
  }).optional(),
  measurements: z.object({
    chest: z.number().optional(),
    waist: z.number().optional(),
    hips: z.number().optional(),
    arms: z.number().optional(),
    thighs: z.number().optional(),
  }).optional(),
  mood: z.enum(['amazing', 'good', 'okay', 'tired', 'stressed']).optional(),
  energy: z.number().min(1).max(10).optional(),
  sleep: z.number().min(0).max(24).optional(),
  water: z.number().min(0).optional(),
  notes: z.string().optional(),
  workouts: z.array(z.object({
    type: z.string(),
    duration: z.number(),
    calories: z.number().optional(),
  })).optional(),
  nutrition: z.object({
    calories: z.number().optional(),
    protein: z.number().optional(),
    carbs: z.number().optional(),
    fat: z.number().optional(),
  }).optional(),
});

// Helper function to get authenticated user
async function getAuthenticatedUser(request: NextRequest) {
  const cookieStore = cookies();
  const accessToken = cookieStore.get('sb-access-token')?.value;

  if (!accessToken) {
    return null;
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  const { data: { user }, error } = await supabase.auth.getUser(accessToken);

  if (error || !user) {
    return null;
  }

  return user;
}

// GET /api/checkins/[id] - Get a specific check-in
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await params;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from('checkins')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Check-in not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      checkIn: data,
    });

  } catch (error) {
    console.error('Get check-in error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// PATCH /api/checkins/[id] - Update a check-in
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await params;

    // Parse and validate request body
    const body = await request.json();
    const validatedData = updateCheckInSchema.parse(body);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify ownership
    const { data: existingCheckIn } = await supabase
      .from('checkins')
      .select('user_id')
      .eq('id', id)
      .single();

    if (!existingCheckIn || existingCheckIn.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Check-in not found' },
        { status: 404 }
      );
    }

    // Update check-in
    const { data, error } = await supabase
      .from('checkins')
      .update({
        ...validatedData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Update check-in error:', error);
      return NextResponse.json(
        { error: 'Failed to update check-in' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      checkIn: data,
      message: 'Check-in updated successfully!',
    });

  } catch (error) {
    console.error('Update check-in error:', error);

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

// DELETE /api/checkins/[id] - Delete a check-in
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthenticatedUser(request);

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id } = await params;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify ownership
    const { data: existingCheckIn } = await supabase
      .from('checkins')
      .select('user_id, xp_earned')
      .eq('id', id)
      .single();

    if (!existingCheckIn || existingCheckIn.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Check-in not found' },
        { status: 404 }
      );
    }

    // Delete check-in
    const { error } = await supabase
      .from('checkins')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Delete check-in error:', error);
      return NextResponse.json(
        { error: 'Failed to delete check-in' },
        { status: 500 }
      );
    }

    // Update user's XP (subtract the XP that was earned)
    if (existingCheckIn.xp_earned) {
      await updateUserXP(user.id, -existingCheckIn.xp_earned);
    }

    return NextResponse.json({
      message: 'Check-in deleted successfully!',
    });

  } catch (error) {
    console.error('Delete check-in error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Helper function to update user's total XP
async function updateUserXP(userId: string, xpChange: number) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get current XP
  const { data: profile } = await supabase
    .from('profiles')
    .select('total_xp, level')
    .eq('id', userId)
    .single();

  const currentXP = profile?.total_xp || 0;
  const newXP = Math.max(0, currentXP + xpChange); // Don't go below 0

  // Calculate new level
  const newLevel = Math.floor(newXP / 100) + 1;

  // Update profile
  await supabase
    .from('profiles')
    .update({
      total_xp: newXP,
      level: newLevel,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
}